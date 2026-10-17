// データシート（Excel）：シートの並び、イベント一覧の1行1件、.xlsx（ZIP）の形。
// Run: node test/datasheet.test.mjs
import { datasheetSheets, matchTitles, playerLabels, minuteOf } from '../js/datasheet.js';
import { buildXLSX, colName } from '../js/xlsx.js';
import { buildXML } from '../js/sportscode.js';
import { inflateRawSync } from 'node:zlib';
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
eq([ev[1][7], ev[1][9], ev[1][33], ev[1][34], ev[1][6]], ['シュート', 'A 太郎', '自', 1, 1], 'shot row: kind, player, shot side, on target, minute');
eq([ev[3][7], ev[3][10], ev[3][35], ev[3][21]], ['得点', 'B 太郎', '得点', 'G1 太郎'], 'goal row: assist in 2人目, goal flag, pitch');
eq([colName(0), colName(25), colName(26), colName(34)], ['A', 'Z', 'AA', 'AI'], 'column names');
const z = await buildXLSX(sh);
eq([z[0], z[1], z[2], z[3]], [0x50, 0x4b, 3, 4], 'zip header');
// ZIP を開く（中央ディレクトリから。method 8＝deflate、0＝そのまま）。CRC は圧縮前のデータのもの
const unzip = (b) => {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength); let e = b.length - 22; while (dv.getUint32(e, true) !== 0x06054b50) e--;
  const n = dv.getUint16(e + 10, true); let p = dv.getUint32(e + 16, true); const out = {};
  for (let i = 0; i < n; i++) {
    const method = dv.getUint16(p + 10, true), crc = dv.getUint32(p + 16, true), csz = dv.getUint32(p + 20, true), usz = dv.getUint32(p + 24, true);
    const nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), lo = dv.getUint32(p + 42, true);
    const name = new TextDecoder().decode(b.subarray(p + 46, p + 46 + nl));
    const ds = lo + 30 + dv.getUint16(lo + 26, true) + dv.getUint16(lo + 28, true);
    const raw = b.subarray(ds, ds + csz); const data = method === 8 ? new Uint8Array(inflateRawSync(raw)) : raw;
    out[name] = { method, crc, usz, data, okCrc: crc32(data) === crc && data.length === usz };
    p += 46 + nl + xl + cl;
  }
  return out;
};
const crc32 = (d) => { let c = 0xFFFFFFFF; for (const x of d) { c ^= x; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; } return (c ^ 0xFFFFFFFF) >>> 0; };
const U = unzip(z); const txt = Object.values(U).map((f) => new TextDecoder().decode(f.data)).join('\n');
eq([Object.keys(U).includes('xl/workbook.xml'), Object.keys(U).includes('xl/worksheets/sheet9.xml'), txt.includes('COUNTIFS('), txt.includes('fullCalcOnLoad')], [true, true, true, true], 'xlsx parts and formulas');
eq([Object.values(U).every((f) => f.okCrc), Object.values(U).some((f) => f.method === 8)], [true, true], 'zip: deflate used, CRC and sizes of the uncompressed data');
{ const z0 = await buildXLSX(sh, { compress: false }); const U0 = unzip(z0);
  eq([Object.values(U0).every((f) => f.method === 0 && f.okCrc), z.length < z0.length, Object.keys(U0).every((k) => Buffer.compare(Buffer.from(U0[k].data), Buffer.from(U[k].data)) === 0)], [true, true, true], 'zip: stored fallback has the same contents'); }

// ---------- 2026-10-17 ----------
// 1分ごと：終わりを含む（10:00ちょうど＝10分）
eq([0, 1000, 60000, 61000, 600000, 601000].map(minuteOf), [1, 1, 1, 2, 10, 11], 'minute of match time (end-inclusive)');
// 試合の名前：同じ日・同じ相手はキックオフ、それでも同じなら番号
{ const a = { date: '2026-10-14', opponent: 'A', kickoff: '10:00' }, b = { date: '2026-10-14', opponent: 'A', kickoff: '14:00' }, c = { date: '2026-10-14', opponent: 'A', kickoff: '14:00' }, d = { date: '2026-10-15', opponent: 'A' };
  const t = matchTitles([a, b, c, d]); eq([t.get(a), t.get(b), t.get(c), t.get(d)], ['2026-10-14 10:00 vs A', '2026-10-14 14:00 vs A（1）', '2026-10-14 14:00 vs A（2）', '2026-10-15 vs A'], 'unique match titles'); }
