// Scenario tests: the cases written in the spec (3章「想定ケース」, 4章 セットプレーの例, 6章 5x4).
// Run: node test/scenarios.test.mjs
import { replay, nowElapsed, playerPeriodTime, playerCounts, seatView, contTime, restTime } from '../js/engine.js';

const M = { G: { pos: 'GK' }, A: { pos: 'FP' }, B: { pos: 'FP' }, C: { pos: 'FP' }, D: { pos: 'FP' },
  E: { pos: 'FP' }, F: { pos: 'FP' }, G2: { pos: 'GK' }, H: { pos: 'FP' }, I: { pos: 'FP', pp: true }, J: { pos: 'FP' } };
const cfg = { times: { half: 20, extra: false, extraHalf: 5 }, members: M, setplayAuto: 60 };
const sec = 1000;
let ok = 0; const fails = [];
function T(name, fn) { try { fn(); ok++; } catch (e) { fails.push(name + ': ' + e.message); } }
const eq = (a, b, m) => { if (a !== b) throw new Error(`${m}: ${a} !== ${b}`); };
// builder: ops at real times; clock runs from kickoff unless stopped
function mk() {
  const ops = []; let n = 0; const T0 = 1e12;
  const at = (s) => T0 + s * sec;
  return {
    ops,
    add(s, o) { ops.push({ id: 'x' + n, n: n++, t: at(s), period: o.period || replay(ops, cfg).current, ...o }); return this; },
    S() { return replay(ops, cfg); },
    at,
  };
}
const ko = (b, s = 0) => b.add(s, { type: 'kickoff', lineup: ['G', 'A', 'B', 'C', 'D'] });
const pt = (S, pid, t) => playerPeriodTime(S, pid, '1H', nowElapsed(S, t)) / sec;

T('5人を一気にOUTして5人をIN', () => {
  const b = mk(); ko(b); b.add(60, { type: 'stop' });
  ['G', 'A', 'B', 'C', 'D'].forEach((p) => b.add(61, { type: 'out', pid: p }));
  ['G2', 'E', 'F', 'H', 'J'].forEach((p) => b.add(62, { type: 'in', pid: p }));
  b.add(70, { type: 'start' });
  const S = b.S(); const t = b.at(130);
  eq(S.seats.filter(Boolean).sort().join(), ['E', 'F', 'G2', 'H', 'J'].sort().join(), 'pitch');
  eq(pt(S, 'A', t), 60, 'A time'); eq(pt(S, 'E', t), 60, 'E time');
});

T('4人OUT・2人は間違い・どの順番でINしても正しい', () => {
  const b = mk(); ko(b); b.add(100, { type: 'stop' });
  ['A', 'B', 'C', 'D'].forEach((p) => b.add(101, { type: 'out', pid: p }));
  b.add(102, { type: 'in', pid: 'E' }); b.add(103, { type: 'in', pid: 'C' }); // C was a mistake
  b.add(104, { type: 'in', pid: 'F' }); b.add(105, { type: 'in', pid: 'D' }); // D was a mistake
  const S = b.S();
  eq(S.seats.filter(Boolean).sort().join(), ['C', 'D', 'E', 'F', 'G'].sort().join(), 'pitch');
  eq(playerCounts(S, 'C', '1H').period, 1, 'C keeps one appearance');
  eq(S.batch.outs.length, 0, 'no waiting left');
});

T('OUTとINの間が10秒：Aは15:00で終了、Bは15:00から、Bのタイマーは0:10', () => {
  const b = mk(); ko(b);
  b.add(300, { type: 'out', pid: 'A' }); // 5:00 elapsed = 残り15:00
  b.add(310, { type: 'in', pid: 'E' });
  const S = b.S(); const t = b.at(310);
  eq(pt(S, 'A', t), 300, 'A'); eq(pt(S, 'E', t), 10, 'E');
  const v = seatView(S, nowElapsed(S, t)).find((x) => x.pid === 'E');
  eq(Math.round(contTime(S, 'E', nowElapsed(S, t), v) / sec), 10, 'E timer 0:10');
});

T('OUTだけでピリオド終了 → 最後まで出場', () => {
  const b = mk(); ko(b); b.add(1190, { type: 'out', pid: 'A' }); b.add(1200, { type: 'periodEnd' });
  const S = b.S();
  eq(playerPeriodTime(S, 'A', '1H', 0) / sec, 1200, 'A full');
  eq(S.current, '2H', 'next period');
});

T('交代待ちがないのにIN → 受け付けない', () => {
  const b = mk(); ko(b); b.add(10, { type: 'in', pid: 'E' });
  const S = b.S(); eq(S.seats.includes('E'), false, 'E not on pitch'); eq(S.notices[0]?.kind, 'needOut', 'notice');
});

T('1つ戻す：直前のINを取り消し', () => {
  const b = mk(); ko(b); b.add(10, { type: 'out', pid: 'A' }); b.add(11, { type: 'in', pid: 'E' }); b.add(12, { type: 'undo' });
  const S = b.S(); eq(S.seats.includes('A'), true, 'A back (waiting)'); eq(S.batch.outs.length, 1, 'A waiting');
});

