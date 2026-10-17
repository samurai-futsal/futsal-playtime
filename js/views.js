// Screens for ① 試合までの準備 (spec 12章) and the navigation frame (spec 14章).
import {
  S, onChange, selectTeam, newId, put, del, now, teamPath, teamSettings, opts, playerById, activityById,
  matchById, playerName, sortPlayers, matchesOf, matchStatus, playedPlayerIds, inAnyMatch, today,
  DEFAULT_TIMES, DEFAULT_TEAM_SETTINGS, lastError, renameOption, addOption, moveOption, saveOptions, deleteOption, watchEvents, optName, watchOps, deviceId,
} from './store.js';
import { replay } from './engine.js';
import { exportBackup, promptBackup, restoreFromFile, lastBackupAt, setBackupVersion } from './backup.js';
import { vPlay, unmountPlay } from './matchplay.js';
import { vReview, stopReviewTick } from './review.js';
import { vFix } from './fix.js';
import { vEvents, vSplit, openTodo } from './evinput.js';
import { vStats } from './stats.js';
import { vAnalysis } from './analysis.js';
import { vSportscode } from './scview.js';
import { vScImport } from './scimportview.js';
import { vReport } from './report.js';
import { vGuide } from './guide.js';
import { vDatasheet } from './dsview.js';
import { vPhys, stopPhysTick } from './viewer.js';
import { $, $$, esc, fmtDate, fmtShort, no, openModal, closeModal, confirmBox, confirmTwice, toast, formVals, optionTagsId } from './ui.js';
export { promptBackup }; // 試合が終わったときのバックアップのお知らせ（matchplay.js から呼ぶ）

let ctx = null; // { fb, user, appVersion, swReg }
// アプリのファイル（sw.js の SHELL と同じ。更新の確認で、この端末のファイルが公開中のものと同じか比べる）
const SHELL_FILES = ['index.html', 'style.css', 'app.js', 'js/store.js', 'js/ui.js', 'js/views.js', 'js/engine.js', 'js/matchplay.js', 'js/model.js', 'js/review.js', 'js/keypad.js', 'js/fix.js', 'js/events.js', 'js/evinput.js', 'js/viewer.js', 'js/teamstats.js', 'js/stats.js', 'js/review58.js', 'js/analysis.js', 'js/sportscode.js', 'js/scview.js', 'js/scimport.js', 'js/scimportview.js', 'js/xlsx.js', 'js/datasheet.js', 'js/dsview.js', 'js/report.js', 'js/guide.js', 'js/options.js', 'js/backup.js', 'js/restoreplan.js', 'js/pdfsave.js', 'vendor/html2canvas.min.js'];
const FB_FILES = ['firebase-app.js', 'firebase-auth.js', 'firebase-firestore.js'].map((f) => 'https://www.gstatic.com/firebasejs/10.12.2/' + f);
export function startApp(c) {
  ctx = c;
  setBackupVersion(c.appVersion);
  try { const t = localStorage.getItem('fpt.team'); if (t) selectTeam(t); } catch {}
  onChange(render);
  addEventListener('hashchange', onHash);
  addEventListener('online', render); addEventListener('offline', render);
  onHash();
}

// ---------- navigation (「‹ 戻る」 = 1つ前の画面) ----------
const stack = [];
// 画面を離れる前の確認（記録の修正で保存していないときなど）。false を返すと移動しない
let leaveGuard = null;
export function setLeaveGuard(fn) {
  leaveGuard = fn;
  window.onbeforeunload = fn ? (e) => { e.preventDefault(); e.returnValue = ''; } : null;
}
let replacing = false; // goReturn で今の画面を置きかえている途中
function onHash() {
  const h = location.hash || '#/home';
  if (leaveGuard && leaveGuard(h) === false) { replacing = false; const prev = stack[stack.length - 1]; if (prev) history.replaceState(null, '', prev); return; }
  if (replacing) { replacing = false; if (stack.length) stack[stack.length - 1] = h; else stack.push(h); }
  else if (stack.length > 1 && stack[stack.length - 2] === h) stack.pop();
  else if (stack[stack.length - 1] !== h) stack.push(h);
  closeModal();
  render();
  scrollTo(0, 0);
}
export function goBack() { if (stack.length > 1) history.back(); else location.hash = '#/home'; }
// 「完了」「‹ 試合ページ」など、入力を終えて元の画面へ戻るとき（spec 14章：保存済みの入力画面には戻らない）。
// 1つ前がその画面なら履歴を1つ戻り、そうでなければ今の画面を置きかえる（どちらでも、あとの「‹ 戻る」で入力画面に戻らない）
export function goReturn(h) {
  if (!h || h === location.hash) return;
  if (stack.length > 1 && stack[stack.length - 2] === h) { history.back(); return; }
  replacing = true; location.replace(h);
}
document.addEventListener('click', (e) => {
  const a = e.target.closest?.('a.mpback, a[data-ret], .play a.cb.back');
  if (!a || e.defaultPrevented || e.button || e.metaKey || e.ctrlKey || e.shiftKey) return;
  e.preventDefault(); goReturn(a.getAttribute('href'));
});
const go = (h) => { location.hash = h; };

function route() {
  const parts = (location.hash || '#/home').replace(/^#\/?/, '').split('/').filter(Boolean);
  return { name: parts[0] || 'home', id: parts[1], sub: parts[2], x: parts[3] };
}

// ---------- frame ----------
function syncLabel() {
  if (!navigator.onLine) return '<span class="sy off">● オフライン（端末に保存）</span>';
  if (S.pending) return '<span class="sy wait">● 同期待ち</span>';
  return '<span class="sy">● 同期済み</span>';
}
function topbar(active) {
  const t = S.team;
  const nav = (key, label, href) => `<a class="nv ${active === key ? 'on' : ''}" href="${href}">${label}</a>`;
  return `<header class="bar">
    <button class="bk" id="btnBack">‹ 戻る</button>
    <a class="tm" href="#/teams">${esc(t ? t.name : 'チームを選ぶ')} ▾</a>
    ${t ? nav('home', 'ホーム', '#/home') + nav('players', '選手', '#/players') + nav('acts', '活動と試合', '#/acts') + nav('analysis', '分析', '#/analysis')
      + `<a class="nv srch ${active === 'search' ? 'on' : ''}" href="#/search">⌕ <span class="wide">試合を</span>探す</a>` : ''}
    <span class="sp"></span>${syncLabel()}
    <a class="nv ${active === 'settings' ? 'on' : ''}" href="#/settings">設定</a>
  </header>`;
}

const VIEWS = {
  home: vHome, teams: vTeams, players: vPlayers, acts: vActivities, a: vActivity, m: vMatch,
  search: vSearch, settings: vSettings, analysis: (r) => vAnalysis(r), guide: vGuide,
};

export function render() {
  const r = route();
  stopReviewTick(); // マッチレビューを開いている間だけ、出場中の時間を1秒ごとに進める
  stopPhysTick(); // フィジカルコーチ用の画面も同じ
  const main = $('#main');
  if (!S.ready.global || !S.ready.teams) { main.innerHTML = '<p class="mu pad">読み込み中…</p>'; return; }
  let name = r.name;
  if (!S.team && !['teams', 'settings', 'guide'].includes(name)) name = 'teams';
  if (S.team && !S.ready.team && !['teams', 'settings', 'guide'].includes(name)) { main.innerHTML = topbar('') + '<p class="mu pad">読み込み中…</p>'; bindFrame(); return; }
  const v = VIEWS[name] || vHome;
  const keep = captureInputs(main);
  const out = v(r);
  if (out.full) { // MATCH PLAY: whole screen, no top bar (spec 14章)
    main.innerHTML = out.html;
    out.bind && out.bind(main.querySelector('.play') || main);
    return;
  }
  unmountPlay();
  main.innerHTML = topbar(out.active ?? name) + `<div class="page">${out.html}</div>`;
  restoreInputs(main, keep);
  bindFrame();
  // bind to the freshly built page element so handlers never pile up across re-renders
  out.bind && out.bind(main.querySelector('.page'));
  if (lastError && lastError.code === 'permission-denied') toastOnce('データベースのルールにより読み書きできません。設定を確認してください');
}
let toasted = false;
function toastOnce(m) { if (!toasted) { toasted = true; toast(m); } }
function bindFrame() { const b = $('#btnBack'); b && (b.onclick = goBack); }
// keep what the user is typing when data updates re-render the screen
function captureInputs(root) {
  const a = document.activeElement;
  const vals = {};
  $$('input[id]:not([type=file]),textarea[id],select[id]', root).forEach((el) => { vals[el.id] = el.type === 'checkbox' ? el.checked : el.value; });
  return { vals, focus: a && a.id && root.contains(a) ? a.id : null, sel: a && 'selectionStart' in a ? [a.selectionStart, a.selectionEnd] : null };
}
function restoreInputs(root, k) {
  for (const [id, v] of Object.entries(k.vals)) {
    const el = root.querySelector('#' + CSS.escape(id));
    if (!el || el.dataset.fresh || el.type === 'file') continue;
    if (el.type === 'checkbox') el.checked = v; else el.value = v;
  }
  if (k.focus) { const el = root.querySelector('#' + CSS.escape(k.focus)); if (el) { el.focus(); try { k.sel && el.setSelectionRange(...k.sel); } catch {} } }
}

// ---------- ホーム ----------
function vHome() {
  const ms = S.matches;
  const td = today();
  const open = ms.filter((m) => m.status !== 'done');
  const byKick = (a, b) => ((a.date || '') + (a.kickoff || '')).localeCompare((b.date || '') + (b.kickoff || ''));
  // 試合中の試合（今日の日付）はいつもホームに出す。試合中のあいだは見出しを「試合中」にする（spec 14章）
  const liveToday = ms.filter((m) => m.status === 'playing' && m.date === td).sort(byKick);
  const next1 = open.filter((m) => (m.date || '') >= td).sort(byKick)[0]
    || [...open].sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0];
  const tops = liveToday.length ? liveToday : next1 ? [next1] : [];
  const isLive = tops.some((m) => m.status === 'playing');
  const recent = ms.filter((m) => !tops.includes(m) && (m.status === 'done' || (m.date || '') < td))
    .sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, 5);
  const nextCard = (next) => `<a class="card nextm" href="#/m/${next.id}">
        <div class="nm-l"><div class="mu">${esc(actName(next))}</div><div class="vs">vs ${esc(next.opponent)}</div>
        <div class="mu">${fmtDate(next.date)}${next.kickoff ? ' ' + esc(next.kickoff) + ' キックオフ' : ''}${next.venue ? '　' + esc(next.venue) : ''}</div></div>
        <div class="nm-r">${chip(matchStatus(next), next)}<span class="go">試合ページへ ›</span></div></a>`;
  const actName = (m) => activityById(m.activityId)?.name || '';
  const tile = (href, t, sub) => `<a class="tile" href="${href}"><b>${t}</b><span>${sub}</span></a>`;
  const activePlayers = S.players.filter((p) => p.status !== 'former').length;
  const backupNote = backupOverdue() ? `<div class="note warn">しばらくバックアップをしていません。<a href="#/settings">設定</a>から書き出してください。</div>` : '';
  return {
    html: `${backupNote}
    <div class="tiles">
      ${tile('#/players', '選手', `在籍 ${activePlayers}人`)}
      ${tile('#/acts', '活動と試合', `活動 ${S.activities.length}件・試合 ${ms.length}件`)}
      ${tile('#/analysis', '分析', '出場時間・スタッツ')}
    </div>
    <h2 class="h">${isLive ? '試合中' : '次の試合'}</h2>
    ${tops.length ? tops.map(nextCard).join('')
      : `<div class="card empty">予定の試合はまだありません。<a href="#/acts">活動と試合</a>から、活動の中に試合を作ってください。</div>`}
    <h2 class="h">最近の試合</h2>
    ${recent.length ? `<div class="card list">${recent.map((m) => matchRow(m, true)).join('')}</div>` : '<div class="card empty">まだありません</div>'}
    <div class="row end"><a class="btn" href="#/search">⌕ 試合を探す</a></div>`,
  };
}
function chip(st, m = null) {
  const c = { 準備中: 'c-prep', 準備完了: 'c-ready', 試合中: 'c-live', 未入力あり: 'c-todo', 記録完了: 'c-done' }[st] || '';
  // 未入力あり n：押すと、イベント入力が未入力・要確認のイベントだけを並べた形で開く
  if (st === '未入力あり' && m) return `<span class="chip ${c} todo" data-todo="${m.id}" title="押すと未入力のイベントだけを開きます">${esc(st)} ${m.evTodo || ''} ›</span>`;
  return `<span class="chip ${c}">${esc(st)}</span>`;
}
// 「未入力あり」のチップは試合の行（リンク）の中にあるので、先に受け取って行き先を変える
document.addEventListener('click', (e) => {
  const t = e.target.closest?.('[data-todo]'); if (!t) return;
  e.preventDefault(); e.stopPropagation();
  openTodo(t.dataset.todo); location.hash = `#/m/${t.dataset.todo}/events`;
}, true);
function matchRow(m, withAct = false) {
  return `<a class="lrow" href="#/m/${m.id}"><span class="d">${fmtShort(m.date)}</span>
    <span class="o">vs ${esc(m.opponent)}${withAct ? `<small>${esc(activityById(m.activityId)?.name || '')}${m.category ? '・' + esc(m.category) : ''}</small>` : ''}</span>${chip(matchStatus(m), m)}<span class="go">›</span></a>`;
}
function backupOverdue() {
  // remind only once a match has been played (spec 5章: 試合が終わるたびにバックアップを促す)
  if (!S.matches.some((m) => m.status === 'done' || m.status === 'playing')) return false;
  return Date.now() - lastBackupAt() > 14 * 864e5; // 最後の書き出しはクラウドに記録（どの端末で書き出しても同じ）
}

