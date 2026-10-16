// ランニングタイム表示（spec 7章）：同じ記録を実際に流れた時間で数え直す。
// Run: node test/running.test.mjs
import { replay } from '../js/engine.js';
import { matchModel, toRunning, playerTable, checkTotal, replayToFix, periodSig, basisOk } from '../js/model.js';

const MEM = { G: { pos: 'GK' }, A: { pos: 'FP' }, B: { pos: 'FP' }, C: { pos: 'FP' }, D: { pos: 'FP' }, E: { pos: 'FP' }, F: { pos: 'FP' } };
const cfg = { times: { half: 1, extra: false }, members: MEM, setplayAuto: 60 }; // 1分ハーフ
let pass = 0, fail = 0;
const eq = (a, b, msg) => { const ok = JSON.stringify(a) === JSON.stringify(b); ok ? pass++ : (fail++, console.log('FAIL', msg, '\n  got', JSON.stringify(a), '\n  want', JSON.stringify(b))); };
const T0 = 1e12; let n = 0;
const op = (s, o, period = '1H') => ({ id: 'o' + n, n: n++, t: T0 + s * 1000, period, ...o });
const time = (M, pid) => Math.round((playerTable(M)[pid]?.total || 0) / 1000);

// 0秒キックオフ → 20秒で止める → 止まっている間（25秒）に A→E → 50秒で再開 → 時計0:00は90秒 → 95秒に終了を押す
const ops = [
  op(0, { type: 'kickoff', lineup: ['G', 'A', 'B', 'C', 'D'] }),
  op(20, { type: 'stop' }),
  op(25, { type: 'out', pid: 'A' }), op(26, { type: 'in', pid: 'E' }),
  op(30, { type: 'out', pid: 'E' }), op(31, { type: 'in', pid: 'F' }), // 止まっている間だけ出たE
  op(50, { type: 'start' }),
  op(92, { type: 'stop' }),
  op(95, { type: 'periodEnd' }),
];
const st = replay(ops, cfg); st.sig = periodSig(ops);
const M = matchModel(st, T0 + 200000);
const R = toRunning(M, st, T0 + 200000);
eq(R.periods[0].elapsed, 90000, 'ランニングタイム＝キックオフから時計が0:00になるまで（90秒）');
eq(M.periods[0].elapsed, 60000, 'プレーイングタイムは60秒のまま');
eq([time(R, 'A'), time(R, 'E'), time(R, 'F'), time(R, 'G')], [25, 5, 60, 90], '止まっている間もピッチにいた時間に入る（交代＝OUTを押した時刻）');
eq([time(M, 'A'), time(M, 'E'), time(M, 'F')], [20, 0, 40], 'プレーイングタイムは変わらない');
const ct = checkTotal(R); eq(ct.players, ct.expected, '合計＝5×ランニングタイム');

// 時計が0:00になったあとに押した交代は、0:00の時刻で切る
const ops2 = [op(0, { type: 'kickoff', lineup: ['G', 'A', 'B', 'C', 'D'] }), op(70, { type: 'out', pid: 'A' }), op(71, { type: 'in', pid: 'E' }), op(75, { type: 'periodEnd' })];
const st2 = replay(ops2, cfg); const R2 = toRunning(matchModel(st2, T0 + 100000), st2, T0 + 100000);
eq([R2.periods[0].elapsed, time(R2, 'A'), time(R2, 'E')], [60000, 60, 0], '0:00のあと → ピリオドの外');

// 記録の修正を使うピリオド：同じ区切りは実際の時刻、変えた区切りは時計の動きから求める
const fp = replayToFix(st, '1H');
const sub = fp.ev.find((e) => e.in === 'F'); sub.at = 45000; // Fが入った時刻を時計の45秒（＝実際の75秒）に直す。Eはその前の場所（止まっている間に入った）
const fix = { periods: { '1H': { ...fp, basis: st.sig['1H'] } } };
const MF = matchModel(st, T0 + 200000, fix); eq(MF.fixed, ['1H'], '修正を使う');
const RF = toRunning(MF, st, T0 + 200000);
eq([time(RF, 'A'), time(RF, 'E'), time(RF, 'F')], [25, 30, 35], '修正：A・Eの始まりは元の時刻。Fの交代は時計で25秒遅らせたので、実際の時刻も25秒遅らせる（30秒→55秒）');
const cf = checkTotal(RF); eq(cf.players, cf.expected, '修正後も合計＝5×ランニングタイム');