T('セットプレー：Bは1:30から再開、Fは0:15から続行、Gは0:00から', () => {
  const b = mk(); b.add(0, { type: 'kickoff', lineup: ['G', 'A', 'B', 'C', 'D'] });
  b.add(90, { type: 'stop' }); b.add(91, { type: 'setplay' });
  b.add(92, { type: 'out', pid: 'B' }); b.add(92, { type: 'out', pid: 'C' });
  b.add(93, { type: 'in', pid: 'E' }); b.add(93, { type: 'in', pid: 'F' });
  b.add(100, { type: 'start' });              // FK 15秒
  b.add(115, { type: 'stop' });
  b.add(116, { type: 'out', pid: 'E' }); b.add(116, { type: 'out', pid: 'C' }); // C is not on pitch: ignored
  b.add(117, { type: 'in', pid: 'B' });
  const S = b.S(); const at = nowElapsed(S, b.at(117));
  const view = seatView(S, at);
  const c = (p) => Math.round(contTime(S, p, at, view.find((x) => x.pid === p)) / sec);
  eq(c('B'), 90, 'B 1:30'); eq(c('F'), 15, 'F 0:15'); eq(c('A'), 105, 'A 1:45');
  eq(!!S.setplay, true, 'C is still off, so set play mode continues until the button or 1:00');
});

T('退場：空席、2分前の補充は確認、空席時間は誰の出場にも入らない', () => {
  const b = mk(); ko(b); b.add(100, { type: 'eject', pid: 'A' }); b.add(160, { type: 'in', pid: 'E', afterGoal: true });
  const S = b.S(); const t = b.at(400);
  eq(S.seats.includes('E'), true, 'E filled'); eq(S.fills[0].early, true, 'early fill');
  eq(pt(S, 'A', t), 100, 'A'); eq(pt(S, 'E', t), 240, 'E');
  b.add(410, { type: 'in', pid: 'A' }); eq(b.S().seats.includes('A'), false, 'ejected cannot come back');
});

T('5x4：GKがOUTしてPP可能な選手がIN → 自動で開始、ボタンで終了', () => {
  const b = mk(); ko(b); b.add(1000, { type: 'out', pid: 'G' }); b.add(1001, { type: 'in', pid: 'I' });
  let S = b.S(); eq(S.ppActive?.team, 'own', 'auto start'); eq(S.ppActive?.auto, true, 'auto flag');
  b.add(1050, { type: 'out', pid: 'I' }); b.add(1051, { type: 'in', pid: 'G' }); // GK back on defence: 5x4 continues
  S = b.S(); eq(!!S.ppActive, true, 'still 5x4');
  b.add(1100, { type: 'ppEnd' }); S = b.S(); eq(S.ppActive, null, 'ended'); eq(S.pp[0].to, 1100 * sec, 'end time');
});

T('GKがOUTしてPP不可の選手がIN → 警告', () => {
  const b = mk(); ko(b); b.add(10, { type: 'out', pid: 'G' }); b.add(11, { type: 'in', pid: 'E' });
  eq(b.S().notices[0]?.kind, 'noGK', 'warn');
});

T('タイムアウトは各チーム各ハーフ1回まで', () => {
  const b = mk(); ko(b); b.add(10, { type: 'timeout', team: 'own' }); b.add(20, { type: 'timeout', team: 'own' }); b.add(30, { type: 'timeout', team: 'opp' });
  eq(b.S().timeouts.length, 2, 'two');
});

T('前半だけリセット → 後半の記録は残る', () => {
  const b = mk(); ko(b); b.add(1200, { type: 'periodEnd' });
  b.add(1300, { type: 'kickoff', lineup: ['G', 'E', 'F', 'H', 'J'] }); b.add(2500, { type: 'periodEnd' });
  b.add(2600, { type: 'extra', yes: false });
  let S = b.S(); eq(S.matchOver, true, 'over');
  b.add(2700, { type: 'reset', scope: '1H' });
  S = b.S(); eq(S.current, '1H', 'back to 1H'); eq(S.periods['2H'].status, 'done', '2H kept'); eq(S.periods['1H'].status, 'none', '1H cleared');
  b.add(2800, { type: 'undo' }); S = b.S(); eq(S.periods['1H'].status, 'done', 'undo the reset');
});

T('時刻合わせ（残り時間を戻す）でも合計が合う', () => {
  const b = mk(); ko(b); b.add(300, { type: 'out', pid: 'A' }); b.add(301, { type: 'in', pid: 'E' });
  b.add(302, { type: 'adjust', elapsed: 250 * sec });
  const S = b.S(); const at = nowElapsed(S, b.at(400));
  let tot = 0; Object.keys(M).forEach((p) => { tot += playerPeriodTime(S, p, '1H', at); });
  eq(tot, 5 * at, 'sum');
});

T('休憩時間はハーフタイムをはさんでも前半から続けて数える', () => {
  const b = mk(); ko(b); b.add(2, { type: 'out', pid: 'A' }); b.add(3, { type: 'in', pid: 'E' }); b.add(1200, { type: 'periodEnd' });
  const S = b.S(); eq(Math.round(restTime(S, 'A', 0) / 1000), 1198, 'A rest at start of 2H');
  b.add(1300, { type: 'kickoff', lineup: ['G', 'B', 'C', 'D', 'F'] });
  eq(Math.round(restTime(b.S(), 'A', 60000) / 1000), 1258, 'A rest 1:00 into 2H');
});

console.log(`scenarios: ${ok} passed, ${fails.length} failed`);
fails.forEach((f) => console.log('  FAIL ' + f));
if (fails.length) process.exit(1);
