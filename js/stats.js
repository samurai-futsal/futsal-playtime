// マッチスタッツ（spec 7章・9章「マッチスタッツ（PDF）」、2026-10-16 決定）。
// いつも使っているシート（リニューアル版）の形：上段＝シュート・進入・FINISH SET PLAY の中身、下段＝時間帯。
// 「試合全体／前半／後半」で範囲を切り替える。「PDFで保存」はPDFのファイルを作って保存する（js/pdfsave.js）。
import { S, watchOps, watchEvents, opts, teamSettings, activityById } from './store.js';
import { periodLabel } from './engine.js';
import { modelOf } from './model.js';
import { todoCount } from './events.js';
import { teamStats, asOfLabel } from './teamstats.js';
import { esc, fmtDate, toast } from './ui.js';
import { render } from './views.js';
import { openTodo } from './evinput.js';
import { savePdf, safeName, preloadPdf } from './pdfsave.js';
import { bigBtn, bindBig, bigOn } from './bigview.js';

let range = 'all';


// PDFで保存：1試合を2ページに（上の表＝シュート・進入・FINISH SET PLAY の中身、下の表＝時間帯）。各ページいっぱいに大きく
export function statsItems(sheet, foot) {
  const d = document.createElement('div'); d.innerHTML = `<div class="stpage">${sheet}${foot}</div>`;
  const n = d.querySelectorAll('.sttier').length;
  return Array.from({ length: Math.max(1, n) }, (_, i) => {
    const c = d.firstElementChild.cloneNode(true);
    c.querySelectorAll('.sttier').forEach((t, k) => { if (k !== i) t.remove(); });
    return { html: c.outerHTML, widths: [900], shrink: sheetW, fix: stretchRows };
  });
}
// ページの幅：真ん中の表（.stt）の幅に、左右の少しの余白を足す
function sheetW(el) { el.style.width = '900px'; return Math.max(...[...el.querySelectorAll('.stt')].map((t) => t.offsetWidth)) + 40; }
// 下が余るときは、表の行を少しずつ高くしてページの縦いっぱいに（1行につき最大14px）
function stretchRows(el, W, aw, ah) {
  const rows = [...el.querySelectorAll('.stt tr')];
  rows.forEach((r) => { r.style.height = ''; });
  const spare = el.offsetWidth * ah / aw - el.offsetHeight - 4;
  if (!rows.length || spare < 8) return;
  const add = Math.min(14, spare / rows.length);
  const hs = rows.map((r) => r.getBoundingClientRect().height);
  rows.forEach((r, k) => { r.style.height = (hs[k] + add).toFixed(1) + 'px'; });
}
export function statsFileName(ms, range = 'all') {
  const day = (m) => (m.date || '').replace(/-/g, '');
  if (ms.length === 1) return `${safeName(`マッチスタッツ_vs${ms[0].opponent || ''}_${day(ms[0])}${range === 'all' ? '' : '_' + periodLabel(range)}`)}.pdf`;
  return `${safeName(`マッチスタッツ_${ms.length}試合_${day(ms[ms.length - 1])}-${day(ms[0])}`)}.pdf`;
}
// 分析画面から：選んだ試合を1試合2ページずつ
export function printStats(ms) {
  const pages = ms.map((m) => calc(m, 'all'));
  if (pages.some((x) => !x)) { toast('記録を読み込んでいます。少し待ってからもう一度押してください'); ms.forEach((m) => { watchOps(m.id); watchEvents(m.id); }); return; }
  savePdf(pages.flatMap((x) => statsItems(x.sheet, x.foot)), statsFileName(ms), { stageCls: 'stw' });
}
function calc(m, range0) {
  let range = range0;
  const opsC = watchOps(m.id); const evC = watchEvents(m.id);
  if (!opsC.ready && !opsC.list.length) return null;
  const cfg = { times: m.times || {}, members: m.members || {}, timesFixed: !!m.timesFixed, setplayAuto: teamSettings().setplayAuto || 60 };
  const { M } = modelOf(opsC.list, cfg, m.fix);
  const goalName = (id) => opts('goalTypes', true).find((o) => o.id === id)?.name || '';
  const evs = evC.list.filter((e) => !e.deleted);
  const shownP = M.periods.filter((p) => p.status !== 'none');
  if (range !== 'all' && !shownP.some((p) => p.key === range)) range = 'all';
  const keys = range === 'all' ? null : [range];
  const R = teamStats(M, evs, goalName, keys);
  const own = S.team?.name || '自チーム', opp = m.opponent || '相手';
  const todo = todoCount(evs, goalName);

  // 時点：どこまでの記録か（最後に終わったピリオドから。マッチレビュー・マッチレポートと同じ）
  const asOf = asOfLabel(M);
  const now = new Date(); const hm = `${now.getHours()}時${String(now.getMinutes()).padStart(2, '0')}分`;
  const rangeLabel = range === 'all' ? '試合全体' : periodLabel(range);

  const act = activityById(m.activityId);
  const sheet = sheetHTML({ R, M, keys, own, opp, game: [act?.name, m.category].filter(Boolean).join(' '), place: m.venue || '', day: (m.date || '').replace(/-/g, '/'), possession: m.possession, pk: m.pk });
  const foot = `<div class="stft">${esc(own)} vs ${esc(opp)}　${esc(fmtDate(m.date))}　${rangeLabel}・${asOf}。MATCH PLAYとイベント入力の記録から作成${M.fixed.length ? '（記録の修正を反映）' : ''}。グレーの「—」＝記録がない項目、「未入力 n」＝その数だけ項目が入っていないもの（内訳に数えていない）。時間帯は試合の時計（プレーイングタイム）</div>`;
  return { M, R, evs, todo, asOf, hm, shownP, sheet, foot, range };
}

