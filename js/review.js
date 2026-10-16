// マッチレビュー (spec 7章「マッチレビュー」). 1〜4 は出場と交代の記録だけで作るので常に表示。
// 5〜8 はイベントが必要（今あるのは 6 セットごとのシュート…。マッチ・ペース・スコア・スタッツは後の工程）。
// 番号は1〜8で固定（出ていない項目は飛ぶ。上部に理由を書く）。ランニングタイムの切り替えは 1〜4 に効く。
import { S, matchById, playerById, matchesOf, teamSettings, watchOps, watchEvents, opts, activityById } from './store.js';
import { setEventTable } from './events.js';
import { replay, periodLabel, periodLen, nowElapsed } from './engine.js';
import { matchModel, toRunning, playerTable, setTable, playedTime, periodSig, entryOrder } from './model.js';
import { esc, fmtShort, fmtDate, openModal, closeModal } from './ui.js';
import { render } from './views.js';
import { teamStats, paceSection, teamSection, playerSection, goalMarks, stagger, scoreBadge } from './review58.js';

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
  const cfg = { times: m.times || {}, members: m.members || {}, setplayAuto: teamSettings().setplayAuto || 60 };
  const st = replay(opsC.list, cfg);
  st.sig = periodSig(opsC.list);
  const M0 = matchModel(st, Date.now(), m.fix);
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
  const C = { M0, order, byNo, mem, last, badge, gkLast, evs, goalName, R, T0: playerTable(M0), own: S.team?.name || '自チーム', opp: m.opponent || '相手' };
  const marks = evs.length ? goalMarks(R, C) : [];
  const half = (k) => `${R.score.own[k] ?? 0}−${R.score.opp[k] ?? 0}`;

  // ---------- 試合の状況 ----------
  const pDone = (k) => st.periods[k]?.status === 'done';
  let state;
  if (st.matchOver) state = `<span class="rvst done">試合終了</span>${evs.length ? scoreBadge(C, R) + `<span class="rvclk">（前半 ${half('1H')}）</span>` : ''}`;
  else if (M.live) {
    const len = periodLen(cfg, st.current);
    state = `<span class="rvst ${running ? 'run' : ''}">${running ? '試合進行中' : '停止中'}</span><span class="rvclk">${periodLabel(st.current)}　残り <b>${mmssUp(len - nowElapsed(st))}</b></span>${evs.length ? scoreBadge(C, R) : ''}`;
  } else if (st.askExtra) state = `<span class="rvst half">後半終了</span>${evs.length ? scoreBadge(C, R) : ''}`;
  else if (pDone('1H') && !pDone('2H')) state = `<span class="rvst half">ハーフタイム</span><span class="rvclk">前半終了</span>${evs.length ? scoreBadge(C, R) : ''}`;
  else if (pDone('2H') && !st.matchOver) state = '<span class="rvst half">延長前</span>';
  else state = '<span class="rvst">開始前</span>';

  const others = matchesOf(m.activityId).filter((x) => x.status === 'playing' || x.status === 'done' || x.id === m.id);
  const sw = `<select id="rvMatch" class="rvsel">${others.map((x) => `<option value="${x.id}" ${x.id === m.id ? 'selected' : ''}>vs ${esc(x.opponent)}（${fmtShort(x.date)}）</option>`).join('')}</select>`;
  // 項目の番号は固定（1〜8）。出ていない項目は番号が飛ぶので、上部にその理由を書く
  const jumps = [[1, '出場時間', 'rv1'], [2, '1回ごと', 'rv1b'], [3, 'タイムライン', 'rv2'], [4, 'セット', 'rv3'], [5, 'ペース', 'rv5'], [6, 'セット別', 'rv4b'], [7, 'スコア', 'rv7'], [8, 'スタッツ', 'rv8']].map(([n, t, id]) => `<a class="rvjp ${n >= 5 && !evs.length ? 'wait' : ''}" href="#${id}" data-jump="${id}"><b>${n}</b>${t}</a>`).join('');
  const head = `<div class="rvhead">
      <div class="rvrow"><a class="btn mpback" href="#/m/${m.id}">‹ 試合ページ</a><a class="btn pri" href="#/m/${m.id}/play">‹ MATCH PLAY へ</a>${state}<span class="sp"></span>${sw}
        <span class="rvmode" role="group" aria-label="時間の数え方"><button class="${runMode ? '' : 'on'}" data-mode="play">プレーイングタイム</button><button class="${runMode ? 'on' : ''}" data-mode="run">ランニングタイム</button></span>
        <button class="btn" id="rvCompact">${isCompact() ? '大きく表示' : '縮小表示'}</button><button class="btn" id="rvPdf">PDFで書き出す</button></div>
      <div class="rvjumps">${jumps}${evs.length ? '' : '<span class="rvnote">5〜8 はイベントを入力すると表示されます</span>'}
        ${M.fixed.length ? `<span class="rvfix">記録の修正を反映：${M.fixed.map((k) => periodLabel(k)).join('・')}</span>` : ''}
        ${M.stale?.length ? `<a class="rvfix warn" href="#/m/${m.id}/fix">${M.stale.map((k) => periodLabel(k)).join('・')}はMATCH PLAYの記録が変わったため、保存した修正を使っていません</a>` : ''}</div></div>`;

  // PDFで書き出すとき（印刷）だけ出す見出し：どの試合の、どこまでの記録か
  const asOf = st.matchOver ? '試合終了時点' : M.live ? `${periodLabel(st.current)} 残り ${mmssUp(periodLen(cfg, st.current) - nowElapsed(st))} 時点` : (pDone('1H') && !pDone('2H')) ? '前半終了時点' : pDone('2H') ? '後半終了時点' : '';
  const act = activityById(m.activityId);
  const printHead = `<div class="rvprint"><div class="rvpt">マッチレビュー（${TT}）　${esc(S.team?.name || '')} vs ${esc(m.opponent || '')}</div>
    <div class="rvps">${esc(fmtDate(m.date))}${m.kickoff ? ' ' + esc(m.kickoff) + 'キックオフ' : ''}　${esc(m.venue || '')}　${esc(act?.name || '')}${m.category ? '　' + esc(m.category) : ''}　<b>${asOf}</b>　（MATCH PLAYの記録から作成${M.fixed.length ? '・記録の修正を反映' : ''}）</div></div>`;

  if (!started) {
    return { active: 'acts', html: `<div class="rvw">${head}<div class="card empty">まだ記録がありません。MATCH PLAYで先発を選んでスタートすると、ここに出場時間が表示されます。</div></div>`, bind: bindReview(m) };
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
    for (const p of M.periods) {
      const t = T[pid]?.per[p.key]?.time || 0; if (!t) continue;
      const h = Hc * t / maxT; y -= h;
      sv.push(`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" fill="${COL[p.key]}"/>`);
    }
    const tot = T[pid]?.total || 0;
    sv.push(`<text x="${(x + bw / 2).toFixed(1)}" y="${(y - 6).toFixed(1)}" font-size="15" font-weight="800" fill="#0B2D6B" text-anchor="middle">${mmss(tot)}</text>`);
    sv.push(`<text x="${(x + bw / 2).toFixed(1)}" y="${20 + Hc + 19}" font-size="15" font-weight="800" fill="#1F5FBF" text-anchor="middle">${esc(mem(pid).no ?? '')}</text>`
      + `<text x="${(x + bw / 2).toFixed(1)}" y="${20 + Hc + 37}" font-size="12.5" fill="#5F6B80" text-anchor="middle">${esc(last(pid))}</text>`);
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
    return `<tr class="${r.total ? '' : 'zero'}"><td>${badge(pid)} ${esc(last(pid))}</td>${cells}<td><b>${mmss(r.total)}</b></td><td>${r.count}</td><td>${played ? Math.round(r.total / played * 100) : 0}%</td></tr>`;
  }).join('');
  const s1 = `<section class="rvsec" id="rv1"><div class="rvtt"><b>1. 出場時間</b><span>グラフはFPだけ（GKは右の枠）。棒＝ピリオドを積み上げ、上の数字＝合計、オレンジの点線＝FPの平均。並びは下の表と同じ（表のGKはいつも一番下）。${runMode ? '時間はすべてランニングタイム（キックオフから時計が0:00になるまでの実際の時間。止まっている間もピッチにいた選手の時間に入る）。' : ''}出場率は、ここまでの${TT}（${denomTxt}）に対して</span></div>
    <div class="rvbox"><div class="rvlg">${legend}</div>${sv.join('')}
    <table class="rvtb"><tr><th class="srt ${sortState.col ? '' : 'on'}" data-sort="">選手<i>${sortState.col ? '' : '背番号順'}</i></th>${th}${sh('total', '合計')}${sh('count', '回数')}${sh('rate', '出場率')}</tr>${rows}</table>
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
      return `<tr class="${l.length ? '' : 'zero'}"><td>${badge(pid)} ${esc(last(pid))}</td>${cells}<td class="sum"><b>${mmss(tot)}</b></td><td class="sum">${l.length}</td></tr>`;
    }).join('');
    return `<div class="rvst2"><b>${p.label}</b><span>（${mmss(p.elapsed)}）</span></div><table class="rvtb rvper"><tr><th>選手</th>${hd}<th>合計</th><th>回数</th></tr>${body}</table>`;
  }).join('');
  const s1b = `<section class="rvsec" id="rv1b"><div class="rvtt"><b>2. 1回ごとの出場時間</b><span>ピッチに入ってから出るまでの1回ごとの時間（${TT}）。大きい数字＝その回の時間、小さい数字＝入った〜出た（${runMode ? 'キックオフからの実際の時間' : '試合の時計の経過時間'}）。オレンジ＝1分未満。合計・回数は「1. 出場時間」と同じ</span></div>
    <div class="rvbox">${perTables}</div></section>`;

  // ---------- 3. 出場タイムライン ----------
  // ピリオドごとに帯を分けて並べ、2つ目以降のピリオドの前に背番号と名前の列をもう一度置く（右の方の帯も誰か分かるように）
  const { tlHead, tlRows } = timelineHTML({ M, order, mem, last, badge, gkLast, T, marks, runMode, compact: isCompact(), hl: tlHl, showExtra: !!(st.askExtra || cfg.times?.extra) });
  const s2 = `<section class="rvsec" id="rv2"><div class="rvtt"><b>3. 出場タイムライン</b><span>並び＝先発のFP（背番号順）、そのあとは初めてピッチに入った順、GKは一番下。いつピッチにいたか${runMode ? '（目盛りはキックオフからの実際の時間）' : '（目盛りは試合の時計の経過時間）'}。帯の中の数字＝その出場の時間（短い出場は帯の上）、右端＝合計${marks.length ? '。緑＝得点・赤＝失点の線（上の文字は試合の時計の経過時間と得点者）' : ''}${(M.zero || []).length ? '。オレンジの線と「0:00」＝時計が止まっている間だけの出場（セットプレーの守備などで入れ替えたとき。実際の時間に合わせるなら「記録の修正」で時刻を直す）' : ''}</span></div>
    <div class="rvbox rvtl">${tlHead}${tlRows}</div></section>`;

  // ---------- 4. セットの出場時間 ----------
  const sets = setTable(M);
  const setRows = sets.length ? sets.map((s, i) => `<tr><td>${i + 1}位</td><td class="setn">${s.pids.map((pid) => `${badge(pid)}<small>${esc(last(pid))}</small>`).join('')}</td><td><b>${mmss(s.time)}</b></td><td>${s.count}</td></tr>`).join('')
    : '<tr><td colspan="4" class="na" style="text-align:center">GKが1人・FPが4人そろった時間がまだありません</td></tr>';
  const s3 = `<section class="rvsec" id="rv3"><div class="rvtt"><b>4. セットの出場時間</b><span>FP4人の組み合わせ（長い順）。GKがいない区間（パワープレー）、退場で空席の区間、交代の瞬間の3秒未満の組み合わせは除く。得点・失点はイベント入力（④）のあとで表示</span></div>
    <div class="rvbox"><table class="rvtb rvset"><tr><th>順位</th><th style="text-align:left">FP4人のセット</th><th>出場時間</th><th>回数</th></tr>${setRows}</table></div></section>`;

  // ---------- 6. セットごとのシュート・ゾーン進入・FINISH SET PLAY（イベントがあるときだけ） ----------
  let s4b = '';
  if (evs.length) {
    const goalName = (id) => opts('goalTypes', true).find((o) => o.id === id)?.name || '';
    const sets0 = runMode ? setTable(M0) : sets; // 回数はイベントの時刻（試合の時計）で数えるので、ここは時計の時間のセット
    const et = setEventTable(M0, sets0, evs, goalName);
    const cell = (v, i) => `<td class="${i % 2 ? 'o' : 'w'}">${v ? `<b>${v}</b>` : '<span class="z">0</span>'}</td>`;
    const fpl = (pids) => pids.slice().sort((a, b) => (parseInt(mem(a).no, 10) || 999) - (parseInt(mem(b).no, 10) || 999)).map((pid) => `${badge(pid)}<small>${esc(last(pid))}</small>`).join('');
    const body = et.rows.map((r, i) => `<tr><td>${i + 1}位</td><td class="setn">${fpl(r.pids)}</td><td>${mmss(r.time)}</td>${r.c.map(cell).join('')}</tr>`).join('')
      + `<tr class="ex"><td></td><td class="setn">GKがいない区間・退場で空席の区間</td><td class="na">—</td>${et.special.map(cell).join('')}</tr>`
      + `<tr class="ex"><td></td><td class="setn">交代の瞬間の3秒未満の組み合わせ</td><td class="na">—</td>${et.other.map(cell).join('')}</tr>`
      + `<tr class="tot"><td></td><td class="setn">合計</td><td>${mmss(sets0.reduce((a, x) => a + x.time, 0))}</td>${et.total.map((v, i) => `<td class="${i % 2 ? 'o' : 'w'}"><b>${v}</b></td>`).join('')}</tr>`;
    s4b = `<section class="rvsec" id="rv4b"><div class="rvtt"><b>6. セットごとのシュート・ゾーン進入・FINISH SET PLAY</b><span>FP4人のセットがピッチにいる間に起きた回数（並びと出場時間は「4. セットの出場時間」のプレーイングタイム）。青＝自チーム、赤＝相手。シュートはSZ内シュートと得点を含む（OGは除く）。FSP＝FINISH SET PLAY</span></div>
    <div class="rvbox"><table class="rvtb rvset2"><tr><th>順位</th><th style="text-align:left">FP4人のセット</th><th>出場時間</th>${et.cols.map(([, l], i) => `<th class="${i % 2 ? 'o' : 'w'}">${l}</th>`).join('')}</tr>${body}</table></div></section>`;
  }

  return { active: 'acts', html: `<div class="rvw ${isCompact() ? 'compact' : ''}">${head}${printHead}<div class="rvbody">${s1}${s1b}${s2}${s3}${evs.length ? paceSection(C) + s4b + teamSection(C) + playerSection(C) : waitSections(m)}</div></div>`, bind: bindReview(m) };
}

function bindReview(m) {
  return (root) => {
    const bar = document.querySelector('.bar'); if (bar) document.documentElement.style.setProperty('--barh', bar.offsetHeight + 'px');
    const sel = root.querySelector('#rvMatch'); if (sel) sel.onchange = () => { location.hash = `#/m/${sel.value}/review`; };
    root.querySelectorAll('[data-tl]').forEach((r) => r.onclick = () => { const id = r.dataset.tl; if (tlHl.has(id)) tlHl.delete(id); else tlHl.add(id); r.classList.toggle('hl', tlHl.has(id)); });
    root.querySelectorAll('[data-sort]').forEach((th) => th.onclick = () => {
      const col = th.dataset.sort;
      if (!col) sortState = { col: '', dir: 'desc' };
      else if (sortState.col !== col) sortState = { col, dir: 'desc' };
      else if (sortState.dir === 'desc') sortState = { col, dir: 'asc' };
      else sortState = { col: '', dir: 'desc' };
      render();
    });
    root.querySelectorAll('[data-mode]').forEach((b) => b.onclick = () => { runPref = b.dataset.mode === 'run'; try { localStorage.setItem(modeKey, b.dataset.mode); } catch {} render(); });
    const pdf = root.querySelector('#rvPdf'); if (pdf) pdf.onclick = () => pdfChoice(m); // 印刷の画面で「PDFとして保存」（iPadは共有→「ファイルに保存」）
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
// PDFの書き出し：出場時間（1〜4）だけ／すべて（1〜8）
function pdfChoice(m) {
  const has = watchEvents(m.id).list.some((e) => !e.deleted);
  const md = openModal(`<h2>マッチレビューをPDFで書き出す</h2><p class="mu">書き出す項目を選んでください。印刷の画面で「PDFとして保存」を選びます（iPadは共有 → 「ファイルに保存」）。</p>
    <div class="pdfch"><button class="card" data-pdf="14"><b>出場時間だけ（1〜4）</b><span>出場時間・1回ごと・タイムライン・セット</span></button>
    <button class="card" data-pdf="all" ${has ? '' : 'disabled'}><b>すべて（1〜8）</b><span>${has ? '1〜4に、ペース・セット別・スコア・スタッツを加える' : 'イベントを入力すると選べます'}</span></button></div>
    <div class="row end"><button class="btn" id="pdfX">やめる</button></div>`);
  md.querySelector('#pdfX').onclick = closeModal;
  md.querySelectorAll('[data-pdf]').forEach((b) => b.onclick = () => {
    closeModal(); document.body.classList.toggle('pr14', b.dataset.pdf === '14');
    setTimeout(() => { window.print(); document.body.classList.remove('pr14'); }, 50);
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
      const bands = M.stints.filter((s) => s.pid === pid && s.period === p.key).map((s) => {
        const d = s.to - s.from, l = pp(p, s.from), w = pp(p, d);
        const small = d / p.len < (o.compact ? 0.16 : 0.09);
        return `<span class="tlb ${mem(pid).pos === 'GK' ? 'gk' : ''}" style="left:${l}%;width:${w}%">${small ? '' : mmss(d)}</span>${small ? `<span class="tls" style="left:${(+l + +w / 2).toFixed(3)}%">${mmss(d)}</span>` : ''}`;
      }).join('');
      const zeros = (M.zero || []).filter((s) => s.pid === pid && s.period === p.key)
        .map((s) => `<i class="tlz" style="left:${pp(p, s.from)}%" title="時計が止まっている間だけの出場"></i><span class="tlzl" style="left:${pp(p, s.from)}%">0:00</span>`).join('');
      const gl = marks.filter((g) => g.period === p.key).map((g) => `<i class="tlgl ${g.own ? 'own' : 'opp'}" style="left:${pp(p, gAt(g))}%"></i>`).join('');
      return (i ? who(pid, 'tlmid') : '') + `<div class="tlt">${futureOf(p)}${bands}${zeros}${gl}</div>`;
    }).join('');
    return `<div class="tlr ${o.hl?.has(pid) ? 'hl' : ''}" data-tl="${pid}" ${tlStyle}>${who(pid, 'tlnm')}${tracks}<b class="tlend">${badge(pid)}<span class="tlsum">${mmss(T[pid]?.total || 0)}</span></b></div>`;
  }).join('');
  // 得点・失点のラベル：目盛りの上の段（重なるときは段をずらす）。時刻は経過時間
  const lane = (p) => { const ls = stagger(marks.filter((g) => g.period === p.key).map((g) => ({ ...g, x: +pp(p, gAt(g)) })), o.compact ? 44 : 26);
    if (!marks.length) return '';
    const n = Math.max(1, ...ls.map((l) => l.row + 1));
    return `<div class="tlgoal" style="height:${n * 15 + 2}px">${ls.map((l) => `<span class="${l.own ? 'own' : 'opp'} ${l.x > 88 ? 'r' : l.x < 12 ? 'l' : ''}" style="left:${l.x}%;top:${l.row * 15}px">${esc(l.label)}</span>`).join('')}</div>`; };
  const tlHead = `<div class="tlr tlhead" ${tlStyle}><span></span>${axis.map((p, i) => (i ? '<span></span>' : '') + `<div class="tlaxw">${lane(p)}<div class="tlax">${ticksOf(p)}</div></div>`).join('')}<span>合計</span></div>`;
  return { tlHead, tlRows };
}
