// Sportscode からの取り込み（spec 9章）：XML と CSV が同じ結果になること、コード・ラベルの読み方、時刻の直し方。
// Run: node test/scimport.test.mjs
import { parseSC, buildImport, kickOffs, periodFromName } from '../js/scimport.js';
import { OPP_OG } from '../js/events.js';
let pass = 0, fail = 0;
const eq = (a, b, msg) => { const ok = JSON.stringify(a) === JSON.stringify(b); ok ? pass++ : (fail++, console.log('FAIL', msg, '\n  got', JSON.stringify(a), '\n  want', JSON.stringify(b))); };
const inst = (id, s, e, code, labels) => `<instance>\n<ID>${id}</ID>\n<start>${s}</start>\n<end>${e}</end>\n<code>${code}</code>\n${labels.map(([g, t]) => `<label>\n<group>${g}</group>\n<text>${t}</text>\n</label>\n`).join('')}</instance>\n`;
const xml = '<file>\n<ALL_INSTANCES>\n' + [
  inst(1, 10, 12, 'Kick Off', []),
  inst(2, 20, 37, 'シュート', [['シュート分類', '枠内'], ['スコアゾーン進入人数', '2'], ['局面', '定位置攻撃'], ['選手', '山田 太郎']]),
  inst(3, 55, 63, 'SETPLAY AT', [['セットプレー分類', 'KICK IN']]),
  inst(4, 45, 62, 'スコアゾーン内シュート', [['シュート分類', 'ゴール'], ['局面', 'セットプレー攻撃'], ['選手', '#7']]),
  inst(5, 70, 87, '被シュート', [['シュート分類', '枠外(ポスト)'], ['シュート分類', 'ブロック'], ['局面', 'GK活用守備']]),
  inst(6, 90, 107, '被シュート', [['シュート分類', 'オウンゴール']]),
  inst(7, 100, 115, 'ROBO 1/2', [['選手', '山田 太郎']]),
  inst(8, 110, 127, 'ファウル', [['選手', '山田 太郎'], ['カード', 'イエロー']]),
  inst(9, 120, 140, '#7', [['選手', '山田 太郎']]),
  inst(10, 130, 147, 'なにか', []),
].join('') + '</ALL_INSTANCES>\n</file>\n';
const csv = 'Timeline,Start time,Duration,Row,Instance number,カード,シュート分類,スコアゾーン進入人数,セットプレー分類,局面,選手,Ungrouped,Notes,Flags\n'
  + 'A vs B,10,2,Kick Off,1,,,,,,,,,\nA vs B,20,17,シュート,1,,枠内,2,,定位置攻撃,山田 太郎,,,\nA vs B,55,8,SETPLAY AT,1,,,,KICK IN,,,,,\n'
  + 'A vs B,45,17,スコアゾーン内シュート,1,,ゴール,,,セットプレー攻撃,#7,,,\nA vs B,70,17,被シュート,1,,"枠外(ポスト), ブロック",,,GK活用守備,,,,\nA vs B,90,17,被シュート,2,,オウンゴール,,,,,,,\n'
  + 'A vs B,100,15,ROBO 1/2,1,,,,,,山田 太郎,,,\nA vs B,110,17,ファウル,1,イエロー,,,,,山田 太郎,,,\nA vs B,120,20,#7,1,,,,,,山田 太郎,,,\nA vs B,130,17,なにか,1,,,,,,,,,\n';