// ---------- チーム ----------
function vTeams() {
  const act = S.teams.filter((t) => !t.archived), arc = S.teams.filter((t) => t.archived);
  const row = (t) => `<div class="lrow static"><span class="o">${esc(t.name)}${t.id === S.teamId ? ' <span class="chip c-ready">選択中</span>' : ''}</span>
    ${t.archived ? `<button class="btn sm" data-unarc="${t.id}">一覧に戻す</button>` : `<button class="btn sm pri" data-pick="${t.id}">このチームを使う</button>`}
    <button class="btn sm" data-ren="${t.id}">名前を変える</button>
    ${t.archived ? '' : `<button class="btn sm" data-arc="${t.id}">アーカイブ</button>`}
    <button class="btn sm dangerline" data-del="${t.id}">削除</button></div>`;
  return {
    active: '',
    html: `<h1>チーム</h1>
    <p class="mu">チームごとに選手・活動・試合を分けて管理します。チームをまたいだ共有はしません。</p>
    <div class="card list">${act.length ? act.map(row).join('') : '<div class="empty">まだチームがありません。下で作ってください。</div>'}</div>
    <div class="card"><label for="newTeam">新しいチームを作る</label>
      <div class="row"><input id="newTeam" placeholder="例：U-19日本代表"><button class="btn pri" id="btnNewTeam">作る</button></div></div>
    ${arc.length ? `<h2 class="h">アーカイブしたチーム</h2><p class="mu">一覧から隠しているチームです。記録は残っていて、元に戻せます。</p><div class="card list">${arc.map(row).join('')}</div>` : ''}`,
    bind(root) {
      $('#btnNewTeam').onclick = () => {
        const name = $('#newTeam').value.trim(); if (!name) return toast('チームの名前を入れてください');
        const id = newId();
        put(['teams', id], { name, archived: false, deleted: false, createdAt: now(), settings: { ...DEFAULT_TEAM_SETTINGS } });
        $('#newTeam').value = ''; $('#newTeam').dataset.fresh = '1';
        selectTeam(id); toast(`「${name}」を作りました`); go('#/home');
      };
      root.onclick = async (e) => {
        const b = e.target.closest('button'); if (!b) return;
        const t = S.teams.find((x) => x.id === (b.dataset.pick || b.dataset.ren || b.dataset.arc || b.dataset.unarc || b.dataset.del));
        if (!t) return;
        if (b.dataset.pick) { selectTeam(t.id); go('#/home'); }
        if (b.dataset.unarc) put(['teams', t.id], { archived: false });
        if (b.dataset.arc) { if (await confirmBox({ title: `「${t.name}」をアーカイブしますか？`, body: '<p>一覧から隠します。記録は残り、いつでも元に戻せます。</p>', ok: 'アーカイブ' })) { put(['teams', t.id], { archived: true }); if (t.id === S.teamId) selectTeam(null); } }
        if (b.dataset.ren) {
          const m = openModal(`<h2>チームの名前を変える</h2><div class="mbody"><input id="renTeam" value="${esc(t.name)}"></div><div class="mfoot"><button class="btn" data-c>やめる</button><button class="btn pri" data-s>保存</button></div>`);
          m.querySelector('[data-c]').onclick = closeModal;
          m.querySelector('[data-s]').onclick = () => { const v = $('#renTeam').value.trim(); if (v) { put(['teams', t.id], { name: v }); closeModal(); } };
        }
        if (b.dataset.del) deleteTeam(t);
      };
    },
  };
}
function deleteTeam(t) {
  const m = openModal(`<h2>「${esc(t.name)}」を削除しますか？</h2><div class="mbody">
    <p>このチームの<b>選手・活動・試合の記録がすべて消えます</b>。元に戻せません。</p>
    <p>削除する前に、<button class="btn sm" id="bkNow">バックアップを書き出す</button></p>
    <label for="delName">確認のため、チーム名「${esc(t.name)}」を入力してください</label><input id="delName" autocomplete="off"></div>
    <div class="mfoot"><button class="btn" data-c>やめる</button><button class="btn danger" data-s disabled>削除する</button></div>`);
  const ok = m.querySelector('[data-s]');
  $('#delName').oninput = (e) => { ok.disabled = e.target.value.trim() !== t.name; };
  $('#bkNow').onclick = exportBackup;
  m.querySelector('[data-c]').onclick = closeModal;
  ok.onclick = () => { put(['teams', t.id], { deleted: true }); if (t.id === S.teamId) selectTeam(null); closeModal(); toast('削除しました'); };
}

// ---------- 選手 ----------
function vPlayers(r) {
  const tab = r.id === 'former' ? 'former' : 'active';
  const list = sortPlayers(S.players.filter((p) => (tab === 'former' ? p.status === 'former' : p.status !== 'former')));
  const sec = (pos) => {
    const ps = list.filter((p) => (pos === 'GK' ? p.pos === 'GK' : p.pos !== 'GK'));
    return `<h2 class="h">${pos}（${ps.length}人）</h2><div class="card list">${ps.length ? ps.map((p) => `<button class="lrow" data-edit="${p.id}">
      <span class="pos ${p.pos === 'GK' ? 'gk' : 'fp'}">${p.pos === 'GK' ? 'GK' : 'FP'}</span><span class="o">${esc(playerName(p))}<small>${esc(p.kana || '')}</small></span><span class="go">編集 ›</span></button>`).join('')
      : '<div class="empty">いません</div>'}</div>`;
  };
  const nFormer = S.players.filter((p) => p.status === 'former').length;
  return {
    html: `<div class="row between"><h1>選手</h1><button class="btn pri" id="btnAddP">＋ 選手を登録</button></div>
    <div class="seg"><a class="${tab === 'active' ? 'on' : ''}" href="#/players">在籍</a><a class="${tab === 'former' ? 'on' : ''}" href="#/players/former">過去所属（${nFormer}）</a></div>
    <p class="mu">GKとFPに分けて、ふりがな順に並べます。${tab === 'former' ? '過去所属の選手は招集の候補に出ませんが、過去の試合の記録には残ります。' : ''}</p>
    ${sec('GK')}${sec('FP')}`,
    bind(root) {
      $('#btnAddP').onclick = () => playerForm(null);
      root.addEventListener('click', (e) => { const b = e.target.closest('[data-edit]'); if (b) playerForm(playerById(b.dataset.edit)); });
    },
  };
}
function playerForm(p) {
  const isNew = !p; p = p || { pos: 'FP', status: 'active' };
  const canDelete = !isNew && !inAnyMatch(p.id);
  const m = openModal(`<h2>${isNew ? '選手を登録' : '選手を編集'}</h2><div class="mbody grid2">
    <div><label for="pLast">姓</label><input id="pLast" name="last" value="${esc(p.last || '')}"></div>
    <div><label for="pFirst">名</label><input id="pFirst" name="first" value="${esc(p.first || '')}"></div>
    <div class="span2"><label for="pKana">ふりがな</label><input id="pKana" name="kana" value="${esc(p.kana || '')}" placeholder="例：たにもと しゅんすけ"></div>
    <div class="span2"><label>ポジション</label><div class="seg">
      <label class="rad"><input type="radio" name="pos" value="GK" ${p.pos === 'GK' ? 'checked' : ''}>GK</label>
      <label class="rad"><input type="radio" name="pos" value="FP" ${p.pos !== 'GK' ? 'checked' : ''}>FP</label></div></div>
    ${isNew ? '' : `<div class="span2 sub">
      ${p.status === 'former' ? '<button class="btn sm" data-act="active">在籍に戻す</button>' : '<button class="btn sm" data-act="former">過去所属にする（移籍・退団）</button>'}
      ${canDelete ? '<button class="btn sm dangerline" data-act="delete">削除</button>' : '<span class="mu">試合に登録されたことがある選手は削除できません（過去所属にしてください）</span>'}</div>`}
  </div><div class="mfoot"><button class="btn" data-c>やめる</button><button class="btn pri" data-s>保存</button></div>`);
  autoKana($('#pLast'), $('#pFirst'), $('#pKana'), !p.kana);
  m.querySelector('[data-c]').onclick = closeModal;
  m.querySelector('[data-s]').onclick = () => {
    const v = formVals(m.querySelector('.mbody'));
    if (!v.last) return toast('姓を入れてください');
    const id = isNew ? newId() : p.id;
    put(teamPath('players', id), { last: v.last, first: v.first, kana: v.kana, pos: v.pos, ...(isNew ? { status: 'active', deleted: false, createdAt: now() } : {}) });
    closeModal(); toast(isNew ? `${v.last} ${v.first} を登録しました` : '保存しました');
  };
  m.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]'); if (!b) return;
    if (b.dataset.act === 'former') { put(teamPath('players', p.id), { status: 'former' }); closeModal(); toast('過去所属にしました'); }
    if (b.dataset.act === 'active') { put(teamPath('players', p.id), { status: 'active' }); closeModal(); toast('在籍に戻しました'); }
    if (b.dataset.act === 'delete' && await confirmBox({ title: `${playerName(p)} を削除しますか？`, body: '<p>元に戻せません。</p>', ok: '削除', danger: true })) {
      put(teamPath('players', p.id), { deleted: true }); toast('削除しました');
    }
  });
}

