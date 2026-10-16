// チームと選手の集計（マッチレビュー 5・7・8、マッチスタッツ）。spec 7章・9章。
// 画面を作らない純粋な計算。同じ記録から同じ計算で作るので、レビューとスタッツの数字は必ず一致する。
// 得点・失点は専用の種類（goal / conc）で記録するが、シュートにも数える（得点＝枠内のシュート）。OGはシュートに数えない。
import { OPP_OG, NO_ASSIST, UNKNOWN, isOG, clsOfGoalType, cardsOf, pitchAt } from './events.js';

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
export function teamStats(M, events, goalName, keys = null) {
  const inR = (e) => !keys || keys.includes(e.period);
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
    const own = e.kind === 'goal';
    if (score[own ? 'own' : 'opp'][e.period] == null) continue;
    score[own ? 'own' : 'opp'][e.period]++;
    goals.push({ e, own });
  }
  const sum = (o, ks) => (ks || Object.keys(o)).reduce((a, k) => a + (o[k] || 0), 0);
  const rangeScore = { own: sum(score.own, keys), opp: sum(score.opp, keys) };
  const timeouts = { own: 0, opp: 0 }; for (const t of M.timeouts || []) if (!keys || keys.includes(t.period)) timeouts[t.team === 'opp' ? 'opp' : 'own']++;
  const ejOwn = (M.ejections || []).filter((x) => !keys || keys.includes(x.period)).length;
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
    };
  });
  return { rows, assistMiss, unknownShooter: sh.filter((s) => !s.pid || s.pid === UNKNOWN).length, noAssist: NO_ASSIST };
}
