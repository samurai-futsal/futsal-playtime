// Sportscode の XML から MATCH PLAY の記録を作る（js/scplay.js）。Run: node test/scplay.test.mjs
import fs from 'fs';
import { parseSC, kickOffs } from '../js/scimport.js';
import { playOpsFromSC } from '../js/scplay.js';
import { replay } from '../js/engine.js';
import { matchModel, playerTable } from '../js/model.js';
let pass = 0, fail = 0;
const ok = (c, msg) => { c ? pass++ : (fail++, console.log('FAIL', msg)); };
const near = (a, b, d, msg) => ok(Math.abs(a - b) <= d, `${msg}: ${a} vs ${b}`);
const load = (f) => parseSC(fs.readFileSync(new URL('./fixtures/' + f, import.meta.url), 'utf8'));
const run = (ops, members) => { const st = replay(ops.map((o, i) => ({ ...o, id: 'o' + i, n: i + 1, dev: 'd' })), { times: { half: 20 }, members }); return { st, T: playerTable(matchModel(st, Date.now(), null)) }; };
const setup = (p) => {
  const nos = [...new Set(p.instances.map((i) => (i.code.match(/^#(\d+)$/) || [])[1]).filter(Boolean))];
  return { byNo: Object.fromEntries(nos.map((n) => [n, 'p' + n])), members: Object.fromEntries([...nos, '1', '2'].map((n) => ['p' + n, { no: n, pos: n === '1' || n === '2' ? 'GK' : 'FP' }])) };
};
// 1つのファイルに前半・後半（GK の行あり）
{
  const p = load('sc_full.xml'); const kos = kickOffs(p.instances); const { byNo, members } = setup(p);
  const periods = [{ key: '1H', ko: kos[0].start, to: kos[1].start }, { key: '2H', ko: kos[1].start, to: 1e9 }];
  const r = playOpsFromSC({ files: [{ name: 'a.xml', instances: p.instances, periods }], byNo, lenMs: 1200000 });
  ok(r.info['1H'].ok && r.info['2H'].ok, 'both periods built');
  near(r.info['1H'].play, 1200, 1, 'first half clock ran ~20:00');
  const { st, T } = run(r.ops, members);
  ok(st.periods['1H'].status === 'done' && st.periods['2H'].status === 'done', 'periods are done after replay');
  const xml = {}; for (const i of p.instances) { const n = (i.code.match(/^#(\d+)$/) || [])[1]; if (n) xml['p' + n] = (xml['p' + n] || 0) + (i.end - i.start) * 1000; }
  for (const pid of Object.keys(xml)) near(T[pid].total, xml[pid], 1500, `playing time of ${pid} equals the XML`);
  ok(r.ops.every((o, i) => !i || o.t >= r.ops[i - 1].t), 'ops are in time order');
  ok(r.vclock['1H'].base === r.vclock['2H'].base, 'same file → same video base');
}
// GK の行がないファイル：GK を選ぶと作れる。選ばないと「4人」で作らない
{
  const p = load('sc_nogk.xml'); const kos = kickOffs(p.instances); const { byNo, members } = setup(p);
  const periods = [{ key: '1H', ko: kos[0].start, to: kos[1].start }];
  const r0 = playOpsFromSC({ files: [{ name: 'b.xml', instances: p.instances, periods }], byNo, lenMs: 1200000 });
  ok(!r0.info['1H'].ok && r0.ops.length === 0, 'four players at kickoff → not built');
  const r = playOpsFromSC({ files: [{ name: 'b.xml', instances: p.instances, periods }], byNo, lenMs: 1200000, gk: { '1H': 'p1' } });
  ok(r.info['1H'].ok, 'built with the chosen GK');
  const { T } = run(r.ops, members);
  near(T.p1.total, r.info['1H'].play * 1000, 1500, 'GK played all the clock-running time');
}
// 前半と後半が別のファイル：後半は前半の終わりのあと
{
  const p = load('sc_full.xml'); const kos = kickOffs(p.instances); const { byNo, members } = setup(p);
  const r = playOpsFromSC({ files: [{ name: '1p.xml', instances: p.instances, periods: [{ key: '1H', ko: kos[0].start, to: kos[1].start }] }, { name: '2p.xml', instances: p.instances, periods: [{ key: '2H', ko: kos[1].start, to: 1e9 }] }], byNo, lenMs: 1200000 });
  const end1 = Math.max(...r.ops.filter((o) => o.period === '1H').map((o) => o.t)); const ko2 = r.ops.find((o) => o.period === '2H' && o.type === 'kickoff').t;
  ok(ko2 > end1, 'second file starts after the first period');
  ok(r.vclock['1H'].base !== r.vclock['2H'].base, 'different files → different bases');
  const { st } = run(r.ops, members); ok(st.periods['2H'].status === 'done', 'second half done');
}
// 背番号が試合メンバーにない
{
  const p = load('sc_full.xml'); const kos = kickOffs(p.instances); const { byNo } = setup(p); delete byNo['15'];
  const r = playOpsFromSC({ files: [{ name: 'a.xml', instances: p.instances, periods: [{ key: '1H', ko: kos[0].start, to: kos[1].start }] }], byNo, lenMs: 1200000 });
  ok(r.missing.includes('15'), 'missing number is reported');
}
console.log(`scplay: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
