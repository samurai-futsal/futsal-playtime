// MATCH PLAY recording engine (spec 3章・4章・6章「パワープレー」・11章).
//
// Everything that happens in MATCH PLAY is saved as an append-only list of operations ("ops").
// This module rebuilds the whole match state by replaying that list from the beginning, so:
//   - 1つ戻す (undo) = add an 'undo' op; replay drops the most recent remaining op
//   - リセット = add a 'reset' op; replay drops the earlier ops of that period
//   - reload / crash / another device = same ops → same state
// Playing time is never stored; it is always computed from the ops (spec 3章).
//
// Times: op.t is the device's real clock (ms). Inside a period, "elapsed" is the playing time in ms
// (counts up; the screen shows the countdown). Cumulative time across periods is used for rest time.

export const PERIODS = [
  { key: '1H', label: '前半', extra: false },
  { key: '2H', label: '後半', extra: false },
  { key: 'E1', label: '延長前半', extra: true },
  { key: 'E2', label: '延長後半', extra: true },
];
export const periodLabel = (k) => PERIODS.find((p) => p.key === k)?.label || k;
export const EJECT_WAIT = 120000; // 退場後の補充まで 2:00（プレーイングタイム）

// cfg: { times:{half, extra, extraHalf}, members:{pid:{no,pos,pp}}, setplayAuto (sec) }
export function periodLen(cfg, key) {
  const t = cfg.times || {};
  return (PERIODS.find((p) => p.key === key)?.extra ? (t.extraHalf || 5) : (t.half || 20)) * 60000;
}

// ---- which ops count: undo pops the latest remaining op; reset drops earlier ops of that period ----
export function effectiveOps(ops) {
  const sorted = [...ops].sort((a, b) => a.t - b.t || (a.n || 0) - (b.n || 0) || String(a.id).localeCompare(String(b.id)));
  const stack = [];
  for (const op of sorted) {
    if (op.type === 'undo') { stack.pop(); continue; }
    stack.push(op);
  }
  // apply resets: drop earlier ops of the reset period (or all, for a whole-match reset)
  const out = [];
  for (let i = 0; i < stack.length; i++) {
    const op = stack[i];
    if (op.type === 'reset') {
      for (let j = out.length - 1; j >= 0; j--) {
        if (op.scope === 'all' || out[j].period === op.scope) out.splice(j, 1);
      }
      out.push(op);
      continue;
    }
    out.push(op);
  }
  return { list: out, lastUndoable: stack[stack.length - 1] || null };
}

const isGK = (cfg, pid) => cfg.members?.[pid]?.pos === 'GK';
const isPP = (cfg, pid) => !!cfg.members?.[pid]?.pp;

function newPeriod(key) {
  return { key, status: 'none', elapsed: 0, runningSince: null, startedAt: null, endedAt: null };
}