const X = parseSC(xml), C = parseSC(csv);
eq([X.kind, C.kind, X.instances.length, C.instances.length], ['xml', 'csv', 10, 10], 'parse both');
const key = (i) => `${i.code}|${i.start}|${i.end}|${i.labels.map((l) => l.join('=')).sort().join(';')}`;
eq(X.instances.map(key).sort(), C.instances.map(key).sort(), 'XML and CSV give the same instances');
eq(kickOffs(X.instances).map((k) => k.start), [10], 'Kick Off');
// 時計：キックオフから 30秒〜40秒は止まっていた（実際の時間 rel → 時計の経過）
const R = { elOfRel: (k, rel) => (rel <= 30000 ? rel : rel <= 40000 ? 30000 : rel - 10000) };
const M = { periods: [{ key: '1H', elapsed: 1200000, len: 1200000 }] };
const gts = ['定位置', 'KI', 'OG'].map((n, i) => ({ id: 'g' + i, name: n }));
const r = buildImport({ instances: C.instances, periods: [{ key: '1H', ko: 10, from: -1e9, to: 1e9 }], R, M, members: { p1: { no: '7' } }, players: [{ id: 'p1', last: '山田', first: '太郎' }], goalTypes: gts });
const ev = (k) => r.events.filter((e) => e.kind === k);
eq(ev('shot')[0], { id: null, period: '1H', at: 25000, seq: 1, src: 'sportscode', kind: 'shot', result: 'in', n: 2, cls: 'pos', pid: 'p1' }, 'shot: time = start + 15s lead - kickoff');
eq([ev('fspat')[0].fsp, ev('fspat')[0].at], ['KI', 38000], 'SETPLAY: 3s lead; clock stopped 30s-40s after kickoff');
const g = ev('goal')[0]; eq([g.pid, g.sz, g.gtype, g.at], ['p1', 'in', 'g1', 40000], 'goal: scorer by number, type from the preceding set play (KI)');
{ const r3 = buildImport({ instances: [{ code: 'シュート', start: 27, end: 44, labels: [] }], periods: [{ key: '1H', ko: 10, from: -1e9, to: 1e9 }], R, M, members: {}, players: [], goalTypes: gts }); eq(r3.events[0].at, 30000, 'during a stoppage = the stopped clock'); }
eq(ev('oshot')[0].result, 'block', 'two labels in one group: block wins over off target');
eq([ev('conc')[0].gtype, ev('conc')[0].sz], ['g2', undefined], 'own goal by us = conceded OG');
eq([ev('rec')[0].pid, ev('foul')[0].card], ['p1', 'yellow'], 'ROBO 1/2 = recovery, card label');
eq([r.events.length, r.unknownCodes], [7, [['なにか', 1]]], 'player rows skipped, unknown codes listed');
const r2 = buildImport({ instances: [{ code: 'シュート', start: 20, end: 37, labels: [['シュート分類', 'オウンゴール']] }], periods: [{ key: '1H', ko: 10, from: -1e9, to: 1e9 }], R, M, members: {}, players: [], goalTypes: gts });
eq([r2.events[0].kind, r2.events[0].pid], ['goal', OPP_OG], 'their own goal = our goal by opp OG');

