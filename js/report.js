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

// A4横（余白8mm）＝ 約1062×733px。1ページを幅1400pxで組み、高さがはみ出すページはさらに縮める
const PAGE_W = 1062, PAGE_H = 728, DESIGN_W = 1400;
export function fitPages(root) {
  root.querySelectorAll('.rpin').forEach((w) => {
    const h = w.scrollHeight, wd = Math.max(DESIGN_W, w.scrollWidth);
    const z = Math.min(PAGE_W / wd, PAGE_H / h);
    w.style.transform = `scale(${z.toFixed(4)})`;
  });
}

export function reportHTML(pages) {
  const now = new Date(); const made = `${now.getFullYear()}/${now.getMonth() + 1}/${now.getDate()} ${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')} 作成`;
  const team = esc(S.team?.name || '');
  // 用紙をA4横にする（印刷が終わると #prArea ごと消える）
  return '<style>@media print{@page{size:A4 landscape;margin:8mm}}</style>' + pages.map((p, i) => `<div class="rpw"><div class="rpin"><div class="rphd"><b class="rpt">マッチレポート</b><span class="rpwho">${team} ${p.who}</span><span class="rpttl">${p.title}</span><span class="rpno">${i + 1} / ${pages.length}</span></div>
    <div class="rpbody">${p.html}</div><div class="rpft">${made}。MATCH PLAYとイベント入力の記録から作成（分析画面と同じ計算）</div></div></div>`).join('');
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