// 表の大きさ（2026-10-18）：上の表・下の表を「1ページ」ずつ、画面に入る一番大きい倍率に（2つは同じ倍率＝同じ文字の大きさ）。
// ・通常表示：上下に並べる。1ページが、上の帯を除いた画面の高さと幅に入る大きさ
// ・縮小表示：2ページを左右に並べて、1画面に両方が入る大きさ（マッチレビューの縮小表示と同じ考え方。広い画面のとき）
// ・拡大表示：上下に並べて、1ページずつ画面いっぱい（ページごとの倍率。縦が余るときは行を少し高く）
// 高さで決まって横が余るときは、真ん中の表を横に広げる（項目名の列と棒を長く・文字を少し大きく。--k）
const BASE = 900;
const compactKey = 'fpt.statsCompact';
const isCompact = () => { try { return localStorage.getItem(compactKey) === '1'; } catch { return false; } };
function fitSheet(root) {
  const pg = root.querySelector('.stpage'); const sh = pg?.querySelector('.stsheet'); if (!pg || !sh) return;
  const big = bigOn(); const compact = !big && isCompact();
  const tiers = [...sh.querySelectorAll('.sttier')];
  pg.style.zoom = ''; pg.style.width = ''; sh.classList.remove('cols2');
  tiers.forEach((t) => { t.style.minHeight = ''; t.style.zoom = ''; t.style.width = ''; t.querySelector('.stt')?.style.removeProperty('--k'); t.querySelectorAll('.stt tr').forEach((r) => { r.style.height = ''; }); });
  document.documentElement.style.scrollPaddingTop = '';
  const ps = getComputedStyle(pg); const inW = pg.clientWidth - parseFloat(ps.paddingLeft) - parseFloat(ps.paddingRight);
  const topH = big ? (root.querySelector('.sthead')?.offsetHeight || 0) : (document.querySelector('.bar')?.offsetHeight || 0);
  const availH = window.innerHeight - topH - (big ? 8 : 40);
  const gap = 24; const H = availH - 12;
  // 縮小表示：2ページが両方とも1画面（この表の上端から画面の下まで）に入る大きさ。広い画面は左右に、狭い画面は上下に並べる
  const Hc = window.innerHeight - (sh.getBoundingClientRect().top + window.scrollY) - 24;
  const cols = compact && inW >= 1000 ? 2 : 1;
  if (cols === 2) sh.classList.add('cols2');
  const colW = (inW - gap * (cols - 1)) / cols;
  const setK = (t, w) => { const stt = t.querySelector('.stt'); if (!stt) return; stt.style.removeProperty('--k'); const k = Math.max(1, Math.min(1.9, (w - 40) / stt.offsetWidth)); stt.style.setProperty('--k', k.toFixed(3)); };
  const lay = (ts, w) => ts.reduce((a, t) => { t.style.width = w + 'px'; setK(t, w); return a + t.offsetHeight; }, 0);
  // ts（1つ、または上下に重ねる全部）が、幅 colW・高さ Hm に入る倍率（横に広げると行が少し高くなることがあるので、入るまで合わせ直す）
  const solve = (ts, Hm) => {
    const base = Math.min(BASE, colW);
    let z = Math.max(0.4, Math.min(2.2, colW / base, Hm / lay(ts, base)));
    for (let i = 0; i < 5; i++) { const h = lay(ts, colW / z); if (h * z <= Hm + 1) break; z = Math.max(0.4, Hm / h); }
    return z;
  };
  const zs = big ? tiers.map((t) => solve([t], H)) : null;
  const zAll = big ? 0 : compact ? (cols === 2 ? Math.min(...tiers.map((t) => solve([t], Hc))) : solve(tiers, Hc - gap * (tiers.length - 1))) : Math.min(...tiers.map((t) => solve([t], H)));
  tiers.forEach((t, i) => {
    const z = big ? zs[i] : zAll;
    t.style.width = colW / z + 'px'; setK(t, colW / z); t.style.zoom = z.toFixed(3);
  });
  // 縦の余り：拡大表示は1ページずつ画面の縦いっぱいに、通常・縮小表示は短い方のページを長い方の高さにそろえる（1行につき最大14px）
  const target = big ? null : Math.max(...tiers.map((t) => t.offsetHeight * zAll));
  tiers.forEach((t, i) => {
    const z = big ? zs[i] : zAll; const stt = t.querySelector('.stt'); const rows = stt ? [...stt.querySelectorAll('tr')] : [];
    const spare = (big ? H : target) / z - t.offsetHeight;
    if (rows.length && spare > 8 && !(compact && cols === 1)) { const add = Math.min(14, spare / rows.length); const hs = rows.map((r) => r.getBoundingClientRect().height / z); rows.forEach((r, k) => { r.style.height = (hs[k] + add).toFixed(1) + 'px'; }); }
    if (big) t.style.minHeight = `${(availH - 4) / z}px`;
  });
  if (big) document.documentElement.style.scrollPaddingTop = topH + 'px';
}
if (typeof window !== 'undefined' && !window.__stfit) {
  window.__stfit = true;
  let t = null; window.addEventListener('resize', () => { const r = document.querySelector('.stw'); if (!r || bigOn()) return; clearTimeout(t); t = setTimeout(() => fitSheet(r.parentElement), 150); });
  window.addEventListener('hashchange', () => { document.documentElement.style.scrollPaddingTop = ''; });
}
export function vStats(m) {
  const x = calc(m, range);
  if (!x) return { active: 'acts', html: '<p class="mu pad">読み込み中…</p>' };
  const { R, evs, todo, asOf, hm, shownP, sheet, foot } = x; range = x.range;
  const segs = [['all', '試合全体'], ...shownP.map((p) => [p.key, p.label])].map(([k, l]) => `<button class="${range === k ? 'on' : ''}" data-range="${k}">${l}</button>`).join('');
  const status = !R.hasEvents ? '<span class="ststat none">イベントがまだ入力されていません（数字はすべて「—」）</span>'
    : todo ? `<button class="ststat todo" id="stTodo">イベント ${evs.length}件・未入力あり ${todo}件 ›</button>` : `<span class="ststat ok">イベント ${evs.length}件・未入力なし</span>`;
  const head = `<div class="crumb noprint"><a class="btn sm mpback" href="#/m/${m.id}">‹ 試合ページ</a><a href="#/m/${m.id}">vs ${esc(m.opponent)}</a> › マッチスタッツ</div>
    <div class="sthead noprint"><h1>マッチスタッツ</h1><span class="rvmode strange">${segs}</span><span class="stasof">${asOf}（${hm}に表示）</span>${status}<span class="sp"></span>
      <span class="stbtns"><button class="btn" id="stPdf">PDFで保存</button><span class="rvzoom">${bigOn() ? '' : `<button class="btn" id="stCompact">${isCompact() ? '通常の表示' : '縮小表示'}</button>`}${bigBtn()}</span><a class="btn pri" href="#/m/${m.id}/review">マッチレビュー ›</a></span></div>`;

  return {
    active: 'acts',
    html: `<div class="stw">${head}<div class="stpage">${sheet}${foot}</div></div>`,
    bind: (root) => {
      root.querySelectorAll('[data-range]').forEach((b) => b.onclick = () => { range = b.dataset.range; render(); });
      preloadPdf();
      const save = () => savePdf(statsItems(sheet, foot), statsFileName([m], range), { stageCls: 'stw' });
      root.querySelector('#stPdf').onclick = save;
      // 試合ページの「マッチスタッツ（PDF）」から来たときは、すぐ保存する
      if (location.hash.endsWith('/print')) { history.replaceState(null, '', `#/m/${m.id}/stats`); setTimeout(save, 300); }
      const t = root.querySelector('#stTodo'); if (t) t.onclick = () => { openTodo(m.id); location.hash = `#/m/${m.id}/events`; };
      bindBig(root, fitSheet);
      if (!bigOn()) fitSheet(root);
      const cb = root.querySelector('#stCompact'); if (cb) cb.onclick = () => { try { localStorage.setItem(compactKey, isCompact() ? '0' : '1'); } catch {} render(); };
    },
  };
}