export function replay(ops, cfg) {
  const { list, lastUndoable } = effectiveOps(ops);
  const S = {
    cfg,
    current: '1H',           // period shown / recorded now
    matchOver: false,
    askExtra: false,         // 後半が終わり、延長戦をやるか確認する段階
    periods: Object.fromEntries(PERIODS.map((p) => [p.key, newPeriod(p.key)])),
    seats: [null, null, null, null, null], // pid on each seat (null = empty, ejected)
    seatSince: [0, 0, 0, 0, 0],
    empty: [null, null, null, null, null], // {from, pid} when a seat is empty after 退場
    batch: { outs: [], ins: [] },          // 交代待ち: outs [{pid, seat, outAt}], ins [pid]
    stints: [],              // {period, pid, seat, from, to(null=ongoing)}
    empties: [],             // {period, seat, pid, from, to}
    ejected: new Set(),
    ejections: [],           // {period, pid, at, early fill flags...}
    fills: [],               // {period, seat, pid, at, early}
    cont: {},                // pid -> elapsed at which the continuous timer started (current period)
    carry: {},               // pid -> continuous time kept for 「続き」 (set play)
    lastOut: {},             // pid -> cumulative ms when they last left the pitch (rest time)
    setplay: null,           // {from, endsAt, onAtStart:Set, left:Set}
    pp: [],                  // 5x4 periods {team, period, from, to, auto}
    ppActive: null,
    timeouts: [],            // {team, period, at}
    adjusts: [],             // {period, at, from, to}
    notices: [],             // messages produced by the last op (for the screen)
    lastUndoable,
    base: {},                // cumulative offset of each period (sum of earlier periods' elapsed)
    lineupDraft: null,
  };
  const P = () => S.periods[S.current];
  const cum = (elapsed) => (S.base[S.current] || 0) + elapsed;

  const elapsedAt = (t) => {
    const p = P();
    if (p.runningSince == null) return p.elapsed;
    return Math.min(p.elapsed + Math.max(0, t - p.runningSince), periodLen(cfg, S.current));
  };
  const openStint = (pid, seat, at) => S.stints.push({ period: S.current, pid, seat, from: at, to: null });
  const closeStint = (pid, at) => {
    const s = S.stints.find((x) => x.period === S.current && x.pid === pid && x.to == null);
    if (s) s.to = Math.max(s.from, at);
  };
  const onPitch = () => S.seats.filter(Boolean);

  function endSetplay() {
    S.setplay = null; S.carry = {};
  }
  function maybeExpireSetplay(at) {
    if (S.setplay && at >= S.setplay.endsAt) endSetplay();
  }

  function commitBatch(at, partial = false) {
    const outs = [...S.batch.outs].sort((a, b) => a.outAt - b.outAt);
    const ins = [...S.batch.ins];
    const n = partial ? Math.min(outs.length, ins.length) : outs.length;
    const pairs = [];
    for (let i = 0; i < n; i++) pairs.push([outs[i], ins[i]]);
    for (const [o, inPid] of pairs) {
      closeStint(o.pid, o.outAt);
      S.lastOut[o.pid] = cum(o.outAt);
      if (S.setplay && S.setplay.onAtStart.has(o.pid)) {
        S.carry[o.pid] = Math.max(0, o.outAt - (S.cont[o.pid] ?? o.outAt));
        S.setplay.left.add(o.pid);
      }
      delete S.cont[o.pid];
      S.seats[o.seat] = inPid; S.seatSince[o.seat] = o.outAt;
      openStint(inPid, o.seat, o.outAt);
      if (S.carry[inPid] != null) { S.cont[inPid] = o.outAt - S.carry[inPid]; delete S.carry[inPid]; }
      else S.cont[inPid] = o.outAt;
      delete S.lastOut[inPid];
    }
    S.batch = { outs: [], ins: [] };
    if (!pairs.length) return;
    // set play mode ends when everyone who left during it is back on the pitch
    if (S.setplay && S.setplay.left.size && [...S.setplay.left].every((pid) => S.seats.includes(pid))) endSetplay();
    // GK check / 5x4 auto start (spec 6章・11章)
    const gkOn = onPitch().some((pid) => isGK(cfg, pid));
    const gkLeft = pairs.some(([o]) => isGK(cfg, o.pid));
    if (!gkOn && gkLeft) {
      const ppIn = pairs.some(([, i]) => isPP(cfg, i));
      if (ppIn) {
        if (!S.ppActive) { S.ppActive = { team: 'own', period: S.current, from: at, to: null, auto: true }; S.pp.push(S.ppActive); S.notices.push({ kind: 'ppAuto' }); }
      } else S.notices.push({ kind: 'noGK' });
    }
  }

  function endPeriod(at) {
    const p = P();
    // 交代待ちが残っていたら、入った分だけ交代し、残りは最後まで出場したものとする（spec 3章）
    if (S.batch.outs.length) {
      if (S.batch.ins.length) commitBatch(at, true);
      S.batch = { outs: [], ins: [] };
    }
    S.stints.filter((s) => s.period === S.current && s.to == null).forEach((s) => { s.to = at; });
    S.empty.forEach((e, i) => { if (e) { const r = S.empties.find((x) => x.period === S.current && x.seat === i && x.to == null); if (r) r.to = at; } });
    onPitch().forEach((pid) => { S.lastOut[pid] = cum(at); });
    if (S.ppActive) { S.ppActive.to = at; S.ppActive = null; }
    endSetplay();
    p.elapsed = at; p.runningSince = null; p.status = 'done';
    S.seats = [null, null, null, null, null]; S.empty = [null, null, null, null, null]; S.cont = {};
    goNext();
  }
  // 次の「記録のないピリオド」へ進む。すべて記録済みなら試合終了（spec 11章）
  function goNext() {
    const free = (k) => S.periods[k].status === 'none';
    if (free('1H')) { S.current = '1H'; return; }
    if (free('2H')) { S.current = '2H'; return; }
    if (S.extraDecided === undefined && free('E1')) { S.askExtra = true; return; }
    if (S.extraDecided && free('E1')) { S.current = 'E1'; return; }
    if (S.extraDecided && free('E2')) { S.current = 'E2'; return; }
    S.matchOver = true;
  }

  for (const op of list) {
    S.notices = [];
    if (op.type === 'reset') {
      // restart the replay state for that period (or whole match): handled by effectiveOps dropping ops;
      // here we only rewind what belonged to the period.
      const scope = op.scope;
      const keys = scope === 'all' ? PERIODS.map((p) => p.key) : [scope];
      for (const k of keys) {
        S.periods[k] = newPeriod(k);
        S.stints = S.stints.filter((s) => s.period !== k);
        S.empties = S.empties.filter((s) => s.period !== k);
        S.pp = S.pp.filter((s) => s.period !== k);
        S.timeouts = S.timeouts.filter((s) => s.period !== k);
        S.ejections = S.ejections.filter((s) => s.period !== k);
        S.fills = S.fills.filter((s) => s.period !== k);
        S.adjusts = S.adjusts.filter((s) => s.period !== k);
      }
      if (scope === 'all') { S.ejected = new Set(); S.lastOut = {}; S.base = {}; S.matchOver = false; S.askExtra = false; S.extraDecided = undefined; S.current = '1H'; }
      else {
        S.ejected = new Set(S.ejections.map((e) => e.pid));
        S.matchOver = false; S.askExtra = false;
        S.current = scope;
      }
      if (S.ppActive && keys.includes(S.ppActive.period)) S.ppActive = null;
      S.seats = [null, null, null, null, null]; S.empty = [null, null, null, null, null];
      S.batch = { outs: [], ins: [] }; S.cont = {}; endSetplay();
      continue;
    }
    if (op.type === 'extra') {
      if (!S.askExtra) continue;
      S.askExtra = false;
      S.extraDecided = !!op.yes;
      goNext();
      continue;
    }
    if (op.type === 'select') {
      if (S.periods[op.to] && S.periods[op.to].status === 'none' && P().status !== 'live') { S.current = op.to; S.askExtra = false; S.matchOver = false; }
      continue;
    }
    if (op.period && op.period !== S.current) {
      // ops are saved with the period they belong to. When replaying after a reset of an earlier
      // period, later periods' ops still apply to their own period.
      if (S.periods[S.current].status === 'live' || !S.periods[op.period]) continue;
      S.current = op.period; S.askExtra = false; S.matchOver = false;
    }
    const p = P();
    const at = elapsedAt(op.t);
    maybeExpireSetplay(at);

    switch (op.type) {
      case 'kickoff': {
        if (p.status !== 'none' || !Array.isArray(op.lineup) || op.lineup.length !== 5) break;
        p.status = 'live'; p.startedAt = op.t; p.elapsed = 0; p.runningSince = op.t;
        if (S.base[S.current] == null) {
          const idx = PERIODS.findIndex((x) => x.key === S.current);
          S.base[S.current] = PERIODS.slice(0, idx).reduce((s, x) => s + (S.periods[x.key].status === 'done' ? S.periods[x.key].elapsed : 0), 0);
        }
        op.lineup.forEach((pid, i) => { S.seats[i] = pid; S.seatSince[i] = 0; openStint(pid, i, 0); S.cont[pid] = 0; delete S.lastOut[pid]; });
        break;
      }
      case 'start':
        if (p.status === 'live' && p.runningSince == null && p.elapsed < periodLen(cfg, S.current)) p.runningSince = op.t;
        break;
      case 'stop':
        if (p.status === 'live' && p.runningSince != null) { p.elapsed = at; p.runningSince = null; }
        break;
      case 'adjust': {
        if (p.status !== 'live') break;
        const to = Math.max(0, Math.min(periodLen(cfg, S.current), op.elapsed));
        S.adjusts.push({ period: S.current, at, from: at, to });
        // shift open stints / timers so nobody gets time that never happened, then set the clock
        const d = to - at;
        // clock moved back: anything recorded after the new time is pulled back to it
        if (to < at) {
          const cut = (x) => (x != null && x > to ? to : x);
          S.stints = S.stints.filter((s) => {
            if (s.period !== S.current) return true;
            const wasClosed = s.to != null;
            s.from = cut(s.from); s.to = cut(s.to);
            return !(wasClosed && s.to === s.from && s.from === to); // drop appearances squeezed to nothing
          });
          S.empties.filter((e) => e.period === S.current).forEach((e) => { e.from = cut(e.from); e.to = cut(e.to); });
          S.empty.forEach((e) => { if (e) e.from = cut(e.from); });
          S.pp.filter((x) => x.period === S.current).forEach((x) => { x.from = cut(x.from); x.to = cut(x.to); });
          S.timeouts.filter((x) => x.period === S.current).forEach((x) => { x.at = cut(x.at); });
          S.seatSince = S.seatSince.map(cut);
          const capCum = (S.base[S.current] || 0) + to;
          Object.keys(S.lastOut).forEach((k) => { if (S.lastOut[k] > capCum) S.lastOut[k] = capCum; });
        }
        S.stints.filter((s) => s.period === S.current && s.to == null).forEach((s) => { s.from = Math.max(0, Math.min(s.from, to)); });
        Object.keys(S.cont).forEach((k) => { S.cont[k] = Math.min(S.cont[k], to); });
        S.batch.outs.forEach((o) => { o.outAt = Math.min(o.outAt, to); });
        if (S.setplay) { S.setplay.from = Math.min(S.setplay.from, to); S.setplay.endsAt += d; }
        p.elapsed = to; if (p.runningSince != null) p.runningSince = op.t;
        break;
      }
      case 'out': {
        if (p.status !== 'live') break;
        const pid = op.pid;
        const ti = S.batch.ins.indexOf(pid);
        if (ti >= 0) { S.batch.ins.splice(ti, 1); break; } // 仮に入った選手をもう一度押す → ベンチに戻す
        const seat = S.seats.indexOf(pid);
        if (seat < 0 || S.batch.outs.some((o) => o.pid === pid)) break;
        S.batch.outs.push({ pid, seat, outAt: at });
        break;
      }
      case 'in': {
        if (p.status !== 'live') break;
        const pid = op.pid;
        if (S.ejected.has(pid)) break;
        const oi = S.batch.outs.findIndex((o) => o.pid === pid);
        if (oi >= 0) { // OUTの取り消し
          S.batch.outs.splice(oi, 1);
          while (S.batch.ins.length > S.batch.outs.length) S.batch.ins.pop();
          if (S.batch.outs.length && S.batch.ins.length === S.batch.outs.length) commitBatch(at);
          break;
        }
        if (S.seats.includes(pid) || S.batch.ins.includes(pid)) break;
        if (S.batch.outs.length > S.batch.ins.length) {
          S.batch.ins.push(pid);
          if (S.batch.ins.length === S.batch.outs.length) commitBatch(at);
          break;
        }
        const es = S.empty.findIndex((e) => e);
        if (es >= 0) { // 退場による空席の補充
          const e = S.empty[es];
          const early = at - e.from < EJECT_WAIT;
          const rec = S.empties.find((x) => x.period === S.current && x.seat === es && x.to == null); if (rec) rec.to = at;
          S.empty[es] = null; S.seats[es] = pid; S.seatSince[es] = at; openStint(pid, es, at);
          S.cont[pid] = S.carry[pid] != null ? at - S.carry[pid] : at; delete S.carry[pid]; delete S.lastOut[pid];
          S.fills.push({ period: S.current, seat: es, pid, at, early: early && !!op.afterGoal });
          break;
        }
        S.notices.push({ kind: 'needOut' });
        break;
      }
      case 'eject': {
        if (p.status !== 'live') break;
        const pid = op.pid; const seat = S.seats.indexOf(pid);
        if (seat < 0) break;
        S.batch.outs = S.batch.outs.filter((o) => o.pid !== pid);
        while (S.batch.ins.length > S.batch.outs.length) S.batch.ins.pop();
        closeStint(pid, at); delete S.cont[pid]; S.lastOut[pid] = cum(at);
        S.seats[seat] = null; S.empty[seat] = { from: at, pid };
        S.empties.push({ period: S.current, seat, pid, from: at, to: null });
        S.ejected.add(pid); S.ejections.push({ period: S.current, pid, at, t: op.t });
        if (S.batch.outs.length && S.batch.ins.length === S.batch.outs.length) commitBatch(at);
        break;
      }
      case 'setplay': {
        if (p.status !== 'live' || S.setplay) break;
        const auto = (cfg.setplayAuto || 60) * 1000;
        S.setplay = { from: at, endsAt: at + auto, onAtStart: new Set(onPitch()), left: new Set() };
        S.carry = {};
        break;
      }
      case 'setplayEnd': endSetplay(); break;
      case 'contReset': delete S.carry[op.pid]; break;
      case 'pp': {
        if (p.status !== 'live' || S.ppActive) break;
        S.ppActive = { team: op.team === 'opp' ? 'opp' : 'own', period: S.current, from: at, to: null, auto: false };
        S.pp.push(S.ppActive);
        break;
      }
      case 'ppEnd': if (S.ppActive) { S.ppActive.to = at; S.ppActive = null; } break;
      case 'timeout': {
        if (p.status !== 'live' || PERIODS.find((x) => x.key === S.current).extra) break;
        if (S.timeouts.some((x) => x.period === S.current && x.team === op.team)) break;
        S.timeouts.push({ team: op.team, period: S.current, at });
        break;
      }
      case 'periodEnd': {
        if (p.status !== 'live') break;
        endPeriod(at);
        break;
      }
      default: break;
    }
  }
  return S;
}

