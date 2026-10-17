// 分析画面の計算（spec 9章）：選手ごとの直接関与・間接関与、パワープレー（5×4）の時間帯で分ける集計。
// Run: node test/analysis.test.mjs
import { playerStats, playerDetail, ppWindows, windowsOf, clipModel, winTest, ppTime, teamStats, addInto, blankDetail } from '../js/teamstats.js';
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
{ const PS = playerStats(M, ev, gn, ['a', 'e', 'g1'], T).rows; eq(PS.map((r) => [r.pid, r.shotOn, r.oshotOn]), [['a', 2, 0], ['e', 0, 2], ['g1', 2, 2]], 'review 8: shots / opp shots while on pitch'); }
// 区間の境目とピリオドの終わりの瞬間：どの時間帯にもちょうど1回だけ入る（5×4/4×5を除く＋5×4＋4×5＝合計）
{
  const ev2 = [200000, 260000, 600000, 700000, 1200000, 0].map((at, i) => ({ id: 'b' + i, kind: 'oshot', period: '1H', at }));
  const n = (mode) => teamStats(M, ev2, gn, null, winTest(windowsOf(M, W, mode), M)).B.shots;
  eq([n('ex'), n('own'), n('opp'), n('all')], [4, 1, 1, 6], 'boundaries: each event counted once');
}

