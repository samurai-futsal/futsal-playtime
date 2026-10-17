// Scenario tests: the cases written in the spec (3章「想定ケース」, 4章 セットプレーの例, 6章 5x4).
// Run: node test/scenarios.test.mjs
import { replay, nowElapsed, playerPeriodTime, playerCounts, seatView, contTime, restTime, perLen, ejectLeft, ejectCarryIn, setplayOn, carryOf } from '../js/engine.js';
import { matchModel, playerTable, setTable, checkTotal, replayToFix, checkFix } from '../js/model.js';

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

T('GKの交代：入るGKはGKの席（一番左）に入る', () => {
  const b = mk(); ko(b); b.add(10, { type: 'stop' });
  b.add(11, { type: 'out', pid: 'B' }); b.add(12, { type: 'out', pid: 'G' }); // FPを先にOUT
  b.add(13, { type: 'in', pid: 'G2' }); b.add(14, { type: 'in', pid: 'E' });  // GKを先にIN
  const S = b.S(); eq(S.seats[0], 'G2', 'GK2 in seat 0'); eq(S.seats[2], 'E', 'E in B seat');
});
T('パワープレーから戻るGKは、一番左の席が空くならそこに入る', () => {
  const b = mk(); ko(b); b.add(100, { type: 'out', pid: 'G' }); b.add(101, { type: 'in', pid: 'I' }); // PP: I in seat 0
  b.add(200, { type: 'out', pid: 'C' }); b.add(200, { type: 'out', pid: 'I' }); b.add(201, { type: 'in', pid: 'E' }); b.add(201, { type: 'in', pid: 'G' });
  const S = b.S(); eq(S.seats[0], 'G', 'GK back in seat 0'); eq(S.seats[3], 'E', 'E in C seat');
});

T('GKはピッチに1人まで：FPのOUTにGKは入れない／GK同士の交代は入れる', () => {
  const b = mk(); ko(b); b.add(10, { type: 'out', pid: 'A' }); b.add(11, { type: 'in', pid: 'G2' });
  let S = b.S(); eq(S.seats.includes('G2'), false, 'G2 refused'); eq(S.notices[0]?.kind, 'twoGK', 'notice');
  b.add(12, { type: 'in', pid: 'E' }); b.add(20, { type: 'out', pid: 'G' }); b.add(21, { type: 'in', pid: 'G2' });
  S = b.S(); eq(S.seats[0], 'G2', 'GK swap ok'); eq(S.seats.includes('G'), false, 'G out');
});

T('OUTの取り消し：その場所に仮に入った選手もベンチに戻る（A・BをOUT→CをIN→Aを取り消し）', () => {
  const b = mk(); ko(b); b.add(10, { type: 'out', pid: 'A' }); b.add(11, { type: 'out', pid: 'B' });
  b.add(12, { type: 'in', pid: 'E' }); b.add(13, { type: 'in', pid: 'A' });
  let S = b.S(); eq(S.seats.includes('E'), false, 'E back on bench'); eq(S.batch.outs.map((o) => o.pid).join(), 'B', 'B still waiting');
  eq(S.seats.includes('A'), true, 'A on pitch');
  b.add(14, { type: 'in', pid: 'F' }); S = b.S(); eq(S.seats.includes('F') && !S.seats.includes('B'), true, 'B->F');
  eq(playerCounts(S, 'A', '1H').period, 1, 'A keeps one appearance');
});
T('4人OUT・1人間違い・3人IN後に取り消し → 1人ベンチに戻り、もう一度押して決まる', () => {
  const b = mk(); ko(b); ['A', 'B', 'C', 'D'].forEach((p, i) => b.add(10 + i, { type: 'out', pid: p }));
  ['E', 'F', 'H'].forEach((p, i) => b.add(20 + i, { type: 'in', pid: p }));
  b.add(30, { type: 'in', pid: 'C' });
  let S = b.S(); eq(S.batch.outs.map((o) => o.pid).join(), 'A,B,D', 'A,B,D waiting'); eq(S.batch.ins.join(), 'E,F', 'H back on bench');
  b.add(31, { type: 'in', pid: 'H' }); S = b.S();
  eq(S.seats.filter(Boolean).sort().join(), ['C', 'E', 'F', 'G', 'H'].sort().join(), 'pitch');
});
T('4人目までIN→1つ戻す→取り消し→もう一度IN', () => {
  const b = mk(); ko(b); ['A', 'B', 'C', 'D'].forEach((p, i) => b.add(10 + i, { type: 'out', pid: p }));
  ['E', 'F', 'H', 'J'].forEach((p, i) => b.add(20 + i, { type: 'in', pid: p }));
  b.add(30, { type: 'undo' }); b.add(31, { type: 'in', pid: 'C' }); b.add(32, { type: 'in', pid: 'H' });
  const S = b.S(); eq(S.seats.filter(Boolean).sort().join(), ['C', 'E', 'F', 'G', 'H'].sort().join(), 'pitch');
  eq(S.stints.filter((x) => x.pid === 'J').length, 0, 'J never played');
});

