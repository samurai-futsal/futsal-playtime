// Event rules (spec 6章・13章): 未入力の数え方、ピッチの5人（交代と同じ秒）、分類の初めの選択、要確認。
// Run: node test/events.test.mjs
import { cardsOf, recheckAll, isTodo, todoCount, missing, missingLv, pitchAt, subAtSecond, autoCls, needsCheck, OPP_OG, NO_ASSIST, UNKNOWN, sortEvents, setEventTable,
  cardIssues, checkOf, CHECK_PITCH, gkOutWindows, goalTypeKey, isOGType, clsOfGoalTypeId, goalTypeIdOf, cleanFields, oejDefaultEnd, oppEjWindows, pitchSig, summary } from '../js/events.js';

let pass = 0, fail = 0;
const eq = (a, b, msg) => { const ok = JSON.stringify(a) === JSON.stringify(b); ok ? pass++ : (fail++, console.log('FAIL', msg, '\n  got', JSON.stringify(a), '\n  want', JSON.stringify(b))); };

const members = { g1: { no: '1', pos: 'GK' }, a: { no: '4', pos: 'FP' }, b: { no: '5', pos: 'FP' }, c: { no: '6', pos: 'FP' }, d: { no: '7', pos: 'FP' }, e: { no: '8', pos: 'FP' }, f: { no: '9', pos: 'FP' } };
const S = (pid, seat, from, to) => ({ period: '1H', pid, seat, from: from * 1000, to: to * 1000 });
// 0〜100秒：g1 a b c d。100秒で a→e。200〜260秒はGKがいない（g1→f のパワープレー）
const M = {
  cfg: { members },
  periods: [{ key: '1H', elapsed: 1200000, len: 1200000, status: 'done' }],
  stints: [S('g1', 0, 0, 200), S('f', 0, 200, 260), S('g1', 0, 260, 1200), S('a', 1, 0, 100), S('e', 1, 100, 1200), S('b', 2, 0, 1200), S('c', 3, 0, 1200), S('d', 4, 0, 1200)],
  pp: [{ period: '1H', team: 'opp', from: 600000, to: 700000 }],
};

// --- pitchAt / subAtSecond
eq(pitchAt(M, '1H', 50000), ['g1', 'a', 'b', 'c', 'd'], 'pitch at 50s');
eq(pitchAt(M, '1H', 100000, 'before'), ['g1', 'a', 'b', 'c', 'd'], 'pitch at sub second: before');
eq(pitchAt(M, '1H', 100000, 'after'), ['g1', 'b', 'c', 'd', 'e'], 'pitch at sub second: after');
eq(pitchAt(M, '1H', 0), ['g1', 'a', 'b', 'c', 'd'], 'pitch at kickoff');
eq(pitchAt(M, '1H', 1200000), ['g1', 'b', 'c', 'd', 'e'], 'pitch at the end');
eq(subAtSecond(M, '1H', 100000), true, 'sub at 100s');
eq(subAtSecond(M, '1H', 101000), false, 'no sub at 101s');
eq(subAtSecond(M, '1H', 0), false, 'kickoff is not a sub');
eq(subAtSecond(M, '1H', 1200000), false, 'period end is not a sub');

// --- autoCls
const ev = (o) => ({ id: 'x', period: '1H', side: 'before', ...o });
eq(autoCls(M, [], ev({ kind: 'shot', at: 230000 })), 'special', 'own GK absent → 特殊局面');
eq(autoCls(M, [], ev({ kind: 'oshot', at: 230000 })), 'special', 'opp shot while own GK absent → 特殊局面');
eq(autoCls(M, [], ev({ kind: 'z4', at: 650000 })), 'special', 'opp 5x4 → 特殊局面');
eq(autoCls(M, [], ev({ kind: 'shot', at: 50000 })), null, 'normal → no preset');
const fsp = [{ id: 'f1', kind: 'fspat', period: '1H', at: 47000 }, { id: 'f2', kind: 'fspdf', period: '1H', at: 300000 }];
eq(autoCls(M, fsp, ev({ kind: 'shot', at: 50000 })), 'set', 'own FSP within 5s → セットプレー');
eq(autoCls(M, fsp, ev({ kind: 'shot', at: 53000 })), null, 'own FSP 6s before → no preset');
eq(autoCls(M, fsp, ev({ kind: 'oshot', at: 50000 })), null, 'opp shot ignores own FSP');
eq(autoCls(M, fsp, ev({ kind: 'oshot', at: 304000 })), 'set', 'opp FSP within 5s → セットプレー');
eq(autoCls(M, [{ id: 'f3', kind: 'fspat', period: '1H', at: 230000 }], ev({ kind: 'shot', at: 231000 })), 'special', '特殊局面 wins over セットプレー');
eq(autoCls(M, [], ev({ kind: 'goal', at: 50000 })), null, 'goal has no cls');