console.log(`analysis: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);

// ---------- 2026-10-17：時間帯・時点・退場・数的同数・セットの表 ----------
import { bandsOf, bandIndex, asOfLabel, noGkWindows, ejWindows, setSplit, setCountTable } from '../js/teamstats.js';
import { PACE_ROWS, binOf } from '../js/review58.js';
const P = (key, label, len, status = 'done', extra = false, elapsed = len) => ({ key, label, len, elapsed: status === 'none' ? 0 : elapsed, status, extra });
const run = async () => {
  // 時間帯の名前（決3・未8）
  const L = (ps) => bandsOf({ periods: ps }).map((b) => b.label);
  eq(L([P('1H', '前半', 1200000), P('2H', '後半', 1200000)]), ['0~10', '11~20', '21~30', '31~40'], 'bands: 20-minute halves');
  eq(L([P('1H', '前半', 900000), P('2H', '後半', 900000)]), ['0~7:30', '7:31~15:00', '15:01~22:30', '22:31~30:00'], 'bands: 15-minute halves');
  eq(L([P('1H', '前半', 1200000), P('2H', '後半', 1200000), P('E1', '延長前半', 300000, 'done', true), P('E2', '延長後半', 300000, 'none', true)]), ['0~10', '11~20', '21~30', '31~40', '41~45', '46~50'], 'bands: extra 5 minutes');
  eq(L([P('1H', '前半', 1200000), P('2H', '後半', 1200000), P('E1', '延長前半', 180000, 'done', true), P('E2', '延長後半', 180000, 'done', true)]), ['0~10', '11~20', '21~30', '31~40', '41~43', '44~46'], 'bands: extra 3 minutes');
  eq(L([P('1H', '前半', 1200000), P('2H', '後半', 1200000), P('E1', '延長前半', 300000, 'none', true)]), ['0~10', '11~20', '21~30', '31~40'], 'bands: extra not played');
  // 境目は終わりを含む：10:00 → 0~10、10:01 → 11~20、後半0:00（通算20:00）→ 11~20、延長前半0:00 → 31~40
  { const Mb = { periods: [P('1H', '前半', 1200000), P('2H', '後半', 1200000), P('E1', '延長前半', 300000, 'done', true), P('E2', '延長後半', 300000, 'done', true)] }; const B = bandsOf(Mb);
    eq([['1H', 0], ['1H', 600000], ['1H', 601000], ['2H', 0], ['2H', 1000], ['2H', 1200000], ['E1', 0], ['E1', 1000], ['E2', 300000]].map(([k, at]) => bandIndex(B, Mb, k, at)), [0, 0, 1, 1, 2, 3, 3, 4, 5], 'band boundaries end-inclusive');
    const Mt = { ...Mb, cfg: { members }, stints: [], empties: [], pp: [] };
    const sh = [['1H', 600000], ['2H', 0], ['E1', 10000], ['E2', 10000]].map(([period, at], i) => ({ id: 's' + i, kind: 'shot', period, at, result: 'in' }));
    const Rb = teamStats(Mt, sh, gn); eq([Rb.A.shotBand, Rb.bands.length], [[1, 1, 0, 0, 1, 1], 6], 'teamStats: extra halves are separate bands'); }
  // マッチ・ペースの区切り（終わりを含む）
  eq([0, 1000, 60000, 61000, 600000, 1200000].map((at) => binOf(at, 60000, 20)), [0, 0, 0, 1, 9, 19], 'pace bins end-inclusive');
  // マッチ・ペースのシュートの行：自チームのOG（失点の種類がOG）は相手のシュートに数えない（チームスタッツと同じ）
  { const g2 = (id) => (id === 'og' ? 'OG' : '定位置');
    const e2 = [{ id: 1, kind: 'conc', period: '1H', at: 1000, gtype: 'og' }, { id: 2, kind: 'conc', period: '1H', at: 2000, gtype: 'x' }, { id: 3, kind: 'oshot', period: '1H', at: 3000 }, { id: 4, kind: 'goal', period: '1H', at: 4000, pid: 'oppOG' }, { id: 5, kind: 'goal', period: '1H', at: 5000, pid: 'a' }];
    const R2 = teamStats(M, e2, g2);
    eq([e2.filter((e) => PACE_ROWS.shot[2](e, g2)).length, e2.filter((e) => PACE_ROWS.shot[3](e, g2)).length], [R2.A.shots, R2.B.shots], 'pace shot row = team stats (OG excluded on both sides)'); }
  // どこまでの記録か
  const AO = (ps, x = {}) => asOfLabel({ periods: ps, ...x });
  eq([AO([P('1H', '前半', 1200000, 'none'), P('2H', '後半', 1200000, 'none')]), AO([P('1H', '前半', 1200000), P('2H', '後半', 1200000, 'none')]),
    AO([P('1H', '前半', 1200000), P('2H', '後半', 1200000), P('E1', '延長前半', 300000, 'done', true), P('E2', '延長後半', 300000, 'none', true)]),
    AO([P('1H', '前半', 1200000), P('2H', '後半', 1200000, 'live', false, 300000)], { live: true, current: '2H' }), AO([P('1H', '前半', 1200000)], { matchOver: true })],
  ['試合開始前', '前半終了時点', '延長前半終了時点', '後半 残り 15:00 時点', '試合終了時点'], 'as-of label');

  // 決1：自チームの5×4は、GKを交代でFPと入れ替えたときだけ（退場でGKがいない・初めからGKがいないは入れない）
  const per = [P('1H', '前半', 1200000)];
  const M1 = { cfg: { members }, periods: per, pp: [], empties: [], stints: [S('g1', 0, 0, 300), S('f', 0, 300, 400), S('g1', 0, 400, 1200), S('a', 1, 0, 1200), S('b', 2, 0, 1200), S('c', 3, 0, 1200), S('d', 4, 0, 500), S('e', 4, 560, 1200)],
    empties: [{ period: '1H', seat: 4, pid: 'd', from: 500000, to: 560000 }] };
  eq(noGkWindows(M1)['1H'], [[300000, 400000]], 'GK swapped out: own 5x4 (no ejection inside)');
  const M1b = { ...M1, stints: [S('g1', 0, 0, 300), S('f', 0, 330, 1200), ...M1.stints.slice(3)], empties: [{ period: '1H', seat: 0, pid: 'g1', from: 300000, to: 330000 }, ...M1.empties] };
  eq(noGkWindows(M1b)['1H'], [], 'GK ejected (empty seat, then FP fills): not own 5x4');
  const M1c = { ...M1, stints: [S('f', 0, 0, 100), S('g1', 0, 100, 1200), ...M1.stints.slice(3)] };
  eq(noGkWindows(M1c)['1H'], [], 'lineup started with no GK: not own 5x4');
  const M1d = { ...M1, stints: [S('g1', 0, 0, 450), S('f', 0, 450, 700), S('g1', 0, 700, 1200), ...M1.stints.slice(3)] }; // 5×4の間に d が退場（500〜560）
  eq([noGkWindows(M1d)['1H'], ppWindows(M1d).own['1H']], [[[450000, 500000], [560000, 700000]], [[450000, 500000], [560000, 700000]]], 'ejection during own 5x4: empty-seat time goes to the ejection window');
  // 決8：退場の時間帯（自チーム＝空席、相手＝'oej'）と、重ならない分け方
  const oej = [{ id: 'j', kind: 'oej', period: '1H', at: 800000, endAt: 920000 }, { id: 'j2', kind: 'oej', period: '1H', at: 1150000, endPeriod: '2H', endAt: 60000 }];
  const per2 = [P('1H', '前半', 1200000), P('2H', '後半', 1200000)];
  const M2 = { ...M1d, periods: per2, pp: [{ period: '1H', team: 'opp', from: 880000, to: 1000000 }], stints: [...M1d.stints, ...['g1', 'a', 'b', 'c', 'e'].map((pid, i) => ({ period: '2H', pid, seat: i, from: 0, to: 1200000 }))] };
  eq(ejWindows(M2, oej), { own: { '1H': [[500000, 560000]], '2H': [] }, opp: { '1H': [[800000, 920000], [1150000, 1200000]], '2H': [[0, 60000]] } }, 'ejection windows (own empty seats, opponent oej across periods)');
  const W2 = ppWindows(M2, oej);
  const wo = (mode) => windowsOf(M2, W2, mode)['1H'];
  eq([wo('ejown'), wo('ejopp'), wo('own'), wo('opp')], [[[500000, 560000]], [[800000, 920000], [1150000, 1200000]], [[450000, 500000], [560000, 700000]], [[920000, 1000000]]], 'disjoint windows: ejection first, then own 5x4, then opp 5x4');
  eq(wo('ex'), [[0, 450000], [700000, 800000], [1000000, 1150000]], '数的同数 = rest of the period');
  // どの時間帯にもちょうど1回だけ入る（時間も回数も）。境目とピリオドの終わりの瞬間も
  { const ats = [0, 450000, 500000, 560000, 700000, 800000, 920000, 1000000, 1150000, 1200000, 333000, 1199000];
    const ev3 = [...ats.map((at, i) => ({ id: 'q' + i, kind: 'oshot', period: '1H', at })), { id: 'q2h', kind: 'oshot', period: '2H', at: 60000 }];
    const modes = ['ex', 'own', 'opp', 'ejown', 'ejopp'];
    const n = (mode) => teamStats(M2, ev3, gn, null, winTest(windowsOf(M2, W2, mode), M2)).B.shots;
    const t = (mode) => clipModel(M2, windowsOf(M2, W2, mode)).periods.reduce((s, p) => s + p.elapsed, 0);
    eq([modes.reduce((s, m) => s + n(m), 0), n('all')], [ev3.length, ev3.length], 'split counts add up to the total');
    eq(modes.reduce((s, m) => s + t(m), 0), 2400000, 'split times add up to the match time'); }
  // 決4：セットの表は数的同数の時間帯だけ。セット＋除いた時間＋GKがそろっていない＋3秒未満＝試合の時間
  { const sp = setSplit(M2, W2);
    eq(sp.time.sets + sp.time.ex + sp.time.special + sp.time.other, sp.time.played, 'set split: times add up');
    eq(sp.time.ex, (50 + 140) * 1000 + 60000 + (120 + 50 + 60) * 1000 + 80000, 'set split: excluded time = 5x4 + ejections');
    const evs4 = [{ id: 'x1', kind: 'shot', period: '1H', at: 100000 }, { id: 'x2', kind: 'shot', period: '1H', at: 600000 }, { id: 'x3', kind: 'oshot', period: '1H', at: 850000 }, { id: 'x4', kind: 'conc', period: '2H', at: 30000 }, { id: 'x5', kind: 'z4', period: '2H', at: 300000 }];
    const ct = setCountTable(M2, W2, evs4, gn, { setMin: 200000 });
    const add = (k) => ct.rows.reduce((s, r) => s + r.c[k], 0) + ct.short.c[k] + ct.ex.c[k] + ct.special.c[k] + ct.other.c[k];
    eq([0, 1, 2].map(add), ct.total.c.slice(0, 3), 'set count table: rows + summary rows = total');
    eq([ct.ex.c[0], ct.ex.c[1], ct.total.c[0], ct.total.c[1]], [1, 2, 2, 2], 'set count table: shots in 5x4/ejection windows go to the summary row');
    eq(ct.rows.reduce((s, r) => s + r.time, 0) + ct.short.time + ct.ex.time + ct.special.time + ct.other.time, ct.total.time, 'set count table: times add up'); }
};
await run();
console.log(`analysis (2026-10-17): ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);

