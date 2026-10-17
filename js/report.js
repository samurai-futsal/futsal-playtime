// マッチレポート（PDF、spec 9章「マッチレポート（PDF）」⑥-4）。A4横で、分析画面と同じ表を1ページずつ並べる。
// 1試合：試合情報・スコア → 出場時間 → タイムライン → マッチ・ペース → スタッツ → セット → パワープレー → 種類別 → 進入 → リカバリー・ロスト → FINISH SET PLAY → ファール・カード
// 複数試合：試合ごとの結果と合計・1試合平均 → 合計のページ → 試合ごとのページ
import { S, watchOps, watchEvents } from './store.js';
import { reportPages } from './analysis.js';
import { printPages } from './stats.js';
import { esc, toast } from './ui.js';

export function printReport(ms, agg = 'sum') {
  if (!ms.length) return;
  const pages = reportPages(ms, agg);
  if (!pages) { toast('記録を読み込んでいます。少し待ってからもう一度押してください'); ms.forEach((m) => { watchOps(m.id); watchEvents(m.id); }); return; }
  printPages(reportHTML(pages), 'prrep', fitPages);
}

// A4横（余白8mm）＝ 約1062×733px。見出しと下の一行はそのままの大きさで、中身だけを用紙いっぱいに広げる：
// ① 中身を組む幅を 1400px から狭めていき、縮めずに収まる一番大きい倍率を探す（最大1.3倍）
// ② それでも下が余るときは、表の行の高さを少しずつ広げて埋める
const PAGE_W = 1062, PAGE_H = 726, MAX_Z = 1.3;
export function fitPages(root) {
  // 試合が多いとページが数百になる：ページを1枚ずつ出して測る（まだ測っていないページは組まないので、測るたびの組み直しが1ページぶんで済む）
  const pgs = [...root.querySelectorAll('.rpw')];
  const lastW = new Map(); // ページの見出し → 前に決まった幅
  const disp = pgs.map((pg) => pg.style.display);
  pgs.forEach((pg) => { pg.style.display = 'none'; });
  pgs.forEach((pg, i) => {
    pg.style.display = disp[i];
    const bx = pg.querySelector('.rpbx'), w = pg.querySelector('.rpin');
    const availH = bx.clientHeight, availW = PAGE_W;
    const fits = (W) => { w.style.width = W + 'px'; const h = w.scrollHeight, sw = w.scrollWidth; const z = Math.min(availW / W, MAX_Z); return { W, h, z, ok: sw <= W + 2 && h * z <= availH }; };
    let best = fits(1400);
    if (!best.ok) { // 1400px でも高さが入らない：さらに広く組んで、全体を縮める
      let f = best; for (let W = 1500; W <= 2200; W += 100) { const g = fits(W); if (Math.min(availW / g.W, availH / g.h) > Math.min(availW / f.W, availH / f.h)) f = g; }
      fits(f.W); best = { ...f, z: Math.min(availW / f.W, availH / f.h) };
    } else {
      // 1350px から 25px ずつ狭めて、収まる一番狭い幅（狭いほど高くなるので、収まらなくなったらその先も収まらない）。
      // 1つずつ試す代わりに二分探索で同じ幅を探す（組み直しの回数を約20回 → 5回に）。
      // 同じ見出しのページ（試合ごとの同じ表）は同じ幅になることが多いので、前のページの幅から確かめる
      const Ws = []; for (let W = 1350; W >= availW / MAX_Z; W -= 25) Ws.push(W);
      let lo = 0, hi = Ws.length; // Ws[0..lo) は収まる、Ws[hi..] は収まらない
      const memo = new Map();
      const test = (i) => { const g = fits(Ws[i]); memo.set(i, g); if (g.ok) lo = Math.max(lo, i + 1); else hi = Math.min(hi, i); };
      const title = pg.querySelector('.rpttl')?.textContent || ''; const gi = Ws.indexOf(lastW.get(title));
      if (gi >= 0) { test(gi); if (lo === gi + 1 && gi + 1 < hi) test(gi + 1); }
      while (lo < hi) test((lo + hi) >> 1);
      if (lo > 0) { best = memo.get(lo - 1) || fits(Ws[lo - 1]); lastW.set(title, best.W); }
      fits(best.W);
      // 余った高さを、表の行に配る（1行につき最大40px）
      const rows = [...w.querySelectorAll('.rpbody table tr')].filter((r) => !r.closest('svg'));
      const spare = availH / best.z - w.scrollHeight - 4;
      if (rows.length && spare > 8) {
        const add = Math.min(40, spare / rows.length);
        const hs = rows.map((r) => r.getBoundingClientRect().height);
        rows.forEach((r, k) => { r.style.height = (hs[k] + add).toFixed(1) + 'px'; });
        if (w.scrollHeight * best.z > availH - 4) rows.forEach((r) => { r.style.height = ''; });
      }
    }
    w.style.transform = `scale(${best.z.toFixed(4)})`;
  });
}

