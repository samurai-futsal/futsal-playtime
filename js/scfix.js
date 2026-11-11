// 記録の修正「Sportscodeから直す」（2026-11-11）：Sportscode の XML の「#背番号」の行から、1つのピリオドの出場・交代を作り直す。
// ・FP は XML のとおり。時計は XML の行を重ねた「時計が動いていた区間」で数え、ピリオドの長さ（20:00 など）に合わせて少しだけ伸び縮みさせる
//   （タグの付け始め・付け終わりのずれで、XML の時計は 20分より十数秒長くなりやすい）
// ・GK は、XML に GK の行があればそれを使う。なければ、XML で FP が 4人の時間は GK がいて、5人の時間は GK を下げていた（パワープレー）とし、
//   どの GK かは今の記録から決める
// ・OUT と IN は順に組にして交代にする（IN が少し遅ければ、OUT の選手はその IN まで出ていたとする）
// ・作ったピリオドには sc（XML の時計）を残す。イベントを同じ XML から取り込み直すと、同じ時計で時刻を決めるので、イベントと出場がぴったりそろう
import { fixData } from './model.js';

const J = 0.35;   // これより短い切れ目は時計が止まったとみなさない（秒）
const R = (ms) => Math.round(ms / 1000) * 1000;
const noOf = (code) => (String(code).match(/^#\s*(\d+)\s*$/) || [])[1];
let nidN = 0; const nid = () => 'sc' + Date.now().toString(36) + (nidN++).toString(36);

// XML の時計：動画の秒 → ピリオドの経過時間（ms）
export function scClock(sc) {
  return (videoSec) => {
    const v = videoSec - sc.ko; let run = 0;
    for (const [s, e] of sc.segs) { if (v <= s) break; run += Math.min(v, e) - s; }
    return Math.max(0, Math.min(sc.len, Math.round(run * 1000 * sc.scale)));
  };
}

// instances：XML のインスタンス（parseSC）、per：{ key, ko, to }（動画の秒）、byNo：{背番号: pid}、isGK(pid)、cur：今の記録のそのピリオド（fix の形）、len：ピリオドの長さ（ms）
export function scFixPeriod({ instances, per, byNo, isGK, cur, len, file = '' }) {
  const warn = [], missing = new Set();
  const by = new Map();
  for (const i of instances) {
    const no = noOf(i.code); if (no == null) continue;
    if (!(i.start >= per.ko - 1 && i.start < per.to) || !(i.end > i.start)) continue;
    const pid = byNo[no]; if (!pid) { missing.add(no); continue; }
    if (!by.has(pid)) by.set(pid, []); by.get(pid).push([i.start, i.end]);
  }
  if (!by.size) return { ok: false, err: 'このピリオドに出場（#背番号）の行がありません', missing: [...missing] };
  for (const [pid, a] of by) { a.sort((x, y) => x[0] - y[0]); const mg = [a[0].slice()]; for (const [s, e] of a.slice(1)) { const l = mg[mg.length - 1]; if (s - l[1] <= 0.05) l[1] = Math.max(l[1], e); else mg.push([s, e]); } by.set(pid, mg); }
  // 時計が動いていた区間（FP も GK も重ねる）
  const all = [...by.values()].flat().sort((x, y) => x[0] - y[0]);
  const segs = [all[0].slice()]; for (const [s, e] of all.slice(1)) { const l = segs[segs.length - 1]; if (s - l[1] <= J) l[1] = Math.max(l[1], e); else segs.push([s, e]); }
  const K = segs[0][0], E = segs[segs.length - 1][1];
  const runIn = (a, b) => segs.reduce((x, [s, e]) => x + Math.max(0, Math.min(e, b) - Math.max(s, a)), 0);
  const play = runIn(K, E); const scale = len / (play * 1000);
  const segsR = segs.map(([s, e]) => [+(s - K).toFixed(2), +(e - K).toFixed(2)]);
  const sc = { file, ko: +K.toFixed(3), segs: segsR, scale: len / (segsR.reduce((x, [s, e]) => x + e - s, 0) * 1000), len }; // 縮め方は、保存する区間（丸めたもの）から決める（終わりがちょうどピリオドの長さになるように）
  const clock = scClock(sc);
  // 1回の出場（間に時計が動いた時間がないインスタンスはつなぐ）
  const stints = [];
  for (const [pid, a] of by) { let c = a[0].slice(); for (const iv of a.slice(1)) { if (runIn(c[1], iv[0]) < 0.5) c[1] = iv[1]; else { stints.push({ pid, from: clock(c[0]), to: clock(c[1]) }); c = iv.slice(); } } stints.push({ pid, from: clock(c[0]), to: clock(c[1]) }); }
  for (const s of stints) { s.from = R(s.from); s.to = R(s.to); if (s.from <= 1000) s.from = 0; if (s.to >= len - 1000) s.to = len; }
  let fps = stints.filter((s) => !isGK(s.pid) && s.to > s.from);
  let gks = stints.filter((s) => isGK(s.pid) && s.to > s.from);
  const gkFromXml = gks.length > 0;
  if (!gkFromXml) {
    // XML に GK の行がないとき：XML で FP が 4人以下の時間は GK がいて、5人の時間は GK を下げていた（パワープレー）とする。
    // どの GK かは、今の記録でその時間に出ていた GK（いなければ、そのピリオドでいちばん長く出ていた GK）
    const appGk = fixData(cur, per.key).stints.filter((s) => isGK(s.pid));
    if (!appGk.length) warn.push('GK の行が XML にも今の記録にもありません');
    const main = (() => { const t = {}; for (const g of appGk) t[g.pid] = (t[g.pid] || 0) + g.to - g.from; return Object.keys(t).sort((x, y) => t[y] - t[x])[0]; })();
    const cuts = [...new Set([0, len, ...fps.flatMap((s) => [s.from, s.to])])].sort((x, y) => x - y);
    const fpAt = (t) => fps.filter((s) => s.from <= t && t < s.to).length;
    const on = [];
    for (let i = 0; i < cuts.length - 1; i++) {
      const a0 = cuts[i], b0 = cuts[i + 1]; const n = fpAt(a0);
      if (n > 5) warn.push(`${mm(a0)}〜${mm(b0)} に XML の FP が ${n}人います`);
      if (n >= 5) continue;
      const mid = (a0 + b0) / 2; const who = appGk.find((g) => g.from <= mid && mid < g.to)?.pid || main;
      if (!who) continue;
      const l = on[on.length - 1]; if (l && l.pid === who && l.to === a0) l.to = b0; else on.push({ pid: who, from: a0, to: b0 });
    }
    gks = on;
    const offT = (list) => len - list.reduce((x, g) => x + g.to - g.from, 0);
    if (offT(appGk) || offT(gks)) warn.push(`GK を下げていた時間（パワープレー）：今の記録 ${mm(offT(appGk))} → XML ${mm(offT(gks))}（XML で FP が 5人の時間）`);
  }
  const pl = [...gks, ...fps];
  const lineup = pl.filter((s) => s.from === 0).map((s) => s.pid);
  if (lineup.length !== 5) return { ok: false, err: `キックオフの時にピッチにいる選手が${lineup.length}人です（5人のときだけ作れます）`, missing: [...missing], play };
  // OUT と IN を順に組にする
  const items = [];
  for (const s of pl) { if (s.from > 0) items.push({ t: s.from, o: 1, type: 'in', pid: s.pid }); if (s.to < len) items.push({ t: s.to, o: 0, type: 'out', pid: s.pid }); }
  items.sort((a, b) => a.t - b.t || a.o - b.o);
  const seat = new Map(lineup.map((p, i) => [p, i]));
  const ev = []; const pOut = [], pIn = [];
  for (const it of items) {
    if (it.type === 'out') {
      const sNo = seat.get(it.pid); seat.delete(it.pid); if (sNo == null) continue;
      if (pIn.length) { const x = pIn.shift(); ev.push({ id: nid(), kind: 'sub', seat: sNo, at: it.t, in: x.pid }); seat.set(x.pid, sNo); if (it.t - x.t > 3000) warn.push(`${mm(x.t)} に入った選手を、${mm(it.t)} の OUT と組にしました（${Math.round((it.t - x.t) / 1000)}秒ずれていました）`); }
      else pOut.push({ seat: sNo, t: it.t, pid: it.pid });
    } else {
      if (pOut.length) { const o = pOut.shift(); ev.push({ id: nid(), kind: 'sub', seat: o.seat, at: it.t, in: it.pid }); seat.set(it.pid, o.seat); if (it.t - o.t > 3000) warn.push(`${mm(o.t)} の OUT を、${mm(it.t)} に入った選手と組にしました（${Math.round((it.t - o.t) / 1000)}秒ずれていました）`); }
      else pIn.push({ pid: it.pid, t: it.t });
    }
  }
  for (const o of pOut) { ev.push({ id: nid(), kind: 'eject', seat: o.seat, at: o.t, reason: null }); warn.push(`${mm(o.t)} の OUT のあと、入る選手がいません（退場・空席にしました）`); }
  for (const x of pIn) warn.push(`${mm(x.t)} に入った選手と組になる OUT がありません（入れていません）`);
  ev.sort((a, b) => a.at - b.at || a.seat - b.seat);
  const fp = { elapsed: len, lineup: lineup.slice(), ev, pp: JSON.parse(JSON.stringify(cur?.pp || [])), sc };
  return { ok: true, fp, play, scale, gkFromXml, warn, missing: [...missing] };
}
const mm = (ms) => { const s = Math.round(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

// 選手ごとの出場時間（ms）
export function totalsOf(fp, key) { const o = {}; for (const s of fixData(fp, key).stints) o[s.pid] = (o[s.pid] || 0) + s.to - s.from; return o; }
