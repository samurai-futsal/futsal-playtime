// マッチレビュー (spec 7章「マッチレビュー」). 1〜4 は出場と交代の記録だけで作るので常に表示。
// 5〜8 はイベントが必要（今あるのは 6 セットごとのシュート…。マッチ・ペース・スコア・スタッツは後の工程）。
// 番号は1〜8で固定（出ていない項目は飛ぶ。上部に理由を書く）。ランニングタイムの切り替えは 1〜4 に効く。
import { S, matchById, playerById, matchesOf, teamSettings, watchOps, watchEvents, opts, activityById } from './store.js';
import { replay, periodLabel, periodLen, perLen, nowElapsed } from './engine.js';
import { matchModel, toRunning, playerTable, playedTime, periodSig, entryOrder } from './model.js';
import { ppWindows, setSplit, setCountTable, asOfLabel } from './teamstats.js';
import { esc, fmtShort, fmtDate, openModal, closeModal } from './ui.js';
import { render } from './views.js';
import { teamStats, paceSection, teamSection, playerSection, goalMarks, stagger, scoreBadge, rvHl, hlc, bindPacePick, bandTip, tSort, tSortNext, tsh, tSorted } from './review58.js';
import { ensureChecks } from './evinput.js';
import { savePdf, safeName, preloadPdf } from './pdfsave.js';

const COL = { '1H': '#1F5FBF', '2H': '#8FB3EC', E1: '#0E8A6E', E2: '#86D3BE' };
const mmss = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const mmssUp = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000 - 1e-6)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
let tick = null;
const SORT0 = { col: 'total', dir: 'desc' }; // 初めは合計の長い順
const tlHl = new Set(); // タイムラインでタップして強調している選手（もう一度タップで戻す）
let sortState = { ...SORT0 }; // 出場時間の表とグラフの並べ替え
const compactKey = 'fpt.reviewCompact';
const isCompact = () => { try { return localStorage.getItem(compactKey) === '1'; } catch { return false; } };
// 時間の数え方：プレーイングタイム（時計の時間）／ランニングタイム（実際に流れた時間）
const modeKey = 'fpt.reviewMode';
let runPref = (() => { try { return localStorage.getItem(modeKey) === 'run'; } catch { return false; } })();
const isRun = () => runPref;

export function stopReviewTick() { clearInterval(tick); tick = null; }