T('退場2人：補充は押した空席に入る', () => {
  const b = mk(); ko(b); b.add(10, { type: 'eject', pid: 'A' }); b.add(11, { type: 'eject', pid: 'C' });
  b.add(200, { type: 'in', pid: 'E', seat: 3 });
  const S = b.S(); eq(S.seats[3], 'E', 'E in C seat'); eq(S.seats[1], null, 'A seat still empty');
});

T('マッチレビュー：出場時間・回数とセット（パワープレー中は除く）', () => {
  const b = mk(); ko(b); b.add(300, { type: 'out', pid: 'A' }); b.add(300, { type: 'in', pid: 'E' });
  b.add(600, { type: 'out', pid: 'G' }); b.add(600, { type: 'in', pid: 'I' }); // 5x4（GKなし）
  b.add(660, { type: 'out', pid: 'I' }); b.add(660, { type: 'in', pid: 'G' });
  b.add(1200, { type: 'periodEnd' });
  const M = matchModel(b.S()); const T = playerTable(M);
  eq(T.A.total / sec, 300, 'A time'); eq(T.E.total / sec, 900, 'E time'); eq(T.G.count, 2, 'G count');
  const sets = setTable(M);
  eq(sets[0].pids.join(), 'B,C,D,E', 'longest set'); eq(sets[0].time / sec, 840, 'B,C,D,E without PP'); eq(sets[0].count, 2, 'two appearances around PP');
  eq(sets[1].time / sec, 300, 'A,B,C,D');
});


T('ピリオド終了で、終わっていない交代は取り消す（決7）：OUTの選手は最後まで、仮に入った選手は記録なし', () => {
  const b = mk(); ko(b); b.add(1100, { type: 'out', pid: 'A' }); b.add(1110, { type: 'out', pid: 'B' }); b.add(1120, { type: 'in', pid: 'E' });
  b.add(1200, { type: 'periodEnd' });
  const S = b.S();
  eq(playerPeriodTime(S, 'A', '1H', 0) / sec, 1200, 'A full'); eq(playerPeriodTime(S, 'B', '1H', 0) / sec, 1200, 'B full');
  eq(S.stints.filter((x) => x.pid === 'E').length, 0, 'E no record');
  b.add(1201, { type: 'undo' }); eq(b.S().batch.ins.join(), 'E', 'undo brings the waiting batch back');
});

T('退場の空席は残りの時間ごと次のピリオドへ持ち越す（決6）', () => {
  const b = mk(); ko(b); b.add(1150, { type: 'eject', pid: 'A' }); b.add(1200, { type: 'periodEnd' });
  let S = b.S(); eq(ejectCarryIn(S).length, 1, 'carry'); eq(ejectCarryIn(S)[0].left, 70 * sec, 'left 1:10');
  b.add(1300, { type: 'kickoff', lineup: ['G', 'B', 'C', 'D', null] }); // 4人で開始
  S = b.S(); eq(S.periods['2H'].status, 'live', '2H live with 4'); eq(S.empty[4]?.pid, 'A', 'empty seat for A');
  eq(ejectLeft(S.empty[4], nowElapsed(S, b.at(1330))), 40 * sec, 'countdown continues');
  b.add(1330, { type: 'in', pid: 'E', seat: 4 }); // 失点で補充（早い）
  S = b.S(); eq(S.fills[0].early, false, 'not marked early without afterGoal');
  const t = b.at(1400); const at = nowElapsed(S, t);
  let tot = 0; Object.keys(M).forEach((p) => { tot += playerPeriodTime(S, p, '2H', at); });
  eq(tot, 5 * at - 30 * sec, 'sum = 5×elapsed − empty');
  const Mo = matchModel(S, t); const ct = checkTotal(Mo); eq(ct.players, ct.expected, 'model total');
  b.add(1500, { type: 'periodEnd' }); S = b.S();
  const fp = replayToFix(S, '2H'); eq(fp.startEmpty?.[4], 'A', 'fix: starts empty'); eq(checkFix(fp, cfg).length, 0, 'fix ok');
  const T2 = playerTable(matchModel(S, b.at(1600), { periods: { '2H': fp } })); eq(T2.E.per['2H'].time / sec, 170, 'fix round trip');
});
T('持ち越しより多く枠を空けたキックオフは受け付けない／2:00が過ぎた空席は持ち越さない', () => {
  const b = mk(); ko(b); b.add(1150, { type: 'eject', pid: 'A' }); b.add(1200, { type: 'periodEnd' });
  b.add(1300, { type: 'kickoff', lineup: ['G', 'B', 'C', null, null] }); eq(b.S().periods['2H'].status, 'none', 'two holes refused');
  const c = mk(); ko(c); c.add(900, { type: 'eject', pid: 'A' }); c.add(1200, { type: 'periodEnd' });
  eq(ejectCarryIn(c.S()).length, 0, 'no carry after 2:00');
});
T('退場の空席を持ち越して5人で始めたときは、持ち越しは消える', () => {
  const b = mk(); ko(b); b.add(1150, { type: 'eject', pid: 'A' }); b.add(1200, { type: 'periodEnd' });
  b.add(1300, { type: 'kickoff', lineup: ['G', 'B', 'C', 'D', 'E'] }); const S = b.S();
  eq(S.empty.filter(Boolean).length, 0, 'no empty'); eq(S.seats.filter(Boolean).length, 5, '5 on pitch');
});

