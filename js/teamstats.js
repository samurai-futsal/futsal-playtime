// チームと選手の集計（マッチレビュー 5・7・8、マッチスタッツ）。spec 7章・9章。
// 画面を作らない純粋な計算。同じ記録から同じ計算で作るので、レビューとスタッツの数字は必ず一致する。
// 得点・失点は専用の種類（goal / conc）で記録するが、シュートにも数える（得点＝枠内のシュート）。OGはシュートに数えない。
import { OPP_OG, NO_ASSIST, UNKNOWN, isOG, isFsp, clsOfGoalType, cardsOf, pitchAt } from './events.js';

export const CLS_KEYS = ['pos', 'set', 'trans', 'gk', 'special'];
const num = (v) => (v == null || v === '' ? null : +v);

// 1本ずつのシュート（得点・失点を含む）を同じ形にそろえる。own=true は自チーム
export function shotsOf(events, goalName, own) {
  const out = [];
  for (const e of events) {
    if (e.deleted) continue;
    const k = e.kind;
    if (own && (k === 'shot' || k === 'szshot')) out.push({ e, sz: k === 'szshot', result: e.result || null, cls: e.cls || null, n: k === 'shot' ? num(e.n) : null, goal: false, pid: e.pid });
    else if (!own && (k === 'oshot' || k === 'oszshot')) out.push({ e, sz: k === 'oszshot', result: e.result || null, cls: e.cls || null, n: k === 'oshot' ? num(e.n) : null, goal: false });
    else if (own && k === 'goal' && e.pid !== OPP_OG) {
      const sz = e.sz === 'in' ? true : e.sz === 'out' ? false : null;
      out.push({ e, sz, result: 'in', cls: clsOfGoalType(goalName(e.gtype)), n: sz === false ? num(e.n) : null, goal: true, pid: e.pid });
    } else if (!own && k === 'conc' && !isOG(goalName(e.gtype))) {
      const sz = e.sz === 'in' ? true : e.sz === 'out' ? false : null;
      out.push({ e, sz, result: 'in', cls: clsOfGoalType(goalName(e.gtype)), n: sz === false ? num(e.n) : null, goal: true });
    }
  }
  return out;
}

