// マッチスタッツ（spec 7章・9章「マッチスタッツ（PDF）」、2026-10-16 決定）。
// いつも使っているシート（リニューアル版）の形：上段＝シュート・進入・FINISH SET PLAY の中身、下段＝時間帯。
// 「試合全体／前半／後半」で範囲を切り替える。「PDFで書き出す」は印刷の画面から保存する。
import { S, watchOps, watchEvents, opts, teamSettings, activityById } from './store.js';
import { replay, periodLabel, periodLen, nowElapsed } from './engine.js';
import { matchModel, periodSig } from './model.js';
import { todoCount } from './events.js';
import { teamStats } from './teamstats.js';
import { esc, fmtDate, toast } from './ui.js';
import { render } from './views.js';
import { openTodo } from './evinput.js';

let range = 'all';

const mmssUp = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000 - 1e-6)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

// 書き出し（印刷）：選んだ試合のマッチスタッツを1試合1ページで出す（分析画面・試合ページから）
export function printStats(ms) {
  const pages = ms.map((m) => calc(m, 'all'));
  if (pages.some((x) => !x)) { toast('記録を読み込んでいます。少し待ってからもう一度押してください'); ms.forEach((m) => { watchOps(m.id); watchEvents(m.id); }); return; }
  printPages(pages.map((x) => `<div class="stw"><div class="stpage">${x.sheet}${x.foot}</div></div>`).join(''), 'prstats');
}
// 画面の内容とは別に、印刷用のページだけを出す
// prep(d)：印刷の前に、ページの大きさを測って整えるとき（マッチレポート）
export function printPages(html, cls, prep = null) {
  document.querySelector('#prArea')?.remove();
  const d = document.createElement('div'); d.id = 'prArea'; d.className = cls; d.innerHTML = html; document.body.appendChild(d);
  if (prep) { d.classList.add('measure'); prep(d); d.classList.remove('measure'); }
  document.body.classList.add('printing');
  const done = () => { document.body.classList.remove('printing'); d.remove(); removeEventListener('afterprint', done); };
  addEventListener('afterprint', done);
  setTimeout(() => window.print(), 60);
}

function calc(m, range0) {
  let range = range0;
  const opsC = watchOps(m.id); const evC = watchEvents(m.id);
  if (!opsC.ready && !opsC.list.length) return null;
  const cfg = { times: m.times || {}, members: m.members || {}, setplayAuto: teamSettings().setplayAuto || 60 };
  const st = replay(opsC.list, cfg); st.sig = periodSig(opsC.list);
  const M = matchModel(st, Date.now(), m.fix);
  const goalName = (id) => opts('goalTypes', true).find((o) => o.id === id)?.name || '';
  const evs = evC.list.filter((e) => !e.deleted);
  const shownP = M.periods.filter((p) => p.status !== 'none');
  if (range !== 'all' && !shownP.some((p) => p.key === range)) range = 'all';
  const keys = range === 'all' ? null : [range];
  const R = teamStats(M, evs, goalName, keys);
  const own = S.team?.name || '自チーム', opp = m.opponent || '相手';
  const todo = todoCount(evs, goalName);

  // 時点：どこまでの記録か
  const pDone = (k) => st.periods[k]?.status === 'done';
  const asOf = st.matchOver ? '試合終了時点' : M.live ? `${periodLabel(st.current)} 残り ${mmssUp(periodLen(cfg, st.current) - nowElapsed(st))} 時点`
    : (pDone('1H') && !pDone('2H')) ? '前半終了時点' : pDone('2H') ? '後半終了時点' : '試合開始前';
  const now = new Date(); const hm = `${now.getHours()}時${String(now.getMinutes()).padStart(2, '0')}分`;
  const rangeLabel = range === 'all' ? '試合全体' : periodLabel(range);

  const act = activityById(m.activityId);
  const sheet = sheetHTML({ R, M, keys, own, opp, game: [act?.name, m.category].filter(Boolean).join(' '), place: m.venue || '', day: (m.date || '').replace(/-/g, '/'), possession: m.possession });
  const foot = `<div class="stft">${esc(own)} vs ${esc(opp)}　${esc(fmtDate(m.date))}　${rangeLabel}・${asOf}。MATCH PLAYとイベント入力の記録から作成${M.fixed.length ? '（記録の修正を反映）' : ''}。グレーの「—」＝記録がない項目、「未入力 n」＝その数だけ項目が入っていないもの（内訳に数えていない）。時間帯は試合の時計（プレーイングタイム）</div>`;
  return { M, R, evs, todo, asOf, hm, shownP, sheet, foot, range };
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
      <button class="btn" id="stPdf">PDFで書き出す</button><a class="btn pri" href="#/m/${m.id}/review">マッチレビュー ›</a></div>`;

  return {
    active: 'acts',
    html: `<div class="stw">${head}<div class="stpage">${sheet}${foot}</div></div>`,
    bind: (root) => {
      root.querySelectorAll('[data-range]').forEach((b) => b.onclick = () => { range = b.dataset.range; render(); });
      root.querySelector('#stPdf').onclick = () => window.print();
      // 試合ページの「マッチスタッツ（PDF）」から来たときは、すぐ印刷の画面を出す
      if (location.hash.endsWith('/print')) { history.replaceState(null, '', `#/m/${m.id}/stats`); setTimeout(() => window.print(), 300); }
      const t = root.querySelector('#stTodo'); if (t) t.onclick = () => { openTodo(m.id); location.hash = `#/m/${m.id}/events`; };
    },
  };
}