// --- needsCheck
eq(needsCheck(M, ev({ kind: 'shot', at: 50000, pid: 'a' })), false, 'on pitch → ok');
eq(needsCheck(M, ev({ kind: 'shot', at: 150000, pid: 'a' })), true, 'bench player → 要確認');
eq(needsCheck(M, ev({ kind: 'shot', at: 150000, pid: UNKNOWN })), false, '不明 → ok');
eq(needsCheck(M, ev({ kind: 'goal', at: 150000, pid: OPP_OG, assist: NO_ASSIST })), false, '相手OG → ok');
eq(needsCheck(M, ev({ kind: 'z4', at: 100000, side: 'after', method: 'pass', pid: 'e', pid2: 'b' })), false, 'after-sub player ok with side=after');
eq(needsCheck(M, ev({ kind: 'z4', at: 100000, side: 'before', method: 'pass', pid: 'e', pid2: 'b' })), true, 'after-sub player not ok with side=before');

// --- missingLv（3段階：基本の空き＝未入力、詳細の空き＝詳細 n。任意は数えない）
const gn = (id) => ({ og: 'OG', t1: '定位置' }[id] || '');
const L = (ev) => { const r = missingLv(ev, gn); return [r.basic, r.detail]; };
eq(L({ kind: 'shot' }), [1, 3], 'empty shot: result=基本, pid/cls/n=詳細');
eq(L({ kind: 'szshot' }), [1, 2], 'empty SZ shot: n is 任意');
eq(L({ kind: 'oshot' }), [1, 2], 'empty opp shot: result / cls,n');
eq(L({ kind: 'oszshot' }), [1, 1], 'empty opp SZ shot: result / cls');
eq(L({ kind: 'shot', pid: 'a', result: 'in', cls: 'pos', n: 0 }), [0, 0], '0人 counts as entered');
eq(L({ kind: 'z4' }), [0, 2], 'z4: method, cls');
eq(L({ kind: 'z4', method: 'pass', cls: 'pos' }), [0, 2], 'z4 pass: passer and receiver');
eq(L({ kind: 'sz', method: 'dribble' }), [0, 1], 'sz dribble: player');
eq(L({ kind: 'osz' }), [0, 0], 'osz: nothing');
eq(L({ kind: 'goal' }), [1, 3], 'empty goal: scorer=基本, assist/type/sz=詳細');
eq(L({ kind: 'goal', pid: 'a', assist: NO_ASSIST, gtype: 't1', sz: 'out' }), [0, 1], 'goal SZ外: people count');
eq(L({ kind: 'goal', pid: 'a', assist: NO_ASSIST, gtype: 't1', sz: 'in' }), [0, 0], 'goal SZ内: people 任意');
eq(L({ kind: 'goal', pid: OPP_OG, assist: NO_ASSIST, gtype: 'og' }), [0, 0], 'opp OG goal complete');
eq(L({ kind: 'conc' }), [0, 2], 'empty conc: type, sz');
eq(L({ kind: 'conc', gtype: 'og' }), [0, 1], 'own OG: OG player');
eq(L({ kind: 'conc', gtype: 't1' }), [0, 1], 'conc: sz');
eq(L({ kind: 'fspat' }), [0, 1], 'fsp: type');
eq(L({ kind: 'lost' }), [0, 1], 'lost: player (zone 任意)');
eq(L({ kind: 'lost', pid: UNKNOWN }), [0, 0], '不明 counts as entered');
eq(L({ kind: 'foul', card: 'none' }), [0, 1], 'foul: player');
eq(L({ kind: 'fouled', card: 'none' }), [0, 0], 'fouled: player is 任意');
eq(missing({ kind: 'shot' }, gn), 1, 'missing = 基本 only');

// --- order
eq(sortEvents([{ id: 2, period: '2H', at: 1 }, { id: 3, period: '1H', at: 5, seq: 2 }, { id: 1, period: '1H', at: 5, seq: 1 }], ['1H', '2H']).map((x) => x.id), [1, 3, 2], 'time order, then input order');

