// ランニングタイム表示（spec 7章）：同じ記録を実際に流れた時間で数え直す。
// Run: node test/running.test.mjs
import { replay } from '../js/engine.js';
import { matchModel, toRunning, playerTable, checkTotal, replayToFix, periodSig } from '../js/model.js';

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
eq([time(RF, 'A'), time(RF, 'E'), time(RF, 'F')], [25, 50, 15], '修正：A・Eの始まりは元の時刻、Fは時計の45秒＝実際の75秒から');
const cf = checkTotal(RF); eq(cf.players, cf.expected, '修正後も合計＝5×ランニングタイム');

// 試合中（時計が動いている）：今の時刻まで
const ops3 = [op(0, { type: 'kickoff', lineup: ['G', 'A', 'B', 'C', 'D'] }), op(10, { type: 'stop' }), op(30, { type: 'start' })];
const st3 = replay(ops3, cfg); const R3 = toRunning(matchModel(st3, T0 + 40000), st3, T0 + 40000);
eq([R3.periods[0].elapsed, time(R3, 'A')], [40000, 40], '試合中は今の時刻まで');

console.log(`running: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
