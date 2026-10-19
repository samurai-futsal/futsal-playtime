// チームと選手の集計（マッチレビュー 5・7・8、マッチスタッツ）。spec 7章・9章。
// 画面を作らない純粋な計算。同じ記録から同じ計算で作るので、レビューとスタッツの数字は必ず一致する。
// 得点・失点は専用の種類（goal / conc）で記録するが、シュートにも数える（得点＝枠内のシュート）。OGはシュートに数えない。
import { OPP_OG, NO_ASSIST, UNKNOWN, isOG, isOGType, clsOfGoalTypeId, oppEjWindows, isFsp, clsOfGoalType, cardsOf, pitchAt, SET_COLS } from './events.js';
import { setTable, SET_MIN } from './model.js';

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
      out.push({ e, sz, result: 'in', cls: clsOfGoalTypeId(e.gtype, goalName), n: sz === false ? num(e.n) : null, goal: true, pid: e.pid });
    } else if (!own && k === 'conc' && !isOGType(e.gtype, goalName)) {
      const sz = e.sz === 'in' ? true : e.sz === 'out' ? false : null;
      out.push({ e, sz, result: 'in', cls: clsOfGoalTypeId(e.gtype, goalName), n: sz === false ? num(e.n) : null, goal: true });
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
  // 時間帯（決3・未8）：前半・後半をそれぞれ半分に分け、延長は延長前半・延長後半を1つずつ。境目は試合通算の時間で、終わりを含む
  const hasExtra = M.periods.some((p) => p.extra && p.status !== 'none');
  const BD = bandsOf(M);
  const bandOf = (e) => bandIndex(BD, M, e.period, e.at);
  const side = (own) => {
    const sh = shotsOf(ev, goalName, own);
    const outSZ = sh.filter((s) => s.sz !== true);
    const c = (arr, f) => arr.filter(f).length;
    const K = (k) => ev.filter((e) => e.kind === k);
    const z4 = K(own ? 'z4' : 'oz4'), szE = K(own ? 'sz' : 'osz'), fsp = K(own ? 'fspat' : 'fspdf');
    const band = (arr) => BD.map((_, b) => arr.filter((x) => bandOf(x.e || x) === b).length);
    const cardEv = ev.filter((e) => e.kind === (own ? 'foul' : 'fouled') && cardMap.has(e.id));
    const cardC = { yellow: 0, y2: 0, red: 0 }; for (const e of cardEv) cardC[cardMap.get(e.id)]++;
    return {
      shots: sh.length, sz: c(sh, (s) => s.sz === true),
      with: c(outSZ, (s) => s.sz === false && s.n != null && s.n >= 1), without: c(outSZ, (s) => s.sz === false && s.n === 0),
      nMiss: c(outSZ, (s) => s.sz == null || s.n == null), outN: outSZ.length, szMiss: c(sh, (s) => s.sz == null),
      in: c(sh, (s) => s.result === 'in'), out: c(sh, (s) => s.result === 'out' || s.result === 'post'), block: c(sh, (s) => s.result === 'block'), resMiss: c(sh, (s) => !s.result),
      goals: c(sh, (s) => s.goal),
      cls: CLS_KEYS.map((k) => c(sh, (s) => s.cls === k)), clsMiss: c(sh, (s) => !s.cls),
      z4: z4.length, szE: szE.length, zcls: CLS_KEYS.map((k) => c(z4, (e) => e.cls === k)), zclsMiss: c(z4, (e) => !e.cls),
      fsp: fsp.length, fspT: [c(fsp, (e) => e.fsp === 'CK'), c(fsp, (e) => e.fsp === 'CK-KI'), c(fsp, (e) => e.fsp === 'KI'), c(fsp, (e) => ['FK', 'PK', '2PK'].includes(e.fsp))], fspMiss: c(fsp, (e) => !e.fsp),
      shotBand: band(sh), z4Band: band(z4), fspBand: band(fsp),
      foul: ev.filter((e) => e.kind === (own ? 'foul' : 'fouled')).length,
      // 2枚目のイエロー（退場）は、イエローにもレッドにも1つずつ数える（2026-10-18 決定）。cardN＝イエロー＋レッドの枚数
      cards: { yellow: cardC.yellow + cardC.y2, red: cardC.red + cardC.y2, y2: cardC.y2 }, cardN: cardC.yellow + cardC.red + cardC.y2 * 2,
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
    A, B, score, rangeScore, goals, timeouts, ejOwn, ejOpp: ev.filter((e) => e.kind === 'oej').length || B.cards.red,
    rec: ev.filter((e) => e.kind === 'rec').length, lost: ev.filter((e) => e.kind === 'lost').length,
    hasEvents: all.length > 0, hasExtra, n: ev.length, bands: BD.map((b) => b.label),
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
  // 進入関与・被進入関与：ピッチにいる間の自チームの Z4・SZ進入と、相手の Z4・SZ進入（2026-10-19）
  const entOn = ent.map(onOf), oentOn = ev.filter((e) => e.kind === 'oz4' || e.kind === 'osz').map(onOf);
  const rows = pids.map((pid) => {
    const t = keys ? (keys.reduce((a, k) => a + (T[pid]?.per?.[k]?.time || 0), 0)) : (T[pid]?.total || 0);
    const my = sh.filter((s) => s.pid === pid);
    const pm = goalsAll.filter((g) => onAt.get(g.id).has(pid)).reduce((a, g) => a + (g.kind === 'goal' ? 1 : -1), 0);
    return {
      pid, time: t, shots: my.length, sz: my.filter((s) => s.sz === true).length, in: my.filter((s) => s.result === 'in').length,
      goals: ev.filter((e) => e.kind === 'goal' && e.pid === pid).length,
      assists: ev.filter((e) => e.kind === 'goal' && e.assist === pid).length,
      inv: ent.filter((e) => e.pid === pid || e.pid2 === pid).length,
      // 本人の Z4進入・SZ進入（ドリブル・パスの出し手と受け手・リバウンド。関わった人それぞれに +1。2026-10-19）
      z4: ent.filter((e) => e.kind === 'z4' && (e.pid === pid || e.pid2 === pid)).length, szE: ent.filter((e) => e.kind === 'sz' && (e.pid === pid || e.pid2 === pid)).length,
      passFrom: ent.filter((e) => e.method === 'pass' && e.pid === pid).length,
      passTo: ent.filter((e) => e.method === 'pass' && e.pid2 === pid).length,
      rec: ev.filter((e) => e.kind === 'rec' && e.pid === pid).length, lost: ev.filter((e) => e.kind === 'lost' && e.pid === pid).length,
      foul: ev.filter((e) => e.kind === 'foul' && e.pid === pid).length, pm,
      shotOn: ownOn.filter((x) => x.has(pid)).length, oshotOn: oppOn.filter((x) => x.has(pid)).length,
      entOn: entOn.filter((x) => x.has(pid)).length, oentOn: oentOn.filter((x) => x.has(pid)).length,
    };
  });
  for (const r of rows) { r.inRate = r.shots ? r.in / r.shots : -1; r.shotDiff = r.shotOn - r.oshotOn; r.entDiff = r.entOn - r.oentOn; r.rlDiff = r.rec - r.lost; }
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
      add(e.pid, (d) => { d.foul++; if (c === 'yellow' || c === 'y2') d.cY++; if (c === 'y2') d.cY2++; if (c === 'red' || c === 'y2') d.cR++; }); // 2枚目のイエローはイエローとレッドの両方に数える
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

// ---------- 時間帯（決3・未8、2026-10-17） ----------
// 前半・後半をそれぞれ半分に分け、延長は延長前半・延長後半を1つずつ（延長を行ったときだけ）。
// 境目は試合通算の時間で、終わりを含む（0:00〜10:00＝「0~10」、10:01〜20:00＝「11~20」。後半の0:00＝通算20:00は「11~20」）。
// 区切りがすべて分ちょうどなら「0~10」の形、そうでなければ「0~7:30」「7:31~15:00」の形。
const mmssT = (ms) => { const x = Math.round(ms / 1000); return `${Math.floor(x / 60)}:${String(x % 60).padStart(2, '0')}`; };
export function bandsOf(M) {
  const reg = M.periods.filter((p) => !p.extra);
  const ext = M.periods.some((p) => p.extra && p.status !== 'none') ? M.periods.filter((p) => p.extra) : [];
  const out = []; let t = 0;
  for (const p of [...reg, ...ext]) {
    const parts = p.extra ? [p.len] : [Math.round(p.len / 2000) * 1000, p.len];
    let prev = 0;
    for (const x of parts) { out.push({ period: p.key, from: t + prev, to: t + x }); prev = x; }
    t += p.len;
  }
  const whole = out.every((b) => b.to % 60000 === 0);
  for (const b of out) b.label = whole ? `${b.from ? b.from / 60000 + 1 : 0}~${b.to / 60000}` : `${b.from ? mmssT(b.from + 1000) : '0'}~${mmssT(b.to)}`;
  return out;
}
// 試合通算の時間（ピリオドの前までの長さ＋経過）
export const cumAt = (M, period, at) => { const i = M.periods.findIndex((p) => p.key === period); return M.periods.slice(0, Math.max(0, i)).reduce((t, p) => t + p.len, 0) + at; };
export function bandIndex(BD, M, period, at) {
  if (!BD.length) return 0;
  const c = cumAt(M, period, at); const i = BD.findIndex((b) => c <= b.to);
  return i < 0 ? BD.length - 1 : i;
}

// どこまでの記録か（マッチスタッツ・マッチレビュー・マッチレポートで同じ）：最後に終わったピリオドから
const mmssUpT = (ms) => { const x = Math.max(0, Math.ceil(ms / 1000 - 1e-6)); return `${Math.floor(x / 60)}:${String(x % 60).padStart(2, '0')}`; };
export function asOfLabel(M) {
  if (M.matchOver) return '試合終了時点';
  const cur = M.periods.find((p) => p.key === M.current);
  if (M.live && cur) return `${cur.label} 残り ${mmssUpT(cur.len - cur.elapsed)} 時点`;
  const done = M.periods.filter((p) => p.status === 'done');
  return done.length ? `${done[done.length - 1].label}終了時点` : '試合開始前';
}

// ---------- パワープレー（5×4）と退場の時間帯で分ける（2026-10-16・17 決定） ----------
// 自チームの5×4＝MATCH PLAY・記録の修正のパワープレー（自チーム）と、GKをFPと入れ替えてGKがいない区間（決1）。
// 退場でGKがいない区間（空席）や、初めからGKがいない並びは5×4に入れない。相手の5×4＝パワープレー（相手）。
const mergeIv = (list) => { const a = list.filter((x) => x[1] > x[0]).sort((x, y) => x[0] - y[0]); const out = []; for (const x of a) { const l = out[out.length - 1]; if (l && x[0] <= l[1]) l[1] = Math.max(l[1], x[1]); else out.push([x[0], x[1]]); } return out; };
// list から cut の区間を取り除く
const subIv = (list, cut) => { let res = mergeIv(list); for (const [c0, c1] of mergeIv(cut)) res = res.flatMap(([a, b]) => (c1 <= a || c0 >= b ? [[a, b]] : [[a, Math.min(b, c0)], [Math.max(a, c1), b]].filter(([x, y]) => y > x))); return res; };
// GKをFPと入れ替えてGKがいない区間（特殊局面）。ピリオドごと
export function noGkWindows(M) {
  const isGK = (pid) => M.cfg.members?.[pid]?.pos === 'GK';
  const out = {};
  for (const p of M.periods) {
    out[p.key] = [];
    if (p.status === 'none') continue;
    const end = p.elapsed;
    const ss = M.stints.filter((x) => x.period === p.key);
    const em = (M.empties || []).filter((x) => x.period === p.key).map((x) => [Math.max(0, x.from), Math.min(end, x.to ?? end)]);
    const emp = (M.empties || []).filter((x) => x.period === p.key);
    const cuts = [...new Set([0, end, ...ss.flatMap((x) => [x.from, x.to]), ...em.flat()])].filter((c) => c >= 0 && c <= end).sort((a, b) => a - b);
    const runs = []; let cur = null;
    for (let i = 0; i + 1 < cuts.length; i++) {
      const a = cuts[i], b = cuts[i + 1]; const on = ss.filter((x) => x.from <= a && x.to >= b);
      if (on.length && !on.some((x) => isGK(x.pid))) { if (cur && cur[1] === a) cur[1] = b; else runs.push(cur = [a, b]); } else cur = null;
    }
    // GKが交代で出た瞬間に始まる区間だけ（GKの退場・初めからGKがいない並びは除く）
    const ok = runs.filter(([a]) => a > 0 && ss.some((x) => isGK(x.pid) && x.to === a) && !emp.some((e) => e.from === a && isGK(e.pid)));
    out[p.key] = subIv(ok, em); // 退場で空席の間は、退場の時間帯に入れる
  }
  return out;
}
// 退場の時間帯：自チーム＝MATCH PLAYの退場で空席の区間（3×4）、相手＝相手の退場の記録（4×3）
export function ejWindows(M, events = null) {
  const own = {};
  for (const p of M.periods) own[p.key] = p.status === 'none' ? [] : mergeIv((M.empties || []).filter((x) => x.period === p.key).map((x) => [Math.max(0, x.from), Math.min(p.elapsed, x.to ?? p.elapsed)]));
  // ランニングタイムの試合の形（M.relOf がある）のときは、相手の退場の時刻（試合の時計）を実際の時間に置きかえる
  const Mp = M.relOf ? { ...M, periods: M.periods.map((p) => ({ ...p, elapsed: p.playing ?? p.elapsed })) } : M;
  let opp = oppEjWindows(events, Mp);
  if (M.relOf) opp = Object.fromEntries(Object.entries(opp).map(([k, iv]) => [k, mergeIv(iv.map(([a, b]) => [M.relOf(k, a), M.relOf(k, b)]))]));
  return { own, opp };
}
// events を渡すと、退場の時間帯（ejOwn・ejOpp）も入る（分析の「数的同数だけ」・セットの表で除く）
export function ppWindows(M, events = null) {
  const own = {}, opp = {};
  const ng = noGkWindows(M);
  for (const p of M.periods) {
    if (p.status === 'none') { own[p.key] = []; opp[p.key] = []; continue; }
    const end = p.elapsed;
    const pp = (team) => (M.pp || []).filter((x) => x.period === p.key && x.team === team).map((x) => [x.from, Math.min(end, x.to ?? end)]);
    own[p.key] = mergeIv([...pp('own'), ...ng[p.key]]); opp[p.key] = mergeIv(pp('opp'));
  }
  const hasOpp = !!M.oppPPRecorded || (M.pp || []).some((x) => x.team === 'opp');
  const E = ejWindows(M, events);
  return { own, opp, hasOpp, ejOwn: E.own, ejOpp: E.opp, hasOppEj: (events || []).some((e) => !e.deleted && e.kind === 'oej') };
}
// mode → ピリオドごとの数える区間。重ならないように分ける（退場を先に、次に自チームの5×4、相手の5×4）：
//  all（すべて＝null）/ ex（数的同数だけ＝5×4・4×5・両チームの退場を除く）/ pp（5×4・4×5）/ own（自チームの5×4）/ opp（相手の5×4）
//  / ejown（自チームの退場＝3×4）/ ejopp（相手の退場＝4×3）。ex＋own＋opp＋ejown＋ejopp＝試合全体
export function windowsOf(M, W, mode) {
  if (mode === 'all') return null;
  const out = {};
  for (const p of M.periods) {
    const k = p.key;
    const eo = W.ejOwn?.[k] || [], ep = subIv(W.ejOpp?.[k] || [], eo), ej = mergeIv([...eo, ...ep]);
    const ow = subIv(W.own[k] || [], ej), op = subIv(W.opp[k] || [], [...ej, ...ow]);
    const all = mergeIv([...ej, ...ow, ...op]);
    if (mode === 'own') out[k] = ow;
    else if (mode === 'opp') out[k] = op;
    else if (mode === 'pp') out[k] = mergeIv([...ow, ...op]);
    else if (mode === 'ejown') out[k] = eo;
    else if (mode === 'ejopp') out[k] = ep;
    else if (mode === 'ej') out[k] = ej;
    else out[k] = subIv(p.status === 'none' ? [] : [[0, p.elapsed]], all);
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

// ---------- セットの表（決4・決8、2026-10-17）：マッチレビュー 4・6、分析のセット、データシートのセットで同じ決め方 ----------
// セットの時間と回数は「数的同数」の時間帯だけで数える（5×4・4×5と、両チームの退場の時間帯を除く）。
// 返り値：sets（すべてのセット。長い順）、classify(e)（そのイベントの行：セットのキー／'ex'＝5×4・4×5と退場の時間帯／
// 'special'＝GK1人・FP4人がそろっていない／'other'＝交代の瞬間の3秒未満）、time（それぞれの時間と、試合の時間 played）
export function setSplit(M, W, keys = null) {
  const isGK = (pid) => M.cfg.members?.[pid]?.pos === 'GK';
  const inK = (k) => !keys || keys.includes(k);
  const wins = windowsOf(M, W, 'ex'); const inEx = winTest(wins, M);
  const Mx = clipModel(M, wins);
  const Mk = { ...Mx, periods: Mx.periods.filter((p) => inK(p.key)) };
  const sets = setTable(Mk);
  const time = { sets: sets.reduce((t, x) => t + x.time, 0), special: 0, other: 0, ex: 0, played: 0 };
  for (const p of M.periods) if (p.status !== 'none' && inK(p.key)) time.played += p.elapsed;
  for (const p of Mk.periods) {
    if (p.status === 'none') continue;
    time.ex += (M.periods.find((q) => q.key === p.key)?.elapsed || 0) - p.elapsed;
    const ss = Mk.stints.filter((x) => x.period === p.key);
    const cuts = [...new Set(ss.flatMap((x) => [x.from, x.to]))].sort((a, b) => a - b);
    for (let i = 0; i + 1 < cuts.length; i++) {
      const a = cuts[i], b = cuts[i + 1]; const on = ss.filter((x) => x.from <= a && x.to >= b).map((x) => x.pid);
      if (!on.length) continue; // 除いた時間帯
      const ok = on.filter(isGK).length === 1 && on.filter((x) => !isGK(x)).length === 4;
      if (!ok) time.special += b - a; else if (b - a < SET_MIN) time.other += b - a;
    }
  }
  const byKey = new Map(sets.map((x) => [x.key, x]));
  const classify = (e) => {
    if (!inEx(e)) return 'ex';
    const on = pitchAt(M, e.period, e.at, e.side || (isFsp(e.kind) ? 'after' : 'before'));
    const gks = on.filter(isGK), fps = on.filter((x) => !isGK(x));
    const key = gks.length === 1 && fps.length === 4 ? fps.slice().sort().join('|') : null;
    return key ? (byKey.has(key) ? key : 'other') : 'special';
  };
  return { sets, classify, time, wins };
}
// マッチレビュー 6・データシート：セットごとの回数（シュート・被シュート・Z4進入…）。出場時間が setMin 未満のセットは short にまとめる。
// rows＋short＋ex＋special＋other ＝ total（時間も回数も）
export function setCountTable(M, W, events, goalName, { keys = null, setMin = 60000 } = {}) {
  const S = setSplit(M, W, keys);
  const col = (e) => {
    const k = e.kind;
    if (k === 'shot' || k === 'szshot') return 0;
    if (k === 'goal') return e.pid === OPP_OG ? -1 : 0;
    if (k === 'oshot' || k === 'oszshot') return 1;
    if (k === 'conc') return isOGType(e.gtype, goalName) ? -1 : 1;
    const i = ['z4', 'oz4', 'sz', 'osz', 'fspat', 'fspdf'].indexOf(k);
    return i < 0 ? -1 : i + 2;
  };
  const zero = () => SET_COLS.map(() => 0);
  const rows = S.sets.filter((x) => x.time >= setMin).map((x) => ({ key: x.key, pids: x.pids, time: x.time, count: x.count, c: zero() }));
  const shortL = S.sets.filter((x) => x.time < setMin);
  const short = { n: shortL.length, time: shortL.reduce((t, x) => t + x.time, 0), count: shortL.reduce((t, x) => t + x.count, 0), c: zero() };
  const ex = { time: S.time.ex, c: zero() }, special = { time: S.time.special, c: zero() }, other = { time: S.time.other, c: zero() }, total = { time: S.time.played, c: zero() };
  const shortK = new Set(shortL.map((x) => x.key));
  for (const e of events) {
    if (e.deleted || (keys && !keys.includes(e.period))) continue;
    const ci = col(e); if (ci < 0) continue;
    const r = S.classify(e);
    const row = r === 'ex' ? ex : r === 'special' ? special : r === 'other' ? other : shortK.has(r) ? short : rows.find((x) => x.key === r);
    row.c[ci]++; total.c[ci]++;
  }
  return { cols: SET_COLS, rows, short, ex, special, other, total };
}