// --- 同じ秒の入れ替えと戻し（守備セットプレーだけ入れ替え）：交代後＝最初の交代のあとの5人
{
  const M2 = { ...M, zero: [{ period: '1H', pid: 'f', seat: 1, from: 300000, to: 300000 }] };
  eq(pitchAt(M2, '1H', 300000, 'after'), ['g1', 'b', 'c', 'd', 'f'], 'after at a swap-and-back second: the swapped-in player');
  eq(pitchAt(M2, '1H', 300000, 'before'), ['g1', 'b', 'c', 'd', 'e'], 'before is unchanged');
}

// --- セットごとのイベント（4-2）
{
  const sets = [{ key: ['b', 'c', 'd', 'e'].sort().join('|'), pids: ['b', 'c', 'd', 'e'], time: 1000000 }, { key: ['a', 'b', 'c', 'd'].sort().join('|'), pids: ['a', 'b', 'c', 'd'], time: 100000 }];
  const gn = (id) => ({ og: 'OG', t1: '定位置' }[id] || '');
  const evs = [
    { kind: 'shot', period: '1H', at: 50000 }, { kind: 'goal', period: '1H', at: 60000, pid: 'a' }, { kind: 'goal', period: '1H', at: 61000, pid: OPP_OG },
    { kind: 'oszshot', period: '1H', at: 150000 }, { kind: 'conc', period: '1H', at: 160000, gtype: 't1' }, { kind: 'conc', period: '1H', at: 161000, gtype: 'og' },
    { kind: 'z4', period: '1H', at: 100000, side: 'after' }, { kind: 'fspat', period: '1H', at: 100000 }, // 交代と同じ秒：FSPは交代後
    { kind: 'oz4', period: '1H', at: 230000 }, { kind: 'rec', period: '1H', at: 50000 }, { kind: 'shot', period: '1H', at: 70000, deleted: true },
  ];
  const t = setEventTable(M, sets, evs, gn);
  eq(t.rows[1].c, [2, 0, 0, 0, 0, 0, 0, 0], 'set abcd: shot + goal (opp OG not a shot)');
  eq(t.rows[0].c, [0, 2, 1, 0, 0, 0, 1, 0], 'set bcde: opp SZ shot + conc (own OG not), z4 after sub, FSP after sub');
  eq(t.special, [0, 0, 0, 1, 0, 0, 0, 0], 'GK absent → special row');
  eq(t.total, [2, 2, 1, 1, 0, 0, 1, 0], 'total');
}

// --- カード（2026-10-16 決定）：自チームの同じ選手の2枚目のイエローは自動で y2。被ファールは選んだまま
{
  const evs = [
    { id: 'f1', kind: 'foul', period: '1H', at: 10000, pid: 'a', card: 'yellow' },
    { id: 'f2', kind: 'foul', period: '1H', at: 20000, pid: 'b', card: 'yellow' },
    { id: 'f3', kind: 'foul', period: '2H', at: 5000, pid: 'a', card: 'yellow' },
    { id: 'f4', kind: 'foul', period: '1H', at: 30000, pid: 'c', card: 'none' },
    { id: 'f5', kind: 'fouled', period: '1H', at: 40000, pid: 'd', card: 'y2' },
    { id: 'f6', kind: 'fouled', period: '1H', at: 41000, pid: 'd', card: 'yellow' },
    { id: 'f7', kind: 'foul', period: '1H', at: 15000, pid: 'a', card: 'yellow', deleted: true },
  ];
  const c = cardsOf(evs, ['1H', '2H']);
  eq([...c.entries()], [['f1', 'yellow'], ['f2', 'yellow'], ['f5', 'y2'], ['f6', 'yellow'], ['f3', 'y2']], 'cards: 2nd yellow of same own player → y2; deleted ignored; opp as chosen');
}
// --- 要確認の付け直しと「未入力あり」の数
{
  const evs = [
    { id: 'r1', kind: 'rec', period: '1H', at: 50000, pid: 'a' },              // a はピッチ：⚠なし
    { id: 'r2', kind: 'rec', period: '1H', at: 150000, pid: 'a', check: false }, // a はベンチ → ⚠ が付く
    { id: 'r3', kind: 'rec', period: '1H', at: 150000, pid: 'e', check: true },  // e はピッチ → ⚠ が外れる
    { id: 'r4', kind: 'oshot', period: '1H', at: 150000 },                        // 結果（基本）が未入力
    { id: 'r5', kind: 'rec', period: '1H', at: 150000 },                          // 選手（詳細）だけ空き → 未入力に数えない
  ];
  eq(recheckAll(M, evs).map((x) => [x.ev.id, x.check]), [['r2', true], ['r3', false]], 'recheckAll: only changed ones');
  eq(evs.map((e) => isTodo(e, gn)), [false, false, true, true, false], 'isTodo: 基本の空き or check');
  eq(todoCount(evs, gn), 2, 'todoCount');
}


