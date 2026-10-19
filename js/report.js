// マッチレポート（PDF、spec 9章「マッチレポート（PDF）」⑥-4）。A4横で、分析画面と同じ表を1ページずつ並べる。
// 1試合：試合情報・スコア → 出場時間 → タイムライン → マッチ・ペース → スタッツ → セット → パワープレー → 種類別 → 進入 → リカバリー・ロスト → FINISH SET PLAY → ファール・カード
// 複数試合：試合ごとの結果と合計・1試合平均 → 合計のページ → 試合ごとのページ
import { S, watchOps, watchEvents } from './store.js';
import { reportPages, timePage } from './analysis.js';
import { savePdfPages, safeName, preloadPdf } from './pdfsave.js';
import { esc, toast, openModal, closeModal } from './ui.js';

// 2試合以上のときは、まとめのページだけか、試合ごとのページも入れるかを聞く（2026-10-17 決11）。
// 初めの選択：6試合以上は「まとめだけ」（試合ごとのページは1試合で約12ページ。47試合だと約570ページ）
export function printReport(ms, agg = 'sum') {
  if (!ms.length) return;
  preloadPdf();
  if (ms.length < 2) { go(ms, agg, true); return; }
  const def = ms.length > 5 ? 'sum' : 'all';
  const opt = (v, t, sub) => `<label class="rpopt"><input type="radio" name="rpMode" value="${v}" ${v === def ? 'checked' : ''}><span><b>${t}</b><small>${sub}</small></span></label>`;
  const md = openModal(`<h2>マッチレポート（${ms.length}試合）</h2><div class="mbody">
    ${opt('sum', 'まとめのページだけ', `試合ごとの結果と、${ms.length}試合の${agg === 'avg' ? '1試合平均' : '合計'}のページ（約10ページ）`)}
    ${opt('all', 'まとめ＋試合ごとのページ', `まとめのあとに、1試合ずつのページ（1試合で約12ページ、ぜんぶで約${10 + ms.length * 12}ページ）`)}
    </div><div class="mfoot"><button class="btn" data-c>やめる</button><button class="btn pri" data-go>PDFで保存</button></div>`);
  md.querySelector('[data-c]').onclick = closeModal;
  md.querySelector('[data-go]').onclick = () => { const v = md.querySelector('input[name="rpMode"]:checked')?.value || def; closeModal(); go(ms, agg, v === 'all'); };
}
function go(ms, agg, perMatch) {
  const pages = reportPages(ms, agg, { perMatch });
  if (!pages) { toast('記録を読み込んでいます。少し待ってからもう一度押してください'); ms.forEach((m) => { watchOps(m.id); watchEvents(m.id); }); return; }
  const day = (m) => (m.date || '').replace(/-/g, '');
  const name = ms.length === 1 ? `マッチレポート_vs${ms[0].opponent || ''}_${day(ms[0])}` : `マッチレポート_${ms.length}試合_${[...ms.map(day)].sort()[0]}-${[...ms.map(day)].sort().pop()}`;
  // ページを組んで（分かれ目で切れないように振り分けて、用紙いっぱいに広げる）、1枚ずつPDFのページに
  savePdfPages((stage) => { stage.innerHTML = reportHTML(pages); fitPages(stage); const els = [...stage.querySelectorAll('.rpw')]; els.forEach((e) => e.setAttribute('data-pdfpg', '')); return els; },
    `${safeName(name)}.pdf`, { stageCls: 'prrep', quality: ms.length > 5 ? 0.8 : 0.88 });
}

// 分析の出場時間（一覧）を、A4横の1ページだけのPDFに。分けずに、用紙いっぱいの大きさで（2026-10-19）
export function printTime(ms) {
  if (!ms.length) return;
  preloadPdf();
  const pg = timePage(ms);
  if (!pg) { toast('記録を読み込んでいます。少し待ってからもう一度押してください'); ms.forEach((m) => { watchOps(m.id); watchEvents(m.id); }); return; }
  const day = (m) => (m.date || '').replace(/-/g, ''); const ds = ms.map(day).sort();
  const name = ms.length === 1 ? `出場時間_vs${ms[0].opponent || ''}_${day(ms[0])}` : `出場時間_${ms.length}試合_${ds[0]}-${ds[ds.length - 1]}`;
  savePdfPages((stage) => { stage.innerHTML = reportHTML([pg], '出場時間'); const el = stage.querySelector('.rpw'); el.classList.add('rpone'); fitOne(el, new Map(), null, 1.6); el.setAttribute('data-pdfpg', ''); return [el]; },
    `${safeName(name)}.pdf`, { stageCls: 'prrep', margin: 14 });
}

