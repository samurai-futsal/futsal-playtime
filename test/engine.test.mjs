// Random-operation test for the MATCH PLAY engine (spec 10章「自動テスト」).
// Run: node test/engine.test.mjs
import { replay, nowElapsed, playerPeriodTime, seatView, periodLen, PERIODS } from '../js/engine.js';
import { matchModel, checkTotal, setTable, playedTime, replayToFix, checkFix, playerTable } from '../js/model.js';

let seed = Number(process.argv[2] || 12345);
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const pick = (a) => a[Math.floor(rnd() * a.length)];

const MEMBERS = {};
['g1', 'g2'].forEach((p) => { MEMBERS[p] = { no: p, pos: 'GK', pp: false }; });
for (let i = 1; i <= 12; i++) MEMBERS['f' + i] = { no: 'f' + i, pos: 'FP', pp: i <= 3 };
const cfg = { times: { half: 20, extra: true, extraHalf: 5 }, members: MEMBERS, setplayAuto: 60 };
const ALL = Object.keys(MEMBERS);

function check(S, t, ctx) {
  const k = S.current; const p = S.periods[k];
  const fail = (m) => { throw new Error(`${m} | seed ${ctx.seed} step ${ctx.step} op ${JSON.stringify(ctx.op)}`); };
  if (p.status === 'live') {
    const at = nowElapsed(S, t);
    const on = S.seats.filter(Boolean);
    const empties = S.empty.filter(Boolean).length;
    if (on.length + empties !== 5) fail(`seats ${on.length}+${empties} != 5`);
    if (new Set(on).size !== on.length) fail('duplicate on pitch');
    on.forEach((pid) => { if (S.ejected.has(pid)) fail('ejected player on pitch'); });
    // the tentative view must also show 5 distinct players/empties
    const v = seatView(S, at).filter((x) => x.pid);
    if (new Set(v.map((x) => x.pid)).size !== v.length) fail('duplicate in seat view');
    // total playing time = 5 × elapsed − empty-seat time
    let total = 0; ALL.forEach((pid) => { total += playerPeriodTime(S, pid, k, at); });
    const emptyMs = S.empties.filter((e) => e.period === k).reduce((s, e) => s + ((e.to ?? at) - e.from), 0);
    if (Math.abs(total + emptyMs - 5 * at) > 1) fail(`time sum ${total}+${emptyMs} != 5×${at}`);
  }
  // finished periods
  for (const pk of PERIODS) {
    const pp = S.periods[pk.key]; if (pp.status !== 'done') continue;
    let total = 0; ALL.forEach((pid) => { total += playerPeriodTime(S, pid, pk.key, pp.elapsed); });
    const emptyMs = S.empties.filter((e) => e.period === pk.key).reduce((s, e) => s + (e.to - e.from), 0);
    if (Math.abs(total + emptyMs - 5 * pp.elapsed) > 1) fail(`done ${pk.key} sum ${total}+${emptyMs} != 5×${pp.elapsed}`);
  }
  // review model (spec 7章): all players' time = 5 × played time − empty seats; sets are 4 distinct FP and fit in the played time
  const M = matchModel(S, t); const ct = checkTotal(M);
  if (Math.abs(ct.players - ct.expected) > 2) fail(`model total ${ct.players} != ${ct.expected}`);
  const sets = setTable(M);
  if (sets.some((x) => new Set(x.pids).size !== 4 || x.pids.some((pid) => MEMBERS[pid].pos === 'GK'))) fail('bad set');
  if (sets.reduce((a, x) => a + x.time, 0) > playedTime(M) + 1) fail('sets longer than played time');
  // no overlapping stints for one player
  for (const pid of ALL) {
    const st = S.stints.filter((s) => s.pid === pid).sort((a, b) => a.period.localeCompare(b.period) || a.from - b.from);
    for (let i = 1; i < st.length; i++) if (st[i].period === st[i - 1].period && st[i].from < (st[i - 1].to ?? Infinity) - 0) fail(`overlap ${pid}`);
  }
}