// periods：M.periods（並び順と長さ）。keys：数える範囲のピリオド（null＝試合全体）
export function teamStats(M, events, goalName, keys = null, win = null) {
  // win(e)：数える時間帯か（分析の「5×4を除く」など）。null＝すべて
  const inR = (e) => (!keys || keys.includes(e.period)) && (!win || win(e));
  const all = events.filter((e) => !e.deleted);
  const ev = all.filter(inR);
  const pOrder = M.periods.map((p) => p.key);
  const cardMap = cardsOf(all, pOrder); // 2枚目のイエローは試合全体で数える
  // 時間帯：前半・後半を10分ずつ（0〜10・11〜20・21〜30・31〜40）。延長は5つ目
  const bandOf = (e) => {
    const i = pOrder.indexOf(e.period); const p = M.periods[i];
    if (!p) return 0; if (p.extra) return 4;
    return i * 2 + (e.at <= p.len / 2 ? 0 : 1);
  };
  const hasExtra = M.periods.some((p) => p.extra && p.status !== 'none');
  const side = (own) => {
    const sh = shotsOf(ev, goalName, own);
    const outSZ = sh.filter((s) => s.sz !== true);
    const c = (arr, f) => arr.filter(f).length;
    const K = (k) => ev.filter((e) => e.kind === k);
    const z4 = K(own ? 'z4' : 'oz4'), szE = K(own ? 'sz' : 'osz'), fsp = K(own ? 'fspat' : 'fspdf');
    const nb = hasExtra ? 5 : 4;
    const band = (arr) => Array.from({ length: nb }, (_, b) => arr.filter((x) => bandOf(x.e || x) === b).length);
    const cardEv = ev.filter((e) => e.kind === (own ? 'foul' : 'fouled') && cardMap.has(e.id));
    const cardC = { yellow: 0, y2: 0, red: 0 }; for (const e of cardEv) cardC[cardMap.get(e.id)]++;
    return {
      shots: sh.length, sz: c(sh, (s) => s.sz === true),
      with: c(outSZ, (s) => s.sz === false && s.n != null && s.n >= 1), without: c(outSZ, (s) => s.sz === false && s.n === 0),
      nMiss: c(outSZ, (s) => s.sz == null || s.n == null),
      in: c(sh, (s) => s.result === 'in'), out: c(sh, (s) => s.result === 'out' || s.result === 'post'), block: c(sh, (s) => s.result === 'block'), resMiss: c(sh, (s) => !s.result),
      goals: c(sh, (s) => s.goal),
      cls: CLS_KEYS.map((k) => c(sh, (s) => s.cls === k)), clsMiss: c(sh, (s) => !s.cls),
      z4: z4.length, szE: szE.length, zcls: CLS_KEYS.map((k) => c(z4, (e) => e.cls === k)), zclsMiss: c(z4, (e) => !e.cls),
      fsp: fsp.length, fspT: [c(fsp, (e) => e.fsp === 'CK'), c(fsp, (e) => e.fsp === 'CK-KI'), c(fsp, (e) => e.fsp === 'KI'), c(fsp, (e) => ['FK', 'PK', '2PK'].includes(e.fsp))], fspMiss: c(fsp, (e) => !e.fsp),
      shotBand: band(sh), z4Band: band(z4), fspBand: band(fsp),
      foul: ev.filter((e) => e.kind === (own ? 'foul' : 'fouled')).length,
      cards: cardC, cardN: cardC.yellow + cardC.y2 + cardC.red,
    };
  };
  const A = side(true), B = side(false);
  // スコア：得点（相手OGを含む）と失点（OGを含む）
  const score = { own: {}, opp: {} };
  for (const p of M.periods) { score.own[p.key] = 0; score.opp[p.key] = 0; }
  const goals = [];
  for (const e of all.slice().sort((a, b) => pOrder.indexOf(a.period) - pOrder.indexOf(b.period) || a.at - b.at || (a.seq || 0) - (b.seq || 0))) {
    if (e.kind !== 'goal' && e.kind !== 'conc') continue;
    if (win && !win(e)) continue;
    const own = e.kind === 'goal';
    if (score[own ? 'own' : 'opp'][e.period] == null) continue;
    score[own ? 'own' : 'opp'][e.period]++;
    goals.push({ e, own });
  }
  const sum = (o, ks) => (ks || Object.keys(o)).reduce((a, k) => a + (o[k] || 0), 0);
  const rangeScore = { own: sum(score.own, keys), opp: sum(score.opp, keys) };
  const timeouts = { own: 0, opp: 0 }; for (const t of M.timeouts || []) if ((!keys || keys.includes(t.period)) && (!win || win(t))) timeouts[t.team === 'opp' ? 'opp' : 'own']++;
  const ejOwn = (M.ejections || []).filter((x) => (!keys || keys.includes(x.period)) && (!win || win(x))).length;
  return {
    A, B, score, rangeScore, goals, timeouts, ejOwn, ejOpp: B.cards.y2 + B.cards.red,
    rec: ev.filter((e) => e.kind === 'rec').length, lost: ev.filter((e) => e.kind === 'lost').length,
    hasEvents: all.length > 0, hasExtra, n: ev.length,
  };
}