// --- 特殊局面は GK をFPと入れ替えたときだけ（決1・2026-10-17）
{
  // 場所0：GK g1 が 0〜300、300で退場（空席）、420 に FP f が補充。100〜150 は g1→e→g1 の入れ替え（パワープレー）
  const M3 = { cfg: { members }, periods: [{ key: '1H', elapsed: 1200000, len: 1200000, status: 'done' }], pp: [],
    stints: [S('g1', 0, 0, 100), S('e', 0, 100, 150), S('g1', 0, 150, 300), S('f', 0, 420, 1200), S('a', 1, 0, 1200), S('b', 2, 0, 1200), S('c', 3, 0, 1200), S('d', 4, 0, 1200)] };
  eq(gkOutWindows(M3)['1H'], [[100000, 150000]], 'GK swap is special; GK ejection and the fill after it are not');
  eq(autoCls(M3, [], ev({ kind: 'shot', at: 120000 })), 'special', 'shot during GK swap → 特殊局面');
  eq(autoCls(M3, [], ev({ kind: 'shot', at: 350000 })), null, 'shot while GK seat is empty (ejection) → not 特殊局面');
  eq(autoCls(M3, [], ev({ kind: 'shot', at: 500000 })), null, 'shot after FP filled the ejected GK seat → not 特殊局面');
  eq(autoCls(M3, [], ev({ kind: 'shot', at: 100000, side: 'before' })), null, 'swap second, before → GK still on');
  eq(autoCls(M3, [], ev({ kind: 'shot', at: 100000, side: 'after' })), 'special', 'swap second, after → 特殊局面');
  // GKなしで始めたピリオド
  const M4 = { cfg: { members }, periods: [{ key: '1H', elapsed: 1200000, len: 1200000, status: 'done' }], pp: [],
    stints: [S('e', 0, 0, 200), S('g1', 0, 200, 1200), S('a', 1, 0, 1200), S('b', 2, 0, 1200), S('c', 3, 0, 1200), S('d', 4, 0, 1200)] };
  eq(gkOutWindows(M4)['1H'], [], 'lineup started without GK → not special');
  eq(autoCls(M4, [], ev({ kind: 'z4', at: 50000 })), null, 'z4 before GK comes in → no preset');
  const t = setEventTable(M3, [], [{ kind: 'shot', period: '1H', at: 120000 }, { kind: 'shot', period: '1H', at: 350000 }, { kind: 'oshot', period: '1H', at: 500000 }]);
  eq([t.special, t.other], [[1, 0, 0, 0, 0, 0, 0, 0], [1, 1, 0, 0, 0, 0, 0, 0]], 'set events: GK swap → special row, ejection/FP fill → other row');
}