export function vReview(m) {
  const opsC = watchOps(m.id);
  if (!opsC.ready && !opsC.list.length) return { active: 'acts', html: '<p class="mu pad">読み込み中…</p>' };
  const cfg = { times: m.times || {}, members: m.members || {}, timesFixed: !!m.timesFixed, setplayAuto: teamSettings().setplayAuto || 60 };
  const st = replay(opsC.list, cfg);
  st.sig = periodSig(opsC.list);
  const M0 = matchModel(st, Date.now(), m.fix);
  ensureChecks(m, M0, watchEvents(m.id), { quiet: true }); // ⚠要確認を、今の交代の記録で確かめ直す（変わったときだけ）
  const evs = watchEvents(m.id).list.filter((e) => !e.deleted);
  const runMode = isRun();
  const M = runMode ? toRunning(M0, st, Date.now()) : M0;
  const TT = runMode ? 'ランニングタイム' : 'プレーイングタイム';
  const running = M.live && st.periods[st.current].runningSince != null;
  // 出場中の時間を進める：時計が動いている間（ランニングタイムは試合中ずっと）1秒ごとに描き直す
  stopReviewTick();
  if (running || (runMode && M.live)) tick = setInterval(() => { if (!location.hash.endsWith('/review')) return stopReviewTick(); render(); }, 1000);

  const mem = (pid) => m.members?.[pid] || {};
  const order = entryOrder(M0); // タイムライン：GK → 先発のFP（背番号順）→ 初めて入った順
  const byNo = Object.keys(m.members || {}).sort((a, b) => (parseInt(mem(a).no, 10) || 999) - (parseInt(mem(b).no, 10) || 999));
  const last = (pid) => playerById(pid)?.last || '';
  // FPを見ることを優先：1〜3の表はGKをいつも一番下に置く（5. マッチ・ペースは別）
  const gkLast = (list) => [...list.filter((pid) => mem(pid).pos !== 'GK'), ...list.filter((pid) => mem(pid).pos === 'GK')];
  const badge = (pid) => `<span class="no ${mem(pid).pos === 'GK' ? 'gk' : 'fp'}">${esc(mem(pid).no ?? '')}</span>`;
  const played = playedTime(M);
  const started = M.periods.some((p) => p.status !== 'none');
  // イベントを使う項目（5〜8）と得点・失点の線（2026-10-16 決定）
  const goalName = (id) => opts('goalTypes', true).find((o) => o.id === id)?.name || '';
  const R = teamStats(M0, evs, goalName);
  const C = { M0, order, byNo, mem, last, badge, gkLast, evs, goalName, R, T0: playerTable(M0), own: S.team?.name || '自チーム', opp: m.opponent || '相手', pk: m.pk || null };
  const marks = evs.length ? goalMarks(R, C) : [];
  const half = (k) => `${R.score.own[k] ?? 0}−${R.score.opp[k] ?? 0}`;

  // ---------- 試合の状況 ----------
  const pDone = (k) => st.periods[k]?.status === 'done';
  let state;
  if (st.matchOver) state = `<span class="rvst done">試合終了</span>${evs.length ? scoreBadge(C, R) + `<span class="rvclk">（前半 ${half('1H')}）</span>` : ''}`;
  else if (M.live) {
    const len = perLen(st, st.current);
    state = `<span class="rvst ${running ? 'run' : ''}">${running ? '試合進行中' : '停止中'}</span><span class="rvclk">${periodLabel(st.current)}　残り <b>${mmssUp(len - nowElapsed(st))}</b></span>${evs.length ? scoreBadge(C, R) : ''}`;
  } else if (st.askExtra) state = `<span class="rvst half">後半終了</span>${evs.length ? scoreBadge(C, R) : ''}`;
  else if (pDone('1H') && !pDone('2H')) state = `<span class="rvst half">ハーフタイム</span><span class="rvclk">前半終了</span>${evs.length ? scoreBadge(C, R) : ''}`;
  else if (pDone('2H') && !st.matchOver) state = '<span class="rvst half">延長前</span>';
  else state = '<span class="rvst">開始前</span>';

  const others = matchesOf(m.activityId).filter((x) => x.status === 'playing' || x.status === 'done' || x.id === m.id);
  const sw = `<select id="rvMatch" class="rvsel" data-fresh="1">${others.map((x) => `<option value="${x.id}" ${x.id === m.id ? 'selected' : ''}>vs ${esc(x.opponent)}（${fmtShort(x.date)}）</option>`).join('')}</select>`;
  // 項目の番号は固定（1〜8）。出ていない項目は番号が飛ぶので、上部にその理由を書く
  const jumps = [[1, '出場時間', 'rv1'], [2, '1回ごと', 'rv1b'], [3, 'タイムライン', 'rv2'], [4, 'セット', 'rv3'], [5, 'ペース', 'rv5'], [6, 'セット別', 'rv4b'], [7, 'スコア', 'rv7'], [8, 'スタッツ', 'rv8']].map(([n, t, id]) => `<a class="rvjp ${n >= 5 && !evs.length ? 'wait' : ''}" href="#${id}" data-jump="${id}"><b>${n}</b>${t}</a>`).join('');
  const head = `<div class="rvhead">
      <div class="rvrow"><a class="btn mpback" href="#/m/${m.id}">‹ 試合ページ</a><a class="btn ${started ? 'pri' : ''}" href="#/m/${m.id}/play">‹ MATCH PLAY へ</a><span class="rvstate">${state}</span><span class="rvctl">${sw}
        <span class="rvmode" role="group" aria-label="時間の数え方"><button class="${runMode ? '' : 'on'}" data-mode="play">プレーイングタイム</button><button class="${runMode ? 'on' : ''}" data-mode="run">ランニングタイム</button></span>
        <button class="btn" id="rvCompact">${isCompact() ? '通常の表示' : '縮小表示'}</button><button class="btn" id="rvPdf">PDFで保存</button><a class="btn" href="#/m/${m.id}/stats">マッチスタッツ ›</a><button class="btn ${fullAll ? 'pri' : ''}" id="rvFull">${fullAll ? '× 閉じる' : '⛶ 大きく表示'}</button></span></div>
      <div class="rvjumps">${jumps}${evs.length ? '' : '<span class="rvnote">5〜8 はイベントを入力すると表示されます</span>'}
        ${M.fixed.length ? `<span class="rvfix">記録の修正を反映：${M.fixed.map((k) => periodLabel(k)).join('・')}</span>` : ''}
        ${M.stale?.length ? `<a class="rvfix warn" href="#/m/${m.id}/fix">${M.stale.map((k) => periodLabel(k)).join('・')}はMATCH PLAYの記録が変わったため、保存した修正を使っていません</a>` : ''}</div></div>`;

  // PDFで書き出すとき（印刷）だけ出す見出し：どの試合の、どこまでの記録か
  const asOf = asOfLabel(M0); // マッチスタッツ・マッチレポートと同じ（最後に終わったピリオドから）
  const act = activityById(m.activityId);
  const printHead = `<div class="rvprint"><div class="rvpt">マッチレビュー（${TT}）　${esc(S.team?.name || '')} vs ${esc(m.opponent || '')}</div>
    <div class="rvps">${esc(fmtDate(m.date))}${m.kickoff ? ' ' + esc(m.kickoff) + 'キックオフ' : ''}　${esc(m.venue || '')}　${esc(act?.name || '')}${m.category ? '　' + esc(m.category) : ''}　<b>${asOf}</b>　（MATCH PLAYの記録から作成${M.fixed.length ? '・記録の修正を反映' : ''}）</div></div>`;

  if (!started) {
    return { active: 'acts', html: `<div class="rvw">${head}<div class="card empty">${Object.keys(m.members || {}).length < 5 ? `先に試合メンバーを選んでください。<div class="mt"><a class="btn pri" href="#/m/${m.id}/members">試合メンバー ›</a></div>` : 'MATCH PLAYで試合を始めると、ここに出場時間が出ます'}</div></div>`, bind: bindReview(m) };
  }

  const T = playerTable(M);
  const shownP = M.periods.filter((p) => p.status !== 'none' || !p.extra || cfg.times?.extra); // 延長ありの試合は、延長の前から列を出す（まだ行っていないピリオドは「—」）
  const denomTxt = M.periods.filter((p) => p.status !== 'none').map((p) => `${p.label}${mmss(p.elapsed)}`).join('＋');

  // ---------- 1. 出場時間 ----------
  const legend = M.periods.filter((p) => !p.extra || p.status !== 'none' || cfg.times?.extra).map((p) => `<span class="lg"><i style="background:${COL[p.key]}"></i>${p.label}</span>`).join('');
  // 表の並べ替え：見出しを押すと 多い順 → 少ない順 → 背番号順（初めは合計の長い順）。グラフも同じ順に並ぶ
  const sortVal = (pid, col) => {
    const r = T[pid] || { per: {}, total: 0, count: 0 };
    if (col === 'total') return r.total; if (col === 'count' || col === 'rate') return col === 'count' ? r.count : r.total;
    const [k, f] = col.split(':'); const ps = M.periods.find((p) => p.key === k);
    if (!ps || ps.status === 'none') return -1; const c = r.per[k]; return f === 'n' ? (c?.count || 0) : (c?.time || 0);
  };
  const sorted = sortState.col ? byNo.slice().sort((a, b) => (sortVal(b, sortState.col) - sortVal(a, sortState.col)) * (sortState.dir === 'asc' ? -1 : 1) || byNo.indexOf(a) - byNo.indexOf(b)) : byNo;
  // ---------- 1. 出場時間のグラフ：FPだけ（GKは右の枠に数字）。目盛りはFPの一番長い時間に合わせ、FPの平均を点線で引く ----------
  const isGKp = (pid) => mem(pid).pos === 'GK';
  const fpList = sorted.filter((pid) => !isGKp(pid)), gkList = byNo.filter(isGKp);
  const fpPlayed = fpList.filter((pid) => (T[pid]?.total || 0) > 0);
  const fpAvg = fpPlayed.length ? fpPlayed.reduce((a, pid) => a + T[pid].total, 0) / fpPlayed.length : 0;
  const fpMax = Math.max(0, ...fpList.map((pid) => T[pid]?.total || 0));
  const gridStep = fpMax > 10 * 60000 ? 5 : fpMax > 4 * 60000 ? 2 : 1; // 分
  const maxT = Math.max(gridStep * 60000, Math.ceil(fpMax / (gridStep * 60000)) * gridStep * 60000);
  const W = 1040, GW = 200, Hc = 170, L = 52, PW = W - GW - 16;
  const n = fpList.length, cw = (PW - L) / Math.max(n, 1), bw = Math.min(46, cw * 0.62);
  const sv = [`<svg class="rvbar" viewBox="0 0 ${W + 10} ${Hc + 64}" preserveAspectRatio="xMinYMin meet">`];
  for (let mi = 0; mi * 60000 <= maxT; mi += gridStep) {
    const y = 20 + Hc - Hc * (mi * 60000) / maxT;
    sv.push(`<line x1="${L}" y1="${y}" x2="${PW}" y2="${y}" stroke="${mi === 0 ? '#18233A' : '#E1E6EF'}"/><text x="${L - 6}" y="${y + 4}" font-size="12" fill="#8A94A6" text-anchor="end">${mi}:00</text>`);
  }
  fpList.forEach((pid, k) => {
    const x = L + 6 + k * cw + (cw - bw) / 2; let y = 20 + Hc;
    // 棒にカーソルを合わせる（iPadは触れる）と、前半・後半の内訳を出す（2026-10-17）
    const bt = `${mem(pid).no ?? ''} ${last(pid)}　` + M.periods.filter((p) => p.status !== 'none').map((p) => `${p.label} ${mmss(T[pid]?.per[p.key]?.time || 0)}`).join('・');
    sv.push(`<g class="rbar" data-bt="${esc(bt)}"><rect x="${(L + 6 + k * cw).toFixed(1)}" y="0" width="${cw.toFixed(1)}" height="${Hc + 64}" fill="transparent"/><g data-anchor="1">`);
    for (const p of M.periods) {
      const t = T[pid]?.per[p.key]?.time || 0; if (!t) continue;
      const h = Hc * t / maxT; y -= h;
      sv.push(`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" fill="${COL[p.key]}"/>`);
    }
    const tot = T[pid]?.total || 0;
    sv.push(`<text x="${(x + bw / 2).toFixed(1)}" y="${(y - 6).toFixed(1)}" font-size="15" font-weight="800" fill="#0B2D6B" text-anchor="middle">${mmss(tot)}</text></g>`);
    sv.push(`<text x="${(x + bw / 2).toFixed(1)}" y="${20 + Hc + 19}" font-size="15" font-weight="800" fill="#1F5FBF" text-anchor="middle">${esc(mem(pid).no ?? '')}</text>`
      + `<text x="${(x + bw / 2).toFixed(1)}" y="${20 + Hc + 37}" font-size="12.5" fill="#5F6B80" text-anchor="middle">${esc(last(pid))}</text></g>`);
  });
  if (fpAvg) {
    const ya = 20 + Hc - Hc * fpAvg / maxT;
    sv.push(`<line x1="${L}" y1="${ya.toFixed(1)}" x2="${PW}" y2="${ya.toFixed(1)}" stroke="#E0832B" stroke-width="2.5" stroke-dasharray="7 5"/><text x="${PW + 4}" y="${(ya - 4).toFixed(1)}" font-size="12" font-weight="800" fill="#E0832B">FP平均</text><text x="${PW + 4}" y="${(ya + 11).toFixed(1)}" font-size="12" font-weight="800" fill="#E0832B">${mmss(fpAvg)}</text>`);
  }
  const gx = W - GW + 40;
  sv.push(`<rect x="${gx - 10}" y="16" width="${GW - 40}" height="${Hc + 8}" rx="10" fill="#F6F8FB" stroke="#E1E6EF"/><text x="${gx + (GW - 60) / 2}" y="38" font-size="13" font-weight="800" fill="#0B2D6B" text-anchor="middle">GK（別枠）</text>`);
  gkList.forEach((pid, i) => {
    const y = 66 + i * 34;
    sv.push(`<rect x="${gx}" y="${y - 14}" width="26" height="20" rx="4" fill="#C8372D"/><text x="${gx + 13}" y="${y + 1}" font-size="12.5" font-weight="800" fill="#fff" text-anchor="middle">${esc(mem(pid).no ?? '')}</text><text x="${gx + 32}" y="${y + 1}" font-size="13" fill="#18233A">${esc(last(pid))}</text><text x="${gx + GW - 62}" y="${y + 1}" font-size="15" font-weight="800" fill="#0B2D6B" text-anchor="end">${mmss(T[pid]?.total || 0)}</text>`);
  });
  sv.push('</svg>');
  const sh = (col, label) => `<th class="srt ${sortState.col === col ? 'on' : ''}" data-sort="${col}">${label}<i>${sortState.col === col ? (sortState.dir === 'asc' ? '▲' : '▼') : '⇅'}</i></th>`;
  const th = shownP.map((p) => sh(`${p.key}:t`, p.label) + sh(`${p.key}:n`, '回数')).join('');
  const rows = gkLast(sorted).map((pid) => {
    const r = T[pid] || { per: {}, total: 0, count: 0 };
    const cells = shownP.map((p) => {
      if (p.status === 'none') return '<td class="na">—</td><td class="na">—</td>';
      const c = r.per[p.key]; return `<td>${mmss(c?.time || 0)}</td><td>${c?.count || 0}</td>`;
    }).join('');
    return `<tr class="${r.total ? '' : 'zero'} ${hlc('1:' + pid)}" data-hlk="1:${pid}"><td>${badge(pid)} ${esc(last(pid))}</td>${cells}<td><b>${mmss(r.total)}</b></td><td>${r.count}</td><td>${played ? Math.round(r.total / played * 100) : 0}%</td></tr>`;
  }).join('');
  const nmw0 = Math.max(2, ...order.map((pid) => last(pid).length));
  const s1 = `<section class="rvsec" id="rv1"><div class="rvtt"><b>1. 出場時間</b><span>グラフはFP（GKは右の枠）。点線＝FPの平均。出場率は ${denomTxt} に対して${runMode ? '。ランニングタイム＝止まっている間も含む実際の時間' : ''}</span></div>
    <div class="rvbox"><div class="rvlg">${legend}</div>${sv.join('')}
    <table class="rvtb rveq" style="--nmw:${nmw0}"><colgroup><col class="c1"></colgroup><tr><th class="srt ${sortState.col ? '' : 'on'}" data-sort="">選手<i>${sortState.col ? '' : '背番号順'}</i></th>${th}${sh('total', '合計')}${sh('count', '回数')}${sh('rate', '出場率')}</tr>${rows}</table>
    <p class="rvhint">初めは合計の長い順。見出しを押すと並べ替え（多い順 → 少ない順 → 背番号順）、「選手」を押すと背番号順。グラフも同じ順に並びます</p></div></section>`;

  // ---------- 2. 1回ごとの出場時間 ----------
  // ピリオドごとに、選手の1回目・2回目…の出場時間。小さい数字＝入った〜出た（経過時間。ランニングタイムはキックオフからの実際の時間）
  const clk = (p, v) => mmss(v); // 経過時間（2026-10-16 決定。タイムラインと同じ向き）
  const onNow = new Set(M.live ? st.seats.filter(Boolean) : []);
  const perTables = M.periods.filter((p) => p.status !== 'none').map((p) => {
    const lists = Object.fromEntries(byNo.map((pid) => [pid, M.stints.filter((x) => x.period === p.key && x.pid === pid).sort((a, b) => a.from - b.from)]));
    const n = Math.max(1, ...Object.values(lists).map((l) => l.length));
    const hd = Array.from({ length: n }, (_, i) => `<th>${i + 1}回目</th>`).join('');
    const body = gkLast(byNo).map((pid) => {
      const l = lists[pid]; const tot = l.reduce((a, x) => a + x.to - x.from, 0);
      const cells = Array.from({ length: n }, (_, i) => {
        const x = l[i]; if (!x) return '<td class="na"></td>';
        const d = x.to - x.from;
        const now = x.open && onNow.has(pid);
        return `<td class="${d < 60000 ? 'sh' : ''}"><b>${mmss(d)}</b><small>${clk(p, x.from)}〜${now ? '出場中' : clk(p, x.to)}</small></td>`;
      }).join('');
      return `<tr class="${l.length ? '' : 'zero'} ${hlc(`2:${p.key}:${pid}`)}" data-hlk="2:${p.key}:${pid}"><td>${badge(pid)} ${esc(last(pid))}</td>${cells}<td class="sum"><b>${mmss(tot)}</b></td><td class="sum">${l.length}</td></tr>`;
    }).join('');
    return `<div class="rvpcol"><div class="rvst2"><b>${p.label}</b><span>（${mmss(p.elapsed)}）</span></div><table class="rvtb rvper rveq" style="--nmw:${Math.max(2, ...order.map((pid) => last(pid).length))}"><colgroup><col class="c1"></colgroup><tr><th>選手</th>${hd}<th>合計</th><th>回数</th></tr>${body}</table></div>`;
  }).join('');
  const s1b = `<section class="rvsec" id="rv1b"><div class="rvtt"><b>2. 1回ごとの出場時間</b><span>大きい数字＝その回の時間、小さい数字＝入った〜出た（${runMode ? 'キックオフからの実際の時間' : '経過時間'}）。オレンジ＝1分未満</span></div>
    <div class="rvbox"><div class="rvpgrid">${perTables}</div></div></section>`;

  // ---------- 3. 出場タイムライン ----------
  // ピリオドごとに帯を分けて並べ、2つ目以降のピリオドの前に背番号と名前の列をもう一度置く（右の方の帯も誰か分かるように）
  const { tlHead, tlRows } = timelineHTML({ M, order, mem, last, badge, gkLast, T, marks, runMode, compact: isCompact(), hl: tlHl, showExtra: !!(st.askExtra || cfg.times?.extra) });
  const s2 = `<section class="rvsec" id="rv2"><div class="rvtt"><b>3. 出場タイムライン</b><span>いつピッチにいたか。帯の数字＝その回の時間、右端＝合計${marks.length ? '。緑＝得点・赤＝失点' : ''}${(M.zero || []).length ? '。オレンジの「0:00」＝時計が止まっている間だけの出場' : ''}</span></div>
    <div class="rvbox rvtl">${tlHead}${tlRows}</div></section>`;

  // ---------- 4. セットの出場時間 ----------
  // 4・6 の表：数的同数の時間帯だけで数える（5×4・4×5と、両チームの退場の時間帯を除く）。出場時間が短いセット（設定、初めは1分未満）は
  // 下の行にまとめる。除いた時間も下の行に出すので、全部足すと試合の時間になる（2026-10-16・17 決定）
  const setMin = (teamSettings().setMin ?? 60) * 1000;
  // セットの4人：背番号順に、番号と名前を同じ幅の枠に入れて縦にそろえる（2026-10-17）
  const byNum = (a, b) => (parseInt(mem(a).no, 10) || 999) - (parseInt(mem(b).no, 10) || 999);
  const chips = (pids) => `<div class="spw">${pids.slice().sort(byNum).map((pid) => `<span class="sp">${badge(pid)}<small>${esc(last(pid))}</small></span>`).join('')}</div>`;
  const nmw = Math.max(2, ...order.map((pid) => last(pid).length));
  const setKey = (pids) => pids.slice().sort().join('+');
  const SP4 = setSplit(M, ppWindows(M, evs));
  const sets4 = SP4.sets.filter((x) => x.time >= setMin), shortS = SP4.sets.filter((x) => x.time < setMin);
  // ピリオドごと（前半・後半…）の時間と回数。見出しを押すと、その時間で並べ替え（2026-10-17）
  const SPp = Object.fromEntries(shownP.filter((p) => p.status !== 'none').map((p) => [p.key, setSplit(M, ppWindows(M, evs), [p.key])]));
  const perOf = (k, key) => SPp[k]?.sets.find((x) => x.key === key) || null;
  const pcell = (p, t, n) => (p.status === 'none' ? '<td class="na">—</td><td class="na">—</td>' : `<td>${t ? mmss(t) : '<span class="z">0:00</span>'}</td><td>${n || '<span class="z">0</span>'}</td>`);
  const exRow = (label, f, n = null) => `<tr class="ex"><td></td><td class="setn">${label}</td>${shownP.map((p) => (p.status === 'none' ? '<td class="na">—</td><td class="na">—</td>' : `<td>${mmss(f(SPp[p.key]) || 0)}</td><td>${n ? n(SPp[p.key]) : ''}</td>`)).join('')}<td><b>${mmss(f(SP4))}</b></td><td>${n ? n(SP4) : ''}</td></tr>`;
  const rank4 = new Map(sets4.map((x, i) => [x, i + 1])); // 順位は合計の出場時間の順位のまま
  const val4 = (x, col) => (col === 'tot' ? x.time : perOf(col, x.key)?.time || 0);
  const shortKeys = new Set(shortS.map((x) => x.key));
  const shortOf = (S) => S.sets.filter((x) => shortKeys.has(x.key));
  const setRows = (sets4.length ? tSorted(4, sets4, val4).map((s) => `<tr class="${hlc('4:' + setKey(s.pids))}" data-hlk="4:${setKey(s.pids)}"><td>${rank4.get(s)}位</td><td class="setn">${chips(s.pids)}</td>${shownP.map((p) => { const q = perOf(p.key, s.key); return pcell(p, q?.time, q?.count); }).join('')}<td class="sum"><b>${mmss(s.time)}</b></td><td class="sum">${s.count}</td></tr>`).join('')
    : `<tr><td colspan="${4 + shownP.length * 2}" class="na" style="text-align:center">GKが1人・FP4人がそろった時間がまだありません</td></tr>`)
    + (shortS.length ? exRow(`出場時間が${mmss(setMin)}未満のセット（${shortS.length}組）`, (S) => shortOf(S).reduce((t, x) => t + x.time, 0), (S) => shortOf(S).reduce((t, x) => t + x.count, 0)) : '')
    + (SP4.time.ex ? exRow('5×4・4×5と退場の時間帯', (S) => S.time.ex) : '') + (SP4.time.special ? exRow('GK1人・FP4人がそろっていない区間', (S) => S.time.special) : '') + (SP4.time.other ? exRow('交代の瞬間の3秒未満の組み合わせ', (S) => S.time.other) : '')
    + `<tr class="tot"><td></td><td style="text-align:left">合計</td>${shownP.map((p) => (p.status === 'none' ? '<td class="na">—</td><td></td>' : `<td>${mmss(SPp[p.key].time.played)}</td><td></td>`)).join('')}<td>${mmss(SP4.time.played)}</td><td></td></tr>`;
  const s3 = `<section class="rvsec" id="rv3"><div class="rvtt"><b>4. セットの出場時間</b><span>FP4人の組み合わせ（合計の長い順）。数的同数の時間帯だけ。${mmss(setMin)}未満のセットや除いた時間は下の行に。見出しを押すと並べ替え</span></div>
    <div class="rvbox"><table class="rvtb rvset rvset4 rveq" style="--nmw:${nmw}"><colgroup><col class="c0"><col class="cset"></colgroup><tr><th class="srt ${tSort[4].col ? '' : 'on'}" data-tsort="4:">順位</th><th style="text-align:left">FP4人のセット</th>${shownP.map((p) => tsh(4, p.key, p.label) + '<th>回数</th>').join('')}${tsh(4, 'tot', '合計', 'sum')}<th class="sum">回数</th></tr>${setRows}</table></div></section>`;

  // ---------- 6. セットごとのシュート・ゾーン進入・FINISH SET PLAY（イベントがあるときだけ） ----------
  let s4b = '';
  if (evs.length) {
    // 回数はイベントの時刻（試合の時計）で数えるので、ここは時計の時間のセット。決め方は 4 と同じ
    const et = setCountTable(M0, ppWindows(M0, evs), evs, goalName, { setMin });
    // 前半・後半…の内訳（数字の下に小さく。2026-10-17）
    const W0 = ppWindows(M0, evs);
    const pls = M0.periods.filter((p) => p.status !== 'none');
    const per = pls.length > 1 ? pls.map((p) => ({ p, t: setCountTable(M0, W0, evs, goalName, { keys: [p.key], setMin: 0 }) })) : [];
    const shortK = new Set(setSplit(M0, W0).sets.filter((x) => x.time < setMin).map((x) => x.key));
    const pl = (p) => p.label.replace('延長', '延').replace('半', '');
    const rowOf = (t, key) => t.rows.find((x) => x.key === key);
    const shortSum = (t) => { const c = t.cols.map(() => 0); let time = 0; t.rows.filter((x) => shortK.has(x.key)).forEach((x) => { time += x.time; x.c.forEach((v, i) => { c[i] += v; }); }); return { time, c }; };
    const pick = (kind, key) => per.map(({ p, t }) => ({ p, r: kind === 'set' ? rowOf(t, key) : kind === 'short' ? shortSum(t) : t[kind] }));
    const brk = (parts, f) => (parts.length ? `<small class="pb">${parts.map(({ p, r }) => `<span><i>${pl(p)}</i>${f(r)}</span>`).join(' ')}</small>` : '');
    const cell = (v, i, parts) => `<td class="${i % 2 ? 'o' : 'w'}">${v ? `<b>${v}</b>` : '<span class="z">0</span>'}${brk(parts, (r) => r?.c[i] || 0)}</td>`;
    const tcell = (t, parts, bold) => `<td>${bold ? `<b>${mmss(t)}</b>` : mmss(t)}${brk(parts, (r) => mmss(r?.time || 0))}</td>`;
    const fpl = chips;
    const sum = (label, r, kind) => { if (!r.time && !r.c.some(Boolean)) return ''; const parts = pick(kind); return `<tr class="ex"><td></td><td class="setn">${label}</td>${tcell(r.time, parts)}${r.c.map((v, i) => cell(v, i, parts)).join('')}</tr>`; };
    const rank = new Map(et.rows.map((r, i) => [r, i + 1])); // 順位は出場時間の順位のまま
    const body = tSorted(6, et.rows, (r, k) => (k === 'time' ? r.time : r.c[+k])).map((r) => { const parts = pick('set', r.key); return `<tr class="${hlc('6:' + setKey(r.pids))}" data-hlk="6:${setKey(r.pids)}"><td>${rank.get(r)}位</td><td class="setn">${fpl(r.pids)}</td>${tcell(r.time, parts)}${r.c.map((v, i) => cell(v, i, parts)).join('')}</tr>`; }).join('')
      + (et.short.n ? sum(`出場時間が${mmss(setMin)}未満のセット（${et.short.n}組）`, et.short, 'short') : '')
      + sum('5×4・4×5と退場の時間帯', et.ex, 'ex') + sum('GK1人・FP4人がそろっていない区間', et.special, 'special') + sum('交代の瞬間の3秒未満の組み合わせ', et.other, 'other')
      + (() => { const parts = pick('total'); return `<tr class="tot"><td></td><td style="text-align:left">合計</td>${tcell(et.total.time, parts, true)}${et.total.c.map((v, i) => `<td class="${i % 2 ? 'o' : 'w'}"><b>${v}</b>${brk(parts, (r) => r?.c[i] || 0)}</td>`).join('')}</tr>`; })();
    s4b = `<section class="rvsec" id="rv4b"><div class="rvtt"><b>6. セットごとのシュート・ゾーン進入・FINISH SET PLAY</b><span>セットがピッチにいる間の回数（数的同数の時間帯だけ）。青＝自チーム、赤＝相手。大きい数字＝合計、下の小さい数字＝前半・後半。見出しを押すと並べ替え</span></div>
    <div class="rvbox"><table class="rvtb rvset2 rveq" style="--nmw:${nmw}"><colgroup><col class="c0"><col class="cset"></colgroup><tr><th class="srt ${tSort[6].col ? '' : 'on'}" data-tsort="6:">順位</th><th style="text-align:left">FP4人のセット</th>${tsh(6, 'time', '出場時間')}${et.cols.map(([, l], i) => tsh(6, String(i), l.replace('FINISH SET PLAY ', 'FINISH SET PLAY<br>'), i % 2 ? 'o' : 'w')).join('')}</tr>${body}</table></div></section>`;
  }

  return { active: 'acts', html: `<div class="rvw ${isCompact() && !fullAll ? 'compact' : ''}">${head}${printHead}<div class="rvbody">${s1}${s1b}${s2}${s3}${evs.length ? paceFit(C) + s4b + teamSection(C) + playerSection(C) : waitSections(m)}</div></div>`, bind: bindReview(m) };
}

