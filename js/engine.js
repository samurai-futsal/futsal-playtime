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
// 空席の補充まで残り（ms）。ピリオドをまたいだ退場は、前のピリオドで残っていた時間（wait）から数える（決6）
export const ejectLeft = (e, el) => (e.wait ?? EJECT_WAIT) - (el - e.from);

// cfg: { times:{half, extra, extraHalf}, members:{pid:{no,pos,pp}}, setplayAuto (sec) }
export function periodLen(cfg, key) {
  const t = cfg.times || {};
  return (PERIODS.find((p) => p.key === key)?.extra ? (t.extraHalf || 5) : (t.half || 20)) * 60000;
}
// 記録したピリオドの長さ（足1）：キックオフのときの長さを使う（あとで試合の設定を変えても記録は変わらない）。
// 記録の修正の「試合情報」で長さを直した試合（cfg.timesFixed）と、長さを持たない古い記録は、試合の設定の長さ。
export function perLen(S, key) {
  return S.periods?.[key]?.len || periodLen(S.cfg, key);
}

// ---- which ops count: undo pops the latest remaining op; reset drops earlier ops of that period ----
// 並べ方（足4）：同じ端末の操作は押した順（端末ごとの通し番号 n）。途中で端末の時計が直っても順番は変わらない。
// 端末どうしは、それぞれの次の操作の時刻の早いほうから順に（同じ端末の順番は崩さない）。
const byId = (a, b) => String(a.id).localeCompare(String(b.id));
export function orderOps(ops) {
  const lanes = new Map();
  for (const op of ops) {
    const k = op.dev && op.dev !== 'unknown' ? op.dev : ''; // 端末が分からない記録は時刻で並べる
    if (!lanes.has(k)) lanes.set(k, []);
    lanes.get(k).push(op);
  }
  const L = [...lanes.entries()].map(([k, l]) => l.sort(k && l.every((o) => o.n != null)
    ? (a, b) => a.n - b.n || a.t - b.t || byId(a, b)
    : (a, b) => a.t - b.t || (a.n || 0) - (b.n || 0) || byId(a, b)));
  if (L.length === 1) return L[0];
  const idx = L.map(() => 0); const out = [];
  for (;;) {
    let best = -1;
    for (let i = 0; i < L.length; i++) {
      const o = L[i][idx[i]]; if (!o) continue;
      const b = best >= 0 ? L[best][idx[best]] : null;
      if (!b || o.t - b.t < 0 || (o.t === b.t && ((o.n || 0) - (b.n || 0) || byId(o, b)) < 0)) best = i;
    }
    if (best < 0) return out;
    out.push(L[best][idx[best]++]);
  }
}
export function effectiveOps(ops) {
  const sorted = orderOps(ops);
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

// 前のピリオドの終わりに補充を待っていた空席（決6）：一番近い、記録が終わった前のピリオドから持ち越す。
// [{pid, left}]（left＝補充まで残りのプレーイングタイム）。次のピリオドは、この数まで枠を空けて（4人で）始められる
export function ejectCarryIn(S, key = S.current) {
  const idx = PERIODS.findIndex((x) => x.key === key);
  for (let j = idx - 1; j >= 0; j--) {
    const q = S.periods[PERIODS[j].key];
    if (q.status === 'done') return (q.ejOut || []).filter((c) => c.left > 0).sort((a, b) => a.left - b.left);
  }
  return [];
}
const isGK = (cfg, pid) => cfg.members?.[pid]?.pos === 'GK';
// Decide which incoming player takes which waiting seat (spec 3章「交代待ち方式」).
// A GK coming in takes the seat of a GK going out, or else the leftmost seat (seat 0) if it is being
// vacated, so the GK stays in the leftmost card. Everyone else fills the remaining seats in OUT order.
export function pairBatch(batch, cfg) {
  const outs = [...batch.outs].sort((a, b) => a.outAt - b.outAt);
  const used = new Set(); const pairs = []; const rest = [];
  for (const pid of batch.ins) {
    if (!isGK(cfg, pid)) { rest.push(pid); continue; }
    const o = outs.find((x) => !used.has(x) && isGK(cfg, x.pid)) || outs.find((x) => !used.has(x) && x.seat === 0);
    if (o) { used.add(o); pairs.push([o, pid]); } else rest.push(pid);
  }
  const free = outs.filter((x) => !used.has(x));
  rest.forEach((pid, i) => { if (free[i]) pairs.push([free[i], pid]); });
  return pairs;
}
const isPP = (cfg, pid) => !!cfg.members?.[pid]?.pp;

function newPeriod(key) {
  // kickT / endT / runs: 実際の時刻（ランニングタイム用）。runs = 時計が動いていた区間 {el0, t0, el1, t1}
  // len / spAuto：キックオフのときのピリオドの長さ（ms）とセットプレーの自動終了（秒）。ejOut：終わったときに補充を待っていた空席（次のピリオドへ持ち越す）
  return { key, status: 'none', elapsed: 0, runningSince: null, startedAt: null, endedAt: null, kickT: null, endT: null, runs: [], len: null, spAuto: null, ejOut: [] };
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
    squeezed: [],            // 時計を戻して消えた出場（実際の時刻だけ使う：ランニングタイム）
    empties: [],             // {period, seat, pid, from, to}
    ejected: new Set(),
    ejections: [],           // {period, pid, at, early fill flags...}
    fills: [],               // {period, seat, pid, at, early}
    cont: {},                // pid -> elapsed at which the continuous timer started (current period)
    carry: {},               // pid -> continuous time kept for 「続き」 (set play)
    lastOut: {},             // pid -> cumulative ms when they last left the pitch (rest time)
    setplay: null,           // {from, endsAt, onAtStart:Set, left:Set}
    pp: [],                  // 5x4 periods {team, period, from, to, auto}
    ppDropped: [],           // 時計を戻して長さが0になった5x4（記録はあったものとして数える）
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

  const lenOf = (k = S.current) => perLen(S, k);
  const elapsedAt = (t) => {
    const p = P();
    if (p.runningSince == null) return p.elapsed;
    return Math.min(p.elapsed + Math.max(0, t - p.runningSince), lenOf());
  };
  // wf / wt: 出場の始まりと終わりの実際の時刻（ランニングタイム用）。プレーイングタイムの計算には使わない
  let T = 0; // 今読んでいる記録の時刻
  const openStint = (pid, seat, at, t = T) => S.stints.push({ period: S.current, pid, seat, from: at, to: null, wf: t, wt: null });
  const closeStint = (pid, at, t = T) => {
    const s = S.stints.find((x) => x.period === S.current && x.pid === pid && x.to == null);
    if (s) { s.to = Math.max(s.from, at); s.wt = t; }
  };
  // 時計を止める（またはピリオドの長さに達した）実際の時刻を記録する
  const closeRun = (p, at) => {
    const r = p.runs[p.runs.length - 1];
    if (r && r.el1 == null) { r.el1 = Math.max(r.el0, at); r.t1 = r.t0 + (r.el1 - r.el0); }
  };
  const onPitch = () => S.seats.filter(Boolean);

  function endSetplay() {
    S.setplay = null; S.carry = {};
  }
  function maybeExpireSetplay(at) {
    if (S.setplay && at >= S.setplay.endsAt) endSetplay();
  }

  function commitBatch(at, partial = false) {
    const pairs = pairBatch(S.batch, cfg);
    for (const [o, inPid] of pairs) {
      closeStint(o.pid, o.outAt, o.outT ?? T);
      S.lastOut[o.pid] = cum(o.outAt);
      if (S.setplay && S.setplay.onAtStart.has(o.pid)) {
        S.carry[o.pid] = Math.max(0, o.outAt - (S.cont[o.pid] ?? o.outAt));
        S.setplay.left.add(o.pid);
      }
      delete S.cont[o.pid];
      S.seats[o.seat] = inPid; S.seatSince[o.seat] = o.outAt;
      openStint(inPid, o.seat, o.outAt, o.outT ?? T);
      if (S.carry[inPid] != null) { S.cont[inPid] = o.outAt - Math.min(S.carry[inPid], o.outAt); delete S.carry[inPid]; }
      else S.cont[inPid] = o.outAt;
      delete S.lastOut[inPid];
    }
    S.batch = { outs: [], ins: [] };
    if (!pairs.length) return;
    // set play mode ends when everyone who left during it is back on the pitch
    if (S.setplay && S.setplay.left.size && [...S.setplay.left].every((pid) => S.seats.includes(pid))) endSetplay();
    // GK check / 5x4 auto start (spec 6章・11章)
    const gkOn = onPitch().some((pid) => isGK(cfg, pid));
    const gkPair = pairs.find(([o]) => isGK(cfg, o.pid));
    if (!gkOn && gkPair) {
      const ppIn = pairs.some(([, i]) => isPP(cfg, i));
      if (ppIn) {
        // 5x4はGKが交代した時刻（GKのOUTを押した時刻）から（試12）
        const g = gkPair[0];
        if (!S.ppActive) { S.ppActive = { team: 'own', period: S.current, from: g.outAt, to: null, auto: true, wf: g.outT ?? T }; S.pp.push(S.ppActive); S.notices.push({ kind: 'ppAuto' }); }
      } else S.notices.push({ kind: 'noGK' });
    }
  }

  // 交代待ちの選手(outPid)の場所に仮に入っている選手を、INの一覧から外す（ベンチに戻す）
  function dropTentativeFor(outPid) {
    const pr = pairBatch(S.batch, cfg).find(([o]) => o.pid === outPid);
    if (pr) S.batch.ins = S.batch.ins.filter((x) => x !== pr[1]);
  }
  // GKはピッチに1人まで：交代で出るGKを除き、すでに入る予定のGKを足して1人以上いれば入れない
  // 空席の補充（fill）は交代ではないので、交代待ちのGKも数える（取り消すと2人になるため）
  function gkWouldDouble(pid, fill = false) {
    if (!isGK(cfg, pid)) return false;
    const outIds = new Set(fill ? [] : S.batch.outs.map((o) => o.pid));
    const stay = S.seats.filter((x) => x && !outIds.has(x) && isGK(cfg, x)).length;
    return stay + S.batch.ins.filter((x) => isGK(cfg, x)).length >= 1;
  }
  const carryInFor = (key) => ejectCarryIn(S, key);

  function endPeriod(at) {
    const p = P();
    // 交代待ちが残っていたら、終わっていない交代は取り消す：OUTを押した選手は最後まで出場、仮に入った選手はベンチに戻る（決7）
    S.batch = { outs: [], ins: [] };
    // 補充を待っている空席は、残りの時間ごと次のピリオドに持ち越す（決6）
    p.ejOut = S.empty.map((e) => e && { pid: e.pid, left: ejectLeft(e, at) }).filter((x) => x && x.left > 0);
    closeRun(p, at);
    const lastRun = p.runs[p.runs.length - 1];
    p.endT = lastRun ? lastRun.t1 : T; // ピリオドの終わり＝時計が最後に止まった（0:00になった）時刻
    S.stints.filter((s) => s.period === S.current && s.to == null).forEach((s) => { s.to = at; s.wt = p.endT; });
    S.empty.forEach((e, i) => { if (e) { const r = S.empties.find((x) => x.period === S.current && x.seat === i && x.to == null); if (r) { r.to = at; r.wt = p.endT; } } });
    onPitch().forEach((pid) => { S.lastOut[pid] = cum(at); });
    if (S.ppActive) { S.ppActive.to = at; S.ppActive.wt = p.endT; S.ppActive = null; }
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

  let lastT = -Infinity;
  for (const op0 of list) {
    S.notices = [];
    // 時刻は戻らないものとして読む（同じ端末の操作は押した順に並ぶので、端末の時計が途中で戻っても時間が逆に進まない）
    const op = op0.t < lastT ? { ...op0, t: lastT } : op0; lastT = op.t;
    if (op.type === 'reset') {
      // restart the replay state for that period (or whole match): handled by effectiveOps dropping ops;
      // here we only rewind what belonged to the period.
      const scope = op.scope;
      const keys = scope === 'all' ? PERIODS.map((p) => p.key) : [scope];
      const liveK = S.periods[S.current].status === 'live' ? S.current : null;
      if (scope !== 'all' && liveK && scope !== liveK) {
        // 記録中のピリオドはそのまま続ける：ほかのピリオドの記録だけを消す（試1。古い記録にあるかもしれないため）
        if (!S.periods[scope]) continue;
        S.periods[scope] = newPeriod(scope);
        for (const f of ['stints', 'squeezed', 'empties', 'pp', 'ppDropped', 'timeouts', 'ejections', 'fills', 'adjusts']) S[f] = S[f].filter((s) => s.period !== scope);
        S.ejected = new Set(S.ejections.map((e) => e.pid));
        continue;
      }
      for (const k of keys) {
        S.periods[k] = newPeriod(k);
        S.stints = S.stints.filter((s) => s.period !== k);
        S.squeezed = S.squeezed.filter((s) => s.period !== k);
        S.empties = S.empties.filter((s) => s.period !== k);
        S.pp = S.pp.filter((s) => s.period !== k);
        S.ppDropped = S.ppDropped.filter((s) => s.period !== k);
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
    T = op.t;
    maybeExpireSetplay(at);

    switch (op.type) {
      case 'kickoff': {
        if (p.status !== 'none' || !Array.isArray(op.lineup) || op.lineup.length !== 5) break;
        const lineup = Array.from(op.lineup, (x) => x || null); // 抜けた要素も空いた枠として読む
        const ids = lineup.filter(Boolean);
        if (new Set(ids).size !== ids.length) break;
        // 空けた枠：前のピリオドから持ち越した退場の空席（決6）。持ち越しより多くは空けられない
        const holes = lineup.map((x, i) => (x ? null : i)).filter((i) => i != null);
        const carryIn = holes.length ? carryInFor(S.current) : [];
        if (holes.length > carryIn.length) break;
        p.len = !cfg.timesFixed && op.len > 0 ? op.len : null;
        p.spAuto = op.spAuto > 0 ? op.spAuto : null;
        p.status = 'live'; p.startedAt = op.t; p.elapsed = 0; p.runningSince = op.t;
        p.kickT = op.t; p.runs = [{ el0: 0, t0: op.t, el1: null, t1: null }];
        if (S.base[S.current] == null) {
          const idx = PERIODS.findIndex((x) => x.key === S.current);
          S.base[S.current] = PERIODS.slice(0, idx).reduce((s, x) => s + (S.periods[x.key].status === 'done' ? S.periods[x.key].elapsed : 0), 0);
        }
        lineup.forEach((pid, i) => { if (!pid) return; S.seats[i] = pid; S.seatSince[i] = 0; openStint(pid, i, 0); S.cont[pid] = 0; delete S.lastOut[pid]; });
        holes.forEach((seat, j) => {
          const c = carryIn[j];
          S.empty[seat] = { from: 0, pid: c.pid, wait: c.left, carried: true };
          S.empties.push({ period: S.current, seat, pid: c.pid, from: 0, to: null, wf: op.t, wt: null, carried: true });
        });
        break;
      }
      case 'start':
        if (p.status === 'live' && p.runningSince == null && p.elapsed < lenOf()) { p.runningSince = op.t; p.runs.push({ el0: p.elapsed, t0: op.t, el1: null, t1: null }); }
        break;
      case 'stop':
        if (p.status === 'live' && p.runningSince != null) { closeRun(p, at); p.elapsed = at; p.runningSince = null; }
        break;
      case 'adjust': {
        if (p.status !== 'live') break;
        const to = Math.max(0, Math.min(lenOf(), op.elapsed));
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
            const gone = wasClosed && s.to === s.from && s.from === to; // drop appearances squeezed to nothing
            if (gone) S.squeezed.push(s); // ランニングタイム用に、実際の時刻だけ残す
            return !gone;
          });
          S.empties.filter((e) => e.period === S.current).forEach((e) => { e.from = cut(e.from); e.to = cut(e.to); });
          S.empty.forEach((e) => { if (e) e.from = cut(e.from); });
          S.pp.filter((x) => x.period === S.current).forEach((x) => { x.from = cut(x.from); x.to = cut(x.to); });
          // 長さが0になった5x4は消す（記録はあったものとして ppDropped に残す）（試11）
          S.pp = S.pp.filter((x) => { const gone = x.period === S.current && x.to != null && x.to <= x.from; if (gone) S.ppDropped.push(x); return !gone; });
          S.timeouts.filter((x) => x.period === S.current).forEach((x) => { x.at = cut(x.at); });
          S.ejections.filter((x) => x.period === S.current).forEach((x) => { x.at = cut(x.at); });
          S.fills.filter((x) => x.period === S.current).forEach((x) => { x.at = cut(x.at); });
          Object.keys(S.carry).forEach((k) => { S.carry[k] = Math.min(S.carry[k], to); }); // 「続き」は新しい時刻より長くならない
          S.seatSince = S.seatSince.map(cut);
          const capCum = (S.base[S.current] || 0) + to;
          Object.keys(S.lastOut).forEach((k) => { if (S.lastOut[k] > capCum) S.lastOut[k] = capCum; });
        }
        S.stints.filter((s) => s.period === S.current && s.to == null).forEach((s) => { s.from = Math.max(0, Math.min(s.from, to)); });
        Object.keys(S.cont).forEach((k) => { S.cont[k] = Math.min(S.cont[k], to); });
        S.batch.outs.forEach((o) => { o.outAt = Math.min(o.outAt, to); });
        if (S.setplay) { S.setplay.from = Math.min(S.setplay.from, to); S.setplay.endsAt += d; }
        if (p.runningSince != null) { closeRun(p, at); p.runs.push({ el0: to, t0: op.t, el1: null, t1: null }); }
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
        S.batch.outs.push({ pid, seat, outAt: at, outT: T });
        break;
      }
      case 'in': {
        if (p.status !== 'live') break;
        const pid = op.pid;
        if (S.ejected.has(pid)) break;
        const oi = S.batch.outs.findIndex((o) => o.pid === pid);
        if (oi >= 0) { // OUTの取り消し：その場所に仮に入っていた選手もベンチに戻す（画面に見えない組み合わせで交代を決めない）
          dropTentativeFor(pid);
          S.batch.outs.splice(oi, 1);
          while (S.batch.ins.length > S.batch.outs.length) S.batch.ins.pop();
          if (S.batch.outs.length && S.batch.ins.length === S.batch.outs.length) commitBatch(at);
          break;
        }
        if (S.seats.includes(pid) || S.batch.ins.includes(pid)) break;
        // 空席を押してから選んだ選手は、交代待ちがあってもその空席に入る
        const pressed = op.seat != null && S.empty[op.seat] ? op.seat : -1;
        if (gkWouldDouble(pid, pressed >= 0)) { S.notices.push({ kind: 'twoGK' }); break; } // GKはピッチに1人まで
        if (pressed < 0 && S.batch.outs.length > S.batch.ins.length) {
          S.batch.ins.push(pid);
          if (S.batch.ins.length === S.batch.outs.length) commitBatch(at);
          break;
        }
        const es = pressed >= 0 ? pressed : S.empty.findIndex((e) => e);
        if (es >= 0) { // 退場による空席の補充
          const e = S.empty[es];
          const early = ejectLeft(e, at) > 0;
          const rec = S.empties.find((x) => x.period === S.current && x.seat === es && x.to == null); if (rec) { rec.to = at; rec.wt = T; }
          S.empty[es] = null; S.seats[es] = pid; S.seatSince[es] = at; openStint(pid, es, at);
          S.cont[pid] = S.carry[pid] != null ? at - Math.min(S.carry[pid], at) : at; delete S.carry[pid]; delete S.lastOut[pid];
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
        dropTentativeFor(pid);
        S.batch.outs = S.batch.outs.filter((o) => o.pid !== pid);
        while (S.batch.ins.length > S.batch.outs.length) S.batch.ins.pop();
        closeStint(pid, at); delete S.cont[pid]; S.lastOut[pid] = cum(at);
        S.seats[seat] = null; S.empty[seat] = { from: at, pid };
        S.empties.push({ period: S.current, seat, pid, from: at, to: null, wf: T, wt: null });
        S.ejected.add(pid); S.ejections.push({ period: S.current, pid, at, t: op.t });
        if (S.batch.outs.length && S.batch.ins.length === S.batch.outs.length) commitBatch(at);
        break;
      }
      case 'setplay': {
        if (p.status !== 'live' || S.setplay) break;
        const auto = (p.spAuto || cfg.setplayAuto || 60) * 1000; // キックオフのときの設定（足1）
        S.setplay = { from: at, endsAt: at + auto, onAtStart: new Set(onPitch()), left: new Set() };
        S.carry = {};
        break;
      }
      case 'setplayEnd': endSetplay(); break;
      case 'contReset': delete S.carry[op.pid]; break;
      case 'pp': {
        if (p.status !== 'live' || S.ppActive) break;
        S.ppActive = { team: op.team === 'opp' ? 'opp' : 'own', period: S.current, from: at, to: null, auto: false, wf: T };
        S.pp.push(S.ppActive);
        break;
      }
      case 'ppEnd': if (S.ppActive) { S.ppActive.to = at; S.ppActive.wt = T; S.ppActive = null; } break;
      case 'timeout': {
        if (p.status !== 'live' || PERIODS.find((x) => x.key === S.current).extra) break;
        if (S.timeouts.some((x) => x.period === S.current && x.team === op.team)) break;
        S.timeouts.push({ team: op.team, period: S.current, at, t: T });
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
  return Math.min(p.elapsed + Math.max(0, now - p.runningSince), perLen(S, S.current));
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
  pairBatch(S.batch, S.cfg).forEach(([o, inPid]) => { tentative[o.seat] = { inPid, outPid: o.pid, outAt: o.outAt }; });
  return S.seats.map((pid, i) => {
    const out = outs.find((o) => o.seat === i);
    if (tentative[i]) return { seat: i, pid: tentative[i].inPid, tentative: true, replacing: tentative[i].outPid, since: tentative[i].outAt };
    if (out) return { seat: i, pid, waiting: true, outAt: out.outAt };
    if (!pid) return { seat: i, pid: null, empty: S.empty[i] };
    return { seat: i, pid };
  });
}
// セットプレーのモードが続いているか（1:00で自動終了したあと、次の操作の前でも終わったものとして見せる。試2）
export function setplayOn(S, at) {
  return !!S.setplay && at < S.setplay.endsAt;
}
// ベンチのカードの「続き」（モードが終わっていれば出さない）
export function carryOf(S, pid, at) {
  return setplayOn(S, at) && S.carry[pid] != null ? S.carry[pid] : null;
}
export function contTime(S, pid, at, view) {
  if (view?.waiting) return Math.max(0, view.outAt - (S.cont[pid] ?? view.outAt));
  if (view?.tentative) return Math.max(0, at - view.since) + Math.min(carryOf(S, pid, at) || 0, view.since);
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
    case 'ppEnd': return '5×4 終了';
    case 'timeout': return `タイムアウト（${op.team === 'own' ? '自チーム' : '相手'}）`;
    case 'periodEnd': return 'ピリオド終了';
    case 'extra': return op.yes ? '延長戦あり' : '延長戦なし';
    case 'select': return 'ピリオドの選択';
    case 'reset': return op.scope === 'all' ? '試合全体のリセット' : `${periodLabel(op.scope)}のリセット`;
    default: return '操作';
  }
}