// A4横（余白8mm）＝ 約1062×733px。見出しと下の一行はそのままの大きさで、中身だけを用紙いっぱいに広げる：
// ① 中身を組む幅を 1400px から狭めていき、縮めずに収まる一番大きい倍率を探す（最大1.3倍）
// ② それでも下が余るときは、表の行の高さを少しずつ広げて埋める
// ③ 長い表（複数試合の一覧など）は、読める大きさ（0.55倍）より小さくしないと入らないときは、縮めずに次のページへ続ける
//    （表の見出しの行をくり返し、ページの見出しに「（続き）」。合計などの下の行は最後のページに。2026-10-17 決11）
const PAGE_W = 1062, PAGE_H = 726, MAX_Z = 1.3, MIN_Z = 0.55;
// same：続きのページは、前のページと同じ幅・倍率で入るならそれにそろえる（同じ表の字の大きさが変わらないように）
function fitOne(pg, lastW, same = null, maxZ = MAX_Z) {
  const bx = pg.querySelector('.rpbx'), w = pg.querySelector('.rpin');
  const availH = bx.clientHeight, availW = PAGE_W;
  const fits = (W) => { w.style.width = W + 'px'; const h = w.scrollHeight, sw = w.scrollWidth; const z = Math.min(availW / W, maxZ); return { W, h, z, ok: sw <= W + 2 && h * z <= availH }; };
  if (same) { w.style.width = same.W + 'px'; if (w.scrollWidth <= same.W + 2 && w.scrollHeight * same.z <= availH) { w.style.transform = `scale(${same.z.toFixed(4)})`; return same; } }
  let best = fits(1400);
  if (!best.ok) { // 1400px でも高さが入らない：さらに広く組んで、全体を縮める
    let f = best; for (let W = 1500; W <= 2200; W += 100) { const g = fits(W); if (Math.min(availW / g.W, availH / g.h) > Math.min(availW / f.W, availH / f.h)) f = g; }
    fits(f.W); best = { ...f, z: Math.min(availW / f.W, availH / f.h) };
  } else {
    // 1350px から 25px ずつ狭めて、収まる一番狭い幅（狭いほど高くなるので、収まらなくなったらその先も収まらない）。
    // 1つずつ試す代わりに二分探索で同じ幅を探す（組み直しの回数を約20回 → 5回に）。
    // 同じ見出しのページ（試合ごとの同じ表）は同じ幅になることが多いので、前のページの幅から確かめる
    const Ws = []; for (let W = 1350; W >= availW / maxZ; W -= 25) Ws.push(W);
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
  return best;
}
// 分けられる表：本文の中で行（tbody の行）が一番多い表
function longTable(pg) {
  let best = null, n = 0;
  pg.querySelectorAll('.rpbody table').forEach((t) => { if (t.closest('svg')) return; const k = [...t.tBodies].reduce((a, b) => a + b.rows.length, 0); if (k > n) { best = t; n = k; } });
  return best && n >= 6 ? best : null;
}
const bodyRows = (t) => [...t.tBodies].flatMap((b) => [...b.rows]);
// el から .rpbody までの、前（dir='previousSibling'）か後ろ（'nextSibling'）にあるものを消す（el を含む枝は残す）
function cutSiblings(el, stop, dir) {
  for (let x = el; x && x !== stop; x = x.parentNode) { let y = x[dir]; while (y) { const z = y[dir]; y.remove(); y = z; } }
}
// 表の k 行目から先を次のページへ。最初のページには、表の前のもの＋k行まで（合計の行・表のあとのものは次へ）。
// k が小さい（表の前のものだけで埋まる）ときは、表をまるごと次のページへ。返り値：次のページ（まだ組んでいない）
function splitPage(pg, t, k) {
  const tables = [...pg.querySelectorAll('.rpbody table')]; const ti = tables.indexOf(t);
  const nx = pg.cloneNode(true);
  const body = pg.querySelector('.rpbody'), nbody = nx.querySelector('.rpbody');
  const nt = [...nx.querySelectorAll('.rpbody table')][ti];
  // このページ：表のあとを消す
  cutSiblings(t, body, 'nextSibling');
  if (k <= 0) { let x = t; while (x.parentNode !== body && x.parentNode.childNodes.length === 1) x = x.parentNode; x.remove(); }
  else { bodyRows(t).slice(k).forEach((r) => r.remove()); t.tFoot?.remove(); }
  // 次のページ：表の前を消して、表は k 行目から（見出しの行はそのまま＝くり返し）
  // 表をまるごと送るときは、すぐ上の見出し（h3）も一緒に
  const h = k <= 0 && t.previousElementSibling && /^H[34]$/.test(t.previousElementSibling.tagName) ? t.previousElementSibling : null;
  if (h) h.remove();
  cutSiblings(nt, nbody, 'previousSibling');
  if (h) nt.before(h.cloneNode(true));
  bodyRows(nt).slice(0, Math.max(0, k)).forEach((r) => r.remove());
  const ttl = nx.querySelector('.rpttl'); if (ttl && !/（続き）$/.test(ttl.textContent)) ttl.textContent += '（続き）';
  // 測るための幅・行の高さ・倍率は組み直す
  for (const q of [pg, nx]) { const w = q.querySelector('.rpin'); w.style.width = ''; w.style.transform = ''; q.querySelectorAll('tr').forEach((r) => { r.style.height = ''; }); }
  pg.after(nx);
  return nx;
}
// 表の前に（ページの本文の中で）何かあるか
function hasBefore(pg, t) {
  const body = pg.querySelector('.rpbody');
  const hd = t.previousElementSibling && /^H[34]$/.test(t.previousElementSibling.tagName) ? t.previousElementSibling : null; // すぐ上の見出しは表と一緒に動くので数えない
  for (let x = t; x && x !== body; x = x.parentNode) for (let y = x.previousSibling; y; y = y.previousSibling) if (y !== hd && (y.nodeType === 1 || (y.nodeType === 3 && y.textContent.trim()))) return true;
  return false;
}
// 0.55倍で入る行の数（表の前のものと見出しの行を入れて）。入らなければ 0、幅が入らないときは -1
function rowsThatFit(pg, t) {
  const bx = pg.querySelector('.rpbx'), w = pg.querySelector('.rpin');
  const availH = bx.clientHeight, Wm = Math.floor(PAGE_W / MIN_Z);
  const body = pg.querySelector('.rpbody');
  // 表のあとのもの・合計の行は、このページには入れないので、測るときは隠す
  const after = []; for (let x = t; x && x !== body; x = x.parentNode) for (let y = x.nextSibling; y; y = y.nextSibling) if (y.nodeType === 1) after.push(y);
  const hide = [...after, ...(t.tFoot ? [t.tFoot] : [])]; const hd = hide.map((e) => e.style.display); hide.forEach((e) => { e.style.display = 'none'; });
  const rows = bodyRows(t); const rd = rows.map((r) => r.style.display);
  w.style.width = Wm + 'px'; w.style.transform = '';
  const ok = (k) => { rows.forEach((r, i) => { r.style.display = i < k ? rd[i] : 'none'; }); return w.scrollWidth <= Wm + 2 && w.scrollHeight * MIN_Z <= availH; };
  let res;
  if (!ok(1)) res = ok(0) || w.scrollWidth <= Wm + 2 ? 0 : -1;
  else { let lo = 1, hi = rows.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (ok(m)) lo = m; else hi = m - 1; } res = lo; }
  rows.forEach((r, i) => { r.style.display = rd[i]; }); hide.forEach((e, i) => { e.style.display = hd[i]; });
  return res;
}
export function fitPages(root) {
  // 試合が多いとページが数百になる：ページを1枚ずつ出して測る（まだ測っていないページは組まないので、測るたびの組み直しが1ページぶんで済む）
  const pgs = [...root.querySelectorAll('.rpw')];
  const lastW = new Map(); // ページの見出し → 前に決まった幅
  const disp = new Map(pgs.map((pg) => [pg, pg.style.display]));
  pgs.forEach((pg) => { pg.style.display = 'none'; });
  const prev = new Map(); // 続きのページ → 前のページの幅と倍率
  for (let i = 0; i < pgs.length; i++) {
    const pg = pgs[i];
    pg.style.display = disp.get(pg) || '';
    const best = fitOne(pg, lastW, prev.get(pg));
    if (best.z >= MIN_Z - 1e-4) continue;
    const t = longTable(pg); if (!t) continue;
    let k = rowsThatFit(pg, t);
    if (k < 0) continue; // 横に長すぎる：分けても入らないので、そのまま縮める
    const n = bodyRows(t).length;
    if (k >= n) continue;
    if (k < 3 && hasBefore(pg, t)) k = 0; // 2行だけ残すより、表をまるごと次のページへ
    else if (k < 1) continue; // 表の前に何もなく、見出しの行と1行でも入らない：分けられないので縮める
    const nx = splitPage(pg, t, k);
    nx.style.display = 'none'; disp.set(nx, '');
    pgs.splice(i + 1, 0, nx);
    const b1 = fitOne(pg, lastW, prev.get(pg));
    prev.set(nx, { W: b1.W, z: b1.z });
  }
  // ページ番号を付け直す
  pgs.forEach((pg, i) => { const no = pg.querySelector('.rpno'); if (no) no.textContent = `${i + 1} / ${pgs.length}`; });
}

