// Random-operation test for the set-play timer (spec 10章「セットプレー交代についても…ランダムに組み合わせたテスト」).
// Run: node test/setplay.test.mjs [seed] [runs]
// 毎回確かめること：
//   - 記録としての出場時間は、セットプレーの操作（開始・終了・「続き」を0:00に）があってもなくても同じ
//   - 「続き」になるのは、モード開始時にピッチにいて、モード中にベンチに下がった選手だけ（ピッチにいる選手には残らない）
//   - 「続き」はモードの間だけ（モードがなければ空）。ピリオドの経過より長くならない
//   - 連続出場タイマーはマイナスにならず、ピリオドの経過より長くならない
//   - 1:00で自動終了したあとは、次の操作の前でも「続き」を見せない
import { replay, nowElapsed, seatView, contTime, perLen, setplayOn, carryOf } from '../js/engine.js';

let seed = Number(process.argv[2] || 500);
const runs = Number(process.argv[3] || 300);
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const pick = (a) => a[Math.floor(rnd() * a.length)];
const MEM = {}; ['g1', 'g2'].forEach((p) => { MEM[p] = { pos: 'GK' }; }); for (let i = 1; i <= 10; i++) MEM['f' + i] = { pos: 'FP', pp: i <= 2 };
const cfg = { times: { half: 20, extra: false }, members: MEM, setplayAuto: 60 };
const ALL = Object.keys(MEM);
const SP = new Set(['setplay', 'setplayEnd', 'contReset']);

let checks = 0; const fails = [];
const fail = (m, ctx) => { if (fails.length < 10) fails.push(`${m} | run ${ctx.run} step ${ctx.step} op ${JSON.stringify(ctx.op)}`); };
const base = seed;
for (let run = 0; run < runs; run++) {
  seed = base + run; const ops = []; let t = 1e12, n = 0;
  for (let step = 0; step < 200; step++) {
    t += Math.floor(rnd() * 15000);
    const S = replay(ops, cfg); const p = S.periods[S.current]; let op;
    if (S.matchOver || S.askExtra) break;
    if (p.status === 'none') {
      let g = 0;
      op = { type: 'kickoff', lineup: ALL.filter((x) => !S.ejected.has(x)).sort(() => rnd() - 0.5).filter((x) => !(MEM[x].pos === 'GK' && g++)).slice(0, 5), spAuto: pick([30, 60, 90]) };
    } else {
      const on = S.seats.filter(Boolean); const bench = ALL.filter((x) => !on.includes(x) && !S.ejected.has(x)); const r = rnd();
      if (r < 0.1) op = { type: p.runningSince == null ? 'start' : 'stop' };
      else if (r < 0.35) op = { type: 'out', pid: pick(on.length ? on : ALL) };
      else if (r < 0.6) op = { type: 'in', pid: pick(rnd() < 0.3 && S.batch.outs.length ? S.batch.outs.map((o) => o.pid) : bench.length ? bench : ALL) };
      else if (r < 0.7) op = { type: 'setplay' };
      else if (r < 0.73) op = { type: 'setplayEnd' };
      else if (r < 0.76) op = { type: 'contReset', pid: pick(ALL) };
      else if (r < 0.8) op = { type: 'adjust', elapsed: Math.floor(rnd() * perLen(S, S.current)) };
      else if (r < 0.9) op = { type: 'undo' };
      else if (r < 0.92) op = { type: 'eject', pid: pick(on.length ? on : ALL) };
      else if (r < 0.94) op = { type: 'periodEnd' };
      else op = { type: 'stop' };
    }
    ops.push({ id: 'o' + n, n: n++, t, period: S.current, ...op });
    const ctx = { run, step, op };
    const A = replay(ops, cfg);
    const B = replay(ops.map((o) => (SP.has(o.type) ? { ...o, type: 'noop' } : o)), cfg);
    checks++;
    const sig = (X) => JSON.stringify(X.stints.map((s) => [s.period, s.pid, s.seat, s.from, s.to]));
    if (sig(A) !== sig(B)) fail('stints differ with/without set-play ops', ctx);
    if (!A.setplay && Object.keys(A.carry).length) fail('carry without set-play mode', ctx);
    const live = A.periods[A.current].status === 'live';
    const el = live ? nowElapsed(A, t) : 0;
    for (const k of Object.keys(A.carry)) {
      if (A.setplay && !A.setplay.onAtStart.has(k)) fail(`carry for ${k} who was not on the pitch at mode start`, ctx);
      if (A.seats.includes(k)) fail(`carry kept for ${k} on the pitch`, ctx);
      if (A.carry[k] < 0 || A.carry[k] > el + 1) fail(`carry ${k} ${A.carry[k]} longer than the period ${el}`, ctx);
    }
    if (live) {
      for (const v of seatView(A, el)) if (v.pid) { const c = contTime(A, v.pid, el, v); if (c < 0 || c > el + 1) fail(`cont ${v.pid} ${c} out of 0..${el}`, ctx); }
      // 自動終了の時刻を過ぎたら（次の操作の前でも）「続き」を見せない
      const later = el + 61000;
      if (A.setplay && later >= A.setplay.endsAt && (setplayOn(A, later) || ALL.some((x) => carryOf(A, x, later) != null))) fail('続き shown after the automatic end', ctx);
    }
  }
}
console.log(`setplay: ${runs} random matches, ${checks} checks, ${fails.length ? 'FAILED' : 'all passed'}`);
fails.forEach((f) => console.log('  FAIL ' + f));
if (fails.length) process.exit(1);