T('5x4の自動開始は、GKがOUTした時刻から（試12）', () => {
  const b = mk(); ko(b); b.add(300, { type: 'out', pid: 'G' }); b.add(310, { type: 'in', pid: 'I' });
  const S = b.S(); eq(S.pp[0].from / sec, 300, 'from GK OUT'); eq(S.stints.find((x) => x.pid === 'I').from / sec, 300, 'I from 300');
});

T('時計を戻す：退場・補充・続きも戻し、長さ0の5x4は消す（試11）', () => {
  const b = mk(); ko(b); b.add(300, { type: 'pp', team: 'opp' }); b.add(320, { type: 'ppEnd' });
  b.add(330, { type: 'eject', pid: 'A' }); b.add(340, { type: 'in', pid: 'E', seat: 1, afterGoal: true });
  b.add(350, { type: 'adjust', elapsed: 280 * sec });
  const S = b.S(); eq(S.pp.length, 0, 'zero-length 5x4 dropped'); eq(matchModel(S, b.at(360)).oppPPRecorded, true, 'still recorded opp 5x4');
  eq(S.ejections[0].at / sec, 280, 'ejection cut'); eq(S.fills[0].at / sec, 280, 'fill cut');
  const c = mk(); ko(c); c.add(500, { type: 'setplay' }); c.add(501, { type: 'out', pid: 'B' }); c.add(502, { type: 'in', pid: 'E' });
  c.add(503, { type: 'adjust', elapsed: 400 * sec });
  eq(c.S().carry.B / sec, 400, 'carry capped');
  c.add(504, { type: 'out', pid: 'E' }); c.add(505, { type: 'in', pid: 'B' });
  const S2 = c.S(); const at = nowElapsed(S2, c.at(505));
  eq(Math.round(contTime(S2, 'B', at, seatView(S2, at).find((x) => x.pid === 'B')) / sec), 401, 'B timer: capped 6:40 + 1 s');
});

T('ピリオドの長さはキックオフのときの長さ（足1）。試合情報で直した試合は設定の長さ', () => {
  const b = mk(); b.add(0, { type: 'kickoff', lineup: ['G', 'A', 'B', 'C', 'D'], len: 15 * 60 * sec, spAuto: 30 });
  b.add(100, { type: 'setplay' });
  let S = b.S(); eq(perLen(S, '1H') / sec, 900, 'kickoff length'); eq((S.setplay.endsAt - S.setplay.from) / sec, 30, 'set play auto from kickoff');
  eq(nowElapsed(S, b.at(2000)) / sec, 900, 'clock stops at 15:00');
  S = replay(b.ops, { ...cfg, timesFixed: true }); eq(perLen(S, '1H') / sec, 1200, 'fixed: match settings');
  const c = mk(); ko(c); eq(perLen(c.S(), '1H') / sec, 1200, 'old log: match settings');
});