// タイムラインの帯の上の小さな数字：となりと重なるものは隠す（帯を押さえると時間が出る）。画面の幅で重なり方が変わるので、描いたあとに確かめる
export function declutterTimeline(root) {
  root.querySelectorAll('.tlt').forEach((t) => {
    let last = -1e9;
    [...t.querySelectorAll('.tls,.tlzl')].map((e) => ({ e, r: e.getBoundingClientRect() })).sort((a, b) => a.r.left - b.r.left)
      .forEach(({ e, r }) => { if (!r.width) return; if (r.left < last + 3) e.style.visibility = 'hidden'; else last = r.right; });
  });
}
function bindReview(m) {
  return (root) => {
    const bar = document.querySelector('.bar'); if (bar) document.documentElement.style.setProperty('--barh', bar.offsetHeight + 'px');
    declutterTimeline(root);
    { const hd = root.querySelector('.rvhead'); if (hd) document.documentElement.style.setProperty('--rvhh', hd.offsetHeight + 'px'); }
    const sel = root.querySelector('#rvMatch'); if (sel) sel.onchange = () => { location.hash = `#/m/${sel.value}/review`; };
    // 表の行を押すと強調（1・2・4・6・8。何行でも。もう一度押すと戻す）
    root.querySelectorAll('tr[data-hlk]').forEach((tr) => tr.onclick = () => { const k = tr.dataset.hlk; rvHl.has(k) ? rvHl.delete(k) : rvHl.add(k); tr.classList.toggle('hl', rvHl.has(k)); });
    bindPacePick(root);
    bindFull(root);
    if (!fullAll) paceMeasure(root);
    { const bx = root.querySelector('#rv1 .rvbox'), bsv = bx?.querySelector('svg.rvbar'); if (bsv) bandTip(bx, bsv, '.rbar', (g) => g.dataset.bt); }
    // タイムラインの帯：カーソルを合わせる（iPadは触れる）と、帯の上に選手名（2026-10-17）
    const tlb = root.querySelector('.rvtl'); const tlTip = tlb ? bandTip(tlb, tlb, '.tlb', (b) => b.closest('[data-tln]')?.dataset.tln || '') : null;
    root.querySelectorAll('[data-tl]').forEach((r) => r.onclick = (e) => { if (tlTip?.touch() && e.target.closest('.tlb')) return; const id = r.dataset.tl; if (tlHl.has(id)) tlHl.delete(id); else tlHl.add(id); r.classList.toggle('hl', tlHl.has(id)); });
    root.querySelectorAll('[data-sort]').forEach((th) => th.onclick = () => {
      const col = th.dataset.sort;
      if (!col) sortState = { col: '', dir: 'desc' };
      else if (sortState.col !== col) sortState = { col, dir: 'desc' };
      else if (sortState.dir === 'desc') sortState = { col, dir: 'asc' };
      else sortState = { col: '', dir: 'desc' };
      render();
    });
    root.querySelectorAll('[data-tsort]').forEach((th) => th.onclick = () => { const [t, col] = th.dataset.tsort.split(':'); tSortNext(t, col); render(); });
    root.querySelectorAll('[data-mode]').forEach((b) => b.onclick = () => { runPref = b.dataset.mode === 'run'; try { localStorage.setItem(modeKey, b.dataset.mode); } catch {} render(); });
    const pdf = root.querySelector('#rvPdf'); if (pdf) pdf.onclick = () => pdfChoice(m);
    if (location.hash.endsWith('/pdf')) { history.replaceState(null, '', `#/m/${m.id}/review`); setTimeout(() => pdfChoice(m), 200); } // 印刷の画面で「PDFとして保存」（iPadは共有→「ファイルに保存」）
    const c = root.querySelector('#rvCompact'); if (c) c.onclick = () => { try { localStorage.setItem(compactKey, isCompact() ? '0' : '1'); } catch {} render(); };
    root.addEventListener('click', (e) => {
      const j = e.target.closest('[data-jump]'); if (!j) return;
      e.preventDefault(); const el = document.getElementById(j.dataset.jump);
      if (el) scrollTo({ top: el.getBoundingClientRect().top + scrollY - (root.querySelector('.rvhead')?.offsetHeight || 0) - (document.querySelector('.bar')?.offsetHeight || 0) - 8, behavior: 'smooth' });
    });
  };
}