// 8. スタッツまとめ：選手ごと。Mp＝プレーイングタイムの試合の形（ピッチにいた5人と出場時間）
export function playerStats(Mp, events, goalName, pids, T, keys = null) {
  const ev = events.filter((e) => !e.deleted && (!keys || keys.includes(e.period)));
  const sh = shotsOf(ev, goalName, true);
  const goalsAll = ev.filter((e) => e.kind === 'goal' || e.kind === 'conc');
  const onAt = new Map(goalsAll.map((g) => [g.id, new Set(pitchAt(Mp, g.period, g.at, g.side || 'before'))]));
  const assistMiss = ev.filter((e) => e.kind === 'goal' && e.pid !== OPP_OG && (e.assist == null || e.assist === '')).length;
  const ent = ev.filter((e) => e.kind === 'z4' || e.kind === 'sz');
  // シュート関与・被シュート関与：その選手がピッチにいる間に起きた自チームのシュート・相手のシュートの数（2026-10-17 決定）
  const onOf = (e) => new Set(pitchAt(Mp, e.period, e.at, e.side || 'before'));
  const ownOn = sh.map((s) => onOf(s.e)), oppOn = shotsOf(ev, goalName, false).map((s) => onOf(s.e));
  const rows = pids.map((pid) => {
    const t = keys ? (keys.reduce((a, k) => a + (T[pid]?.per?.[k]?.time || 0), 0)) : (T[pid]?.total || 0);
    const my = sh.filter((s) => s.pid === pid);
    const pm = goalsAll.filter((g) => onAt.get(g.id).has(pid)).reduce((a, g) => a + (g.kind === 'goal' ? 1 : -1), 0);
    return {
      pid, time: t, shots: my.length, sz: my.filter((s) => s.sz === true).length, in: my.filter((s) => s.result === 'in').length,
      goals: ev.filter((e) => e.kind === 'goal' && e.pid === pid).length,
      assists: ev.filter((e) => e.kind === 'goal' && e.assist === pid).length,
      inv: ent.filter((e) => e.pid === pid || e.pid2 === pid).length,
      passFrom: ent.filter((e) => e.method === 'pass' && e.pid === pid).length,
      passTo: ent.filter((e) => e.method === 'pass' && e.pid2 === pid).length,
      rec: ev.filter((e) => e.kind === 'rec' && e.pid === pid).length, lost: ev.filter((e) => e.kind === 'lost' && e.pid === pid).length,
      foul: ev.filter((e) => e.kind === 'foul' && e.pid === pid).length, pm,
      shotOn: ownOn.filter((x) => x.has(pid)).length, oshotOn: oppOn.filter((x) => x.has(pid)).length,
    };
  });
  return { rows, assistMiss, unknownShooter: sh.filter((s) => !s.pid || s.pid === UNKNOWN).length, noAssist: NO_ASSIST };
}