// 選手の名前：同じ名前は背番号、名前がない選手は「背番号 n」
{ const pl = [{ id: 'p1', last: '田中', first: '太郎' }, { id: 'p2', last: '田中', first: '太郎' }, { id: 'p3', last: '', first: '' }];
  const L = playerLabels(['p1', 'p2', 'p3', 'p4'], pl, (pid) => ({ p1: 4, p2: 9, p3: 12 })[pid]);
  eq([L.get('p1'), L.get('p2'), L.get('p3'), L.get('p4')], ['田中 太郎（背番号 4）', '田中 太郎（背番号 9）', '背番号 12', '名前なし'], 'unique player labels'); }
// 数式の範囲はイベント一覧の最後の行まで。退場の時間帯の列。ピリオドの終わりの瞬間も5x4に入る。セットの下の行で合計が合う
{ const M2 = { ...M, pp: [{ period: '1H', team: 'opp', from: 1100000, to: null }], empties: [{ period: '1H', seat: 1, pid: 'a', from: 100000, to: 160000 }],
    stints: [St('g1', 0, 0, 1200), St('a', 1, 0, 100), St('e', 1, 160, 1200), St('b', 2, 0, 1200), St('c', 3, 0, 1200), St('d', 4, 0, 1200)] };
  const ev2 = [...evs, { id: '4', kind: 'oshot', period: '1H', at: 1200000 }, { id: '5', kind: 'shot', period: '1H', at: 120000, pid: 'b' }, { id: '6', kind: 'shot', period: '1H', at: 600000, pid: 'b' }, { id: '7', kind: 'shot', period: '1H', at: 700000, pid: 'b' }, { id: '8', kind: 'oej', period: '1H', at: 700000, endAt: 820000 }];
  const sh2 = datasheetSheets([{ m: { id: 'm1', date: '2026-10-14', opponent: 'ペルー', members }, M: M2, evs: ev2, goalName: () => '定位置', players, activity: '大会', setMin: 60000 }], 'チーム');
  const er = sh2.find((s) => s.name === 'イベント一覧').rows; const hd = er[0].map((c) => c.v);
  const col = (n) => hd.indexOf(n); const row = (id) => er.find((r, i) => i && r[col('経過')].v === ({ 4: 1200000, 5: 120000, 6: 600000, 7: 700000 })[id] / 86400000);
  eq([row(4)[col('5×4の時間帯')], row(5)[col('退場の時間帯')], row(7)[col('退場の時間帯')], row(6)[col('通算の分')]], ['相手5×4', '自チームの退場（4対5）', '相手の退場（5対4）', 10], 'event list: 5x4 at period end, ejection column, minute');
  const info = sh2.find((s) => s.name === '試合情報').rows.flat().filter((c) => c && c.f).map((c) => c.f);
  eq([info.some((f) => f.includes(`$${er.length}`)), info.some((f) => f.includes('$5000'))], [true, false], 'COUNTIFS ranges end at the last event row');
  const sets = sh2.find((s) => s.name === 'セット').rows.slice(1);
  const tot = sets.find((r) => r[2]?.v === '合計（試合の時間）'); const parts = sets.filter((r) => r !== tot).reduce((t, r) => t + r[3].v, 0);
  eq([Math.round(parts * 86400), Math.round(tot[3].v * 86400), sets.some((r) => r[2]?.v === '5×4・4×5と退場の時間帯')], [1200, 1200, true], 'set sheet: summary rows add up to the match time'); }
// Sportscode：GKをFPと入れ替えた区間は帯を分けて「局面＝特殊局面」。5x4の時間帯の終わり（ピリオドの終わり）の瞬間も5x4
{ const Ms = { ...M, pp: [{ period: '1H', team: 'opp', from: 1100000, to: null }], stints: [St('g1', 0, 0, 300), St('e', 0, 300, 400), St('g1', 0, 400, 1200), St('a', 1, 0, 1200), St('b', 2, 0, 1200), St('c', 3, 0, 1200), St('d', 4, 0, 1200)] };
  const R = { ...Ms, relOf: (k, a) => a, clock: { '1H': { runs: [{ t0: 0, t1: 1200000 }] } } };
  const st = { periods: { '1H': { kickT: 0, endT: 1200000, runs: [{ t0: 0, t1: 1200000 }] } } };
  const x = buildXML({ M: Ms, R, st, members, events: [{ id: 'o', kind: 'oshot', period: '1H', at: 1200000, result: 'in' }], goalName: () => '', key: '1H', ko: 0, lead: {}, name: (p) => p });
  const bands = x.inst.filter((i) => i.code === '#4');
  eq(bands.map((i) => [i.start, i.end, i.labels.some(([g, t]) => g === '局面' && t === '特殊局面')]), [[0, 300, false], [300, 400, true], [400, 1200, false]], 'sportscode: special-phase label on the no-GK interval');
  eq(x.inst.find((i) => i.code === 'スコアゾーン内被シュート' || i.code === '被シュート').labels.find(([g]) => g === '5x4')?.[1], '相手5x4', 'sportscode: 5x4 label at the period end'); }
console.log(`datasheet: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