// 5〜8：イベントがまだないときも項目の枠は出して、何が入るかと「イベントを入力すると表示」を書く
function waitSections(m) {
  const box = (n, id, t, what) => `<section class="rvsec rvwait" id="${id}"><div class="rvtt"><b>${n}. ${t}</b></div>
    <div class="rvbox"><div class="rvwbox"><b>イベントを入力すると、ここに表示されます</b><span>${what}</span><a class="btn sm" href="#/m/${m.id}/events">イベント入力 ›</a></div></div></section>`;
  return box(5, 'rv5', 'マッチ・ペース', '出場の帯と得点・失点の線、1分ごとのシュート・ゾーン進入・FINISH SET PLAY')
    + box(6, 'rv4b', 'セットごとのシュート・ゾーン進入・FINISH SET PLAY', 'FP4人のセットがピッチにいる間のシュート・被シュート・進入などの回数')
    + box(7, 'rv7', 'スコアとチームスタッツ', '得点経過と、シュート・枠内・進入・FINISH SET PLAY・ファール・カード・タイムアウトの比較')
    + box(8, 'rv8', 'スタッツまとめ', '選手ごとのシュート・得点・アシスト・進入関与・リカバリー・ロスト・ファール・得失点±');
}
// PDFで保存：出場時間（1〜4）だけ／すべて（1〜8）。1項目＝1ページ（2026-10-17）
function pdfChoice(m) {
  preloadPdf();
  const has = watchEvents(m.id).list.some((e) => !e.deleted);
  const md = openModal(`<h2>マッチレビューをPDFで保存</h2><p class="mu">保存する項目を選んでください。1項目を1ページに大きく入れます。${navigator.maxTouchPoints > 1 ? 'できたら「ファイルに保存」を選びます。' : 'できたらダウンロードします。'}</p>
    <div class="pdfch"><button class="card" data-pdf="14"><b>出場時間だけ（1〜4）</b><span>出場時間・1回ごと・タイムライン・セット</span></button>
    <button class="card" data-pdf="all" ${has ? '' : 'disabled'}><b>すべて（1〜8）</b><span>${has ? '1〜4に、ペース・セット別・スコア・スタッツを加える' : 'イベントを入力すると選べます'}</span></button></div>
    <div class="row end"><button class="btn" id="pdfX">やめる</button></div>`);
  md.querySelector('#pdfX').onclick = closeModal;
  md.querySelectorAll('[data-pdf]').forEach((b) => b.onclick = () => {
    const only14 = b.dataset.pdf === '14';
    const head = document.querySelector('.rvw .rvprint')?.outerHTML || '';
    const secs = [...document.querySelectorAll('.rvw .rvbody > .rvsec')].filter((x) => !x.classList.contains('rvwait') && (!only14 || ['rv1', 'rv1b', 'rv2', 'rv3'].includes(x.id)));
    const items = secs.map((sec) => {
      const c = sec.cloneNode(true); c.classList.remove('rvfull');
      c.querySelectorAll('.rvmax,.rvfsbar').forEach((x) => x.remove());
      c.querySelectorAll('.hl').forEach((x) => x.classList.remove('hl'));
      c.querySelectorAll('svg.pace .prl.on').forEach((x) => x.classList.remove('on'));
      c.querySelectorAll('svg.pace .pmk').forEach((x) => x.remove());
      c.querySelectorAll('.rvtt span').forEach((x) => { x.textContent = x.textContent.replace(/[。、]?(見出しを押すと並べ替え|行を押すと強調・下のグラフを押すと●|行を押すと強調)/g, ''); });
      c.querySelectorAll('th.srt i').forEach((x) => { if (x.textContent === '⇅') x.remove(); });
      const it = { html: head + c.outerHTML };
      if (sec.id === 'rv5') it.widths = [850, 1000, 1150];
      if (sec.id === 'rv5') it.fix = (el, W, aw, ah) => { // ページの縦横に合わせて描き直す
        for (let k = 0; k < 2; k++) { // 描き直すと周りの高さも変わるので2回
          const svg = el.querySelector('svg.pace'); if (!svg) return;
          const r = svg.getBoundingClientRect(); const other = el.offsetHeight - r.height;
          const want = r.width / Math.max(200, W * ah / aw - other);
          const nv = paceSvgFor(want); if (!nv) return;
          svg.outerHTML = nv;
          el.querySelectorAll('svg.pace .pmk').forEach((x) => x.remove());
        }
      };
      return it;
    });
    const day = (m.date || '').replace(/-/g, '');
    closeModal();
    savePdf(items, `${safeName(`マッチレビュー_vs${m.opponent || ''}_${day}`)}.pdf`, { stageCls: 'rvw' });
  });
}

