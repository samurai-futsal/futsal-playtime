// データシート（Excel）：シートの並び、イベント一覧の1行1件、.xlsx（ZIP）の形。
// Run: node test/datasheet.test.mjs
import { datasheetSheets } from '../js/datasheet.js';
import { buildXLSX, colName } from '../js/xlsx.js';
let pass = 0, fail = 0;
const eq = (a, b, msg) => { const ok = JSON.stringify(a) === JSON.stringify(b); ok ? pass++ : (fail++, console.log('FAIL', msg, '\n  got', JSON.stringify(a), '\n  want', JSON.stringify(b))); };
const members = { g1: { no: '1', pos: 'GK' }, a: { no: '4', pos: 'FP' }, b: { no: '5', pos: 'FP' }, c: { no: '6', pos: 'FP' }, d: { no: '7', pos: 'FP' }, e: { no: '8', pos: 'FP' } };
const players = Object.keys(members).map((id) => ({ id, last: id.toUpperCase(), first: '太郎' }));
const St = (pid, seat, from, to) => ({ period: '1H', pid, seat, from: from * 1000, to: to * 1000 });
const M = { cfg: { members }, periods: [{ key: '1H', label: '前半', elapsed: 1200000, len: 1200000, status: 'done' }, { key: '2H', label: '後半', elapsed: 0, len: 1200000, status: 'none' }],
  stints: [St('g1', 0, 0, 1200), St('a', 1, 0, 100), St('e', 1, 100, 1200), St('b', 2, 0, 1200), St('c', 3, 0, 1200), St('d', 4, 0, 1200)], empties: [], pp: [], zero: [] };
const evs = [{ id: '1', kind: 'shot', period: '1H', at: 50000, pid: 'a', result: 'in', cls: 'pos', n: 1 }, { id: '2', kind: 'goal', period: '1H', at: 150000, pid: 'e', assist: 'b', sz: 'in', gtype: 't' }, { id: '3', kind: 'oshot', period: '1H', at: 70000, result: 'out' }];
const sh = datasheetSheets([{ m: { id: 'm1', date: '2026-10-14', opponent: 'ペルー', members }, M, evs, goalName: () => '定位置', players, activity: '大会' }], 'チーム');
eq(sh.map((s) => s.name), ['はじめに', '試合情報', 'イベント一覧', '出場時間', '出場記録', '選手スタッツ', 'セット', '1分ごと', '選手一覧'], 'sheets');
const ev = sh.find((s) => s.name === 'イベント一覧').rows;
eq(ev.length, 4, 'one row per event + header');
eq([ev[1][7], ev[1][9], ev[1][32], ev[1][33], ev[1][6]], ['シュート', 'A 太郎', '自', 1, 1], 'shot row: kind, player, shot side, on target, minute');
eq([ev[3][7], ev[3][10], ev[3][34], ev[3][21]], ['得点', 'B 太郎', '得点', 'G1 太郎'], 'goal row: assist in 2人目, goal flag, pitch');
eq([colName(0), colName(25), colName(26), colName(34)], ['A', 'Z', 'AA', 'AI'], 'column names');
const z = buildXLSX(sh);
eq([z[0], z[1], z[2], z[3]], [0x50, 0x4b, 3, 4], 'zip header');
const txt = new TextDecoder().decode(z);
eq(['xl/workbook.xml', 'xl/worksheets/sheet9.xml', 'COUNTIFS(', 'fullCalcOnLoad'].map((s) => txt.includes(s)), [true, true, true, true], 'xlsx parts and formulas');
console.log(`datasheet: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