// ---------- 分析画面（spec 9章「集計画面の構成」）：選手ごとの直接関与・間接関与（出場中） ----------
// 本人のプレー＝直接関与、ピッチにいる間にチームに起きたこと＝間接関与（本人のプレーも含む）。
export const FSP_KEYS = ['CK', 'CK-KI', 'KI', 'FK', 'PK', '2PK'];
export const ZONE_KEYS = ['Z1', 'Z2', 'Z3', 'Z4'];
export function blankDetail() {
  const z6 = () => [0, 0, 0, 0, 0, 0], z4 = () => [0, 0, 0, 0];
  return {
    time: 0, count: 0, games: 0, pOwn: 0, pOpp: 0,
    shots: 0, sz: 0, in: 0, out: 0, block: 0, resMiss: 0, goals: 0, assists: 0,
    ent: { z4: { dr: 0, pf: 0, pt: 0, rb: 0, inv: 0 }, sz: { dr: 0, pf: 0, pt: 0, rb: 0, inv: 0 } }, inv: 0, passFrom: 0, passTo: 0,
    rec: 0, lost: 0, recZ: z4(), lostZ: z4(), foul: 0, fouled: 0, cY: 0, cY2: 0, cR: 0,
    on: { shot: 0, oshot: 0, gf: 0, ga: 0, z4: 0, sz: 0, oz4: 0, osz: 0, rec: 0, lost: 0, foul: 0, ofoul: 0, at: z6(), df: z6() },
  };
}
export function playerDetail(Mp, events, goalName, pids, T, keys = null, win = null) {
  const all = events.filter((e) => !e.deleted);
  const ev = all.filter((e) => (!keys || keys.includes(e.period)) && (!win || win(e)));
  const cards = cardsOf(all, Mp.periods.map((p) => p.key));
  const own = shotsOf(ev, goalName, true), opp = shotsOf(ev, goalName, false);
  const onC = new Map();
  const onOf = (e) => { if (!onC.has(e)) onC.set(e, new Set(pitchAt(Mp, e.period, e.at, e.side || (isFsp(e.kind) ? 'after' : 'before')))); return onC.get(e); };
  const out = {};
  for (const pid of pids) {
    const d = (out[pid] = blankDetail());
    const t = T[pid];
    d.time = keys ? keys.reduce((a, k) => a + (t?.per?.[k]?.time || 0), 0) : (t?.total || 0);
    d.count = keys ? keys.reduce((a, k) => a + (t?.per?.[k]?.count || 0), 0) : (t?.count || 0);
    d.games = d.time > 0 ? 1 : 0;
  }
  const add = (pid, f) => { if (out[pid]) f(out[pid]); };
  const onAll = (e, f) => { for (const pid of onOf(e)) add(pid, (d) => f(d.on)); };
  for (const s of own) {
    add(s.pid, (d) => { d.shots++; if (s.sz === true) d.sz++; if (s.result === 'in') d.in++; else if (s.result === 'out' || s.result === 'post') d.out++; else if (s.result === 'block') d.block++; else d.resMiss++; });
    onAll(s.e, (o) => o.shot++);
  }
  for (const s of opp) onAll(s.e, (o) => o.oshot++);
  for (const e of ev) {
    const k = e.kind;
    if (k === 'goal') { add(e.pid, (d) => d.goals++); if (e.assist && e.assist !== NO_ASSIST) add(e.assist, (d) => d.assists++); onAll(e, (o) => o.gf++); }
    else if (k === 'conc') onAll(e, (o) => o.ga++);
    else if (k === 'z4' || k === 'sz') {
      const g = k;
      const who = new Set([e.pid, e.pid2].filter((x) => x && x !== UNKNOWN));
      for (const pid of who) add(pid, (d) => { d.ent[g].inv++; d.inv++; });
      if (e.method === 'pass') { add(e.pid, (d) => { d.ent[g].pf++; d.passFrom++; }); add(e.pid2, (d) => { d.ent[g].pt++; d.passTo++; }); }
      else if (e.method === 'dribble') add(e.pid, (d) => d.ent[g].dr++);
      else if (e.method === 'rebound') add(e.pid, (d) => d.ent[g].rb++);
      onAll(e, (o) => o[g]++);
    } else if (k === 'oz4' || k === 'osz') onAll(e, (o) => o[k]++);
    else if (k === 'rec' || k === 'lost') {
      const zi = ZONE_KEYS.indexOf(e.zone);
      add(e.pid, (d) => { d[k]++; if (zi >= 0) d[k + 'Z'][zi]++; });
      onAll(e, (o) => o[k]++);
    } else if (k === 'foul') {
      const c = cards.get(e.id);
      add(e.pid, (d) => { d.foul++; if (c === 'yellow') d.cY++; else if (c === 'y2') d.cY2++; else if (c === 'red') d.cR++; });
      onAll(e, (o) => o.foul++);
    } else if (k === 'fouled') { add(e.pid, (d) => d.fouled++); onAll(e, (o) => o.ofoul++); }
    else if (k === 'fspat' || k === 'fspdf') { const i = FSP_KEYS.indexOf(e.fsp); onAll(e, (o) => { if (i >= 0) o[k === 'fspat' ? 'at' : 'df'][i]++; }); }
  }
  return out;
}
// 数字の入れ物を足し合わせる（試合をまたいだ合計）
export function addInto(a, b) {
  for (const k of Object.keys(b)) {
    if (typeof b[k] === 'number') a[k] = (a[k] || 0) + b[k];
    else if (Array.isArray(b[k])) { a[k] = a[k] || b[k].map(() => 0); b[k].forEach((v, i) => { a[k][i] += v; }); }
    else if (b[k] && typeof b[k] === 'object') { a[k] = a[k] || {}; addInto(a[k], b[k]); }
  }
  return a;
}

