// 動画と試合の時計を合わせる（2026-10-22）。動画は端末の中のファイルをそのまま再生するだけ（どこにも送らない）。
// 合わせ方：ピリオドごとに「動画のこの場面がキックオフ」を1回押す（sync[ピリオド] = { v：動画の秒, name：動画のファイル名 }）。
// あとは MATCH PLAY の記録（時計が動いた・止まった実際の時刻）から、動画の秒 ⇔ 試合の時計（経過 ms）を計算する。
// R：toRunning() の結果（relOf：時計の経過 → キックオフからの実際の時間、elOfRel：その逆。時計が止まっている間は止まった値）

// 動画の秒 v → { period, at }（その動画で合わせたピリオドのうち、キックオフが v より前で一番あとのもの）
export function clockAtVideo(R, periods, sync, name, v) {
  let hit = null;
  for (const p of periods) {
    const s = sync?.[p.key]; if (!s || (s.name != null && s.name !== name) || p.status === 'none') continue; // name が null＝どの動画でも（Sportscode・あとから記録で作った試合）
    if (v + 0.05 >= s.v && (!hit || s.v >= hit.s.v)) hit = { p, s };
  }
  if (!hit) return null;
  const rel = Math.max(0, (v - hit.s.v) * 1000);
  const len = hit.p.len || 0;
  const at = Math.max(0, Math.min(len, Math.round(R.elOfRel(hit.p.key, rel))));
  return { period: hit.p.key, at };
}
// 試合の時計（ピリオド・経過 ms）→ 動画の秒（そのピリオドをこの動画で合わせていないときは null）
export function videoAtClock(R, sync, name, period, at) {
  const s = sync?.[period]; if (!s || (s.name != null && s.name !== name)) return null;
  return s.v + R.relOf(period, at) / 1000;
}
