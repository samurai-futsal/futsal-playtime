// 分析画面の計算（spec 9章）：選手ごとの直接関与・間接関与、パワープレー（5×4）の時間帯で分ける集計。
// Run: node test/analysis.test.mjs
import { playerDetail, ppWindows, windowsOf, clipModel, winTest, ppTime, teamStats, addInto, blankDetail } from '../js/teamstats.js';
import { playerTable } from '../js/model.js';

let pass = 0, fail = 0;
const eq = (a, b, msg) => { const ok = JSON.stringify(a) === JSON.stringify(b); ok ? pass++ : (fail++, console.log('FAIL', msg, '\n  got', JSON.stringify(a), '\n  want', JSON.stringify(b))); };
const members = { g1: { no: '1', pos: 'GK' }, a: { no: '4', pos: 'FP' }, b: { no: '5', pos: 'FP' }, c: { no: '6', pos: 'FP' }, d: { no: '7', pos: 'FP' }, e: { no: '8', pos: 'FP' }, f: { no: '9', pos: 'FP' } };
const S = (pid, seat, from, to) => ({ period: '1H', pid, seat, from: from * 1000, to: to * 1000 });
// 0〜100秒：g1 a b c d。100秒で a→e。200〜260秒は GK がいない（g1→f の自チームの5×4）。600〜700秒は相手の5×4
const M = {
  cfg: { members },
  periods: [{ key: '1H', elapsed: 1200000, len: 1200000, status: 'done' }],
  stints: [S('g1', 0, 0, 200), S('f', 0, 200, 260), S('g1', 0, 260, 1200), S('a', 1, 0, 100), S('e', 1, 100, 1200), S('b', 2, 0, 1200), S('c', 3, 0, 1200), S('d', 4, 0, 1200)],
  empties: [], pp: [{ period: '1H', team: 'opp', from: 600000, to: 700000 }], timeouts: [], ejections: [],
};
const gn = () => '';
const ev = [
  { id: 1, kind: 'shot', period: '1H', at: 50000, pid: 'a', result: 'in' },
  { id: 2, kind: 'goal', period: '1H', at: 60000, pid: 'b', assist: 'a', sz: 'in' },
  { id: 3, kind: 'oshot', period: '1H', at: 150000, result: 'out' },
  { id: 4, kind: 'z4', period: '1H', at: 230000, method: 'pass', pid: 'f', pid2: 'b' },
  { id: 5, kind: 'conc', period: '1H', at: 650000 },
  { id: 6, kind: 'rec', period: '1H', at: 650000, pid: 'e', zone: 'Z2' },
];
const pids = Object.keys(members);
const T = playerTable(M);
const D = playerDetail(M, ev, gn, pids, T);
eq([D.a.shots, D.a.in, D.a.assists, D.b.goals, D.b.shots], [1, 1, 1, 1, 1], 'direct: shot, assist, goal counted as shot');
eq([D.a.on.shot, D.e.on.shot, D.a.on.gf, D.e.on.oshot, D.a.on.oshot], [2, 0, 1, 2, 0], 'indirect: only while on pitch (conceded goal is also an opp shot)');
eq([D.f.ent.z4.pf, D.b.ent.z4.pt, D.f.inv, D.b.inv, D.c.on.z4], [1, 1, 1, 1, 1], 'entry: pass from / to, involvement');
eq([D.e.rec, D.e.recZ, D.g1.on.ga], [1, [0, 1, 0, 0], 1], 'recovery zone, conceded while on pitch');
// --- 5×4
const W = ppWindows(M);
eq([W.own['1H'], W.opp['1H'], W.hasOpp], [[[200000, 260000]], [[600000, 700000]], true], 'own 5x4 from no-GK, opp 5x4 from record');
const ex = windowsOf(M, W, 'ex');
eq(ex['1H'], [[0, 200000], [260000, 600000], [700000, 1200000]], 'excluding 5x4');
const Mx = clipModel(M, ex); const Tx = playerTable(Mx);
eq([Mx.periods[0].elapsed, Tx.f?.total || 0, Tx.b.total], [1040000, 0, 1040000], 'clipped time');
const win = winTest(ex);
const Dx = playerDetail(M, ev, gn, pids, Tx, null, win);
eq([Dx.b.on.z4, Dx.g1.on.ga, Dx.e.rec], [0, 0, 0], 'events in 5x4 are left out');
const R = teamStats(M, ev, gn, null, win);
eq([R.rangeScore.own, R.rangeScore.opp, R.A.shots, R.B.shots], [1, 0, 2, 1], 'team stats without 5x4');
eq([ppTime(M, W, 'f'), ppTime(M, W, 'b')], [{ own: 60000, opp: 0 }, { own: 60000, opp: 100000 }], '5x4 time per player');
eq(addInto(blankDetail(), D.a).on.shot, 2, 'addInto');

console.log(`analysis: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