export function reportHTML(pages, label = 'マッチレポート') {
  const now = new Date(); const made = `${now.getFullYear()}/${now.getMonth() + 1}/${now.getDate()} ${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')} 作成`;
  const team = esc(S.team?.name || '');
  // 用紙をA4横にする（印刷が終わると #prArea ごと消える）
  return '<style>@media print{@page{size:A4 landscape;margin:8mm}}</style>' + pages.map((p, i) => `<div class="rpw"><div class="rphd"><b class="rpt">${label}</b><span class="rpwho">${team} ${p.who}</span><span class="rpttl">${p.title}</span>${pages.length > 1 ? `<span class="rpno">${i + 1} / ${pages.length}</span>` : ''}</div>
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
      <p class="mu">この試合のすべてを A4横 のPDFにして保存します。PCはそのままダウンロード、iPadは共有の画面で「ファイルに保存」を選びます。試合中（ハーフタイムなど）は、その時点までの記録で作ります。複数の試合をまとめるときは、分析画面の「書き出し」から書き出せます。</p>
      <div class="card"><div class="scrow"><button class="btn pri" id="rpGo">マッチレポートをPDFで保存</button></div>
      <ol class="dsl"><li><b>試合情報・スコア・チームスタッツ</b>：得点者・アシスト、両チームの比較（SZ内シュート・FINISH SET PLAYの内訳つき）</li>
      <li><b>出場時間と出場回数</b>（上に棒グラフ、下に表）</li><li><b>出場タイムライン</b></li><li><b>マッチ・ペース</b>（1分ごと）</li>
      ${has ? `<li><b>スタッツ（まとめ）</b>：進入関与・パスの出し手・受け手を含む</li><li><b>セットの集計</b></li><li><b>パワープレー</b></li><li><b>種類別</b></li>
      <li><b>進入</b>（方法、パスの出し手・受け手）</li><li><b>リカバリーとロスト</b>（ゾーン別）</li><li><b>FINISH SET PLAY の内訳</b></li><li><b>ファールとカード</b></li>` : '<li class="mu">スタッツなどのページは、イベントを入力すると入ります</li>'}</ol>
      <p class="mu sm">中身は分析画面と同じ計算です（前半・後半とパワープレーは分けず、試合全体）。</p></div></div>`,
    bind: (root) => {
      preloadPdf(); root.querySelector('#rpGo').onclick = () => printReport([m]);
      // 試合ページの「マッチレポート（PDF）」から来たときは、すぐ保存する
      if (location.hash.endsWith('/pdf')) { history.replaceState(null, '', `#/m/${m.id}/report`); setTimeout(() => printReport([m]), 300); }
    },
  };
}