// シート（上段・下段）。R = teamStats の結果
export function sheetHTML({ R, M, keys, own, opp, game, place, day, possession, pk = null }) {
  const { A, B } = R; const has = R.hasEvents;
  const v = (x) => (has ? x : null);
  // スコアの行：選んだ範囲（試合全体／前半／後半）のピリオドだけ。まだ行っていないピリオドは空欄
  const ps = M.periods.filter((p) => (!p.extra || p.status !== 'none') && (!keys || keys.includes(p.key)));
  const hd = `<table class="sthd"><tr><td class="g gm">GAME</td><td class="g">TM</td><td class="w">${esc(game)}</td><td class="g">PLACE</td><td>${esc(place)}</td><td class="g">DAY</td><td>${esc(day)}</td></tr></table>`;
  const sc = (p, side) => (!has ? '<span class="na">—</span>' : p.status === 'none' ? '' : R.score[side][p.key] ?? 0);
  const scTot = (side) => (has ? (keys ? R.rangeScore[side] : Object.values(R.score[side]).reduce((a, b) => a + b, 0)) : '<span class="na">—</span>');
  const scRows = ps.map((p, i) => `<tr>${i === 0 ? `<td class="sttm" rowspan="${ps.length}">${esc(own)}</td><td class="stbig" rowspan="${ps.length}">${scTot('own')}</td>` : ''}<td class="stp">${sc(p, 'own')}</td><td class="stp">${p.label}</td><td class="stp">${sc(p, 'opp')}</td>${i === 0 ? `<td class="stbig" rowspan="${ps.length}">${scTot('opp')}</td><td class="sttm" rowspan="${ps.length}">${esc(opp)}</td>` : ''}</tr>`).join('');
  const scT = `<table class="stsc">${scRows}</table>${pk && !keys ? `<div class="stpk">PK ${pk.own ?? 0}−${pk.opp ?? 0}</div>` : ''}`;
  const pos = `<table class="stpos"><tr><td></td><td class="py">ポゼッション率</td><td></td></tr><tr><td>${possession != null ? possession + '%' : '<span class="na">—</span>'}</td><td class="pl">${possession != null ? '' : '（記録なし）'}</td><td>${possession != null ? (100 - possession) + '%' : '<span class="na">—</span>'}</td></tr></table>`;
  const max = Math.max(1, A.shots, B.shots, A.z4, B.z4, A.fsp, B.fsp);
  const W = (x) => Math.round(x / max * 118);
  const tier = (top) => {
    const rows = [];
    const sec = (t, c) => rows.push(`<tr class="sec"><td></td><td colspan="3" style="background:${c}">${t}</td><td></td></tr>`);
    // na：その内訳がすべて未入力（数字の代わりにグレーの「—」。7章「未入力の表示」）
    const row = (label, a, b, { bold = false, ma = 0, mb = 0, naA = false, naB = false } = {}) => {
      a = naA ? null : v(a); b = naB ? null : v(b);
      const cell = (x, mi) => (x == null ? '<span class="na">—</span>' : x) + (has && mi ? `<div class="miss">未入力 ${mi}</div>` : '');
      rows.push(`<tr class="${bold ? 'b' : ''}"><td class="bl"><i style="width:${a == null ? 0 : W(a)}px"></i></td><td class="v">${cell(a, ma)}</td><td class="lb">${label}</td><td class="v">${cell(b, mb)}</td><td class="br"><i style="width:${b == null ? 0 : W(b)}px"></i></td></tr>`);
    };
    const allNA = (miss, n) => n > 0 && miss === n;
    const clsL = ['定位置', 'セットプレー(6m/10m含む)', 'トランジション', 'GK活用', '特殊局面'];
    if (top) {
      sec('シュート数', '#1F3FFF'); row('シュート', A.shots, B.shots, { bold: true });
      sec('シュートエリア', '#7FD3F7'); row('スコアゾーン内シュート', A.sz, B.sz, { ma: A.szMiss, mb: B.szMiss, naA: allNA(A.szMiss, A.shots), naB: allNA(B.szMiss, B.shots) });
      const nNA = { ma: A.nMiss, mb: B.nMiss, naA: allNA(A.nMiss, A.outN), naB: allNA(B.nMiss, B.outN) };
      row('スコアゾーン外S/ゾーン内に人有', A.with, B.with, nNA); row('スコアゾーン外S/ゾーン内に人無', A.without, B.without, nNA);
      const rNA = { naA: allNA(A.resMiss, A.shots), naB: allNA(B.resMiss, B.shots) };
      sec('シュート結末', '#7FD3F7'); row('枠内(ゴール含む)', A.in, B.in, { ma: A.resMiss, mb: B.resMiss, ...rNA }); row('枠外(ポスト含む)', A.out, B.out, rNA); row('ブロック', A.block, B.block, rNA);
      const cNA = { naA: allNA(A.clsMiss, A.shots), naB: allNA(B.clsMiss, B.shots) };
      sec('シュート分類', '#7FD3F7'); clsL.forEach((l, i) => row(l, A.cls[i], B.cls[i], i === 0 ? { ma: A.clsMiss, mb: B.clsMiss, ...cNA } : cNA));
      sec('ゾーン進入', '#FF0000'); row('ゾーン4進入', A.z4, B.z4, { bold: true }); row('スコアゾーン進入', A.szE, B.szE, { bold: true });
      const zNA = { naA: allNA(A.zclsMiss, A.z4), naB: allNA(B.zclsMiss, B.z4) };
      sec('Z4進入分類', '#F08080'); clsL.forEach((l, i) => row(l, A.zcls[i], B.zcls[i], i === 0 ? { ma: A.zclsMiss, mb: B.zclsMiss, ...zNA } : zNA));
      const fNA = { naA: allNA(A.fspMiss, A.fsp), naB: allNA(B.fspMiss, B.fsp) };
      sec('FINISH SET PLAY', '#00B050'); row('FINISH SET PLAY 合計', A.fsp, B.fsp, { bold: true, ma: A.fspMiss, mb: B.fspMiss });
      ['CK', 'CK-KICK IN', 'KICK IN', 'FK(6m/10m含む)'].forEach((l, i) => row(l, A.fspT[i], B.fspT[i], fNA));
    } else {
      const bands = R.bands; // 時間帯の名前は試合の長さから（決3・未8）
      sec('シュート数', '#1F3FFF'); row('シュート', A.shots, B.shots, { bold: true });
      sec('シュート時間帯', '#7FD3F7'); bands.forEach((l, i) => row(l, A.shotBand[i], B.shotBand[i]));
      sec('ゾーン進入', '#FF0000'); row('ゾーン4進入', A.z4, B.z4, { bold: true }); row('スコアゾーン進入', A.szE, B.szE, { bold: true });
      sec('ゾーン進入時間帯（ゾーン4進入）', '#F08080'); bands.forEach((l, i) => row(l, A.z4Band[i], B.z4Band[i]));
      sec('FINISH SET PLAY', '#00B050'); row('FINISH SET PLAY 合計', A.fsp, B.fsp, { bold: true });
      sec('FINISH SET PLAY 時間帯', '#92D050'); bands.forEach((l, i) => row(l, A.fspBand[i], B.fspBand[i]));
    }
    return `<div class="sttier">${hd}${scT}${top ? pos : ''}<table class="stt">${rows.join('')}</table></div>`;
  };
  return `<div class="stsheet">${tier(true)}${tier(false)}</div>`;
}