export function reportHTML(pages) {
  const now = new Date(); const made = `${now.getFullYear()}/${now.getMonth() + 1}/${now.getDate()} ${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')} 作成`;
  const team = esc(S.team?.name || '');
  // 用紙をA4横にする（印刷が終わると #prArea ごと消える）
  return '<style>@media print{@page{size:A4 landscape;margin:8mm}}</style>' + pages.map((p, i) => `<div class="rpw"><div class="rphd"><b class="rpt">マッチレポート</b><span class="rpwho">${team} ${p.who}</span><span class="rpttl">${p.title}</span><span class="rpno">${i + 1} / ${pages.length}</span></div>
    <div class="rpbx"><div class="rpin"><div class="rpbody">${p.html}</div></div></div><div class="rpft">${made}。MATCH PLAYとイベント入力の記録から作成（分析画面と同じ計算）</div></div>`).join('');
}

// 試合ページの「マッチレポート（PDF）」から開く画面
export function vReport(m) {
  watchOps(m.id); watchEvents(m.id);
  const has = watchEvents(m.id).list.some((e) => !e.deleted);
  return {
    active: 'acts',
    html: `<div class="scw"><div class="crumb"><a class="btn sm mpback" href="#/m/${m.id}">‹ 試合ページ</a><a href="#/m/${m.id}">vs ${esc(m.opponent)}</a> › マッチレポート（PDF）</div>
      <h1>マッチレポート（PDF）</h1>
      <p class="mu">この試合のすべてを A4横 で書き出します。印刷の画面で「PDFとして保存」を選びます（iPadは共有 → 「ファイルに保存」）。試合中（ハーフタイムなど）は、その時点までの記録で作ります。複数の試合をまとめるときは、分析画面の「書き出し」から書き出せます。</p>
      <div class="card"><div class="scrow"><button class="btn pri" id="rpGo">マッチレポートを書き出す（PDF）</button></div>
      <ol class="dsl"><li><b>試合情報・スコア・チームスタッツ</b>：得点者・アシスト、両チームの比較（SZ内シュート・FINISH SET PLAYの内訳つき）</li>
      <li><b>出場時間と出場回数</b>（上に棒グラフ、下に表）</li><li><b>出場タイムライン</b></li><li><b>マッチ・ペース</b>（1分ごと）</li>
      ${has ? `<li><b>スタッツ（まとめ）</b>：進入関与・パスの出し手・受け手を含む</li><li><b>セットの集計</b></li><li><b>パワープレー</b></li><li><b>種類別</b></li>
      <li><b>進入</b>（方法、パスの出し手・受け手）</li><li><b>リカバリーとロスト</b>（ゾーン別）</li><li><b>FINISH SET PLAY の内訳</b></li><li><b>ファールとカード</b></li>` : '<li class="mu">スタッツなどのページは、イベントを入力すると入ります</li>'}</ol>
      <p class="mu sm">中身は分析画面と同じ計算です（前半・後半とパワープレーは分けず、試合全体）。</p></div></div>`,
    bind: (root) => { root.querySelector('#rpGo').onclick = () => printReport([m]); },
  };
}