// ---------- マッチスタッツのシート（記6・記7・足8） ----------
{
  globalThis.localStorage = globalThis.localStorage || { getItem() { return null; }, setItem() {} };
  globalThis.document = globalThis.document || { querySelector() { return null; }, addEventListener() {}, documentElement: { style: { setProperty() {} } } };
  globalThis.window = globalThis.window || globalThis; globalThis.addEventListener = globalThis.addEventListener || (() => {}); globalThis.location = globalThis.location || { hash: '' };
  const { sheetHTML } = await import('../js/stats.js');
  const Mh = { cfg: { members }, periods: [P('1H', '前半', 1200000), P('2H', '後半', 1200000, 'none')], stints: M.stints, empties: [], pp: [], zero: [], timeouts: [], ejections: [] };
  const evs5 = [{ id: 'g', kind: 'goal', period: '1H', at: 300000, pid: 'a' }, { id: 's1', kind: 'shot', period: '1H', at: 1000, pid: 'a' }, { id: 's2', kind: 'shot', period: '1H', at: 2000, pid: 'a', result: 'out' }, { id: 'f', kind: 'fspat', period: '1H', at: 5000 }];
  const html = (keys = null) => sheetHTML({ R: teamStats(Mh, evs5, gn, keys), M: Mh, keys, own: '自', opp: '相', game: '', place: '', day: '', possession: null });
  const h = html();
  const sc = h.match(/<td class="stp">([^<]*)<\/td><td class="stp">後半<\/td><td class="stp">([^<]*)<\/td>/);
  eq(sc && [sc[1], sc[2]], ['', ''], 'stats sheet: unplayed period score is blank');
  const cell = (label) => { const m = h.match(new RegExp(`<td class="v">((?:(?!<td).)*)</td><td class="lb">${label.replace(/[()]/g, '\\$&')}</td><td class="v">((?:(?!<td).)*)</td>`)); return m && [m[1], m[2]]; };
  eq(cell('スコアゾーン外S/ゾーン内に人有')[0].startsWith('<span class="na">—</span>'), true, 'stats sheet: all 人数 missing → —');
  eq(cell('スコアゾーン内シュート')[0], '0<div class="miss">未入力 1</div>', 'stats sheet: SZ-in row shows goals with unknown SZ as 未入力');
  eq(cell('枠内(ゴール含む)')[0], '1<div class="miss">未入力 1</div>', 'stats sheet: partly missing result → number + 未入力');
  eq([cell('定位置')[0].startsWith('<span class="na">—</span>'), cell('CK')[0]], [true, '<span class="na">—</span>'], 'stats sheet: classification / FSP breakdown all missing → —');
  eq(cell('ブロック')[1], '0', 'stats sheet: opponent with no shots stays 0');
  eq(/0~10/.test(h) && /31~40/.test(h), true, 'stats sheet: band labels');
  const h1 = html(['1H']);
  eq([(h1.match(/<td class="stp">/g) || []).length, /後半/.test(h1.split('<table class="stt">')[0])], [6, false], 'stats sheet: range 前半 shows only the 前半 score row');
}
console.log(`analysis (stats sheet): ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);

// ---------- 試合の形の写し（modelOf、2026-10-17）：同じ記録なら同じ形を使い、記録・設定・修正が変われば作り直す ----------
{
  const { modelOf, matchModel } = await import('../js/model.js');
  const { replay } = await import('../js/engine.js');
  const mem = { G: { no: '1', pos: 'GK' }, A: { no: '2', pos: 'FP' }, B: { no: '3', pos: 'FP' }, C: { no: '4', pos: 'FP' }, D: { no: '5', pos: 'FP' }, E: { no: '6', pos: 'FP' } };
  const cfg = { times: { half: 20 }, members: mem, setplayAuto: 60 };
  const t0 = 1e12; let n = 0; const op = (t, o) => ({ id: 'x' + n, n: n++, t: t0 + t * 1000, dev: 'd', period: o.period || '1H', ...o });
  const ops = [op(0, { type: 'kickoff', lineup: ['G', 'A', 'B', 'C', 'D'], len: 1200000 }), op(100, { type: 'out', pid: 'A' }), op(101, { type: 'in', pid: 'E' }), op(1300, { type: 'periodEnd' })];
  const a = modelOf(ops, cfg), b = modelOf(ops, { ...cfg, members: { ...mem } });
  eq([a.M === b.M, a.st === b.st], [true, true], 'modelOf: same ops and same settings → same model');
  eq(JSON.stringify(a.M), JSON.stringify(matchModel(replay(ops, cfg), Date.now())), 'modelOf: same result as replay + matchModel');
  eq(modelOf(ops, { ...cfg, times: { half: 15 } }).M === a.M, false, 'modelOf: settings changed → rebuilt');
  eq(modelOf([...ops], cfg).M === a.M, false, 'modelOf: new list of ops → rebuilt');
  const live = ops.slice(0, 3);
  const l1 = modelOf(live, cfg, null, t0 + 200000), l2 = modelOf(live, cfg, null, t0 + 260000);
  eq([l1.st === l2.st, l1.M === l2.M, l2.M.periods[0].elapsed - l1.M.periods[0].elapsed], [true, false, 60000], 'modelOf: live match → model follows the clock');
}
console.log(`analysis (modelOf): ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