// シート（上段・下段）。R = teamStats の結果
export function sheetHTML({ R, M, keys, own, opp, game, place, day, possession }) {
  const { A, B } = R; const has = R.hasEvents;
  const v = (x) => (has ? x : null);
  const ps = M.periods.filter((p) => !p.extra || p.status !== 'none');
  const hd = `<table class="sthd"><tr><td class="g">GAME</td><td class="w">${esc(game)}</td><td class="g">PLACE</td><td>${esc(place)}</td><td class="g">DAY</td><td>${esc(day)}</td></tr></table>`;
  const sc = (k, side) => (has ? R.score[side][k] ?? 0 : '<span class="na">—</span>');
  const scTot = (side) => (has ? (keys ? R.rangeScore[side] : Object.values(R.score[side]).reduce((a, b) => a + b, 0)) : '<span class="na">—</span>');
  const scRows = ps.map((p, i) => `<tr>${i === 0 ? `<td class="sttm" rowspan="${ps.length}">${esc(own)}</td><td class="stbig" rowspan="${ps.length}">${scTot('own')}</td>` : ''}<td class="stp">${sc(p.key, 'own')}</td><td class="stp">${p.label}</td><td class="stp">${sc(p.key, 'opp')}</td>${i === 0 ? `<td class="stbig" rowspan="${ps.length}">${scTot('opp')}</td><td class="sttm" rowspan="${ps.length}">${esc(opp)}</td>` : ''}</tr>`).join('');
  const scT = `<table class="stsc">${scRows}</table>`;
  const pos = `<table class="stpos"><tr><td></td><td class="py">ポゼッション率</td><td></td></tr><tr><td>${possession != null ? possession + '%' : '<span class="na">—</span>'}</td><td class="pl">${possession != null ? '' : '（記録なし）'}</td><td>${possession != null ? (100 - possession) + '%' : '<span class="na">—</span>'}</td></tr></table>`;
  const max = Math.max(1, A.shots, B.shots, A.z4, B.z4, A.fsp, B.fsp);
  const W = (x) => Math.round(x / max * 118);
  const tier = (top) => {
    const rows = [];
    const sec = (t, c) => rows.push(`<tr class="sec"><td></td><td colspan="3" style="background:${c}">${t}</td><td></td></tr>`);
    const row = (label, a, b, { bold = false, ma = 0, mb = 0 } = {}) => {
      a = v(a); b = v(b);
      const cell = (x, mi) => (x == null ? '<span class="na">—</span>' : x) + (x != null && mi ? `<div class="miss">未入力 ${mi}</div>` : '');
      rows.push(`<tr class="${bold ? 'b' : ''}"><td class="bl"><i style="width:${a == null ? 0 : W(a)}px"></i></td><td class="v">${cell(a, ma)}</td><td class="lb">${label}</td><td class="v">${cell(b, mb)}</td><td class="br"><i style="width:${b == null ? 0 : W(b)}px"></i></td></tr>`);
    };
    const clsL = ['定位置', 'セットプレー(6m/10m含む)', 'トランジション', 'GK活用', '特殊局面'];
    if (top) {
      sec('シュート数', '#1F3FFF'); row('シュート', A.shots, B.shots, { bold: true });
      sec('シュートエリア', '#7FD3F7'); row('スコアゾーン内シュート', A.sz, B.sz);
      row('スコアゾーン外S/ゾーン内に人有', A.with, B.with, { ma: A.nMiss, mb: B.nMiss }); row('スコアゾーン外S/ゾーン内に人無', A.without, B.without, { ma: A.nMiss, mb: B.nMiss });
      sec('シュート結末', '#7FD3F7'); row('枠内(ゴール含む)', A.in, B.in, { ma: A.resMiss, mb: B.resMiss }); row('枠外(ポスト含む)', A.out, B.out); row('ブロック', A.block, B.block);
      sec('シュート分類', '#7FD3F7'); clsL.forEach((l, i) => row(l, A.cls[i], B.cls[i], i === 0 ? { ma: A.clsMiss, mb: B.clsMiss } : {}));
      sec('ゾーン進入', '#FF0000'); row('ゾーン4進入', A.z4, B.z4, { bold: true }); row('スコアゾーン進入', A.szE, B.szE, { bold: true });
      sec('Z4進入分類', '#F08080'); clsL.forEach((l, i) => row(l, A.zcls[i], B.zcls[i], i === 0 ? { ma: A.zclsMiss, mb: B.zclsMiss } : {}));
      sec('FINISH SET PLAY', '#00B050'); row('FINISH SET PLAY 合計', A.fsp, B.fsp, { bold: true, ma: A.fspMiss, mb: B.fspMiss });
      ['CK', 'CK-KICK IN', 'KICK IN', 'FK(6m/10m含む)'].forEach((l, i) => row(l, A.fspT[i], B.fspT[i]));
    } else {
      const bands = ['0~10', '11~20', '21~30', '31~40', ...(R.hasExtra ? ['延長'] : [])];
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
