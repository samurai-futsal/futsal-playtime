// マッチレビュー (spec 7章「マッチレビュー」). Items 1〜3 are built from the MATCH PLAY record only,
// so they are always shown. Items 4〜6 need events (④) and are not shown until then.
import { S, matchById, playerById, matchesOf, teamSettings, watchOps, watchEvents, opts } from './store.js';
import { setEventTable } from './events.js';
import { replay, periodLabel, periodLen, nowElapsed } from './engine.js';
import { matchModel, toRunning, playerTable, setTable, playedTime, periodSig, entryOrder } from './model.js';
import { esc, fmtShort } from './ui.js';
import { render } from './views.js';

const COL = { '1H': '#1F5FBF', '2H': '#8FB3EC', E1: '#0E8A6E', E2: '#86D3BE' };
const mmss = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const mmssUp = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000 - 1e-6)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
let tick = null;
let sortState = { col: '', dir: 'desc' }; // 出場時間の表の並べ替え
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
  const badge = (pid) => `<span class="no ${mem(pid).pos === 'GK' ? 'gk' : 'fp'}">${esc(mem(pid).no ?? '')}</span>`;
  const played = playedTime(M);
  const started = M.periods.some((p) => p.status !== 'none');

  // ---------- 試合の状況 ----------
  const pDone = (k) => st.periods[k]?.status === 'done';
  let state;
  if (st.matchOver) state = '<span class="rvst done">試合終了</span>';
  else if (M.live) {
    const len = periodLen(cfg, st.current);
    state = `<span class="rvst ${running ? 'run' : ''}">${running ? '試合進行中' : '停止中'}</span><span class="rvclk">${periodLabel(st.current)}　残り <b>${mmssUp(len - nowElapsed(st))}</b></span>`;
  } else if (st.askExtra) state = '<span class="rvst half">後半終了</span>';
  else if (pDone('1H') && !pDone('2H')) state = '<span class="rvst half">ハーフタイム</span><span class="rvclk">前半終了</span>';
  else if (pDone('2H') && !st.matchOver) state = '<span class="rvst half">延長前</span>';
  else state = '<span class="rvst">開始前</span>';

  const others = matchesOf(m.activityId).filter((x) => x.status === 'playing' || x.status === 'done' || x.id === m.id);
  const sw = `<select id="rvMatch" class="rvsel">${others.map((x) => `<option value="${x.id}" ${x.id === m.id ? 'selected' : ''}>vs ${esc(x.opponent)}（${fmtShort(x.date)}）</option>`).join('')}</select>`;
  const jumps = [['出場時間', 'rv1'], ['1回ごと', 'rv1b'], ['タイムライン', 'rv2'], ['セット', 'rv3'], ...(evs.length ? [['セット別', 'rv4b']] : [])].map(([t, id], i) => [i + 1, t, id]).map(([n, t, id]) => `<a class="rvjp" href="#${id}" data-jump="${id}"><b>${n}</b>${t}</a>`).join('');
  const head = `<div class="rvhead">
      <div class="rvrow"><a class="btn pri" href="#/m/${m.id}/play">‹ MATCH PLAY へ</a>${state}<span class="sp"></span>${sw}
        <span class="rvmode" role="group" aria-label="時間の数え方"><button class="${runMode ? '' : 'on'}" data-mode="play">プレーイングタイム</button><button class="${runMode ? 'on' : ''}" data-mode="run">ランニングタイム</button></span>
        <button class="btn" id="rvCompact">${isCompact() ? '大きく表示' : '縮小表示'}</button></div>
      <div class="rvjumps">${jumps}<span class="rvnote">4〜6（マッチ・ペース、スコア、スタッツ）はイベントを入力すると表示します</span>
        ${M.fixed.length ? `<span class="rvfix">記録の修正を反映：${M.fixed.map((k) => periodLabel(k)).join('・')}</span>` : ''}
        ${M.stale?.length ? `<a class="rvfix warn" href="#/m/${m.id}/fix">${M.stale.map((k) => periodLabel(k)).join('・')}はMATCH PLAYの記録が変わったため、保存した修正を使っていません</a>` : ''}</div></div>`;

  if (!started) {
    return { active: 'acts', html: `<div class="rvw">${head}<div class="card empty">まだ記録がありません。MATCH PLAYで先発を選んでスタートすると、ここに出場時間が表示されます。</div></div>`, bind: bindReview(m) };
  }

  const T = playerTable(M);
  const shownP = M.periods.filter((p) => p.status !== 'none' || !p.extra);
  const denomTxt = M.periods.filter((p) => p.status !== 'none').map((p) => `${p.label}${mmss(p.elapsed)}`).join('＋');

  // ---------- 1. 出場時間 ----------
  // 目盛りの最大＝ここまでに行ったピリオドの公式の長さの合計（前半中・ハーフタイムは20分、後半に入ると40分、延長に入ると延長の分も足す）
  const maxT = Math.max(M.periods.filter((p) => p.status !== 'none').reduce((s, p) => s + p.len, 0), 60000);
  const gridStep = maxT > 30 * 60000 ? 10 : 5; // 分
  const W = 1040, Hc = 170, L = 52;
  const n = byNo.length, cw = (W - L) / Math.max(n, 1), bw = Math.min(46, cw * 0.62);
  const sv = [`<svg class="rvbar" viewBox="0 0 ${W + 10} ${Hc + 64}" preserveAspectRatio="xMinYMin meet">`];
  for (let mi = 0; mi * 60000 <= maxT; mi += gridStep) {
    const y = 20 + Hc - Hc * (mi * 60000) / maxT;
    sv.push(`<line x1="${L}" y1="${y}" x2="${W + 8}" y2="${y}" stroke="${mi === 0 ? '#18233A' : '#E1E6EF'}"/><text x="${L - 6}" y="${y + 4}" font-size="12" fill="#8A94A6" text-anchor="end">${mi}:00</text>`);
  }
  byNo.forEach((pid, k) => {
    const x = L + 6 + k * cw + (cw - bw) / 2; let y = 20 + Hc;
    for (const p of M.periods) {
      const t = T[pid]?.per[p.key]?.time || 0; if (!t) continue;
      const h = Hc * t / maxT; y -= h;
      sv.push(`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" fill="${COL[p.key]}"/>`);
    }
    const tot = T[pid]?.total || 0;
    sv.push(`<text x="${(x + bw / 2).toFixed(1)}" y="${(y - 6).toFixed(1)}" font-size="15" font-weight="800" fill="#0B2D6B" text-anchor="middle">${mmss(tot)}</text>`);
    sv.push(`<text x="${(x + bw / 2).toFixed(1)}" y="${20 + Hc + 19}" font-size="15" font-weight="800" fill="${mem(pid).pos === 'GK' ? '#C8372D' : '#1F5FBF'}" text-anchor="middle">${esc(mem(pid).no ?? '')}</text>`
      + `<text x="${(x + bw / 2).toFixed(1)}" y="${20 + Hc + 37}" font-size="12.5" fill="#5F6B80" text-anchor="middle">${esc(last(pid))}</text>`);
  });
  sv.push('</svg>');
  const legend = M.periods.filter((p) => !p.extra || p.status !== 'none' || cfg.times?.extra).map((p) => `<span class="lg"><i style="background:${COL[p.key]}"></i>${p.label}</span>`).join('');
  // 表の並べ替え：見出しを押すと 多い順 → 少ない順 → 背番号順（初めは背番号順）
  const sortVal = (pid, col) => {
    const r = T[pid] || { per: {}, total: 0, count: 0 };
    if (col === 'total') return r.total; if (col === 'count' || col === 'rate') return col === 'count' ? r.count : r.total;
    const [k, f] = col.split(':'); const ps = M.periods.find((p) => p.key === k);
    if (!ps || ps.status === 'none') return -1; const c = r.per[k]; return f === 'n' ? (c?.count || 0) : (c?.time || 0);
  };
  const sorted = sortState.col ? byNo.slice().sort((a, b) => (sortVal(b, sortState.col) - sortVal(a, sortState.col)) * (sortState.dir === 'asc' ? -1 : 1) || byNo.indexOf(a) - byNo.indexOf(b)) : byNo;
  const sh = (col, label) => `<th class="srt ${sortState.col === col ? 'on' : ''}" data-sort="${col}">${label}<i>${sortState.col === col ? (sortState.dir === 'asc' ? '▲' : '▼') : '⇅'}</i></th>`;
  const th = shownP.map((p) => sh(`${p.key}:t`, p.label) + sh(`${p.key}:n`, '回数')).join('');
  const rows = sorted.map((pid) => {
    const r = T[pid] || { per: {}, total: 0, count: 0 };
    const cells = shownP.map((p) => {
      if (p.status === 'none') return '<td class="na">—</td><td class="na">—</td>';
      const c = r.per[p.key]; return `<td>${mmss(c?.time || 0)}</td><td>${c?.count || 0}</td>`;
    }).join('');
    return `<tr class="${r.total ? '' : 'zero'}"><td>${badge(pid)} ${esc(last(pid))}</td>${cells}<td><b>${mmss(r.total)}</b></td><td>${r.count}</td><td>${played ? Math.round(r.total / played * 100) : 0}%</td></tr>`;
  }).join('');
  const s1 = `<section class="rvsec" id="rv1"><div class="rvtt"><b>1. 出場時間</b><span>棒＝ピリオドを積み上げ、上の数字＝合計。${runMode ? '時間はすべてランニングタイム（キックオフから時計が0:00になるまでの実際の時間。止まっている間もピッチにいた選手の時間に入る）。' : ''}出場率は、ここまでの${TT}（${denomTxt}）に対して</span></div>
    <div class="rvbox"><div class="rvlg">${legend}</div>${sv.join('')}
    <table class="rvtb"><tr><th class="srt ${sortState.col ? '' : 'on'}" data-sort="">選手<i>${sortState.col ? '' : '背番号順'}</i></th>${th}${sh('total', '合計')}${sh('count', '回数')}${sh('rate', '出場率')}</tr>${rows}</table>
    <p class="rvhint">見出しを押すと並べ替え（多い順 → 少ない順 → 背番号順）。「選手」を押すと背番号順に戻ります</p></div></section>`;

  // ---------- 2. 1回ごとの出場時間 ----------
  // ピリオドごとに、選手の1回目・2回目…の出場時間。小さい数字＝入った〜出た（プレーイングタイムは残り時間、ランニングタイムはキックオフからの時間）
  const clk = (p, v) => (runMode ? mmss(v) : mmss(p.len - v));
  const onNow = new Set(M.live ? st.seats.filter(Boolean) : []);
  const perTables = M.periods.filter((p) => p.status !== 'none').map((p) => {
    const lists = Object.fromEntries(byNo.map((pid) => [pid, M.stints.filter((x) => x.period === p.key && x.pid === pid).sort((a, b) => a.from - b.from)]));
    const n = Math.max(1, ...Object.values(lists).map((l) => l.length));
    const hd = Array.from({ length: n }, (_, i) => `<th>${i + 1}回目</th>`).join('');
    const body = byNo.map((pid) => {
      const l = lists[pid]; const tot = l.reduce((a, x) => a + x.to - x.from, 0);
      const cells = Array.from({ length: n }, (_, i) => {
        const x = l[i]; if (!x) return '<td class="na"></td>';
        const d = x.to - x.from;
        const now = M.live && p.key === M.current && onNow.has(pid) && i === l.length - 1;
        return `<td class="${d < 60000 ? 'sh' : ''}"><b>${mmss(d)}</b><small>${clk(p, x.from)}〜${now ? '出場中' : clk(p, x.to)}</small></td>`;
      }).join('');
      return `<tr class="${l.length ? '' : 'zero'}"><td>${badge(pid)} ${esc(last(pid))}</td>${cells}<td class="sum"><b>${mmss(tot)}</b></td><td class="sum">${l.length}</td></tr>`;
    }).join('');
    return `<div class="rvst2"><b>${p.label}</b><span>（${mmss(p.elapsed)}）</span></div><table class="rvtb rvper"><tr><th>選手</th>${hd}<th>合計</th><th>回数</th></tr>${body}</table>`;
  }).join('');
  const s1b = `<section class="rvsec" id="rv1b"><div class="rvtt"><b>2. 1回ごとの出場時間</b><span>ピッチに入ってから出るまでの1回ごとの時間（${TT}）。大きい数字＝その回の時間、小さい数字＝入った〜出た（${runMode ? 'キックオフからの時間' : '時計の残り時間'}）。オレンジ＝1分未満。合計・回数は「1. 出場時間」と同じ</span></div>
    <div class="rvbox">${perTables}</div></section>`;

  // ---------- 3. 出場タイムライン ----------
  const axis = M.periods.filter((p) => !p.extra || p.status !== 'none' || st.askExtra || cfg.times?.extra);
  const total = axis.reduce((s, p) => s + p.len, 0);
  const off = {}; let acc = 0; for (const p of axis) { off[p.key] = acc; acc += p.len; }
  const pct = (v) => (v / total * 100).toFixed(3);
  // プレーイングタイムは残り時間（20:00 → 0:00）、ランニングタイムはキックオフからの時間（0:00 → 35:56）
  const ticks = runMode
    ? axis.map((p) => `<span style="left:${pct(off[p.key])}%">${p.label} 0:00</span><span style="left:${pct(off[p.key] + p.len / 2)}%">${mmss(p.len / 2)}</span>`).join('') + `<span style="left:100%">${mmss(axis[axis.length - 1]?.len || 0)}</span>`
    : axis.map((p) => `<span style="left:${pct(off[p.key])}%">${p.label} ${mmss(p.len)}</span><span style="left:${pct(off[p.key] + p.len / 2)}%">${mmss(p.len / 2)}</span>`).join('') + '<span style="left:100%">0:00</span>';
  const seps = axis.slice(1).map((p) => `<i class="tlsep" style="left:${pct(off[p.key])}%"></i>`).join('');
  const future = axis.filter((p) => p.status === 'none').map((p) => `<i class="tlfut" style="left:${pct(off[p.key])}%;width:${pct(p.len)}%"></i>`).join('')
    + (M.live ? `<i class="tlfut" style="left:${pct(off[M.current] + (M.periods.find((p) => p.key === M.current).elapsed))}%;width:${pct(M.periods.find((p) => p.key === M.current).len - M.periods.find((p) => p.key === M.current).elapsed)}%"></i>` : '');
  const tlRows = order.map((pid) => {
    const bands = M.stints.filter((s) => s.pid === pid && off[s.period] != null).map((s) => {
      const d = s.to - s.from, l = pct(off[s.period] + s.from), w = pct(d);
      const small = d / total < 0.045;
      return `<span class="tlb ${mem(pid).pos === 'GK' ? 'gk' : ''}" style="left:${l}%;width:${w}%">${small ? '' : mmss(d)}</span>${small ? `<span class="tls" style="left:${(+l + +w / 2).toFixed(3)}%">${mmss(d)}</span>` : ''}`;
    }).join('');
    return `<div class="tlr"><span>${badge(pid)} ${esc(last(pid))}</span><div class="tlt">${seps}${future}${bands}</div><b>${mmss(T[pid]?.total || 0)}</b></div>`;
  }).join('');
  const s2 = `<section class="rvsec" id="rv2"><div class="rvtt"><b>3. 出場タイムライン</b><span>並び＝GK、先発のFP（背番号順）、そのあとは初めてピッチに入った順。いつピッチにいたか${runMode ? '（目盛りはキックオフからの実際の時間）' : ''}。帯の中の数字＝その出場の時間（短い出場は帯の上）、右端＝合計</span></div>
    <div class="rvbox"><div class="tlr tlhead"><span></span><div class="tlax">${ticks}</div><span>合計</span></div>${tlRows}</div></section>`;

  // ---------- 4. セットの出場時間 ----------
  const sets = setTable(M);
  const setRows = sets.length ? sets.map((s, i) => `<tr><td>${i + 1}位</td><td class="setn">${s.pids.map((pid) => `${badge(pid)}<small>${esc(last(pid))}</small>`).join('')}</td><td><b>${mmss(s.time)}</b></td><td>${s.count}</td></tr>`).join('')
    : '<tr><td colspan="4" class="na" style="text-align:center">GKが1人・FPが4人そろった時間がまだありません</td></tr>';
  const s3 = `<section class="rvsec" id="rv3"><div class="rvtt"><b>4. セットの出場時間</b><span>FP4人の組み合わせ（長い順）。GKがいない区間（パワープレー）、退場で空席の区間、交代の瞬間の3秒未満の組み合わせは除く。得点・失点はイベント入力（④）のあとで表示</span></div>
    <div class="rvbox"><table class="rvtb rvset"><tr><th>順位</th><th style="text-align:left">FP4人のセット</th><th>出場時間</th><th>回数</th></tr>${setRows}</table></div></section>`;

  // ---------- 5. セットごとのシュート・ゾーン進入・FINISH SET PLAY（イベントがあるときだけ） ----------
  let s4b = '';
  if (evs.length) {
    const goalName = (id) => opts('goalTypes', true).find((o) => o.id === id)?.name || '';
    const et = setEventTable(M0, sets, evs, goalName);
    const cell = (v, i) => `<td class="${i % 2 ? 'o' : 'w'}">${v ? `<b>${v}</b>` : '<span class="z">0</span>'}</td>`;
    const fpl = (pids) => pids.slice().sort((a, b) => (parseInt(mem(a).no, 10) || 999) - (parseInt(mem(b).no, 10) || 999)).map((pid) => `${badge(pid)}<small>${esc(last(pid))}</small>`).join('');
    const body = et.rows.map((r, i) => `<tr><td>${i + 1}位</td><td class="setn">${fpl(r.pids)}</td><td>${mmss(r.time)}</td>${r.c.map(cell).join('')}</tr>`).join('')
      + `<tr class="ex"><td></td><td class="setn">GKがいない区間・退場で空席の区間</td><td class="na">—</td>${et.special.map(cell).join('')}</tr>`
      + `<tr class="ex"><td></td><td class="setn">交代の瞬間の3秒未満の組み合わせ</td><td class="na">—</td>${et.other.map(cell).join('')}</tr>`
      + `<tr class="tot"><td></td><td class="setn">合計</td><td>${mmss(sets.reduce((a, x) => a + x.time, 0))}</td>${et.total.map((v, i) => `<td class="${i % 2 ? 'o' : 'w'}"><b>${v}</b></td>`).join('')}</tr>`;
    s4b = `<section class="rvsec" id="rv4b"><div class="rvtt"><b>5. セットごとのシュート・ゾーン進入・FINISH SET PLAY</b><span>FP4人のセットがピッチにいる間に起きた回数（並びは「4. セットの出場時間」と同じ）。青＝自チーム、赤＝相手。シュートはSZ内シュートと得点を含む（OGは除く）。FSP＝FINISH SET PLAY</span></div>
    <div class="rvbox"><table class="rvtb rvset2"><tr><th>順位</th><th style="text-align:left">FP4人のセット</th><th>${runMode ? 'ランニング<br>タイム' : '出場時間'}</th>${et.cols.map(([, l], i) => `<th class="${i % 2 ? 'o' : 'w'}">${l}</th>`).join('')}</tr>${body}</table></div></section>`;
  }

  return { active: 'acts', html: `<div class="rvw ${isCompact() ? 'compact' : ''}">${head}<div class="rvbody">${s1}${s1b}${s2}${s3}${s4b}</div></div>`, bind: bindReview(m) };
}

