// Sportscode からの取り込み（spec 9章）：XML と CSV が同じ結果になること、コード・ラベルの読み方、時刻の直し方。
// Run: node test/scimport.test.mjs
import { parseSC, buildImport, kickOffs } from '../js/scimport.js';
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
console.log(`scimport: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
