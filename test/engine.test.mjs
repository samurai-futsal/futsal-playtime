// Random-operation test for the MATCH PLAY engine (spec 10章「自動テスト」).
// Run: node test/engine.test.mjs
import { replay, nowElapsed, playerPeriodTime, seatView, periodLen, PERIODS } from '../js/engine.js';

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
  // no overlapping stints for one player
  for (const pid of ALL) {
    const st = S.stints.filter((s) => s.pid === pid).sort((a, b) => a.period.localeCompare(b.period) || a.from - b.from);
    for (let i = 1; i < st.length; i++) if (st[i].period === st[i - 1].period && st[i].from < (st[i - 1].to ?? Infinity) - 0) fail(`overlap ${pid}`);
  }
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
      const lineup = [...avail].sort(() => rnd() - 0.5).slice(0, 5);
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
  }
  return ops.length;
}

let runs = Number(process.argv[3] || 400), opsTotal = 0;
for (let i = 0; i < runs; i++) opsTotal += runOne(1000 + i);
console.log(`OK: ${runs} random matches, ${opsTotal} operations, all checks passed`);
