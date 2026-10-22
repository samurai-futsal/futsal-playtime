// Sportscode の XML から、MATCH PLAY の記録（ops）を作る（2026-10-22）。MATCH PLAY を使わなかった試合のため。
// Sportscode の「#背番号」の行は、その選手がピッチにいて時計が動いている間だけのインスタンス（ボールが外に出て時計が止まると切れる）。
//  ・時計が動いていた区間 ＝ 全選手のインスタンスを重ねた区間
//  ・選手の出場（1回）＝ その選手のインスタンスのうち、間に時計が動いた時間がないものをつないだもの
//  ・キックオフ ＝ 最初の区間の始まりにいた5人、交代 ＝ 出場の終わり（OUT）と始まり（IN）、時計の停止・再開 ＝ 区間の切れ目
// 時刻（op.t）は「そのファイルの基準＋動画の秒」。ファイルが変わったら、前のピリオドの終わりから間をあける。
// 返す：{ ops, info:{ピリオド: {play, segs, lineup, subs, warn[]}}, missing:[背番号], vclock:{ピリオド:{base, file}} }

const J = 0.35;  // これより短い切れ目は、時計が止まったとみなさない（秒）
const S = 0.6;   // 同じ瞬間とみなす幅（秒）
const EJ = 5;    // OUT のあと、時計が動いた時間でこれより長く次の IN がなければ「退場」（空席）とみなす（秒）
const noOf = (code) => (String(code).match(/^#\s*(\d+)\s*$/) || [])[1];

// gk：{ ピリオド: GKの選手 }。XML に GK の行がないとき（FP だけ記録したファイル）、その GK が時計の動いた間ずっと出ていたものとして足す
export function playOpsFromSC({ files, byNo, lenMs, gk = {}, startT = Date.UTC(2026, 0, 1, 10), gapMs = 15 * 60000 }) {
  const ops = [], info = {}, missing = new Set(), vclock = {};
  let lastT = null;
  for (const f of files) {
    let W = null;
    for (const per of f.periods) {
      const warn = [];
      // その選手のインスタンス（ピリオドの範囲）
      const by = new Map();
      for (const i of f.instances) {
        const no = noOf(i.code); if (no == null) continue;
        if (!(i.start >= per.ko - 1 && i.start < per.to) || !(i.end > i.start)) continue;
        const pid = byNo[no]; if (!pid) { missing.add(no); continue; }
        if (!by.has(pid)) by.set(pid, []); by.get(pid).push([i.start, i.end]);
      }
      if (!by.size) { info[per.key] = { play: 0, segs: 0, lineup: [], subs: 0, warn: ['このピリオドに出場（#背番号）の記録がありません'], ok: false }; continue; }
      for (const [pid, a] of by) { a.sort((x, y) => x[0] - y[0]); const m = [a[0].slice()]; for (const [s, e] of a.slice(1)) { const l = m[m.length - 1]; if (s - l[1] <= 0.05) l[1] = Math.max(l[1], e); else m.push([s, e]); } by.set(pid, m); }
      // 時計が動いていた区間
      const all = [...by.values()].flat().sort((x, y) => x[0] - y[0]);
      const segs = [all[0].slice()]; for (const [s, e] of all.slice(1)) { const l = segs[segs.length - 1]; if (s - l[1] <= J) l[1] = Math.max(l[1], e); else segs.push([s, e]); }
      if (gk[per.key] && !by.has(gk[per.key])) by.set(gk[per.key], segs.map((x) => x.slice()));
      const runIn = (a, b) => segs.reduce((x, [s, e]) => x + Math.max(0, Math.min(e, b) - Math.max(s, a)), 0); // a〜b に時計が動いた秒
      const K = segs[0][0], E = segs[segs.length - 1][1];
      // 出場（1回）
      const stints = [];
      for (const [pid, a] of by) { let cur = a[0].slice(); for (const iv of a.slice(1)) { if (runIn(cur[1], iv[0]) < 0.5) cur[1] = iv[1]; else { stints.push({ pid, s: cur[0], e: cur[1] }); cur = iv.slice(); } } stints.push({ pid, s: cur[0], e: cur[1] }); }
      const lineup = stints.filter((x) => x.s <= K + S).map((x) => x.pid);
      if (lineup.length !== 5) { info[per.key] = { play: runIn(K, E), segs: segs.length, lineup, subs: 0, warn: [`キックオフの時にピッチにいる選手が${lineup.length}人です（5人のときだけ作れます）`], ok: false }; continue; }
      // 並べる：停止(0)・OUT(1)・IN(2)・再開(3)
      const items = [];
      segs.forEach(([s, e], k) => { if (k) items.push({ v: s, o: 3, type: 'start' }); if (k < segs.length - 1) items.push({ v: e, o: 0, type: 'stop' }); });
      for (const x of stints) { if (x.s > K + S) items.push({ v: x.s, o: 2, type: 'in', pid: x.pid }); if (x.e < E - S) items.push({ v: x.e, o: 1, type: 'out', pid: x.pid }); }
      items.sort((a, b) => a.v - b.v || a.o - b.o);
      // IN が OUT より少し早いとき（同時の交代）は、OUT のあとにする。OUT のあと長く IN がなければ退場（空席）にする
      const seq = []; let pend = 0;
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        if (it.type === 'in' && pend <= 0) {
          const j = items.findIndex((y, k) => k > i && y.type === 'out' && y.v - it.v <= 3);
          if (j > i) { const [o] = items.splice(j, 1); seq.push(o); seq.push({ ...it, v: o.v }); continue; }
        }
        if (it.type === 'out') {
          const nxt = items.find((y, k) => k > i && y.type === 'in');
          if (!nxt || runIn(it.v, nxt.v) > EJ) { seq.push({ ...it, type: 'eject' }); warn.push(`${Math.round(it.v)}秒あたり：OUTのあと、すぐに入る選手がいません（退場・空席として作りました）`); continue; }
          pend++;
        } else if (it.type === 'in') pend = Math.max(0, pend - 1);
        seq.push(it);
      }
      // 基準の時刻：同じファイルの次のピリオドは同じ基準（実際の間の時間がそのまま）、別のファイルなら前の終わりから間をあける
      if (W == null) W = lastT == null ? startT - K * 1000 : lastT + gapMs - K * 1000;
      const T = (v) => Math.round(W + v * 1000);
      ops.push({ type: 'kickoff', period: per.key, lineup, len: lenMs, t: T(K) });
      for (const it of seq) ops.push({ type: it.type, period: per.key, ...(it.pid ? { pid: it.pid } : {}), t: T(it.v) });
      ops.push({ type: 'stop', period: per.key, t: T(E) });
      ops.push({ type: 'periodEnd', period: per.key, t: T(E) + 1 });
      lastT = T(E) + 1;
      vclock[per.key] = { base: W, file: f.name || '' };
      const play = runIn(K, E);
      if (Math.abs(play * 1000 - lenMs) > 5000) warn.push(`時計が動いた時間の合計が ${Math.floor(play / 60)}:${String(Math.round(play % 60)).padStart(2, '0')} です（試合の設定は ${lenMs / 60000}分）`);
      info[per.key] = { play, segs: segs.length, lineup, subs: seq.filter((x) => x.type === 'in').length, warn, ok: true };
    }
  }
  return { ops, info, missing: [...missing].sort((a, b) => a - b), vclock };
}