function bindReview(m) {
  return (root) => {
    const bar = document.querySelector('.bar'); if (bar) document.documentElement.style.setProperty('--barh', bar.offsetHeight + 'px');
    const sel = root.querySelector('#rvMatch'); if (sel) sel.onchange = () => { location.hash = `#/m/${sel.value}/review`; };
    root.querySelectorAll('[data-sort]').forEach((th) => th.onclick = () => {
      const col = th.dataset.sort;
      if (!col) sortState = { col: '', dir: 'desc' };
      else if (sortState.col !== col) sortState = { col, dir: 'desc' };
      else if (sortState.dir === 'desc') sortState = { col, dir: 'asc' };
      else sortState = { col: '', dir: 'desc' };
      render();
    });
    root.querySelectorAll('[data-mode]').forEach((b) => b.onclick = () => { runPref = b.dataset.mode === 'run'; try { localStorage.setItem(modeKey, b.dataset.mode); } catch {} render(); });
    const c = root.querySelector('#rvCompact'); if (c) c.onclick = () => { try { localStorage.setItem(compactKey, isCompact() ? '0' : '1'); } catch {} render(); };
    root.addEventListener('click', (e) => {
      const j = e.target.closest('[data-jump]'); if (!j) return;
      e.preventDefault(); const el = document.getElementById(j.dataset.jump);
      if (el) scrollTo({ top: el.getBoundingClientRect().top + scrollY - (root.querySelector('.rvhead')?.offsetHeight || 0) - (document.querySelector('.bar')?.offsetHeight || 0) - 8, behavior: 'smooth' });
    });
  };
}