// ---------- derived values for the screen (computed at "now") ----------
export function nowElapsed(S, now = Date.now()) {
  const p = S.periods[S.current];
  if (p.runningSince == null) return p.elapsed;
  return Math.min(p.elapsed + Math.max(0, now - p.runningSince), periodLen(S.cfg, S.current));
}
// Playing time of a player in one period (ms), counting an ongoing stint up to `at`.
export function playerPeriodTime(S, pid, key, at) {
  return S.stints.filter((s) => s.pid === pid && s.period === key).reduce((sum, s) => sum + ((s.to ?? (key === S.current ? at : s.from)) - s.from), 0);
}
export function playerCounts(S, pid, key) {
  const st = S.stints.filter((s) => s.pid === pid);
  return { period: st.filter((s) => s.period === key).length, match: st.length };
}
export function playerMatchTime(S, pid, at) {
  return PERIODS.reduce((sum, p) => sum + playerPeriodTime(S, pid, p.key, at), 0);
}
// Seat view with the 交代待ち tentative assignments (spec 3章).
export function seatView(S, at) {
  const outs = [...S.batch.outs].sort((a, b) => a.outAt - b.outAt);
  const tentative = {}; // seat -> {inPid, outPid, outAt}
  outs.forEach((o, i) => { if (S.batch.ins[i]) tentative[o.seat] = { inPid: S.batch.ins[i], outPid: o.pid, outAt: o.outAt }; });
  return S.seats.map((pid, i) => {
    const out = outs.find((o) => o.seat === i);
    if (tentative[i]) return { seat: i, pid: tentative[i].inPid, tentative: true, replacing: tentative[i].outPid, since: tentative[i].outAt };
    if (out) return { seat: i, pid, waiting: true, outAt: out.outAt };
    if (!pid) return { seat: i, pid: null, empty: S.empty[i] };
    return { seat: i, pid };
  });
}
export function contTime(S, pid, at, view) {
  if (view?.waiting) return Math.max(0, view.outAt - (S.cont[pid] ?? view.outAt));
  if (view?.tentative) return Math.max(0, at - view.since) + (S.carry[pid] || 0);
  if (S.cont[pid] == null) return 0;
  return Math.max(0, at - S.cont[pid]);
}
// cumulative playing time before a period = sum of the finished earlier periods
export function baseOf(S, key) {
  if (S.base[key] != null) return S.base[key];
  const idx = PERIODS.findIndex((x) => x.key === key);
  return PERIODS.slice(0, idx).reduce((s, x) => s + (S.periods[x.key].status === 'done' ? S.periods[x.key].elapsed : 0), 0);
}
export function restTime(S, pid, at) {
  const lo = S.lastOut[pid];
  if (lo == null) return null;
  return Math.max(0, baseOf(S, S.current) + at - lo);
}
export function setplayLeft(S, at) {
  if (!S.setplay) return null;
  return Math.max(0, S.setplay.endsAt - at);
}
// Short description of an op, for 「取り消しました：…」
export function describeOp(op, name) {
  const n = (pid) => name(pid);
  switch (op?.type) {
    case 'kickoff': return 'ピリオドの開始';
    case 'start': return 'スタート';
    case 'stop': return 'ストップ';
    case 'adjust': return '時刻合わせ';
    case 'out': return `${n(op.pid)} OUT`;
    case 'in': return `${n(op.pid)} IN`;
    case 'eject': return `${n(op.pid)} 退場`;
    case 'setplay': return 'セットプレー開始';
    case 'setplayEnd': return 'セットプレー終了';
    case 'contReset': return `${n(op.pid)} の「続き」を0:00に`;
    case 'pp': return 'パワープレー開始';
    case 'ppEnd': return '5x4 終了';
    case 'timeout': return `タイムアウト（${op.team === 'own' ? '自チーム' : '相手'}）`;
    case 'periodEnd': return 'ピリオド終了';
    case 'extra': return op.yes ? '延長戦あり' : '延長戦なし';
    case 'select': return 'ピリオドの選択';
    case 'reset': return op.scope === 'all' ? '試合全体のリセット' : `${periodLabel(op.scope)}のリセット`;
    default: return '操作';
  }
}
