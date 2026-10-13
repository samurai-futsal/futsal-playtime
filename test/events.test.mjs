// Event rules (spec 6章・13章): 未入力の数え方、ピッチの5人（交代と同じ秒）、分類の初めの選択、要確認。
// Run: node test/events.test.mjs
import { missing, pitchAt, subAtSecond, autoCls, needsCheck, OPP_OG, NO_ASSIST, UNKNOWN, sortEvents } from '../js/events.js';

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

// --- missing（● 資料に出る項目の空き）
const gn = (id) => ({ og: 'OG', t1: '定位置' }[id] || '');
eq(missing({ kind: 'shot' }, gn), 4, 'empty shot: pid,result,cls,n');
eq(missing({ kind: 'szshot' }, gn), 3, 'empty SZ shot: n is optional');
eq(missing({ kind: 'oshot' }, gn), 3, 'empty opp shot: result,cls,n');
eq(missing({ kind: 'oszshot' }, gn), 2, 'empty opp SZ shot: result,cls');
eq(missing({ kind: 'shot', pid: 'a', result: 'in', cls: 'pos', n: 0 }, gn), 0, '0人 counts as entered');
eq(missing({ kind: 'z4' }, gn), 1, 'z4: cls only (method/player optional)');
eq(missing({ kind: 'sz' }, gn), 0, 'sz: nothing required');
eq(missing({ kind: 'osz' }, gn), 0, 'osz: nothing');
eq(missing({ kind: 'goal' }, gn), 4, 'empty goal: scorer,assist,type,sz');
eq(missing({ kind: 'goal', pid: 'a', assist: NO_ASSIST, gtype: 't1', sz: 'out' }, gn), 1, 'goal SZ外: people count needed');
eq(missing({ kind: 'goal', pid: 'a', assist: NO_ASSIST, gtype: 't1', sz: 'in' }, gn), 0, 'goal SZ内: people optional');
eq(missing({ kind: 'goal', pid: OPP_OG, assist: NO_ASSIST, gtype: 'og' }, gn), 0, 'opp OG goal complete');
eq(missing({ kind: 'conc' }, gn), 2, 'empty conc: type, sz');
eq(missing({ kind: 'conc', gtype: 'og' }, gn), 0, 'own OG: nothing else');
eq(missing({ kind: 'conc', gtype: 't1' }, gn), 1, 'conc: sz');
eq(missing({ kind: 'fspat' }, gn), 1, 'fsp: type');
eq(missing({ kind: 'lost' }, gn), 1, 'lost: player (zone optional)');
eq(missing({ kind: 'lost', pid: UNKNOWN }, gn), 0, '不明 counts as entered');
eq(missing({ kind: 'foul', card: 'none' }, gn), 1, 'foul: player');

// --- order
eq(sortEvents([{ id: 2, period: '2H', at: 1 }, { id: 3, period: '1H', at: 5, seq: 2 }, { id: 1, period: '1H', at: 5, seq: 1 }], ['1H', '2H']).map((x) => x.id), [1, 3, 2], 'time order, then input order');

console.log(`events: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