// 試合中（時計が動いている）：今の時刻まで
const ops3 = [op(0, { type: 'kickoff', lineup: ['G', 'A', 'B', 'C', 'D'] }), op(10, { type: 'stop' }), op(30, { type: 'start' })];
const st3 = replay(ops3, cfg); const R3 = toRunning(matchModel(st3, T0 + 40000), st3, T0 + 40000);
eq([R3.periods[0].elapsed, time(R3, 'A')], [40000, 40], '試合中は今の時刻まで');

// ---- 2026-10-16：交代の修正に合わせて時計の記録も直す ----
{ // 時計が止まっている間（記録上）に E が入って出た。実際は E がいる間に時計が5秒動いていた（ペルー戦 前半 3:34〜3:29 と同じ形）
  n = 0;
  const ops = [op(0, { type: 'kickoff', lineup: ['G', 'A', 'B', 'C', 'D'] }), op(20, { type: 'stop' }),
    op(30, { type: 'out', pid: 'A' }), op(30.5, { type: 'in', pid: 'E' }), op(40, { type: 'out', pid: 'E' }), op(40.5, { type: 'in', pid: 'A' }),
    op(50, { type: 'start' }), op(90, { type: 'stop' }), op(95, { type: 'periodEnd' })];
  const st = replay(ops, cfg); st.sig = periodSig(ops);
  const fp = replayToFix(st, '1H');
  fp.ev.filter((e) => e.in === 'E').forEach((e) => { e.at = 15000; }); // E が入ったのは時計の15秒（記録では20秒）
  const M = matchModel(st, T0 + 200000, { periods: { '1H': { ...fp, basis: st.sig['1H'] } } });
  const R = toRunning(M, st, T0 + 200000);
  const c = R.clock['1H'];
  eq([c.changed, c.removed.length, c.added.length], [true, 1, 1], '時計：15〜20秒の5秒を削り、Eがいる間に5秒足す');
  eq([Math.round(c.removed[0].t0 - T0) / 1000, Math.round(c.removed[0].t1 - T0) / 1000], [15, 20], '削るのは記録で15〜20秒に動いていた分');
  eq(c.added[0].t0 >= T0 + 30500 && c.added[0].t1 <= T0 + 40000, true, '足すのはEが入ってから出るまでの間');
  eq([time(M, 'E'), time(R, 'E')], [5, 10], 'Eはプレーイングタイム5秒、ランニングタイムは押した実際の時刻のまま（30〜40秒）');
  const ct = checkTotal(R); eq(ct.players, ct.expected, '時計を直しても合計＝5×ランニングタイム');
  eq(c.runs.reduce((s2, r) => s2 + r.t1 - r.t0, 0), 60000, '直した時計の合計＝ピリオドの長さ');
}