// --- 3枚目のイエローは退場に数えず、要確認（記11）
{
  const evs = [
    { id: 'y1', kind: 'foul', period: '1H', at: 10000, pid: 'a', card: 'yellow' },
    { id: 'y2', kind: 'foul', period: '1H', at: 20000, pid: 'a', card: 'yellow' },
    { id: 'y3', kind: 'foul', period: '2H', at: 30000, pid: 'a', card: 'yellow' },
    { id: 'u1', kind: 'foul', period: '1H', at: 40000, pid: UNKNOWN, card: 'yellow' },
    { id: 'u2', kind: 'foul', period: '1H', at: 41000, pid: UNKNOWN, card: 'yellow' },
  ];
  eq([...cardsOf(evs, ['1H', '2H'])], [['y1', 'yellow'], ['y2', 'y2'], ['u1', 'yellow'], ['u2', 'yellow'], ['y3', 'yellow']], '3rd yellow is not another sending-off; 不明 not counted');
  eq([...cardIssues(evs, ['1H', '2H']).keys()], ['y3'], '3rd yellow flagged');
  const M2 = { ...M, periods: [...M.periods, { key: '2H', elapsed: 1200000, len: 1200000, status: 'done' }], stints: [...M.stints, ...M.stints.map((s) => ({ ...s, period: '2H' }))] };
  const ch = recheckAll(M2, evs);
  eq(ch.map((x) => [x.ev.id, x.check, /3枚目/.test(x.why)]), [['y3', true, true]], 'recheckAll flags the 3rd yellow with a reason');
  eq(checkOf(M2, { ...evs[2], checkOk: true }, null, evs), { check: false, why: '' }, 'このままにする (checkOk) clears 要確認');
}
// --- 要確認の理由・このままにする・取り込みの理由（未4・記14）
{
  eq(checkOf(M, ev({ id: 'k', kind: 'rec', at: 150000, pid: 'a' })), { check: true, why: CHECK_PITCH }, 'reason: bench player');
  eq(checkOf(M, ev({ id: 'k', kind: 'rec', at: 150000, pid: 'a', checkOk: true })).check, false, 'checkOk → not 要確認');
  eq(checkOf(M, ev({ id: 'k', kind: 'shot', at: 50000, pid: 'a', impWhy: 'X' })), { check: true, why: 'X' }, 'import reason keeps 要確認 after recheck');
  const evs = [{ id: 'k1', kind: 'rec', period: '1H', at: 150000, pid: 'a', check: true, checkOk: true }];
  eq(recheckAll(M, evs).map((x) => [x.ev.id, x.check]), [['k1', false]], 'recheck respects このままにする');
  eq(isTodo({ ...evs[0], check: false }, gn), false, 'このままにした event is not 未入力あり');
}
// --- しるし：出場の区切りが変わると変わる（記4）
{
  const a = pitchSig(M), b = pitchSig({ ...M, stints: M.stints.map((s) => (s.pid === 'e' ? { ...s, from: 101000 } : s)) });
  const c = pitchSig({ ...M, stints: [...M.stints] });
  eq([a !== b, a === c], [true, true], 'pitchSig changes when a sub time changes, same otherwise');
  const live = (to) => ({ ...M, stints: [...M.stints, { period: '2H', pid: 'a', seat: 1, from: 0, to, open: true }] });
  eq(pitchSig(live(5000)) === pitchSig(live(9000)), true, 'pitchSig ignores the growing end of an ongoing appearance');
}
// --- 得点・失点の種類は名前でなく id で見分ける（記15）
{
  const list = [{ id: 'o0_定位置', name: '定位置' }, { id: 'o2_CK', name: 'コーナー' }, { id: 'o11_OG', name: 'オウンゴール' }, { id: 'o1700000000000', name: 'OG' }, { id: 'o1700000000001', name: 'FK' }];
  const gn = (id) => list.find((o) => o.id === id)?.name || '';
  eq([goalTypeKey('o11_OG', 'オウンゴール'), goalTypeKey('o1700000000001', 'FK'), goalTypeKey('x', '')], ['OG', 'FK', ''], 'goalTypeKey');
  eq([isOGType('o11_OG', gn), isOGType('o1700000000000', gn), isOGType('o2_CK', gn), isOGType(undefined, gn)], [true, true, false, false], 'isOGType: renamed default OG, custom OG by name');
  eq([clsOfGoalTypeId('o2_CK', gn), clsOfGoalTypeId('o0_定位置', gn), clsOfGoalTypeId('o1700000000001', gn), clsOfGoalTypeId(null, gn)], ['set', 'pos', 'set', null], 'clsOfGoalTypeId: renamed CK is still set play');
  eq([goalTypeIdOf(list, 'OG'), goalTypeIdOf(list, 'CK'), goalTypeIdOf(list, 'コーナー'), goalTypeIdOf(list, 'なし')], ['o11_OG', 'o2_CK', 'o2_CK', null], 'goalTypeIdOf');
  eq(missingLv({ kind: 'conc', gtype: 'o11_OG' }, gn), { basic: 0, detail: 1 }, 'renamed OG still asks for the OG player, not SZ');
  const t = setEventTable(M, [], [{ kind: 'conc', period: '1H', at: 50000, gtype: 'o11_OG' }], gn);
  eq(t.total, [0, 0, 0, 0, 0, 0, 0, 0], 'renamed OG conceded is not counted as an opp shot');
}
// --- 種類を変えたら、その種類の項目だけ残す（記3）
{
  const gn = (id) => ({ og: 'OG', t1: '定位置' }[id] || '');
  const base = { id: 'e1', period: '1H', at: 1000, seq: 5, src: 'sportscode', imp: 7 };
  eq(cleanFields({ ...base, kind: 'conc', pid: 'a', assist: 'b', gtype: 't1', sz: 'out', n: 2 }, gn), { ...base, kind: 'conc', gtype: 't1', sz: 'out', n: 2 }, 'goal → 失点 drops scorer and assist, keeps src/imp');
  eq(cleanFields({ ...base, kind: 'goal', pid: 'a', result: 'in', cls: 'pos', n: 2 }, gn), { ...base, kind: 'goal', pid: 'a' }, 'shot → 得点 drops result/cls (and n without SZ)');
  eq(cleanFields({ ...base, kind: 'foul', pid: 'a', card: 'y2' }, gn), { ...base, kind: 'foul', pid: 'a', card: 'none' }, '被ファール → ファール drops イエロー2枚目');
  eq(cleanFields({ ...base, kind: 'oz4', method: 'pass', pid: 'a', pid2: 'b', cls: 'set', sp: 'CK' }, gn), { ...base, kind: 'oz4', cls: 'set', sp: 'CK' }, 'Z4 → 被Z4 drops method and players');
  eq(cleanFields({ ...base, kind: 'conc', gtype: 'og', og: 'a', sz: 'in', n: 1 }, gn), { ...base, kind: 'conc', gtype: 'og', og: 'a' }, 'OG conceded: no SZ (決5)');
  eq(cleanFields({ ...base, kind: 'goal', pid: OPP_OG, gtype: 'og', sz: 'in', n: 1 }, gn), { ...base, kind: 'goal', pid: OPP_OG, gtype: 'og', assist: NO_ASSIST }, 'opp OG goal: no SZ, no assist');
  eq(cleanFields({ ...base, kind: 'rec', pid: 'a', zone: 'Z9', card: 'red' }, gn), { ...base, kind: 'rec', pid: 'a' }, 'rec: invalid zone and card dropped');
  eq(cleanFields({ ...base, kind: 'szshot', result: 'in', n: 0 }, gn), { ...base, kind: 'szshot', result: 'in' }, 'SZ shot with 0 people → empty');
}
// --- 相手の退場（4×3。決8）
{
  const MM = { periods: [{ key: '1H', len: 1200000, elapsed: 1200000, status: 'done' }, { key: '2H', len: 1200000, elapsed: 1200000, status: 'done' }], matchOver: true };
  eq(oejDefaultEnd(MM, [], '1H', 300000), { endPeriod: '1H', endAt: 420000 }, 'default end: 2:00 later');
  eq(oejDefaultEnd(MM, [{ kind: 'goal', period: '1H', at: 350000 }, { kind: 'conc', period: '1H', at: 340000 }], '1H', 300000), { endPeriod: '1H', endAt: 350000 }, 'our goal before 2:00 ends it (conceded does not)');
  eq(oejDefaultEnd(MM, [], '1H', 1140000), { endPeriod: '2H', endAt: 60000 }, 'crosses into the next period');
  eq(oejDefaultEnd(MM, [{ kind: 'goal', period: '2H', at: 30000 }], '1H', 1140000), { endPeriod: '2H', endAt: 30000 }, 'goal in the next period');
  eq(oejDefaultEnd(MM, [], '2H', 1150000), { endPeriod: '2H', endAt: 1200000 }, 'clamped to the end of the match');
  eq(oejDefaultEnd(MM, [{ kind: 'goal', period: '1H', at: 300000 }], '1H', 300000), { endPeriod: '1H', endAt: 420000 }, 'goal at the same second as the ejection does not end it');
  const evs = [
    { id: 'o1', kind: 'oej', period: '1H', at: 1140000, endPeriod: '2H', endAt: 60000 },
    { id: 'o2', kind: 'oej', period: '2H', at: 30000, endPeriod: '2H', endAt: 100000 },
    { id: 'o3', kind: 'oej', period: '2H', at: 500000 }, // 終わりなし → 初めの終わり
    { id: 'o4', kind: 'oej', period: '1H', at: 1000, endPeriod: '1H', endAt: 2000, deleted: true },
  ];
  eq(oppEjWindows(evs, MM), { '1H': [[1140000, 1200000]], '2H': [[0, 100000], [500000, 620000]] }, 'oppEjWindows: split by period, merged, default end');
  eq([missingLv({ kind: 'oej' }), needsCheck(M, ev({ kind: 'oej', at: 150000 }))], [{ basic: 0, detail: 0 }, false], 'oej is never a todo');
  eq(summary({ kind: 'oej', endPeriod: '2H', endAt: 60000 }, (x) => x, undefined, (p, at) => `${p}-${at}`), '4×3 〜 2H-60000まで', 'oej summary');
}

console.log(`events: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