// 出場タイムライン（マッチレビュー 3 と分析画面の出場時間タブで使う）。o = { M, order, mem, last, badge, gkLast, T, marks, runMode, compact, hl, showExtra }
export function timelineHTML(o) {
  const { M, order, mem, last, badge, gkLast, T, marks, runMode } = o;
  const axis = M.periods.filter((p) => !p.extra || p.status !== 'none' || o.showExtra);
  const pp = (p, v) => (Math.max(0, Math.min(1, v / p.len)) * 100).toFixed(3);
  const gAt = (g) => (runMode && M.relOf ? M.relOf(g.period, g.at) : g.at); // ランニングタイムでは実際の時間に置きかえる
    // 目盛りは経過時間（0:00→）。プレーイングタイムもランニングタイムも同じ向き（2026-10-16 決定）
  const ticksOf = (p) => `<span style="left:0%">${p.label} 0:00</span><span style="left:50%">${mmss(p.len / 2)}</span><span class="r" style="left:100%">${mmss(p.len)}</span>`;
  const futureOf = (p) => (p.status === 'none' ? '<i class="tlfut" style="left:0%;width:100%"></i>'
    : (M.live && p.key === M.current ? `<i class="tlfut" style="left:${pp(p, p.elapsed)}%;width:${pp(p, p.len - p.elapsed)}%"></i>` : ''));
  const tlCols = (nm, mid, end) => `${nm}px ${axis.map((p, i) => (i ? `${mid}px ` : '') + `minmax(0,${p.len}fr)`).join(' ')} ${end}px`;
  // 名前の列は一番長い名前に合わせる（番号と名前を0:00のすぐ横にそろえる）。合計の列も番号と時間を近づける
  const nameW = Math.max(2, ...order.map((pid) => last(pid).length)) * 15;
  const tlStyle = `style="--tlc:${tlCols(40 + nameW, 51 + nameW, 82)};--tlcc:${tlCols(84, 30, 66)}"`;
  const who = (pid, cls) => `<span class="${cls}">${badge(pid)}<span class="tln">${esc(last(pid))}</span></span>`;
  const tlRows = gkLast(order).map((pid) => {
    const tracks = axis.map((p, i) => {
      // 短い出場の数字は帯の上。近くの数字と重なるときは出さない（帯を押さえると時間が出る）
      let lastX = -1e9; const gap = o.compact ? 9 : 5;
      const bands = M.stints.filter((s) => s.pid === pid && s.period === p.key).sort((x, y) => x.from - y.from).map((s) => {
        const d = s.to - s.from, l = pp(p, s.from), w = pp(p, d);
        const small = d / p.len < (o.compact ? 0.16 : 0.09);
        const cx = +l + +w / 2; const show = !small || cx - lastX >= gap; if (small && show) lastX = cx;
        return `<span class="tlb ${mem(pid).pos === 'GK' ? 'gk' : ''}" style="left:${l}%;width:${w}%">${small ? '' : mmss(d)}</span>${small && show ? `<span class="tls" style="left:${cx.toFixed(3)}%">${mmss(d)}</span>` : ''}`;
      }).join('');
      const zeros = (M.zero || []).filter((s) => s.pid === pid && s.period === p.key)
        .map((s) => `<i class="tlz" style="left:${pp(p, s.from)}%" title="時計が止まっている間だけの出場"></i><span class="tlzl" style="left:${pp(p, s.from)}%">0:00</span>`).join('');
      const gl = marks.filter((g) => g.period === p.key).map((g) => `<i class="tlgl ${g.own ? 'own' : 'opp'}" style="left:${pp(p, gAt(g))}%"></i>`).join('');
      return (i ? who(pid, 'tlmid') : '') + `<div class="tlt">${futureOf(p)}${bands}${zeros}${gl}</div>`;
    }).join('');
    return `<div class="tlr ${o.hl?.has(pid) ? 'hl' : ''}" data-tl="${pid}" data-tln="${esc(String(mem(pid).no ?? ''))} ${esc(last(pid))}" ${tlStyle}>${who(pid, 'tlnm')}${tracks}<b class="tlend">${badge(pid)}<span class="tlsum">${mmss(T[pid]?.total || 0)}</span></b></div>`;
  }).join('');
  // 得点・失点のラベル：目盛りの上の段（重なるときは段をずらす）。時刻は経過時間
  const lane = (p) => { const ls = stagger(marks.filter((g) => g.period === p.key).map((g) => ({ ...g, x: +pp(p, gAt(g)) })), o.compact ? 44 : 26);
    if (!marks.length) return '';
    const n = Math.max(1, ...ls.map((l) => l.row + 1));
    return `<div class="tlgoal" style="height:${n * 15 + 2}px">${ls.map((l) => `<span class="${l.own ? 'own' : 'opp'} ${l.x > 88 ? 'r' : l.x < 12 ? 'l' : ''}" style="left:${l.x}%;top:${l.row * 15}px">${esc(l.label)}</span>`).join('')}</div>`; };
  const tlHead = `<div class="tlr tlhead" ${tlStyle}><span></span>${axis.map((p, i) => (i ? '<span></span>' : '') + `<div class="tlaxw">${lane(p)}<div class="tlax">${ticksOf(p)}</div></div>`).join('')}<span>合計</span></div>`;
  return { tlHead, tlRows };
}

