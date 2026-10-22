// 動画と試合の時計の合わせ方（js/vsync.js）。Run: node test/vsync.test.mjs
import { clockAtVideo, videoAtClock } from '../js/vsync.js';
let pass = 0, fail = 0;
const eq = (a, b, msg) => { const ok = JSON.stringify(a) === JSON.stringify(b); ok ? pass++ : (fail++, console.log('FAIL', msg, '\n  got', JSON.stringify(a), '\n  want', JSON.stringify(b))); };
// 前半：キックオフから 0〜60秒 時計が動き、60〜90秒 止まり（30秒）、90秒から また動く
const runs = { '1H': [[0, 60000, 0], [90000, 1e9, 60000]], '2H': [[0, 1e9, 0]] };
const R = {
  elOfRel: (k, rel) => { let el = 0; for (const [t0, t1, e0] of runs[k]) { if (rel < t0) break; el = rel >= t1 ? e0 + (t1 - t0) : e0 + (rel - t0); } return el; },
  relOf: (k, at) => { for (const [t0, t1, e0] of runs[k]) if (at <= e0 + (t1 - t0) && at >= e0) return t0 + (at - e0) - (at === e0 && e0 > 0 ? 0 : 0); return at; },
};
const P = [{ key: '1H', status: 'done', len: 1200000 }, { key: '2H', status: 'done', len: 1200000 }];
const sync = { '1H': { v: 100, name: 'a.mp4' }, '2H': { v: 2000, name: 'a.mp4' } };
eq(clockAtVideo(R, P, sync, 'a.mp4', 50), null, 'before the first kickoff');
eq(clockAtVideo(R, P, sync, 'a.mp4', 130), { period: '1H', at: 30000 }, '30s after kickoff');
eq(clockAtVideo(R, P, sync, 'a.mp4', 175), { period: '1H', at: 60000 }, 'clock stopped: stays at 60s');
eq(clockAtVideo(R, P, sync, 'a.mp4', 200), { period: '1H', at: 70000 }, 'after the stop: 100s real = 70s clock');
eq(clockAtVideo(R, P, sync, 'a.mp4', 2000 + 65), { period: '2H', at: 65000 }, 'second half');
eq(clockAtVideo(R, P, sync, 'b.mp4', 130), null, 'another file is not synced');
eq(clockAtVideo(R, P, { ...sync, '2H': { v: 10, name: 'b.mp4' } }, 'b.mp4', 70), { period: '2H', at: 60000 }, 'second half in its own file');
eq(clockAtVideo(R, P, sync, 'a.mp4', 1900), { period: '1H', at: 1200000 }, 'clamped to the period length');
eq(videoAtClock(R, sync, 'a.mp4', '1H', 70000), 200, 'clock → video (after the stop)');
eq(videoAtClock(R, sync, 'a.mp4', '1H', 30000), 130, 'clock → video');
eq(videoAtClock(R, sync, 'b.mp4', '1H', 30000), null, 'not synced in that file');
console.log(`vsync: ${pass} passed, ${fail} failed`);
if (fail) process.exit(1);