// 記録の修正（spec 8章）：MATCH PLAYの記録を修正用の形に直して戻しても、出場時間・回数・空席がまったく同じ
let softCount = 0;
function checkFixRoundTrip(S, t, sd, step) {
  const fail = (m) => { throw new Error(`fix round trip: ${m} | seed ${sd} step ${step}`); };
  const fix = { periods: {} };
  for (const p of PERIODS) if (S.periods[p.key].status === 'done') {
    fix.periods[p.key] = replayToFix(S, p.key);
    // 時計を大きく戻して退場より前にした記録では、退場とGKの矛盾が出ることがある（修正の画面で知らせて直してもらう）。数だけ数える
    const all = checkFix(fix.periods[p.key], cfg); const soft = all.filter((e) => /退場したあと|GKが2人/.test(e)); softCount += soft.length;
    const errs = all.filter((e) => !soft.includes(e)); if (errs.length) fail(errs.join(' / '));
  }
  const A = matchModel(S, t), B = matchModel(S, t, fix);
  const ta = playerTable(A), tb = playerTable(B);
  for (const pid of ALL) for (const p of PERIODS) {
    const x = ta[pid]?.per[p.key] || { time: 0, count: 0 }, y = tb[pid]?.per[p.key] || { time: 0, count: 0 };
    if (x.time !== y.time) fail(`${pid} ${p.key} time ${x.time} vs ${y.time}`);
  }
  const ea = A.empties.reduce((s, e) => s + e.to - e.from, 0), eb = B.empties.reduce((s, e) => s + e.to - e.from, 0);
  if (ea !== eb) fail(`empty ${ea} vs ${eb}`);
  const ct = checkTotal(B); if (Math.abs(ct.players - ct.expected) > 2) fail(`fixed total ${ct.players} != ${ct.expected}`);
}

function runOne(sd, steps = 220) {
  seed = sd; const ops = []; let t = 1e12; let n = 0;
  const add = (o) => { const S0 = replay(ops, cfg); ops.push({ id: 'o' + n, t, n: n++, period: S0.current, ...o }); };
  for (let step = 0; step < steps; step++) {
    t += Math.floor(rnd() * 40000);
    const S = replay(ops, cfg);
    const p = S.periods[S.current];
    let op;
    if (S.matchOver) { if (rnd() < 0.3) op = { type: 'reset', scope: pick(['1H', '2H', 'all']) }; else op = { type: 'undo' }; }
    else if (S.askExtra) op = { type: 'extra', yes: rnd() < 0.5 };
    else if (p.status === 'none') {
      const avail = ALL.filter((x) => !S.ejected.has(x));
      let g = 0; const lineup = [...avail].sort(() => rnd() - 0.5).filter((x) => !(cfg.members[x]?.pos === 'GK' && g++)).slice(0, 5); // スタメンのGKは1人まで（準備画面と同じ）
      op = rnd() < 0.9 ? { type: 'kickoff', lineup } : { type: 'undo' };
    } else {
      const on = S.seats.filter(Boolean);
      const bench = ALL.filter((x) => !on.includes(x) && !S.ejected.has(x));
      const r = rnd();
      if (r < 0.12) op = { type: p.runningSince == null ? 'start' : 'stop' };
      else if (r < 0.34) op = { type: 'out', pid: pick(on.length ? on : ALL) };
      else if (r < 0.58) op = { type: 'in', pid: pick(rnd() < 0.25 && S.batch.outs.length ? S.batch.outs.map((o) => o.pid) : bench.length ? bench : ALL) };
      else if (r < 0.62) op = { type: 'eject', pid: pick(on.length ? on : ALL) };
      else if (r < 0.66) op = { type: 'setplay' };
      else if (r < 0.68) op = { type: 'setplayEnd' };
      else if (r < 0.71) op = { type: 'pp', team: pick(['own', 'opp']) };
      else if (r < 0.73) op = { type: 'ppEnd' };
      else if (r < 0.75) op = { type: 'timeout', team: pick(['own', 'opp']) };
      else if (r < 0.79) op = { type: 'adjust', elapsed: Math.floor(rnd() * periodLen(cfg, S.current)) };
      else if (r < 0.88) op = { type: 'undo' };
      else if (r < 0.93) op = { type: 'periodEnd' };
      else if (r < 0.95) op = { type: 'reset', scope: pick([S.current, 'all']) };
      else op = { type: 'contReset', pid: pick(ALL) };
    }
    add(op);
    check(replay(ops, cfg), t, { seed: sd, step, op });
    if (step % 20 === 19) checkFixRoundTrip(replay(ops, cfg), t, sd, step);
  }
  return ops.length;
}

let runs = Number(process.argv[3] || 400), opsTotal = 0;
for (let i = 0; i < runs; i++) opsTotal += runOne(1000 + i);
console.log(`OK: ${runs} random matches, ${opsTotal} operations, all checks passed（時計を戻した記録での退場・GKの知らせ ${softCount}件）`);