// --- 記14：名前があいまいなとき・ピリオドの分け方・おかしな値・同じグループの2つのラベル・入力の順
{
  const R0 = { elOfRel: (k, rel) => rel };
  const M2 = { periods: [{ key: '1H', elapsed: 1200000, len: 1200000 }, { key: '2H', elapsed: 1200000, len: 1200000 }] };
  const members = { p1: { no: '7' }, p2: { no: '8' }, p3: { no: '9' } };
  const players = [{ id: 'p1', last: '山田', first: '太郎' }, { id: 'p2', last: '山田', first: '次郎' }, { id: 'p3', last: '松', first: '一' }];
  const kos = [0, 1203]; // 前半の終わり（動画 1200）のすぐあとに後半の Kick Off
  const periods = kos.map((k, i) => ({ key: ['1H', '2H'][i], ko: k, shift: 0, from: i ? k : -1e9, to: kos[i + 1] ?? 1e9 }));
  const inst = [
    { code: 'Kick Off', start: 0, end: 1, labels: [] }, { code: 'Kick Off', start: 1203, end: 1204, labels: [] },
    { code: 'シュート', start: 1199 - 15, end: 1201, labels: [['シュート分類', '枠内']] },                                     // 前半 19:59 のシュート
    { code: 'スコアゾーン内シュート', start: 300, end: 317, labels: [['シュート分類', 'ゴール'], ['スコアゾーン進入人数', '0'], ['選手', '#7']] },
    { code: 'シュート', start: 400, end: 417, labels: [['シュート分類', '枠内'], ['局面', '定位置攻撃'], ['局面', 'トランジション攻撃'], ['選手', '山田 次郎']] },
    { code: 'シュート', start: 500, end: 517, labels: [['シュート分類', '枠外'], ['選手', '山田']] },        // 山田が2人
    { code: 'シュート', start: 510, end: 527, labels: [['シュート分類', '枠外'], ['選手', '松川 網汰']] },   // 名字の前だけ「松」と合う
    { code: 'ROBO 1/2', start: 600, end: 615, labels: [['ゾーン', '相手陣'], ['選手', '#8']] },
    { code: 'PERDIDA', start: 610, end: 625, labels: [['ゾーン', 'Ｚ３'], ['選手', '#9']] },
    { code: 'スコアゾーン内シュート', start: 700, end: 717, labels: [['シュート分類', '枠内'], ['スコアゾーン進入人数', '0']] },
    { code: 'シュート', start: 1300, end: 1317, labels: [['シュート分類', '枠内']] },
  ];
  const gts = [{ id: 'o0_定位置', name: '定位置' }, { id: 'o11_OG', name: 'オウンゴール' }];
  const r = buildImport({ instances: inst, periods, R: R0, M: M2, members, players, goalTypes: gts, seqBase: 1700000000000 });
  const E = r.events;
  const last1H = E.find((e) => e.kind === 'shot' && e.period === '1H' && e.at === 1199000);
  eq(!!last1H, true, 'shot at 19:59 of 1H (code starts before, play before 2H Kick Off) stays in 1H');
  eq(E.filter((e) => e.period === '2H').map((e) => e.at), [112000], '2H: only the shot after Kick Off 2');
  const g = E.find((e) => e.kind === 'goal'); eq([g.sz, g.n, g.pid], ['in', undefined, 'p1'], 'SZ goal with 0 people → n empty');
  const amb = E.filter((e) => e.kind === 'shot' && (e.at === 515000 || e.at === 525000)); eq(amb.map((e) => e.pid), [undefined, undefined], 'same surname / prefix only → not matched');
  eq(r.unmatched.map(([v]) => v).sort(), ['山田', '松川 網汰'].sort(), 'ambiguous names are listed as not found');
  const two = E.find((e) => e.at === 415000); eq([two.pid, two.cls, two.check, /局面/.test(two.impWhy)], ['p2', 'pos', true, true], 'two 局面 labels → first one + 要確認 with a reason');
  const rec = E.find((e) => e.kind === 'rec'), lost = E.find((e) => e.kind === 'lost'); eq([rec.zone, lost.zone], [undefined, 'Z3'], 'zone not Z1-Z4 → empty; full-width Ｚ３ read as Z3');
  const sz0 = E.find((e) => e.kind === 'szshot'); eq(sz0.n, undefined, 'SZ shot with 0 people → n empty');
  eq(r.warnings.length, 3, 'warnings: SZ goal 0, SZ shot 0, zone');
  eq(E.map((e) => e.seq), E.map((_, i) => 1700000000001 + i), 'seq = import time + index');
  const og = buildImport({ instances: [{ code: '被シュート', start: 20, end: 37, labels: [['シュート分類', 'オウンゴール'], ['スコアゾーン進入人数', '2']] }], periods: [{ key: '1H', ko: 10, from: -1e9, to: 1e9 }], R: R0, M: M2, members, players, goalTypes: gts });
  eq([og.events[0].kind, og.events[0].gtype, og.events[0].sz, og.events[0].n], ['conc', 'o11_OG', undefined, undefined], 'renamed OG type found by id; OG ignores SZ (決5)');
}
// ファイル名からピリオド（SCI-01）
eq(['vsペルー_1P.xml', 'peru-2P.xml', 'U19 2H.csv', 'match_1h.XML', '20261017前半.xml', '後半_peru.csv', 'peru_E1.xml', 'peru_ET2.xml', '延長前半.csv', '延長後半.xml', 'peru.xml', '2026_1017.xml', 'TEAM12P.xml', 'peru_１Ｐ.xml', 'P1.xml'].map(periodFromName),
  ['1H', '2H', '2H', '1H', '1H', '2H', 'E1', 'E2', 'E1', 'E2', null, null, null, '1H', null], 'period from file name');
console.log(`scimport: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