// ---- 0.5.9 で直した不具合 ----
const mk = (list) => { n = 0; return list.map(([s, o, per]) => op(s, o, per)); };
const KO = { type: 'kickoff', lineup: ['G', 'A', 'B', 'C', 'D'] };
{ // A1：延長戦の質問の答えで、後半の修正が古い扱いにならない
  const ops = mk([[0, KO], [60, { type: 'periodEnd' }], [100, { type: 'kickoff', lineup: ['G', 'A', 'B', 'C', 'D'] }, '2H'], [160, { type: 'periodEnd' }, '2H']]);
  const cfg2 = { ...cfg, times: { half: 1, extra: true, extraHalf: 1 } };
  const st0 = replay(ops, cfg2); const sig0 = periodSig(ops);
  const fp = replayToFix(st0, '2H');
  ops.push(op(200, { type: 'extra', yes: false }, '2H'));
  const st1 = replay(ops, cfg2); st1.sig = periodSig(ops);
  eq(basisOk(st1.sig, '2H', sig0['2H']), true, '延長戦の答えのあとも後半の修正のしるしが合う');
  eq(matchModel(st1, T0 + 1e6, { periods: { '2H': { ...fp, basis: sig0['2H'] } } }).fixed, ['2H'], '後半の修正を使う');
  // 0.5.8までの数え方で保存した修正（延長戦の答えも数えていた）も使える
  const oldBasis = st1.sig.alt['2H'];
  eq(matchModel(st1, T0 + 1e6, { periods: { '2H': { ...fp, basis: oldBasis } } }).fixed, ['2H'], '古い数え方のしるしも使える');
}
{ // A2：止まっている間の交代で、修正が入った選手だけ変えたとき
  const ops = mk([[0, KO], [20, { type: 'stop' }], [25, { type: 'out', pid: 'A' }], [26, { type: 'in', pid: 'E' }], [50, { type: 'start' }], [95, { type: 'periodEnd' }]]);
  const st2 = replay(ops, cfg); st2.sig = periodSig(ops);
  const fp = replayToFix(st2, '1H'); fp.ev.find((e) => e.in === 'E').in = 'F';
  const R2 = toRunning(matchModel(st2, T0 + 1e6, { periods: { '1H': { ...fp, basis: st2.sig['1H'] } } }), st2, T0 + 1e6);
  eq([time(R2, 'A'), time(R2, 'F')], [25, 65], '入った選手を変えても、交代の実際の時刻は元のまま');
  const c2 = checkTotal(R2); eq(c2.players, c2.expected, '合計が合う');
}
{ // A2：止まっている間の退場＋修正
  const ops = mk([[0, KO], [20, { type: 'stop' }], [40, { type: 'eject', pid: 'A' }], [50, { type: 'start' }], [95, { type: 'periodEnd' }]]);
  const st3 = replay(ops, cfg); st3.sig = periodSig(ops);
  const fp = replayToFix(st3, '1H');
  const R3 = toRunning(matchModel(st3, T0 + 1e6, { periods: { '1H': { ...fp, basis: st3.sig['1H'] } } }), st3, T0 + 1e6);
  const c3 = checkTotal(R3); eq([time(R3, 'A'), c3.players === c3.expected], [40, true], '退場の実際の時刻が元のまま');
}
{ // A3：時計を戻しても、ランニングタイムで出場が消えない
  const ops = mk([[0, KO], [30, { type: 'out', pid: 'A' }], [30, { type: 'in', pid: 'E' }], [40, { type: 'out', pid: 'E' }], [40, { type: 'in', pid: 'F' }], [45, { type: 'adjust', elapsed: 20000 }], [85, { type: 'periodEnd' }]]);
  const st4 = replay(ops, cfg); const R4 = toRunning(matchModel(st4, T0 + 1e6), st4, T0 + 1e6);
  const c4 = checkTotal(R4); eq([time(R4, 'E'), c4.players === c4.expected], [10, true], '時計を戻した間の出場（10秒）が残る');
}
{ // A4：試合中、時計が止まっている間もランニングタイムは進む
  const ops = mk([[0, KO], [30, { type: 'stop' }], [40, { type: 'out', pid: 'A' }], [40, { type: 'in', pid: 'E' }]]);
  const st5 = replay(ops, cfg); const R5 = toRunning(matchModel(st5, T0 + 50000), st5, T0 + 50000);
  eq([R5.periods[0].elapsed, time(R5, 'A'), time(R5, 'E')], [50000, 40, 10], '止まっている間に入った選手も今まで数える');
}
{ // A6：同じ秒に同じ場所で何度も交代したときの順番
  const ops = mk([[0, KO], [20, { type: 'stop' }], [21, { type: 'out', pid: 'A' }], [21, { type: 'in', pid: 'E' }], [22, { type: 'out', pid: 'E' }], [22, { type: 'in', pid: 'F' }], [23, { type: 'out', pid: 'F' }], [23, { type: 'in', pid: 'A' }], [30, { type: 'start' }], [80, { type: 'periodEnd' }]]);
  const st6 = replay(ops, cfg); const fp = replayToFix(st6, '1H');
  eq(fp.ev.map((e) => e.in), ['E', 'F', 'A'], '交代の順番が記録のとおり');
}

console.log(`running: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