// ---------- 5. マッチ・ペースの横幅：ほかの項目と同じ幅で、高さは1画面に入るように（2026-10-17） ----------
// 画面の幅と高さから、グラフの横の長さ（tw）を決める。描いたあとに実際の枠の大きさを測り、比率が違えば描き直す
let paceRatio = null, paceC = null;
// ratio（横÷縦）に合わせたマッチ・ペースの svg（大きく表示のときにも使う）
function paceSvgFor(ratio) {
  if (!paceC) return null;
  const o = { pick: true, rowH: 20, gh: 96, svgOnly: true };
  const vb = (paceSection(paceC, o).match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/) || []).slice(1).map(Number); if (!vb.length) return null;
  return paceSection(paceC, { ...o, tw: Math.max(600, ratio * vb[1] - (vb[0] - 840)) });
}
function paceFit(C) {
  paceC = C;
  const o = { pick: true, rowH: 20, gh: 96 };
  if (!paceRatio) return paceSection(C, o);
  const vb = (paceSection(C, { ...o, svgOnly: true }).match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/) || []).slice(1).map(Number);
  if (!vb.length) return paceSection(C, o);
  const fixed = vb[0] - 840;
  return paceSection(C, { ...o, tw: Math.max(600, paceRatio * vb[1] - fixed) });
}
function paceMeasure(root) {
  const sec = root.querySelector('#rv5:not(.rvfull)'); const box = sec?.querySelector('.rvbox'); const svg = box?.querySelector('svg.pace'); if (!svg) return;
  const W = box.clientWidth - 36, H = window.innerHeight - (document.querySelector('.bar')?.offsetHeight || 60) - (root.querySelector('.rvhead')?.offsetHeight || 0) - 110;
  if (W < 300 || H < 200) return;
  const want = W / H; const vb = svg.viewBox.baseVal; const have = vb.width / vb.height;
  // 一度その比率で描いたら、それ以上は描き直さない（縦向きなどで比率に届かないときに繰り返さないように）
  if (paceRatio && Math.abs(paceRatio - want) / want < 0.04) return;
  if (Math.abs(have - want) / want > 0.04) { paceRatio = want; render(); }
}
if (typeof window !== 'undefined' && !window.__paceResize) {
  window.__paceResize = true;
  let t = null; window.addEventListener('resize', () => { clearTimeout(t); t = setTimeout(() => { if (location.hash.includes('/review') && !document.querySelector('.rvfull')) { const r = document.querySelector('.rvw'); if (r) paceMeasure(r.parentElement || document); } }, 250); });
}

