// 記録の読み方（store.js、2026-10-17 決13）：聞き続けるか・1回だけ読むか、端末の保存を使ってよいか。
// Run: node test/readplan.test.mjs
import { wantLiveFor, snapPlan, cacheUsable, revOf } from '../js/store.js';

let pass = 0, fail = 0;
const eq = (a, b, msg) => { const A = JSON.stringify(a), B = JSON.stringify(b); if (A === B) pass++; else { fail++; console.log('NG:', msg, '\n  got ', A, '\n  want', B); } };

// ---- 聞き続けるか ----
const done = { id: 'm1', status: 'done' }, live = { id: 'm2', status: 'playing' }, prep = { id: 'm3', status: 'prep' };
eq(wantLiveFor(live, 'm2', '#/analysis'), true, '試合中の試合は、どの画面でも聞き続ける');
eq(wantLiveFor(done, 'm1', '#/analysis'), false, '終わった試合を分析で使うときは1回だけ読む');
eq(wantLiveFor(done, 'm1', '#/m/m1'), true, '試合ページを開いている');
for (const sub of ['play', 'events', 'review', 'fix', 'stats', 'report', 'physical', 'events/rt'])
  eq(wantLiveFor(done, 'm1', `#/m/m1/${sub}`), true, `#/m/m1/${sub} を開いている`);
eq(wantLiveFor(done, 'm1', '#/m/m10/review'), false, '別の試合（id の前が同じ）');
eq(wantLiveFor(done, 'm10', '#/m/m1/review'), false, '別の試合（id が長い）');
eq(wantLiveFor(prep, 'm3', '#/m/m3/play'), true, '始まる前の MATCH PLAY');
eq(wantLiveFor(prep, 'm3', '#/home'), false, '始まる前の試合で、画面にもない');
eq(wantLiveFor(undefined, 'm4', '#/a/act1'), false, '一覧にまだない試合');
eq(wantLiveFor(done, 'm1', ''), false, '画面の場所がない');

// ---- 1回だけ読む試合を、今読むか ----
eq(snapPlan({ ready: false }, ''), 'load', 'はじめて：読む');
eq(snapPlan({ ready: false, loading: true, tried: '' }, ''), 'wait', '読み込み中は重ねて読まない');
eq(snapPlan({ ready: true, rev: 'r1', tried: 'r1' }, 'r1'), 'keep', '印が同じ：そのまま（描き直しても読み直さない）');
eq(snapPlan({ ready: true, rev: 'r1', tried: 'r1' }, 'r2'), 'load', 'ほかの端末で書かれた（印が変わった）：読み直す');
eq(snapPlan({ ready: true, rev: undefined, tried: 'r1' }, 'r1'), 'wait', 'オフラインで確かめられなかった：同じ印では何度も読まない');
eq(snapPlan({ ready: true, rev: undefined, tried: undefined }, 'r1'), 'load', 'つながったら（tried を消す）読み直す');
eq(snapPlan({ ready: true, rev: undefined, tried: 'r1' }, 'r2'), 'load', 'オフラインのあとに印が変わった');
eq(snapPlan({ ready: true, rev: '', tried: '' }, ''), 'keep', '印をまだ書いていない古い試合も、読んだらそのまま');
eq(snapPlan({ ready: true, rev: 'r1', loading: true, tried: 'r2' }, 'r2'), 'wait', '読み込み中に描き直し');

// ---- 端末の保存を使ってよいか ----
eq(cacheUsable(null, 'r1', 300), false, 'メモがない：サーバーから読む');
eq(cacheUsable({ rev: 'r1', n: 300 }, 'r1', 300), true, '印も件数も同じ：端末の保存で足りる');
eq(cacheUsable({ rev: 'r1', n: 300 }, 'r1', 305), true, '件数が多い（この端末のまだ送っていない書き込み）');
eq(cacheUsable({ rev: 'r1', n: 300 }, 'r1', 120), false, '端末の保存の一部が消されていた：サーバーから読む');
eq(cacheUsable({ rev: 'r1', n: 300 }, 'r1', 0), false, '端末の保存が空');
eq(cacheUsable({ rev: 'r1', n: 300 }, 'r2', 300), false, '印が違う：サーバーから読む');
eq(cacheUsable({ rev: '', n: 0 }, '', 0), false, '記録0件の試合はサーバーで確かめる（1回の読み取り）');

// ---- 印の値 ----
eq([revOf({ revOps: 'a' }, 'revOps'), revOf({}, 'revOps'), revOf(undefined, 'revEv'), revOf({ revEv: 5 }, 'revEv')], ['a', '', '', '5'], '印の値');

console.log(`readplan: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