// ふりがなの自動入力：姓・名を日本語入力で打つとき、漢字に変換する前のひらがなを拾って
// ふりがな欄に入れる（変換の辞書は使わない）。ふりがな欄を自分で直したら、それ以降は上書きしない。
function autoKana(lastEl, firstEl, kanaEl, enabled) {
  let auto = enabled;
  const read = new Map([[lastEl, ''], [firstEl, '']]);
  const kata2hira = (s) => s.replace(/[\u30a1-\u30f6]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
  const isKana = (s) => /^[\u3041-\u309f\u30a1-\u30fcー\s]+$/.test(s);
  const pending = new Map();
  const fill = () => { if (auto) kanaEl.value = [read.get(lastEl), read.get(firstEl)].filter(Boolean).join(' '); };
  for (const el of [lastEl, firstEl]) {
    el.addEventListener('compositionupdate', (e) => { if (e.data && isKana(e.data)) pending.set(el, kata2hira(e.data)); });
    el.addEventListener('compositionend', () => {
      if (pending.get(el)) { read.set(el, read.get(el) + pending.get(el)); pending.delete(el); fill(); }
    });
    el.addEventListener('input', (e) => {
      if (!el.value) { read.set(el, ''); fill(); return; }
      // かなをそのまま確定した場合（変換しない名前など）は、その文字をふりがなとして使う
      if (!e.isComposing && isKana(el.value)) { read.set(el, kata2hira(el.value)); fill(); }
    });
  }
  kanaEl.addEventListener('input', () => { auto = false; });
}

// ---------- 活動と試合 ----------
function vActivities() {
  const list = [...S.activities].sort((a, b) => (b.start || '').localeCompare(a.start || ''));
  return {
    html: `<div class="row between"><h1>活動と試合</h1><button class="btn pri" id="btnAddA">＋ 活動を作る</button></div>
    <p class="mu">合宿・大会・リーグ戦の節などの「活動」を作り、その中に招集メンバーと試合を登録します。</p>
    <div class="card list">${list.length ? list.map((a) => {
      const n = Object.keys(a.members || {}).length, mc = matchesOf(a.id).length;
      return `<a class="lrow" href="#/a/${a.id}"><span class="chip c-type">${esc(a.type || '活動')}</span>
        <span class="o">${esc(a.name)}<small>${fmtDate(a.start, false)}${a.end && a.end !== a.start ? ' 〜 ' + fmtDate(a.end, false) : ''}</small></span>
        <span class="mu">招集 ${n}人・試合 ${mc}件</span><span class="go">›</span></a>`;
    }).join('') : '<div class="empty">まだ活動がありません。「＋ 活動を作る」から作ってください。</div>'}</div>`,
    bind() { $('#btnAddA').onclick = () => activityForm(null); },
  };
}
function timesFields(t, locked = false) {
  // 延長戦の長さは「延長戦あり」のときだけ出す。locked＝試合が始まったあと（事前設定では変えられない。2026-10-17 決定）
  const dis = locked ? 'disabled' : '';
  return `<div><label for="fHalf">前後半の長さ（分）</label><input id="fHalf" name="half" type="number" min="1" max="40" inputmode="numeric" value="${esc(t.half)}" ${dis}></div>
    <div><label class="chk" style="margin-top:34px"><input id="fExtra" type="checkbox" name="extra" ${t.extra ? 'checked' : ''} ${dis}> 延長戦あり</label></div>
    <div id="extraBox" ${t.extra ? '' : 'hidden'}><label for="fExtraHalf">延長戦の長さ（分・前後半それぞれ）</label><input id="fExtraHalf" name="extraHalf" type="number" min="1" max="20" inputmode="numeric" value="${esc(t.extraHalf)}" ${dis}></div>
    ${locked ? '<p class="span2 note info">試合が始まったあとは、記録の修正の『試合情報』で直せます</p>' : ''}`;
}
document.addEventListener('change', (e) => {
  if (e.target.id === 'fExtra') { const b = document.getElementById('extraBox'); if (b) b.hidden = !e.target.checked; }
});
function readTimes(v) {
  const half = Math.max(1, Math.min(40, parseInt(v.half, 10) || DEFAULT_TIMES.half));
  const extraHalf = Math.max(1, Math.min(20, parseInt(v.extraHalf, 10) || DEFAULT_TIMES.extraHalf));
  return { half, extra: !!v.extra, extraHalf };
}
function activityForm(a) {
  const isNew = !a; a = a || { type: '', start: today(), end: today(), times: { ...DEFAULT_TIMES } };
  const t = { ...DEFAULT_TIMES, ...(a.times || {}) };
  const m = openModal(`<h2>${isNew ? '活動を作る' : '活動を編集'}</h2><div class="mbody grid2">
    <div><label for="aType">種類</label><select id="aType" name="typeId">${optionTagsId(opts('activityTypes'), a.typeId, { blank: '選んでください', all: opts('activityTypes', true) })}${!a.typeId && a.type ? `<option value="=" selected>${esc(a.type)}</option>` : ''}</select></div>
    <div><label for="aName">名前</label><input id="aName" name="name" value="${esc(a.name || '')}" placeholder="例：〇〇カップ"></div>
    <div><label for="aStart">開始日</label><input id="aStart" name="start" type="date" value="${esc(a.start || '')}"></div>
    <div><label for="aEnd">終了日</label><input id="aEnd" name="end" type="date" value="${esc(a.end || '')}"></div>
    <div class="span2 subh">試合時間の初期値（この活動で試合を作るときに入る値）</div>
    ${timesFields(t)}
    ${isNew ? '' : '<div class="span2 sub"><button class="btn sm dangerline" data-delA>この活動を削除</button></div>'}
  </div><div class="mfoot"><button class="btn" data-c>やめる</button><button class="btn pri" data-s>保存</button></div>`);
  m.querySelector('[data-c]').onclick = closeModal;
  m.querySelector('[data-s]').onclick = () => {
    const v = formVals(m.querySelector('.mbody'));
    if (!v.name) return toast('活動の名前を入れてください');
    if (!v.start) return toast('開始日を入れてください');
    const end = v.end && v.end >= v.start ? v.end : v.start;
    const id = isNew ? newId() : a.id;
    put(teamPath('activities', id), { ...(v.typeId === '=' ? {} : { typeId: v.typeId, type: optName('activityTypes', v.typeId) }), name: v.name, start: v.start, end, times: readTimes(v), ...(isNew ? { members: {}, deleted: false, createdAt: now() } : {}) });
    closeModal(); toast('保存しました');
    if (isNew) go('#/a/' + id);
  };
  const d = m.querySelector('[data-delA]');
  d && (d.onclick = async () => {
    const ms = matchesOf(a.id);
    if (ms.some((x) => x.status === 'playing')) return blockedLive(true);
    const ok = await confirmTwice(
      { title: `「${a.name}」を削除しますか？`, body: ms.length ? `<p>この活動の<b>試合 ${ms.length}件と、その記録も消えます</b>。</p>` : '<p>招集メンバーの情報も消えます。</p>', ok: '削除する', danger: true },
      { title: '本当に削除しますか？', body: '<p>元に戻せません。</p>', ok: '削除する', danger: true });
    if (!ok) return;
    ms.forEach((x) => put(teamPath('matches', x.id), { deleted: true }));
    put(teamPath('activities', a.id), { deleted: true });
    toast('削除しました'); go('#/acts');
  });
}

// ---------- 活動のページ（招集メンバーと試合） ----------
let actEditOrder = null; // 編集を始めたときの並び { id: 活動, ids }
function vActivity(r) {
  const a = activityById(r.id);
  if (!a) return { active: 'acts', html: '<div class="card empty">この活動は見つかりません（削除された可能性があります）。<a href="#/acts">活動と試合へ</a></div>' };
  const editMode = r.sub === 'edit';
  const mem = a.members || {};
  const played = playedPlayerIds(a.id);
  const ids = Object.keys(mem).filter((id) => playerById(id));
  // 見るときも編集のときも同じ並び（GK→FP、背番号順）。編集中は、編集を始めたときの並びのまま動かさない（番号を打っている間に枠が動かないように）
  const byNo = sortPlayers(ids.map(playerById)).sort((x, y) => (x.pos === y.pos ? 0 : x.pos === 'GK' ? -1 : 1) || (parseInt(mem[x.id]?.no, 10) || 999) - (parseInt(mem[y.id]?.no, 10) || 999));
  if (!editMode) actEditOrder = null;
  else if (!actEditOrder || actEditOrder.id !== a.id) actEditOrder = { id: a.id, ids: byNo.map((p) => p.id) };
  const at = (p) => { const k = actEditOrder.ids.indexOf(p.id); return k < 0 ? 1e9 : k; };
  const sorted = editMode ? byNo.slice().sort((x, y) => at(x) - at(y)) : byNo;
  const counts = {}; ids.forEach((id) => { const n = String(mem[id]?.no ?? '').trim(); if (n) counts[n] = (counts[n] || 0) + 1; });
  const dup = Object.keys(counts).filter((n) => counts[n] > 1);
  const tile = (p) => {
    const n = mem[p.id]?.no ?? '';
    const isDup = dup.includes(String(n).trim());
    if (!editMode) return `<div class="mtile">${no(n || '—', p.pos)}<span>${esc(playerName(p))}</span></div>`;
    return `<div class="mtile edit ${isDup ? 'dup' : ''}"><input id="no_${p.id}" class="noin" inputmode="numeric" value="${esc(n)}" data-no="${p.id}" aria-label="${esc(playerName(p))}の背番号">
      <span>${esc(playerName(p))}<small>${p.pos === 'GK' ? 'GK' : 'FP'}</small></span>
      ${played.has(p.id) ? '<span class="mu xs">出場済み</span>' : `<button class="btn xs" data-out="${p.id}">外す</button>`}</div>`;
  };
  const ms = matchesOf(a.id);
  return {
    active: 'acts',
    html: `<div class="crumb"><a href="#/acts">活動と試合</a> › ${esc(a.name)}</div>
    <div class="row between"><div><span class="chip c-type">${esc(a.type || '活動')}</span> <h1 class="inl">${esc(a.name)}</h1>
      <div class="mu">${fmtDate(a.start)}${a.end && a.end !== a.start ? ' 〜 ' + fmtDate(a.end) : ''}　試合時間の初期値：前後半 各${a.times?.half ?? 20}分・延長${a.times?.extra ? `あり（各${a.times.extraHalf}分）` : 'なし'}</div></div>
      <button class="btn" id="btnEditA">活動を編集</button></div>

    <div class="row between mt"><h2 class="h">招集メンバー（${ids.length}人）</h2>
      <div class="row">${editMode ? '<button class="btn pri" id="btnDone">完了</button>' : '<button class="btn" id="btnAddM">＋ メンバーを追加</button><a class="btn" href="#/a/' + a.id + '/edit">編集</a>'}</div></div>
    ${editMode ? `<p class="mu">背番号を直したり、招集から外したりできます。この活動の試合に出場した選手は外せません。</p>` : ''}
    ${dup.length ? `<div class="note bad">背番号 ${dup.map(esc).join('・')} が重なっています</div>` : ''}
    <div class="card"><div class="mgrid ${editMode ? 'edit' : ''}">${sorted.length ? sorted.map(tile).join('') : '<div class="empty">まだいません。「＋ メンバーを追加」から選んでください。</div>'}</div></div>

    <div class="row between mt"><h2 class="h">試合（${ms.length}件）</h2><button class="btn pri" id="btnAddMatch">＋ 試合を作る</button></div>
    <div class="card list">${ms.length ? ms.map((m) => `<div class="lrow static"><span class="d">${fmtShort(m.date)}${m.kickoff ? `<small>${esc(m.kickoff)}</small>` : ''}</span>
        <span class="o">vs ${esc(m.opponent)}<small>${esc(m.category || '')}</small></span>${chip(matchStatus(m), m)}
        <a class="btn sm pri" href="#/m/${m.id}">開く</a><button class="btn sm" data-editm="${m.id}">編集</button><button class="btn sm dangerline" data-delm="${m.id}">削除</button></div>`).join('')
      : '<div class="empty">まだ試合がありません</div>'}</div>`,
    bind(root) {
      $('#btnEditA').onclick = () => activityForm(a);
      $('#btnAddMatch').onclick = () => matchForm(null, a);
      const add = $('#btnAddM'); add && (add.onclick = () => addMembers(a));
      const done = $('#btnDone'); done && (done.onclick = () => goReturn('#/a/' + a.id));
      root.addEventListener('change', (e) => {
        const id = e.target.dataset.no; if (!id) return;
        const v = e.target.value.trim();
        put(teamPath('activities', a.id), { members: { [id]: { no: v } } });
        // まだ始まっていない試合（準備中・準備完了）の試合メンバーの背番号も合わせる。始まった試合の記録は変えない
        let n = 0;
        for (const x of matchesOf(a.id)) {
          if (x.status === 'playing' || x.status === 'done' || !x.members?.[id] || String(x.members[id].no ?? '') === v) continue;
          put(teamPath('matches', x.id), { members: { [id]: { no: v } } }); n++;
        }
        if (n) toast(`まだ始まっていない試合（${n}件）の背番号も変えました`);
      });
      root.addEventListener('click', async (e) => {
        const out = e.target.closest('[data-out]');
        if (out) {
          const p = playerById(out.dataset.out);
          if (await confirmBox({ title: `${playerName(p)} を招集から外しますか？`, ok: '外す' })) put(teamPath('activities', a.id), { members: { [p.id]: del() } });
        }
        const em = e.target.closest('[data-editm]'); if (em) go('#/m/' + em.dataset.editm + '/setup');
        const dm = e.target.closest('[data-delm]'); if (dm) deleteMatch(matchById(dm.dataset.delm));
      });
    },
  };
}
function addMembers(a) {
  const mem = a.members || {};
  const cand = sortPlayers(S.players.filter((p) => p.status !== 'former' && !mem[p.id]));
  if (!cand.length) { toast(S.players.length ? '在籍の選手は全員招集済みです' : '先に「選手」で選手を登録してください'); return; }
  const m = openModal(`<h2>招集メンバーを追加</h2><div class="mbody">
    <p class="mu">追加する選手を選んでください。背番号は追加したあと「編集」で入れられます。</p>
    <div class="row"><button class="btn sm" data-all>全員を選ぶ</button></div>
    <div class="picks">${cand.map((p) => `<label class="pick"><input type="checkbox" value="${p.id}"><span class="pos ${p.pos === 'GK' ? 'gk' : 'fp'}">${p.pos === 'GK' ? 'GK' : 'FP'}</span>${esc(playerName(p))}</label>`).join('')}</div>
  </div><div class="mfoot"><button class="btn" data-c>やめる</button><button class="btn pri" data-s>追加</button></div>`, { wide: true });
  m.querySelector('[data-c]').onclick = closeModal;
  m.querySelector('[data-all]').onclick = () => $$('.picks input', m).forEach((c) => { c.checked = true; });
  m.querySelector('[data-s]').onclick = () => {
    const ids = $$('.picks input:checked', m).map((c) => c.value);
    if (!ids.length) return toast('選手を選んでください');
    const add = {}; ids.forEach((id) => { add[id] = { no: '' }; });
    put(teamPath('activities', a.id), { members: add });
    closeModal(); toast(`${ids.length}人を追加しました。背番号は「編集」で入れてください`);
    go('#/a/' + a.id + '/edit');
  };
}
function matchForm(mt, a) {
  // create only; editing an existing match happens on the 事前設定 page
  const t = { ...DEFAULT_TIMES, ...(a.times || {}) };
  const d = a.start && a.start > today() ? a.start : (a.end && a.end < today() ? a.start : today());
  const m = openModal(`<h2>試合を作る</h2><div class="mbody grid2">
    <div><label for="mDate">日付</label><input id="mDate" name="date" type="date" value="${esc(d)}"></div>
    <div><label for="mOpp">対戦相手</label><input id="mOpp" name="opponent" placeholder="例：サンプルFC"></div>
    <div><label for="mCat">試合の区分（任意）</label><select id="mCat" name="categoryId">${optionTagsId(opts('matchCategories'), '', { blank: 'なし' })}</select></div>
    <div><label for="mKo">キックオフ時刻（任意）</label><input id="mKo" name="kickoff" type="time"></div>
    <div class="span2"><label for="mVenue">会場（任意）</label><input id="mVenue" name="venue"></div>
    <div class="span2 subh">試合時間（活動の初期値）</div>
    ${timesFields(t)}
  </div><div class="mfoot"><button class="btn" data-c>やめる</button><button class="btn pri" data-s>作る</button></div>`);
  m.querySelector('[data-c]').onclick = closeModal;
  m.querySelector('[data-s]').onclick = () => {
    const v = formVals(m.querySelector('.mbody'));
    if (!v.date) return toast('日付を入れてください');
    if (!v.opponent) return toast('対戦相手を入れてください');
    const id = newId(); const ts = teamSettings();
    put(teamPath('matches', id), {
      activityId: a.id, date: v.date, opponent: v.opponent, categoryId: v.categoryId, category: optName('matchCategories', v.categoryId), kickoff: v.kickoff, venue: v.venue, memo: '',
      times: readTimes(v), colorTimer: { orange: ts.colorOrange, red: ts.colorRed }, members: {}, status: 'prep',
      deleted: false, createdAt: now(), createdOrder: Date.now(),
    });
    closeModal(); toast('試合を作りました'); go('#/m/' + id);
  };
}
function blockedLive(act = false) {
  return confirmBox({ title: act ? '試合中の試合がある活動は削除できません' : '試合中の試合は削除できません', body: act ? '<p>この活動の中に、いま「試合中」の試合があります。MATCH PLAYで試合を終えてから削除してください。</p>' : '<p>この試合はいま「試合中」です。MATCH PLAYで試合を終えてから削除してください。</p>', ok: 'わかりました', cancel: '閉じる' });
}
async function deleteMatch(m) {
  if (!m) return;
  if (m.status === 'playing') return blockedLive();
  const hasRec = m.status === 'playing' || m.status === 'done';
  const ok = await confirmTwice(
    { title: `vs ${m.opponent}（${fmtShort(m.date)}）を削除しますか？`, body: hasRec ? '<p><b>出場時間やイベントの記録も消えます。</b></p><p>削除する前にバックアップを書き出すことをおすすめします。</p>' : '<p>事前設定と試合メンバーが消えます。</p>', ok: '削除する', danger: true },
    { title: '本当に削除しますか？', body: '<p>元に戻せません。</p>', ok: '削除する', danger: true });
  if (!ok) return;
  put(teamPath('matches', m.id), { deleted: true }); toast('削除しました');
}

// ---------- 試合ページ ----------
function vMatch(r) {
  const m = matchById(r.id);
  if (!m) return { active: 'acts', html: '<div class="card empty">この試合は見つかりません（削除された可能性があります）。<a href="#/acts">活動と試合へ</a></div>' };
  if (r.sub === 'setup') return vMatchSetup(m);
  if (r.sub === 'members') return vMatchMembers(m);
  if (r.sub === 'review') return vReview(m);
  if (r.sub === 'fix') return vFix(m);
  if (r.sub === 'events') return vEvents(m, { rt: r.x === 'rt' });
  if (r.sub === 'split') return vSplit(m);
  if (r.sub === 'stats') return vStats(m);
  if (r.sub === 'analysis') return vAnalysis(r, m);
  if (r.sub === 'sportscode') return vSportscode(m);
  if (r.sub === 'scimport') return vScImport(m);
  if (r.sub === 'datasheet') return vDatasheet(m);
  if (r.sub === 'report') return vReport(m);
  if (r.sub === 'physical') return vPhys(m);
  if (r.sub === 'play') {
    if (Object.keys(m.members || {}).length < 5) return { active: 'acts', html: `<div class="card empty">MATCH PLAYを開くには、試合メンバーを5人以上選んでください。<a href="#/m/${m.id}/members">試合メンバーへ</a></div>` };
    return vPlay(m);
  }
  const a = activityById(m.activityId);
  const st = matchStatus(m);
  const nMem = Object.keys(m.members || {}).length;
  const t = { ...DEFAULT_TIMES, ...(m.times || {}) };
  // ボタン：説明は短く、改行する位置を決めておく（変な位置で折り返さない）。kind：rec＝記録する／see＝見るだけ／out＝書き出す
  const btn = (label, sub, href, { done = null, pri = false, kind = '' } = {}) => `<a class="act ${kind} ${pri ? 'pri' : ''}" href="${href}">
      <b>${label}${done === true ? ' <span class="ok">✓</span>' : done === false ? ' <span class="wait">未</span>' : ''}</b><span>${sub.split('\n').map((x) => `<span class="ln">${x}</span>`).join('')}</span></a>`;
  return {
    active: 'acts',
    bind: bindPostInputs(m),
    html: `<div class="crumb"><a href="#/acts">活動と試合</a> › <a href="#/a/${a?.id}">${esc(a?.name || '')}</a> › vs ${esc(m.opponent)}</div>
    <div class="row between"><div><h1 class="inl">vs ${esc(m.opponent)}</h1> ${chip(st, m)}
      <div class="mu">${fmtDate(m.date)}${m.kickoff ? ' ' + esc(m.kickoff) + ' キックオフ' : ''}${m.category ? '　' + esc(m.category) : ''}${m.venue ? '　' + esc(m.venue) : ''}　前後半 各${t.half}分・延長${t.extra ? `あり（各${t.extraHalf}分）` : 'なし'}</div></div></div>
    <h2 class="h">試合前</h2>
    <div class="acts acts2">
      ${btn('事前設定', '日付・相手・区分\n試合時間・カラータイマー', `#/m/${m.id}/setup`, { done: true })}
      ${btn('試合メンバー', `${nMem}人（最大25人）\nパワープレー可能な選手`, `#/m/${m.id}/members`, { done: nMem >= 5, pri: nMem < 5 })}
    </div>
    <h2 class="h">試合中</h2>
    <div class="grp">記録する</div>
    <div class="acts acts2">
      ${btn('MATCH PLAY', 'ベンチの記録係が使う\n交代・時計・出場時間（1試合に1台）', `#/m/${m.id}/play`, { pri: nMem >= 5 && m.status !== 'done', kind: 'rec' })}
      ${btn('リアルタイム入力', 'ベンチ外スタッフが使う\nPC・iPadでイベントを入力', `#/m/${m.id}/events/rt`, { kind: 'rec' })}
    </div>
    <div class="grp">見る（記録はしない）</div>
    <div class="acts acts3">
      ${btn('フィジカルコーチ用 <small class="ro">閲覧専用</small>', 'ランニングタイムで\n今の出場・休み・合計出場', `#/m/${m.id}/physical`, { kind: 'see' })}
      ${btn('マッチレビュー', '出場時間・タイムライン・セット\nPDFでも書き出せる ※試合後も', `#/m/${m.id}/review`, { kind: 'see' })}
      ${btn('マッチスタッツ', 'シュート・ゾーン進入などの比較\nいつものシートの形 ※試合後も', `#/m/${m.id}/stats`, { kind: 'see' })}
    </div>
    <h2 class="h">試合後</h2>
    <div class="grp">入れる・直す</div>
    <div class="acts acts2">
      ${btn('イベント入力', '映像を見ながら入力\n試合中に入れたものの確認も', `#/m/${m.id}/events`, { kind: 'rec', pri: st === '未入力あり' })}
      ${btn('記録の修正', '交代・スタメン・退場\nパワープレー・試合情報', `#/m/${m.id}/fix`, { kind: 'rec' })}
      ${btn('Sportscodeから取り込み', 'XML・CSVを読み込んで\nイベント入力に自動で記録', `#/m/${m.id}/scimport`, { kind: 'rec' })}
    </div>
    ${postInputs(m)}
    <div class="grp">見る（記録はしない）</div>
    <div class="acts acts2">
      ${btn('分析', 'この試合・大会全体\n選手ごとのスタッツ', `#/m/${m.id}/analysis`, { kind: 'see' })}
    </div>
    <div class="grp">書き出す（ハーフタイムでも、その時点までの記録で）</div>
    <div class="acts acts3">
      ${btn('マッチスタッツ（PDF）', 'いつものシートの形\n上の表・下の表で2ページ', `#/m/${m.id}/stats/print`, { kind: 'out' })}
      ${btn('マッチレビュー（PDF）', '出場時間だけ（1〜4）\nまたは すべて（1〜8）', `#/m/${m.id}/review/pdf`, { kind: 'out' })}
      ${btn('マッチレポート（PDF）', 'A4横・試合のすべて', `#/m/${m.id}/report/pdf`, { kind: 'out' })}
      ${btn('データシート（Excel）', 'イベント一覧・選手スタッツ\n数式で集計', `#/m/${m.id}/datasheet`, { kind: 'out' })}
      ${btn('Sportscode（XML・CSV）', '出場の帯とイベント\nSportscode・Excel用', `#/m/${m.id}/sportscode`, { kind: 'out' })}
    </div>
    <p class="mu actnote">左の色：青＝記録する（記録が変わる）／緑＝見るだけ／茶＝書き出す</p>`,
  };
}
// 試合後に手で入れる数字：ポゼッション率（m.possession：自チームの%）とPK戦
// m.pk = { own, opp, kicks: [{ pid, res }] }（なければ null）。kicks は自チームのキッカーを蹴った順に。res：goal＝成功／saved＝GKが止めた／missed＝枠外・ポスト
// キッカーを入れたときは、自チームのスコアは成功の数（自動）。相手のスコアは手で入れる
export const PK_RES = [['goal', '成功'], ['saved', '失敗（GKが止めた）'], ['missed', '失敗（枠外・ポスト）']];
// コース（キッカーから見た向き）
export const PK_COURSE = [['tl', '左上'], ['tc', '中央上'], ['tr', '右上'], ['bl', '左下'], ['bc', '中央下'], ['br', '右下'], ['ol', '左枠外'], ['ot', '上枠外'], ['or', '右枠外']];
export const pkOwnScore = (pk) => (pk?.kicks?.length ? pk.kicks.filter((k) => k.res === 'goal').length : pk?.own ?? 0);
function postInputs(m) {
  const ps = m.possession != null && m.possession !== '' ? m.possession : '';
  const pk = m.pk && typeof m.pk === 'object' ? m.pk : null;
  const kicks = pk?.kicks || [];
  const mem = Object.entries(m.members || {}).sort((a, b) => (parseInt(a[1].no, 10) || 999) - (parseInt(b[1].no, 10) || 999));
  const pOpts = (sel) => `<option value="">選手を選ぶ</option>${mem.map(([pid, x]) => `<option value="${pid}" ${pid === sel ? 'selected' : ''}>${esc(x.no ?? '')} ${esc(playerById(pid)?.last || '')} ${esc(playerById(pid)?.first || '')}</option>`).join('')}`;
  const cOpts = (sel) => `<option value="">コースを選ぶ</option>${PK_COURSE.map(([v, l]) => `<option value="${v}" ${v === sel ? 'selected' : ''}>${l}</option>`).join('')}`;
  const rOpts = (sel) => `<option value="">結果を選ぶ</option>${PK_RES.map(([v, l]) => `<option value="${v}" ${v === sel ? 'selected' : ''}>${l}</option>`).join('')}`;
  const kickRows = kicks.map((k, i) => `<tr><td class="pkno">${i + 1}人目</td><td><select data-pkp="${i}">${pOpts(k.pid)}</select></td><td><select data-pkc="${i}">${cOpts(k.course)}</select></td><td><select data-pkr="${i}" class="${k.res === 'goal' ? 'ok' : k.res ? 'ng' : ''}">${rOpts(k.res)}</select></td><td><button class="btn sm" data-pkdel="${i}" title="この行を消す">消す</button></td></tr>`).join('');
  return `<div class="grp">試合後に入れる数字</div>
    <div class="card postin">
      <div class="pi"><label for="mPoss">ポゼッション率（自チーム）</label>
        <div class="row"><input id="mPoss" class="pinum" type="number" min="0" max="100" step="1" inputmode="numeric" value="${esc(ps)}" placeholder="—"><span>%</span>
        <span class="mu" id="possOpp">${ps !== '' ? `相手 ${Math.round((100 - ps) * 10) / 10}%` : '相手は100%から引いた値になります'}</span></div></div>
      <div class="pi"><label>PK戦</label>
        <div class="row"><div class="seg pkseg"><button class="${pk ? '' : 'on'}" data-pkhad="0">なし</button><button class="${pk ? 'on' : ''}" data-pkhad="1">あり</button></div>
        ${pk ? `<span class="pkin">自チーム ${kicks.length ? `<b class="pkauto" title="キッカーの成功の数">${pkOwnScore(pk)}</b>` : `<input id="pkOwn" class="pinum" type="number" min="0" max="99" inputmode="numeric" value="${esc(pk.own ?? 0)}" aria-label="PK戦 自チームの成功">`} − <input id="pkOpp" class="pinum" type="number" min="0" max="99" inputmode="numeric" value="${esc(pk.opp ?? 0)}" aria-label="PK戦 相手の成功"> 相手</span>` : ''}</div>
        ${pk ? `<div class="pkk"><div class="mu sm">自チームのキッカー（蹴った順）。コースはキッカーから見た向き${kicks.length ? '：自チームのスコアは成功の数から自動で入ります' : ''}</div>
          ${kicks.length ? `<table class="pktb"><tbody>${kickRows}</tbody></table>` : ''}
          <button class="btn sm" id="pkAdd">＋ ${kicks.length + 1}人目のキッカーを足す</button></div>` : ''}</div>
    </div>`;
}
function bindPostInputs(m) {
  return (root) => {
    const poss = root.querySelector('#mPoss');
    if (poss) poss.onchange = () => {
      const t = poss.value.trim();
      if (t === '') { put(teamPath('matches', m.id), { possession: del() }); toast('ポゼッション率を消しました'); return; }
      const v = Number(t);
      if (!Number.isFinite(v) || v < 0 || v > 100) { toast('ポゼッション率は0〜100の数で入れてください'); poss.value = m.possession ?? ''; return; }
      put(teamPath('matches', m.id), { possession: Math.round(v * 10) / 10 }); toast('ポゼッション率を保存しました');
    };
    root.querySelectorAll('[data-pkhad]').forEach((b) => { b.onclick = async () => {
      const had = b.dataset.pkhad === '1';
      if (had === !!(m.pk && typeof m.pk === 'object')) return;
      if (!had && m.pk?.kicks?.length && !(await confirmBox({ title: 'PK戦の記録を消しますか？', body: '<p>キッカーと結果、スコアが消えます。</p>', ok: '消す', danger: true }))) return;
      put(teamPath('matches', m.id), { pk: had ? { own: 0, opp: 0, kicks: [] } : null });
    }; });
    for (const id of ['pkOwn', 'pkOpp']) {
      const el = root.querySelector('#' + id); if (!el) continue;
      el.onchange = () => {
        const v = Math.round(Number(el.value));
        if (el.value.trim() === '' || !Number.isFinite(v) || v < 0 || v > 99) { toast('PK戦の数は0〜99で入れてください'); el.value = m.pk?.[id === 'pkOwn' ? 'own' : 'opp'] ?? 0; return; }
        put(teamPath('matches', m.id), { pk: { ...(m.pk || {}), [id === 'pkOwn' ? 'own' : 'opp']: v } }); toast('PK戦のスコアを保存しました');
      };
    }
    // キッカー：配列ごと書く（自チームのスコアは成功の数）
    const saveKicks = (kicks) => { const pk = { ...(m.pk || {}), kicks }; pk.own = pkOwnScore(pk); put(teamPath('matches', m.id), { pk }); };
    const cur = () => (m.pk?.kicks || []).map((k) => ({ ...k }));
    const add = root.querySelector('#pkAdd');
    if (add) add.onclick = () => saveKicks([...cur(), { pid: '', res: '' }]);
    root.querySelectorAll('[data-pkp]').forEach((el) => { el.onchange = async () => { const k = cur(); const i = +el.dataset.pkp;
      if (el.value && k.some((x, j) => j !== i && x.pid === el.value) && !(await confirmBox({ title: 'この選手は、もう別の順番で蹴っています', body: '<p>全員が蹴り終わって2巡目に入ったときは、このままで大丈夫です。</p>', ok: 'このまま入れる' }))) { el.value = k[i].pid || ''; return; }
      k[i].pid = el.value; saveKicks(k); }; });
    // 枠外のコースを選んだときは、結果が空なら「失敗（枠外・ポスト）」を入れる
    root.querySelectorAll('[data-pkc]').forEach((el) => { el.onchange = () => { const k = cur(); const i = +el.dataset.pkc; k[i].course = el.value; if (/^o/.test(el.value) && !k[i].res) k[i].res = 'missed'; saveKicks(k); }; });
    root.querySelectorAll('[data-pkr]').forEach((el) => { el.onchange = () => { const k = cur(); k[+el.dataset.pkr].res = el.value; saveKicks(k); }; });
    root.querySelectorAll('[data-pkdel]').forEach((b) => { b.onclick = () => { const k = cur(); k.splice(+b.dataset.pkdel, 1); saveKicks(k); }; });
  };
}
const mmss = (sec) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
const parseMmss = (s, fb) => { const m = String(s).trim().match(/^(\d{1,2})(?::(\d{1,2}))?$/); return m ? (+m[1]) * 60 + (+(m[2] || 0)) : fb; };
function vMatchSetup(m) {
  const t = { ...DEFAULT_TIMES, ...(m.times || {}) };
  const ct = m.colorTimer || { orange: teamSettings().colorOrange, red: teamSettings().colorRed };
  const started = m.status === 'playing' || m.status === 'done';
  const legacyCat = !m.categoryId && m.category; // 一覧にない名前（古い記録）。選び直すまでそのまま残す
  return {
    active: 'acts',
    html: `<div class="crumb"><a class="btn sm mpback" href="#/m/${m.id}">‹ 試合ページ</a><a href="#/m/${m.id}">vs ${esc(m.opponent)}</a> › 事前設定</div><h1>事前設定</h1>
    <div class="card"><div class="grid2" id="setupForm">
      <div><label for="sDate">日付</label><input id="sDate" name="date" type="date" value="${esc(m.date || '')}"></div>
      <div><label for="sOpp">対戦相手</label><input id="sOpp" name="opponent" value="${esc(m.opponent || '')}"></div>
      <div><label for="sCat">試合の区分（任意）</label><select id="sCat" name="categoryId">${optionTagsId(opts('matchCategories'), m.categoryId, { blank: 'なし', all: opts('matchCategories', true) })}${legacyCat ? `<option value="=" selected>${esc(m.category)}</option>` : ''}</select></div>
      <div><label for="sKo">キックオフ時刻（任意）</label><input id="sKo" name="kickoff" type="time" value="${esc(m.kickoff || '')}"></div>
      <div class="span2"><label for="sVenue">会場（任意）</label><input id="sVenue" name="venue" value="${esc(m.venue || '')}"></div>
      <div class="span2"><label for="sMemo">メモ（任意）</label><textarea id="sMemo" name="memo" rows="2">${esc(m.memo || '')}</textarea></div>
      <div class="span2 subh">試合時間</div>
      ${timesFields(t, started)}
      <div class="span2 subh">カラータイマー（連続出場時間で色が変わる。GKは対象外）</div>
      <div><label for="sOr">オレンジになる時間（分:秒）</label><input id="sOr" name="orange" value="${mmss(ct.orange)}" inputmode="numeric"></div>
      <div><label for="sRed">赤になる時間（分:秒）</label><input id="sRed" name="red" value="${mmss(ct.red)}" inputmode="numeric"></div>
    </div></div>
    <div class="row end"><button class="btn" id="btnCancel">やめる</button><button class="btn pri" id="btnSave">保存</button></div>`,
    bind() {
      $('#btnCancel').onclick = goBack;
      $('#btnSave').onclick = () => {
        const v = formVals($('#setupForm'));
        if (!v.date) return toast('日付を入れてください');
        if (!v.opponent) return toast('対戦相手を入れてください');
        const orange = parseMmss(v.orange, ct.orange), red = parseMmss(v.red, ct.red);
        if (red <= orange) return toast('赤になる時間は、オレンジより後にしてください');
        put(teamPath('matches', m.id), { date: v.date, opponent: v.opponent, ...(v.categoryId === '=' ? {} : { categoryId: v.categoryId, category: optName('matchCategories', v.categoryId) || (v.categoryId ? m.category : '') }), kickoff: v.kickoff, venue: v.venue, memo: v.memo,
          ...(started ? {} : { times: readTimes(v) }), colorTimer: { orange, red } });
        toast('保存しました'); goBack();
      };
    },
  };
}
function vMatchMembers(m) {
  const a = activityById(m.activityId);
  const call = a?.members || {};
  const mem = m.members || {};
  const ids = Object.keys(call).filter((id) => playerById(id));
  const ps = sortPlayers(ids.map(playerById)).sort((x, y) => (x.pos === y.pos ? 0 : x.pos === 'GK' ? -1 : 1) || (parseInt(call[x.id]?.no, 10) || 999) - (parseInt(call[y.id]?.no, 10) || 999));
  // Members chosen earlier but since removed from 招集 stay listed so nothing silently disappears.
  const orphan = Object.keys(mem).filter((id) => !call[id]);
  const n = Object.keys(mem).length;
  const prev = matchesOf(m.activityId).filter((x) => x.id !== m.id && Object.keys(x.members || {}).length && ((x.date || '') < (m.date || '') || ((x.date || '') === (m.date || '') && (x.createdOrder || 0) < (m.createdOrder || 0)))).pop();
  const card = (p, info) => {
    const sel = !!mem[p.id];
    const pp = sel && mem[p.id].pp;
    const num = sel ? mem[p.id].no : info?.no;
    return `<div class="pcard ${sel ? 'sel' : ''}">
      <button class="pc-main" data-tog="${p.id}">${no(num || '—', p.pos)}<span>${esc(playerName(p))}</span>${sel ? '<b class="ok">✓</b>' : ''}</button>
      ${sel && p.pos !== 'GK' ? `<button class="pc-pp ${pp ? 'on' : ''}" data-pp="${p.id}">${pp ? 'パワープレー可 ✓' : 'パワープレー可'}</button>` : ''}</div>`;
  };
  return {
    active: 'acts',
    html: `<div class="crumb"><a class="btn sm mpback" href="#/m/${m.id}">‹ 試合ページ</a><a href="#/m/${m.id}">vs ${esc(m.opponent)}</a> › 試合メンバー</div>
    <div class="row between"><h1 class="inl">試合メンバー <span class="cnt ${n > 25 ? 'ng' : ''}">${n} / 25人</span></h1>
      ${prev ? `<button class="btn" id="btnCopy">前の試合のメンバーをコピー</button>` : ''}</div>
    <p class="mu">招集メンバーから、この試合に出る選手を押して選びます（最大25人）。選んだFPの「パワープレー可」を押すと、パワープレー可能な選手になります（MATCH PLAYで番号が黄色になります）。選んだ時点の背番号とポジションが、この試合の記録として残ります。</p>
    ${ids.length ? '' : `<div class="note warn">この活動の招集メンバーがいません。先に<a href="#/a/${a?.id}">活動のページ</a>で招集メンバーを追加してください。</div>`}
    <div class="pgrid">${ps.map((p) => card(p, call[p.id])).join('')}</div>
    ${orphan.length ? `<h2 class="h">招集から外れた選手</h2><div class="pgrid">${orphan.map((id) => playerById(id) && card(playerById(id))).join('')}</div>` : ''}
    ${memberWarn(mem)}
    <div class="row end"><a class="btn pri" data-ret href="#/m/${m.id}">完了</a></div>`,
    bind(root) {
      const cp = $('#btnCopy');
      cp && (cp.onclick = async () => {
        if (n && !(await confirmBox({ title: '前の試合のメンバーをコピーしますか？', body: `<p>vs ${esc(prev.opponent)}（${fmtShort(prev.date)}）のメンバーとパワープレー可能の印に置き換えます。</p>`, ok: 'コピー' }))) return;
        const next = {};
        Object.entries(prev.members).forEach(([id, v]) => { if (call[id]) next[id] = { no: call[id].no ?? v.no, pos: playerById(id)?.pos || v.pos, pp: !!v.pp }; });
        const clear = {}; Object.keys(mem).forEach((id) => { if (!next[id]) clear[id] = del(); });
        put(teamPath('matches', m.id), { members: { ...clear, ...next } }); toast('コピーしました');
      });
      root.addEventListener('click', (e) => {
        const t = e.target.closest('[data-tog]');
        if (t) {
          const id = t.dataset.tog;
          if (mem[id]) put(teamPath('matches', m.id), { members: { [id]: del() } });
          else {
            if (n >= 25) return toast('試合メンバーは25人までです');
            const p = playerById(id);
            if (!String(call[id]?.no ?? '').trim()) toast(`${playerName(p)} は背番号が入っていません。活動のページで入れてください`);
            put(teamPath('matches', m.id), { members: { [id]: { no: call[id]?.no ?? '', pos: p.pos, pp: false } } });
          }
        }
        const pp = e.target.closest('[data-pp]');
        if (pp) { const id = pp.dataset.pp; put(teamPath('matches', m.id), { members: { [id]: { pp: !mem[id].pp } } }); }
      });
    },
  };
}

// 試合メンバーの注意（止めはしない）：背番号なし・背番号の重なり・GKがいない
function memberWarn(mem) {
  const ids = Object.keys(mem); if (!ids.length) return '';
  const nm = (id) => esc(playerName(playerById(id)));
  const blank = ids.filter((id) => !String(mem[id]?.no ?? '').trim());
  const by = {}; ids.forEach((id) => { const n = String(mem[id]?.no ?? '').trim(); if (n) (by[n] = by[n] || []).push(id); });
  const dup = Object.entries(by).filter(([, l]) => l.length > 1);
  const gk = ids.filter((id) => (mem[id]?.pos || playerById(id)?.pos) === 'GK').length;
  const w = [];
  if (blank.length) w.push(`背番号が入っていない選手がいます：${blank.map(nm).join('、')}（活動のページの招集メンバーで入れてください）`);
  if (dup.length) w.push(`背番号が重なっています：${dup.map(([n, l]) => `${esc(n)}番（${l.map(nm).join('・')}）`).join('、')}`);
  if (!gk) w.push('GKが1人もいません');
  return w.length ? `<div class="note warn mwarn">${w.map((x) => `<div>⚠ ${x}</div>`).join('')}<div class="mu xs">このままでも試合は始められます</div></div>` : '';
}

// ---------- 試合を探す ----------
function vSearch() {
  const statuses = ['準備中', '準備完了', '試合中', '未入力あり', '記録完了'];
  return {
    html: `<h1>試合を探す</h1>
    <div class="card filt">
      <input id="qOpp" placeholder="相手チーム名で検索">
      <select id="qAct"><option value="">すべての活動</option>${[...S.activities].sort((a, b) => (b.start || '').localeCompare(a.start || '')).map((a) => `<option value="${a.id}">${esc(a.name)}</option>`).join('')}</select>
      <select id="qCat"><option value="">すべての区分</option>${optionTagsId(opts('matchCategories', true), '', { blank: null })}</select>
      <select id="qSt"><option value="">すべての状態</option>${statuses.map((s) => `<option>${s}</option>`).join('')}</select>
    </div>
    <div id="results"></div>`,
    bind() {
      const draw = () => {
        const q = $('#qOpp').value.trim(), act = $('#qAct').value, cat = $('#qCat').value, st = $('#qSt').value;
        const list = S.matches.filter((m) => (!q || (m.opponent || '').includes(q)) && (!act || m.activityId === act) && (!cat || m.categoryId === cat) && (!st || matchStatus(m) === st))
          .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
        const groups = [];
        for (const m of list) { let g = groups.find((x) => x.id === m.activityId); if (!g) groups.push(g = { id: m.activityId, ms: [] }); g.ms.push(m); }
        $('#results').innerHTML = groups.length ? groups.map((g) => `<h2 class="h">${esc(activityById(g.id)?.name || '')}</h2><div class="card list">${g.ms.map((m) => matchRow(m)).join('')}</div>`).join('')
          : '<div class="card empty">該当する試合はありません</div>';
      };
      ['qOpp', 'qAct', 'qCat', 'qSt'].forEach((id) => { $('#' + id).oninput = draw; });
      draw();
    },
  };
}

// ---------- 設定 ----------
function vSettings() {
  const ts = teamSettings();
  const lb = lastBackupAt();
  // 消せる選択肢：活動の種類・試合の区分は、どの活動・試合でも使っていないもの。得点・失点の種類は、足した種類だけ（初めからある種類は分類の判定に使うので消さない）。使っているかは押したときに確かめる
  const builtin = (o) => /^o\d+_/.test(o.id);
  const usedIn = (key, o) => (key === 'activityTypes' ? S.activities.some((a) => a.typeId === o.id || (!a.typeId && a.type === o.name))
    : key === 'matchCategories' ? S.matches.some((m) => m.categoryId === o.id || (!m.categoryId && m.category === o.name)) : false);
  const canDel = (key, o) => (key === 'goalTypes' ? !builtin(o) : !usedIn(key, o));
  const optEditor = (key, title) => {
    const list = S.global[key];
    return `<div class="opted"><h3>${title}</h3>${list.map((o, i) => `<div class="optrow ${o.hidden ? 'hid' : ''}">
      <input id="opt_${key}_${esc(o.id)}" data-ok="${key}" data-oid="${esc(o.id)}" value="${esc(o.name)}" aria-label="${esc(title)}：${esc(o.name)}">
      <button class="btn xs opb" data-up="${key}:${esc(o.id)}" ${i === 0 ? 'disabled' : ''} aria-label="上へ">↑</button>
      <button class="btn xs opb" data-down="${key}:${esc(o.id)}" ${i === list.length - 1 ? 'disabled' : ''} aria-label="下へ">↓</button>
      <button class="btn xs opb" data-hide="${key}:${esc(o.id)}">${o.hidden ? '表示する' : '非表示'}</button>${canDel(key, o) ? `<button class="btn xs opb" data-odel="${key}:${esc(o.id)}" title="一度も使っていない選択肢だけ消せます">消す</button>` : ''}</div>`).join('')}
      <div class="row"><input id="optnew_${key}" placeholder="追加する名前"><button class="btn sm" data-add="${key}">追加</button></div></div>`;
  };
  return {
    active: 'settings',
    html: `<h1>設定</h1>
    <h2 class="h">アプリ全体</h2>
    <div class="card"><h3>ログインと同期</h3>
      <p>ログイン中：${esc(ctx.user.email)}　<button class="btn sm" id="btnOut">ログアウト</button></p>
      <p class="mu">同期の状態：${!navigator.onLine ? 'オフライン（記録は端末に保存され、つながったときに送られます）' : S.pending ? '同期待ち（送っている途中です）' : '同期済み'}</p></div>
    <div class="card"><h3>担当者の名前（この端末）</h3>
      <p class="mu">この端末で入力する人の名前です。イベント入力の「担当者」・入力したイベントの印・直した履歴・MATCH PLAYの記録中の表示・記録の修正の履歴に出ます（この端末だけに保存）。端末を別の人に渡したときは名前を変えてください（イベント入力の「担当者」からも変えられます）。</p>
      <div class="row"><input id="devNameIn" value="${esc((() => { try { return localStorage.getItem('fpt.deviceName') || ''; } catch { return ''; } })())}" placeholder="例：谷本"><button class="btn sm pri" id="btnDevName">保存</button></div></div>
    <div class="card"><h3>バックアップ</h3>
      <p class="mu">全チームの記録をファイルに書き出します。最後に書き出した日時：${lb ? new Date(lb).toLocaleString('ja-JP') : 'まだありません'}</p>
      <div class="row"><button class="btn pri xp" id="btnBk">バックアップを書き出す</button><button class="btn" id="btnRestore">ファイルから戻す</button><input type="file" id="restoreFile" accept=".json,application/json" hidden></div></div>
    <div class="card"><h3>アプリ</h3>
      <p>バージョン ${esc(ctx.appVersion)}　<button class="btn sm" id="btnUpd">更新を確認</button> <span id="updMsg" class="mu"></span></p>
      <p id="updForce" hidden><button class="btn pri" id="btnForce">最新にする</button> <span class="mu">アプリのファイルを入れ直して開き直します（試合の記録はそのまま残ります）</span></p>
      <p class="mu">更新は、画面上部に「新しいバージョンがあります」と出たときに「更新する」を押したときだけ行います（遠征中に勝手に切り替わりません）。</p>
      <p class="mu">iPadでは、Safariの共有ボタン →「ホーム画面に追加」で追加し、いつもホーム画面のアイコンから開いてください。</p>
      <p><a class="btn" href="#/guide">使い方（使用説明書）を見る ›</a></p></div>
    <h2 class="h">全チーム共通：選択肢の編集</h2>
    <div class="card"><p class="mu">名前を変えると、過去の試合の表示にも反映されます。一度も使っていない選択肢は「消す」で消せます。使った選択肢は「非表示」にします（得点・失点の種類のうち初めからあるものは、分類の判定に使うので消せません）。</p>
      <div class="optgrid">${optEditor('activityTypes', '活動の種類')}${optEditor('matchCategories', '試合の区分')}${optEditor('goalTypes', '得点・失点の種類')}</div></div>
    ${S.team ? `<h2 class="h">このチーム（${esc(S.team.name)}）</h2>
    <div class="card"><div class="grid2" id="teamSet">
      <div><label for="tOr">カラータイマー：オレンジ（分:秒）</label><input id="tOr" name="colorOrange" value="${mmss(ts.colorOrange)}"></div>
      <div><label for="tRed">カラータイマー：赤（分:秒）</label><input id="tRed" name="colorRed" value="${mmss(ts.colorRed)}"></div>
      <div><label for="tSp">セットプレーの自動終了（分:秒）</label><input id="tSp" name="setplayAuto" value="${mmss(ts.setplayAuto)}"></div>
      <div><label for="tRef">これより短い出場は参考値（分:秒）</label><input id="tRef" name="refMin" value="${mmss(ts.refMin)}"></div>
      <div><label for="tSetMin">セットの表に出す出場時間（分:秒以上）</label><input id="tSetMin" name="setMin" value="${mmss(ts.setMin)}"></div>
      <div><label for="tROr">フィジカルコーチ用：オレンジ（実際の時間・分:秒）</label><input id="tROr" name="runOrange" value="${mmss(ts.runOrange)}"></div>
      <div><label for="tRRed">フィジカルコーチ用：赤（実際の時間・分:秒）</label><input id="tRRed" name="runRed" value="${mmss(ts.runRed)}"></div>
    </div><p class="mu">カラータイマーは試合を作るときの初期値です。試合ごとに事前設定で変えられます。フィジカルコーチ用の色は、ピッチに入ってからの実際の時間（時計が止まっている間も進む）で付きます。</p>
    <div class="row end"><button class="btn pri" id="btnTeamSet">保存</button></div></div>` : ''}`,
    bind(root) {
      $('#btnOut').onclick = async () => { if (await confirmBox({ title: 'ログアウトしますか？', body: '<p>もう一度ログインするにはネットが必要です。試合の前にはログアウトしないでください。</p>', ok: 'ログアウト' })) ctx.signOut(); };
      $('#btnBk').onclick = () => exportBackup();
      $('#btnRestore').onclick = () => $('#restoreFile').click();
      $('#restoreFile').onchange = (e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) restoreFromFile(f); };
      $('#btnDevName').onclick = () => { const v = $('#devNameIn').value.trim(); try { if (v) localStorage.setItem('fpt.deviceName', v); else localStorage.removeItem('fpt.deviceName'); } catch {} toast(v ? `担当者の名前を「${v}」にしました` : '名前を消しました（「iPad」か「PC」と出ます）'); render(); };
      $('#btnUpd').onclick = async () => {
        const msg = (t) => { $('#updMsg').textContent = t; };
        msg('確認中…'); $('#updForce').hidden = true;
        try {
          await ctx.swReg?.update();
          if (ctx.swReg?.waiting) return msg('新しいバージョンがあります（上の「更新する」を押してください）');
          // いま公開されている版を直接見る（GitHub Pagesの古いコピーに左右されない）
          const latest = (await (await fetch(`./sw.js?fresh=${Date.now()}`, { cache: 'no-store' })).text()).match(/VERSION = '([^']+)'/)?.[1];
          if (latest && latest !== ctx.appVersion) { $('#updForce').hidden = false; return msg(`新しいバージョン ${latest} があります。下の「最新にする」を押してください`); }
          // この端末に入っているファイルが、公開中のものと同じか（一部だけ古いままになっていないか）
          const bad = [];
          for (const f of SHELL_FILES) {
            const [mine, live] = await Promise.all([fetch(`./${f}`).then((r) => r.text()), fetch(`./${f}?fresh=${Date.now()}`, { cache: 'no-store' }).then((r) => (r.ok ? r.text() : null))]);
            if (live != null && mine !== live) bad.push(f);
          }
          if (bad.length) { $('#updForce').hidden = false; return msg(`一部のファイル（${bad.length}個）が古いままです。下の「最新にする」を押してください`); }
          msg(`最新です（${ctx.appVersion}・すべてのファイルを確認しました）`);
        } catch { msg('ネットにつながっているときに確認できます'); }
      };
      $('#btnForce').onclick = async () => {
        if (!navigator.onLine) return toast('ネットにつながっているときに使えます');
        if (!(await confirmBox({ title: 'アプリを最新にしますか？', body: '<p>アプリのファイルを入れ直して開き直します。試合の記録・下書きはそのまま残ります。</p>', ok: '最新にする' }))) return;
        const msg = (t) => { const el = $('#updMsg'); if (el) el.textContent = t; };
        // 1) 先に新しい版のファイルを全部取ってきて確かめる。1つでも取れなければ、今の版のまま（何も消さない）
        msg('新しいファイルを確かめています…');
        let files;
        try {
          const t = Date.now();
          const text = async (u) => { const r = await fetch(u, { cache: 'no-store' }); if (!r.ok) throw new Error(u + ' ' + r.status); const x = await r.text(); if (!x) throw new Error(u + ' empty'); return x; };
          const sw = await text(`./sw.js?fresh=${t}`);
          const latest = sw.match(/VERSION = '([^']+)'/)?.[1]; if (!latest) throw new Error('sw.js');
          // 新しい版の sw.js に書かれているファイル一覧（新しく増えたファイルも含めて）
          const shell = [...new Set([...sw.matchAll(/'\.\/([^']+)'/g)].map((x) => x[1]).filter(Boolean).concat(SHELL_FILES))];
          files = [...shell.map((f) => `./${f}`), ...FB_FILES];
          const got = await Promise.all([
            ...shell.map((f) => text(`./${f}?fresh=${t}`).then((x) => [f, x])),
            ...FB_FILES.map((u) => text(`${u}?check=${t}`).then((x) => [u, x])),
          ]);
          const app = got.find(([f]) => f === 'app.js')?.[1] || '';
          if (!app.includes(`APP_VERSION = '${latest}'`)) throw new Error('app.js と sw.js の版が合いません');
        } catch (e) {
          console.warn('force update', e);
          msg('新しいファイルを取ってこられませんでした。今の版のまま使えます（ネットのよいところで、もう一度押してください）');
          return;
        }
        // 2) 全部そろったので、古いファイルを消して入れ直す
        msg('入れ直しています…');
        try {
          for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
          for (const k of await caches.keys()) await caches.delete(k);
          await Promise.all(files.map((f) => fetch(f, { cache: 'reload' }).catch(() => {})));
        } finally { location.reload(); }
      };
      const ts2 = $('#btnTeamSet');
      ts2 && (ts2.onclick = () => {
        const v = formVals($('#teamSet'));
        const s = { colorOrange: parseMmss(v.colorOrange, ts.colorOrange), colorRed: parseMmss(v.colorRed, ts.colorRed), setplayAuto: parseMmss(v.setplayAuto, ts.setplayAuto), refMin: parseMmss(v.refMin, ts.refMin), setMin: parseMmss(v.setMin, ts.setMin), runOrange: parseMmss(v.runOrange, ts.runOrange), runRed: parseMmss(v.runRed, ts.runRed) };
        if (s.colorRed <= s.colorOrange || s.runRed <= s.runOrange) return toast('赤になる時間は、オレンジより後にしてください');
        put(['teams', S.teamId], { settings: s }); toast('保存しました');
      });
      // 選択肢は1件ずつ書く（store.js saveOptions）。2台で同時に直しても、別の選択肢の直しは消えない
      root.addEventListener('change', (e) => {
        const k = e.target.dataset.ok; if (!k) return;
        const o = S.global[k].find((x) => x.id === e.target.dataset.oid); if (!o) return;
        const v = e.target.value.trim(); if (!v || v === o.name) { e.target.value = o.name; return; }
        if (!renameOption(k, o.id, v)) { e.target.value = o.name; return toast(`「${v}」はすでにあります。別の名前にしてください`); }
        toast('名前を変えました');
      });
      root.addEventListener('click', async (e) => {
        const b = e.target.closest('button'); if (!b) return;
        if (b.dataset.odel) {
          const [k, id] = b.dataset.odel.split(':'); const o = S.global[k].find((x) => x.id === id); if (!o) return;
          if (k === 'goalTypes') { // すべての試合のイベントを確かめる（読み込みがまだなら、少し待ってもらう）
            const cs = S.matches.map((m) => watchEvents(m.id));
            if (cs.some((c) => !c.ready)) return toast('記録を確かめています。少し待ってからもう一度押してください');
            if (cs.some((c) => c.list.some((e) => e.gtype === id))) return toast(`「${o.name}」は記録で使っているので消せません。使わないときは「非表示」にしてください`);
          } else if (usedIn(k, o)) return toast(`「${o.name}」は使っているので消せません。使わないときは「非表示」にしてください`);
          if (await confirmBox({ title: `「${o.name}」を消しますか？`, body: '<p>一度も使っていない選択肢です。消すと元に戻せません。</p>', ok: '消す', danger: true })) { deleteOption(k, id); toast('消しました'); }
          return;
        }
        const spec = b.dataset.up || b.dataset.down || b.dataset.hide; const add = b.dataset.add;
        if (add) {
          const inp = $('#optnew_' + add); const v = inp.value.trim(); if (!v) return;
          if (!addOption(add, v)) return toast('同じ名前がすでにあります');
          inp.value = ''; inp.dataset.fresh = '1'; return;
        }
        if (!spec) return;
        const [k, id] = spec.split(':'); const list = S.global[k]; const i = list.findIndex((o) => o.id === id); if (i < 0) return;
        if (b.dataset.up && i > 0) moveOption(k, i, i - 1);
        if (b.dataset.down && i < list.length - 1) moveOption(k, i, i + 1);
        if (b.dataset.hide) saveOptions(k, { [id]: { hidden: !list[i].hidden } });
      });
    },
  };
}

// ---------- 更新の確認（app.js から使う。試13） ----------
// MATCH PLAY を開いているあいだは「更新する」を出さない
export const onPlayScreen = () => /^#\/m\/[^/]+\/play/.test(location.hash);
// この端末で記録している試合のピリオドが進行中か（更新で開き直す前に確かめる）
export function liveOnThisDevice() {
  const me = deviceId();
  for (const m of S.matches) {
    if (m.status !== 'playing') continue;
    const c = watchOps(m.id); if (!c.list.length) continue;
    const mine = [...c.list].sort((a, b) => (a.t || 0) - (b.t || 0)).filter((o) => o.dev === me);
    if (!mine.length) continue;
    try {
      const st = replay(c.list, { times: m.times || {}, members: m.members || {}, timesFixed: !!m.timesFixed, setplayAuto: teamSettings().setplayAuto || 60 });
      if (st.periods[st.current]?.status === 'live') return m;
    } catch {}
  }
  return null;
}
export async function confirmUpdate() {
  const m = liveOnThisDevice();
  if (!m) return true;
  return confirmBox({ title: '試合中ですが、更新しますか？', body: `<p>この端末で vs ${esc(m.opponent)} を記録中です（ピリオドが進行中）。</p><p>更新するとアプリを開き直します。記録は消えませんが、ハーフタイムや試合後に更新するのがおすすめです。</p>`, ok: '更新する', cancel: 'あとで' });
}