// ---------- 大きく表示：マッチレビュー全体（1〜8）を画面いっぱいに出し、上下に動かして見る（2026-10-17） ----------
// アプリの上の帯を隠し、横幅の上限をはずす。項目の番号（1〜8）で移動できる。「× 閉じる」か Esc で戻す
let fullAll = false;
function setFull(on) {
  fullAll = on; document.body.classList.toggle('rvall', on);
  paceRatio = null; // マッチ・ペースは新しい画面の大きさに合わせて描き直す
  render();
}
function bindFull(root) {
  document.body.classList.toggle('rvall', fullAll);
  const b = root.querySelector('#rvFull'); if (b) b.onclick = () => setFull(!fullAll);
  if (!window.__rvallKeys) {
    window.__rvallKeys = true;
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && fullAll && location.hash.includes('/review')) setFull(false); });
    window.addEventListener('hashchange', () => { if (!location.hash.includes('/review') && fullAll) { fullAll = false; document.body.classList.remove('rvall'); } });
    let t = null; window.addEventListener('resize', () => { if (!fullAll) return; clearTimeout(t); t = setTimeout(() => { if (fullAll && location.hash.includes('/review')) render(); }, 250); });
  }
  if (fullAll) fitAll(root);
}
// 大きく表示：1項目を1画面いっぱいに（2026-10-17）。項目ごとに、画面の幅と高さに入る一番大きい倍率で広げる。
// 1画面に入らない長い表は、等倍で上下に動かして見る。マッチ・ペースは画面の縦横に合わせて描き直す
function fitAll(root) {
  const secs = [...root.querySelectorAll('.rvbody > .rvsec:not(.rvwait)')].filter((x) => x.querySelector('.rvbox'));
  const vh = window.innerHeight;
  for (const sec of secs) {
    const box = sec.querySelector('.rvbox'); const tt = sec.querySelector('.rvtt');
    box.style.zoom = ''; box.style.width = '';
    const cs = getComputedStyle(sec);
    const availW = sec.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const availH = vh - (tt?.offsetHeight || 0) - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - 16;
    if (sec.id === 'rv5') {
      const old = box.querySelector('svg.pace'); const pad = 36 + (box.querySelector('.pinfo')?.offsetHeight || 20) + 8;
      const svg = paceSvgFor((availW - 36) / Math.max(200, availH - pad));
      if (old && svg) { old.outerHTML = svg; bindPacePick(root); }
      continue;
    }
    const cols = Math.max(0, ...[...box.querySelectorAll('table')].map((t) => t.rows[0]?.cells.length || 0));
    const minW = box.querySelector('.rvpgrid') ? Math.min(availW, 1400) : cols > 6 ? Math.min(availW, 1000) : cols ? 600 : 320; // 2は表が2つ横に並ぶので広めに
    let done = false;
    for (let z = 2.2; z >= 0.8; z -= 0.05) {
      if (availW / z < minW) continue;
      box.style.width = `${availW / z}px`;
      if (box.offsetHeight * z <= availH) { box.style.zoom = z.toFixed(2); done = true; break; }
    }
    if (!done) { box.style.width = ''; box.style.zoom = ''; continue; }
    // まだ下が余る表は、行を少しずつ高くして画面の縦いっぱいに（1行につき最大30px）
    const z = +box.style.zoom || 1;
    const rows = [...box.querySelectorAll('table tr')].filter((r) => !r.closest('svg'));
    const spare = availH / z - box.offsetHeight - 4;
    if (rows.length && spare > 8) {
      const add = Math.min(30, spare / rows.length); const hs = rows.map((r) => r.getBoundingClientRect().height / z);
      rows.forEach((r, k) => { r.style.height = (hs[k] + add).toFixed(1) + 'px'; });
      if (box.offsetHeight * z > availH) rows.forEach((r) => { r.style.height = ''; });
    }
  }
}