// ---------- パワープレー（5×4）の時間帯で分ける（2026-10-16 決定） ----------
// 自チームの5×4＝MATCH PLAY・記録の修正のパワープレー（自チーム）と、GKがピッチにいない区間。相手の5×4＝パワープレー（相手）。
const mergeIv = (list) => { const a = list.filter((x) => x[1] > x[0]).sort((x, y) => x[0] - y[0]); const out = []; for (const x of a) { const l = out[out.length - 1]; if (l && x[0] <= l[1]) l[1] = Math.max(l[1], x[1]); else out.push([x[0], x[1]]); } return out; };
export function ppWindows(M) {
  const isGK = (pid) => M.cfg.members?.[pid]?.pos === 'GK';
  const own = {}, opp = {};
  for (const p of M.periods) {
    if (p.status === 'none') { own[p.key] = []; opp[p.key] = []; continue; }
    const end = p.elapsed;
    const pp = (team) => (M.pp || []).filter((x) => x.period === p.key && x.team === team).map((x) => [x.from, Math.min(end, x.to ?? end)]);
    const ss = M.stints.filter((x) => x.period === p.key);
    const cuts = [...new Set([0, end, ...ss.flatMap((x) => [x.from, x.to])])].filter((c) => c >= 0 && c <= end).sort((a, b) => a - b);
    const noGK = [];
    for (let i = 0; i + 1 < cuts.length; i++) { const a = cuts[i], b = cuts[i + 1]; const on = ss.filter((x) => x.from <= a && x.to >= b); if (on.length && !on.some((x) => isGK(x.pid))) noGK.push([a, b]); }
    own[p.key] = mergeIv([...pp('own'), ...noGK]); opp[p.key] = mergeIv(pp('opp'));
  }
  const hasOpp = (M.pp || []).some((x) => x.team === 'opp');
  return { own, opp, hasOpp };
}
// mode：all / ex（5×4を除く）/ pp（5×4すべて）/ own（自チームの5×4）/ opp（相手の5×4）→ ピリオドごとの数える区間
export function windowsOf(M, W, mode) {
  if (mode === 'all') return null;
  const out = {};
  for (const p of M.periods) {
    const both = mergeIv([...(W.own[p.key] || []), ...(W.opp[p.key] || [])]);
    if (mode === 'own') out[p.key] = W.own[p.key] || [];
    else if (mode === 'opp') out[p.key] = W.opp[p.key] || [];
    else if (mode === 'pp') out[p.key] = both;
    else { const c = []; let t = 0; for (const [a, b] of both) { if (a > t) c.push([t, a]); t = Math.max(t, b); } if (t < p.elapsed) c.push([t, p.elapsed]); out[p.key] = c; }
  }
  return out;
}
const ov = (a, b, iv) => iv.reduce((s, [x, y]) => s + Math.max(0, Math.min(b, y) - Math.max(a, x)), 0);
// 出場（帯）を区間で切った試合の形。時間と回数はこの区間の中だけで数える
export function clipModel(M, wins) {
  if (!wins) return M;
  const stints = []; const empties = [];
  for (const s of M.stints) for (const [x, y] of wins[s.period] || []) { const a = Math.max(s.from, x), b = Math.min(s.to, y); if (b > a) stints.push({ ...s, from: a, to: b }); }
  for (const s of M.empties) for (const [x, y] of wins[s.period] || []) { const a = Math.max(s.from, x), b = Math.min(s.to, y); if (b > a) empties.push({ ...s, from: a, to: b }); }
  const periods = M.periods.map((p) => ({ ...p, elapsed: (wins[p.key] || []).reduce((t, [x, y]) => t + y - x, 0) }));
  return { ...M, stints, empties, periods };
}
// 区間の中か。区間の終わりは含まない（次の区間に入る）。ただしピリオドの終わり（時計が0:00）の瞬間は、そこで終わる区間に入れる
export const winTest = (wins, M = null) => {
  if (!wins) return null;
  const end = Object.fromEntries((M?.periods || []).map((p) => [p.key, p.elapsed]));
  return (e) => (wins[e.period] || []).some(([x, y]) => e.at >= x && (e.at < y || (e.at === y && y === end[e.period])));
};
// 選手ごとの5×4の出場時間（攻撃＝自チームの5×4、守備＝相手の5×4）
export function ppTime(M, W, pid) {
  let own = 0, opp = 0;
  for (const s of M.stints) if (s.pid === pid) { own += ov(s.from, s.to, W.own[s.period] || []); opp += ov(s.from, s.to, W.opp[s.period] || []); }
  return { own, opp };
}