T('並べ方（足4）：同じ端末は押した順、端末の時計が途中で戻っても順番は変わらない', () => {
  const T0 = 1e12;
  const ops = [
    { id: 'a', dev: 'ipad', n: 1, t: T0, period: '1H', type: 'kickoff', lineup: ['G', 'A', 'B', 'C', 'D'] },
    { id: 'b', dev: 'ipad', n: 2, t: T0 + 100 * sec, period: '1H', type: 'out', pid: 'A' },
    { id: 'c', dev: 'ipad', n: 3, t: T0 + 95 * sec, period: '1H', type: 'in', pid: 'E' }, // 時計が5秒戻った
    { id: 'd', dev: 'ipad', n: 4, t: T0 + 96 * sec, period: '1H', type: 'out', pid: 'B' },
  ];
  const S = replay(ops, cfg);
  eq(S.seats.includes('E'), true, 'E in'); eq(S.batch.outs.map((o) => o.pid).join(), 'B', 'B waiting');
  eq(S.stints.find((x) => x.pid === 'A').to / sec, 100, 'A out at 100'); eq(S.batch.outs[0].outAt / sec, 100, 'no time going backwards');
  const ops2 = [...ops, { id: 'e', dev: 'pc', n: 1, t: T0 + 50 * sec, period: '1H', type: 'timeout', team: 'own' }];
  eq(replay(ops2, cfg).timeouts[0].at / sec, 50, 'other device merged by time');
});

T('記録中に前のピリオドをリセットしても、記録中のピリオドは変わらない（試1）', () => {
  const b = mk(); ko(b); b.add(1200, { type: 'periodEnd' });
  b.add(1300, { type: 'kickoff', lineup: ['G', 'E', 'F', 'H', 'J'] }); b.add(1400, { type: 'out', pid: 'E' }); b.add(1401, { type: 'in', pid: 'A' });
  b.add(1500, { type: 'reset', scope: '1H', period: '2H' });
  let S = b.S(); eq(S.current, '2H', 'still 2H'); eq(S.periods['2H'].status, 'live', '2H live'); eq(S.periods['1H'].status, 'none', '1H cleared');
  eq(S.seats.filter(Boolean).sort().join(), ['A', 'F', 'G', 'H', 'J'].sort().join(), 'pitch kept');
  b.add(2500, { type: 'periodEnd', period: '2H' }); S = b.S();
  eq(S.current, '1H', 'then 1H can be recorded again'); eq(playerPeriodTime(S, 'A', '2H', 0) / sec, 1100, 'A 2H time');
});

T('空席を押してから選んだ選手は、交代待ちがあっても空席に入る', () => {
  const b = mk(); ko(b); b.add(10, { type: 'eject', pid: 'A' }); b.add(200, { type: 'out', pid: 'B' });
  b.add(201, { type: 'in', pid: 'E', seat: 1 });
  let S = b.S(); eq(S.seats[1], 'E', 'E fills A seat'); eq(S.batch.outs.map((o) => o.pid).join(), 'B', 'B still waiting');
  b.add(202, { type: 'in', pid: 'F' }); S = b.S(); eq(S.seats[2], 'F', 'F replaces B');
  const c = mk(); ko(c); c.add(10, { type: 'eject', pid: 'A' }); c.add(200, { type: 'out', pid: 'G' }); c.add(201, { type: 'in', pid: 'G2', seat: 1 });
  eq(c.S().seats.includes('G2'), false, 'GK cannot fill while the GK is still on the pitch (waiting)');
});

T('セットプレーの自動終了：時間を過ぎたら、次の操作の前でも終わったものとして見せる（試2）', () => {
  const b = mk(); ko(b); b.add(90, { type: 'setplay' }); b.add(91, { type: 'out', pid: 'B' }); b.add(92, { type: 'in', pid: 'E' });
  const S = b.S(); const at = nowElapsed(S, b.at(200));
  eq(setplayOn(S, at), false, 'mode over'); eq(carryOf(S, 'B', at), null, 'no 続き shown');
  eq(carryOf(S, 'B', nowElapsed(S, b.at(120))), 91 * sec, 'shown before 1:00');
  b.add(200, { type: 'out', pid: 'E' }); b.add(201, { type: 'in', pid: 'B' });
  const S2 = b.S(); const a2 = nowElapsed(S2, b.at(201));
  eq(Math.round(contTime(S2, 'B', a2, seatView(S2, a2).find((x) => x.pid === 'B')) / sec), 1, 'B starts from 0 (what the screen showed)');
});

console.log(`scenarios: ${ok} passed, ${fails.length} failed`);
fails.forEach((f) => console.log('  FAIL ' + f));
if (fails.length) process.exit(1);
