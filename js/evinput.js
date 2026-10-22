// イベント入力（spec 13章）。試合後に映像を見ながらでも、試合中のリアルタイム入力でも同じ画面。
// 入力の順番：時刻 → イベント → 選手 → 結果。「記録する」を押した時点で記録になる（時刻は残る）。
// 入れないと記録できないのは時刻とイベントだけ。項目は ●基本／○詳細／△任意 の3段階（基本の空きだけが「未入力」）。
import { S as D, watchOps, watchEvents, saveEvent, patchEvent, playerById, opts, teamSettings, put, teamPath, deviceId } from './store.js';
import { replay, PERIODS, periodLabel } from './engine.js';
import { matchModel, periodSig, toRunning } from './model.js';
import { clockAtVideo, videoAtClock } from './vsync.js';
import { esc, openModal, closeModal, confirmBox, toast } from './ui.js';
import { keypadHTML, bindKeypad } from './keypad.js';
import { render } from './views.js';
import { devName } from './matchplay.js';
import {
  KIND, MAIN_OWN, MAIN_OPP, SUBS, RESULTS, CLS, SETP, FSP, METHODS, ZONES, CARDS, CARDS_OPP, cardsOf, UNKNOWN, OPP_OG, NO_ASSIST,
  isShot, isSZ, isFsp, hasCls, isOGType, goalTypeIdOf, missing, missingLv, recheckAll, isTodo, pitchAt, subAtSecond, autoCls, liveEvents, sortEvents, summary,
  EV_FIELDS, PLAYER_KEYS, cleanFields, checkOf, cardIssues, pitchSig, oejDefaultEnd, areaOf,
} from './events.js';
import { courtSVG, locFromEvent } from './court.js';

const mmss = (sec) => `${Math.floor(sec / 60)}:${String(Math.max(0, sec) % 60).padStart(2, '0')}`;
let ui = { m: null };
// 「未入力あり n」から開いたとき：未入力・要確認のイベントだけを並べる
let todoFor = null;
export function openTodo(matchId) { todoFor = matchId; if (ui.m === matchId) ui.todo = true; }
const FIELDS = EV_FIELDS;

// ---------- 動画を見ながら入力（2026-10-22） ----------
// 動画は端末の中のファイルを開いて再生するだけ（どこにも送らない）。画面を描き直しても同じ <video> を使い続ける（再生の位置がそのまま）。
// 一時停止すると、止めた場面の試合の時計が①の時刻に入る（ピリオドごとにキックオフの場面を1回合わせておく）
const VID = { el: null, url: null, name: '', open: false, ctx: null, skip: false };
const syncKey = (mid) => `fpt.vsync.${mid}`;
const syncOf0 = (mid) => { try { return JSON.parse(localStorage.getItem(syncKey(mid)) || '{}'); } catch { return {}; } };
// 自分で合わせたもの ＋ 記録の時刻が動画の時刻でできている試合（Sportscode の XML から作った・あとから記録）は、はじめから合っている
function syncOf(mid) {
  const s = syncOf0(mid); const c = VID.ctx; if (!c || c.m.id !== mid || !c.m.vclock) return s;
  for (const [k, v] of Object.entries(c.m.vclock)) { const kt = c.st.periods[k]?.kickT; if (s[k] || kt == null || !Number.isFinite(+v.base)) continue; s[k] = { v: (kt - v.base) / 1000, name: v.name ?? null, auto: true }; }
  return s;
}
const saveSync = (mid, s) => { try { localStorage.setItem(syncKey(mid), JSON.stringify(Object.fromEntries(Object.entries(s).filter(([, v]) => !v.auto)))); } catch {} };
const hms = (v) => { v = Math.max(0, Math.floor(v || 0)); const h = Math.floor(v / 3600), mm = Math.floor(v / 60) % 60, ss = v % 60; return `${h ? h + ':' + String(mm).padStart(2, '0') : mm}:${String(ss).padStart(2, '0')}`; };
function runOf(c) { if (!c.R) c.R = toRunning(c.M, c.st, Date.now()); return c.R; }
function vidClock(c) {
  if (!VID.el || !VID.url) return null;
  return clockAtVideo(runOf(c), c.M.periods, syncOf(c.m.id), VID.name, VID.el.currentTime);
}
function vidEl() {
  if (VID.el) return VID.el;
  const v = document.createElement('video'); v.controls = true; v.playsInline = true; v.preload = 'metadata'; v.className = 'evvideo';
  const stop = (seek) => {
    if (VID.skip) { if (seek) VID.skip = false; return; } // 一覧から場面へ動かしたとき（時刻は記録のまま）
    const c = VID.ctx; if (!c || !VID.open || !v.paused) return;
    const r = vidClock(c); if (!r) return;
    const p = c.M.periods.find((x) => x.key === r.period); if (!p) return;
    ui.period = r.period; ui.listPer = r.period; ui.sec = Math.max(0, Math.round((p.len - r.at) / 1000));
    render();
  };
  v.addEventListener('pause', () => stop(false));
  v.addEventListener('seeked', () => { if (v.paused) stop(true); else if (VID.skip) VID.skip = false; });
  v.addEventListener('timeupdate', () => { const n = document.querySelector('.evvid .vnow'); if (n && VID.ctx) n.innerHTML = vidNow(VID.ctx); });
  VID.el = v; return v;
}
function vidNow(c) {
  if (!VID.url) return '';
  const r = vidClock(c); const p = r && c.M.periods.find((x) => x.key === r.period);
  return `動画 <b>${hms(VID.el.currentTime)}</b>　→　${r ? `<b class="vclk">${p.label} ${mmss(Math.round((p.len - r.at) / 1000))}</b><small>（残り時間）</small>` : '<span class="mu">キックオフの場面を合わせると、試合の時計が出ます</span>'}`;
}
function vidPanel(m, M) {
  const sync = syncOf(m.id);
  const pers = M.periods.filter((p) => p.status !== 'none');
  const syncRows = pers.map((p) => { const s = sync[p.key]; const here = s && s.name === VID.name;
    return `<div class="vsr"><span class="vsl">${p.label}</span>${s?.auto && s.name == null ? `<span class="vok">✓ 記録が動画の時刻でできているので合っています（動画 ${hms(s.v)} がキックオフ）</span>` : here ? `<span class="vok">✓ 動画 ${hms(s.v)} がキックオフ</span>` : s ? `<span class="mu">別の動画（${esc(s.name)}）で合わせています</span>` : '<span class="mu">まだ合わせていません</span>'}${VID.url ? `<button class="btn sm" data-vk="${p.key}">今の場面を${p.label}のキックオフにする</button>` : ''}</div>`; }).join('');
  return `<div class="card evvid"><div class="vh"><b>動画</b><span class="mu vnm">${VID.url ? esc(VID.name) : ''}</span><span class="sp"></span><label class="btn sm">${VID.url ? '別の動画を開く' : '動画を開く'}<input type="file" accept="video/*,.mp4,.mov,.m4v" id="evVidFile" hidden></label><button class="btn sm" id="evVidClose">閉じる</button></div>
    <div class="vslot" id="evVidSlot">${VID.url ? '' : '<div class="vnone">PC・iPadの中にある試合の動画を開いてください。<br>動画はどこにも送らず、この端末で再生するだけです。</div>'}</div>
    ${VID.url ? `<div class="vctl"><button class="btn sm" data-vs="-5">−5秒</button><button class="btn sm" data-vs="-1">−1秒</button><button class="btn sm pri" data-vs="0">${VID.el && !VID.el.paused ? '❚❚ 止める' : '▶ 再生'}</button><button class="btn sm" data-vs="1">＋1秒</button><button class="btn sm" data-vs="5">＋5秒</button></div><div class="vnow"></div>` : ''}
    <div class="vsync"><div class="vst">時刻の合わせ方：動画をピリオドの始まり（キックオフ）の場面にして、ボタンを押す。止めた場面の時計が①に入ります</div>${syncRows || '<span class="mu">MATCH PLAYで記録したピリオドがありません（時刻は①で入れてください）</span>'}</div></div>`;
}

function cfgOf(m) { return { times: m.times || {}, members: m.members || {}, timesFixed: !!m.timesFixed, setplayAuto: teamSettings().setplayAuto || 60 }; }
const goalTypes = () => opts('goalTypes', true);
const goalName = (id) => goalTypes().find((o) => o.id === id)?.name || '';
const ogId = () => goalTypeIdOf(goalTypes(), 'OG'); // 名前を変えても id で見分ける（記15）
const isOGg = (id) => isOGType(id, goalName);


// ---------- 入力の分担（2026-10-16 決定）：1〜5人。どのイベントも必ず1人だけが担当する ----------
const ALLK = [...MAIN_OWN, ...MAIN_OPP, ...SUBS];
const GRP = { ownShot: ['shot', 'szshot', 'goal'], ownEnt: ['z4', 'sz', 'fspat'], oppShot: ['oshot', 'oszshot', 'conc'], oppEnt: ['oz4', 'osz', 'fspdf'] };
export const PRESETS = [['atkdef', '攻撃と守備で分ける'], ['shotent', 'シュートと進入で分ける']];
export function presetAssign(name, n) {
  const a = {}; const set = (ks, i) => ks.forEach((k) => { a[k] = i; });
  if (n <= 1) { set(ALLK, 0); return a; }
  if (name === 'shotent') {
    const shots = [...GRP.ownShot, ...GRP.oppShot], ent = ['z4', 'sz', 'oz4', 'osz'], fsp = ['fspat', 'fspdf'];
    if (n === 2) { set(shots, 0); set([...ent, ...fsp, ...SUBS], 1); } else if (n === 3) { set(shots, 0); set([...ent, ...fsp], 1); set(SUBS, 2); } else if (n === 4) { set(shots, 0); set(ent, 1); set(fsp, 2); set(SUBS, 3); } else { set(GRP.ownShot, 0); set(GRP.oppShot, 1); set(ent, 2); set(fsp, 3); set(SUBS, 4); }
  } else {
    if (n === 2) { set([...MAIN_OWN, ...SUBS], 0); set(MAIN_OPP, 1); } else if (n === 3) { set(MAIN_OWN, 0); set(MAIN_OPP, 1); set(SUBS, 2); } else if (n === 4) { set(GRP.ownShot, 0); set(GRP.ownEnt, 1); set(MAIN_OPP, 2); set(SUBS, 3); } else { set(GRP.ownShot, 0); set(GRP.ownEnt, 1); set(GRP.oppShot, 2); set(GRP.oppEnt, 3); set(SUBS, 4); }
  }
  return a;
}
export function splitOf(m) {
  const s = m.evSplit || {}; const n = Math.min(5, Math.max(1, s.n || 1));
  const def = presetAssign('atkdef', n); const assign = {};
  for (const k of ALLK) { const v = s.assign?.[k]; assign[k] = Number.isInteger(v) && v >= 0 && v < n ? v : def[k]; }
  const names = Array.from({ length: n }, (_, i) => (s.names || [])[i] || '');
  return { n, names, assign };
}
const roleKey = (m) => `fpt.evRole.${m.id}`;
// 担当者の名前をその場で変える（端末を別の人に渡したとき）
function changeWho(m) {
  const md = openModal(`<h2>担当者の名前</h2><p class="mu">この端末で入力する人の名前です。端末を別の人に渡したときは、ここで変えてください（このあとの入力と履歴がその名前になります）。</p>
    <input id="whoIn" value="${esc((() => { try { return localStorage.getItem('fpt.deviceName') || ''; } catch { return ''; } })())}" placeholder="例：谷本" style="width:100%;font-size:18px">
    <div class="mfoot"><button class="btn" data-c>やめる</button><button class="btn pri" data-ok>決める</button></div>`);
  md.querySelector('[data-c]').onclick = closeModal;
  md.querySelector('[data-ok]').onclick = () => { const v = md.querySelector('#whoIn').value.trim(); try { if (v) localStorage.setItem('fpt.deviceName', v); else localStorage.removeItem('fpt.deviceName'); } catch {}
    // 担当者を決めてある担当なら、その名前も替える（端末を別の人に渡した＝その担当を別の人がする）
    if (m) { const sp = splitOf(m); const r = roleOf(m, sp.n); if (sp.n > 1 && r != null && (m.evSplit?.names || [])[r]) { const names = sp.names.slice(); names[r] = v; put(teamPath('matches', m.id), { evSplit: { n: sp.n, names, assign: sp.assign } }); } }
    closeModal(); toast(v ? `担当者を「${v}」にしました` : '名前を消しました'); render(); };
  setTimeout(() => md.querySelector('#whoIn')?.focus(), 50);
}
function roleOf(m, n) {
  if (n <= 1) return 0;
  try { const v = parseInt(localStorage.getItem(roleKey(m)), 10); return Number.isInteger(v) && v >= 0 && v < n ? v : null; } catch { return null; }
}
function setRole(m, v) {
  try { if (v == null) localStorage.removeItem(roleKey(m)); else localStorage.setItem(roleKey(m), String(v)); } catch {}
  put(teamPath('matches', m.id), { evRoles: { [deviceId()]: { role: v == null ? null : v, name: devName(), t: Date.now() } } });
}
// 担当の名前＝その担当を選んだ端末の担当者の名前（設定の「担当者の名前」）。12時間より前に選んだものは出さない
// 担当の名前：入力担当の設定③で決めた担当者を優先。決めていなければ、その担当を選んだ端末の担当者の名前
const roleWho = (m, i) => { const plan = (m.evSplit?.names || [])[i]; if (plan) return [plan]; return [...new Set(Object.values(m.evRoles || {}).filter((x) => x && x.role === i && Date.now() - (x.t || 0) < 12 * 3600e3).map((x) => x.name || '?'))]; };
const roleName = (m, i) => { const w = roleWho(m, i); return `担当${i + 1}${w.length ? `（${esc(w.join('・'))}）` : ''}`; };
const kindsOf = (sp, i) => ALLK.filter((k) => sp.assign[k] === i);
// 担当のイベントの名前の一覧：相手の退場は、被ファールの担当が入れる（EV-07。分担の表と「どの担当ですか？」に出す）
const kindsShown = (ks) => (ks.includes('fouled') ? [...ks, 'oej'] : ks);
const kindLabel = (k) => KIND[k].label;

// 分担を決める画面（イベント入力から開く）
export function vSplit(m) {
  const sp = splitOf(m);
  const prev = D.matches.filter((x) => x.id !== m.id && !x.deleted && x.evSplit && (x.date || '') <= (m.date || '9999')).sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0];
  const cell = (k, i) => `<td class="${sp.assign[k] === i ? 'on' : ''}"><button class="spc" data-sk="${k}" data-si="${i}" aria-label="${kindLabel(k)}を担当${i + 1}に">${sp.assign[k] === i ? '✓' : ''}</button></td>`;
  const rowsOf = (ks, cls) => ks.map((k) => `<tr><td class="ev ${cls}">${kindLabel(k)}</td>${Array.from({ length: sp.n }, (_, i) => cell(k, i)).join('')}</tr>`).join('');
  const cnt = (i) => kindsShown(kindsOf(sp, i)).length;
  const html = `<div class="crumb"><a class="btn sm mpback" href="#/m/${m.id}">‹ 試合ページ</a><a href="#/m/${m.id}">vs ${esc(m.opponent)}</a> › <a href="#/m/${m.id}/events">イベント入力</a> › 入力担当の設定</div>
    <div class="row between"><h1 style="margin:0">入力担当の設定</h1><a class="btn pri" href="#/m/${m.id}/events">イベント入力 ›</a></div>
    <p class="mu">何人で入力するかと、それぞれが入れるイベントを決めます。どのイベントも必ず1人だけが担当します（押した担当に移ります）。この試合のすべての端末に同じ分担が出て、試合中でも変えられます。</p>
    <div class="card"><h3>① 入力の担当人数</h3><div class="seg spn">${[1, 2, 3, 4, 5].map((v) => `<button data-sn="${v}" class="${sp.n === v ? 'on' : ''}">${v === 1 ? '1人（全部）' : v + '人'}</button>`).join('')}</div>
</div>
    ${sp.n > 1 ? `<div class="spgrid"><div><div class="card"><h3>② それぞれが入れるイベント（押した担当に移ります）</h3>
      <table class="sptb"><tr><th style="text-align:left">イベント</th>${sp.names.map((nm, i) => `<th>担当${i + 1}<small>${esc(nm) || '&nbsp;'}</small><small>${cnt(i)}個</small></th>`).join('')}</tr>
      ${rowsOf(MAIN_OWN, 'own')}<tr class="sep"><td colspan="${sp.n + 1}"></td></tr>${rowsOf(MAIN_OPP, 'opp')}<tr class="sep"><td colspan="${sp.n + 1}"></td></tr>${rowsOf(SUBS, 'sub')}<tr class="oejrow"><td class="ev sub">${kindLabel('oej')}<small>被ファールの担当</small></td>${Array.from({ length: sp.n }, (_, i) => `<td class="${sp.assign.fouled === i ? 'on' : ''}"><span class="spc fix">${sp.assign.fouled === i ? '✓' : ''}</span></td>`).join('')}</tr></table></div>
      <div class="card"><h3>③ 担当者を決める</h3><p class="mu">それぞれの担当を誰がするかを入れておくと、各端末で担当を選んだときに、その端末の担当者の名前も自動でその人になります（空けておくと、担当を選んだ端末の担当者の名前が出ます）。</p>
        <div class="spnames">${sp.names.map((nm, i) => `<label>担当${i + 1}<input id="spName${i}" data-sname="${i}" value="${esc(nm)}" placeholder="担当者名を入力"></label>`).join('')}</div></div></div>
      <div><div class="card sppre"><h3>よく使う分け方（押すと②が切りかわる）</h3>
        ${PRESETS.map(([id, l]) => `<button data-sp="${id}"><b>${l}</b><small>${Array.from({ length: sp.n }, (_, i) => `担当${i + 1}＝${kindsShown(ALLK.filter((k) => presetAssign(id, sp.n)[k] === i)).map(kindLabel).join('・')}`).join('　')}</small></button>`).join('')}
        <button data-sp="prev" ${prev ? '' : 'disabled'}><b>前の試合と同じ</b><small>${prev ? `vs ${esc(prev.opponent)}（${esc(prev.date || '')}）の分担をそのまま使う` : '分担を決めた前の試合がありません'}</small></button></div>
        <div class="card"><h3>各端末では</h3><p class="mu" style="margin:0">イベント入力を開くと「どの担当ですか？」と聞かれ、担当を押すだけ。その担当のイベントだけが大きく出ます（担当以外のイベントは出ません）。③で担当者を決めてあれば、その端末の担当者の名前も自動でその人になります。</p></div></div></div>`
    : '<div class="card"><p class="mu" style="margin:0">1人で全部のイベントを入力します。何人かで分ける時は、上で人数を選んでください。</p></div>'}`;
  return {
    active: 'acts', html,
    bind: (root) => {
      const write = (next) => put(teamPath('matches', m.id), { evSplit: next });
      root.addEventListener('click', (e) => {
        const b = e.target.closest('button'); if (!b || b.disabled) return;
        if (b.dataset.sn) { const n = +b.dataset.sn; const names = Array.from({ length: n }, (_, i) => sp.names[i] || (m.evSplit?.names || [])[i] || ''); return write({ n, names, assign: presetAssign('atkdef', n) }); }
        if (b.dataset.sk) { return write({ n: sp.n, names: sp.names, assign: { ...sp.assign, [b.dataset.sk]: +b.dataset.si } }); }
        if (b.dataset.sp === 'prev' && prev) { const ps = splitOf(prev); return write({ n: ps.n, names: ps.names, assign: ps.assign }); }
        if (b.dataset.sp) return write({ n: sp.n, names: sp.names, assign: presetAssign(b.dataset.sp, sp.n) });
      });
      root.querySelectorAll('[data-sname]').forEach((inp) => { inp.onchange = () => { const names = sp.names.slice(); names[+inp.dataset.sname] = inp.value.trim(); write({ n: sp.n, names, assign: sp.assign }); }; });
    },
  };
}

// ---------- 直した履歴（イベントごとに持つ）と「1つ戻す」 ----------
// hist：[{t, dev, by, act:'add'|'edit'|'del'|'revert', prev?, undone?, of?}]。prev＝変える前のイベント
const snap = (e) => { const { hist, t, dev, ...r } = e; return JSON.parse(JSON.stringify(r)); };
function mark(act, prev) { const h = { t: Date.now(), dev: deviceIdLocal(), by: devName(), act }; if (prev) h.prev = snap(prev); return h; }
const deviceIdLocal = () => deviceId();
function writeEv(m, next, act, old) {
  const hist = [...(old?.hist || []), mark(act, act === 'add' ? null : old)];
  return saveEvent(m.id, { ...next, hist });
}
// 取り消せる変更：そのイベントで、それより後の変更がすべて「取り消し」か「取り消し済み」のもの（新しい方から順に戻せる）
function undoable(ev) {
  const hist = ev.hist || [];
  for (let i = hist.length - 1; i >= 0; i--) { const h = hist[i]; if (h.act === 'revert' || h.undone) continue; return i; }
  return -1;
}
function revertLast(m, ev) {
  const hist = ev.hist || []; const i = undoable(ev); if (i < 0) return null;
  const h = hist[i];
  const base = h.act === 'add' ? { ...snap(ev), deleted: true } : { ...h.prev, id: ev.id };
  if (h.act === 'del') base.deleted = false;
  const nh = hist.map((x, j) => (j === i ? { ...x, undone: true } : x)).concat({ ...mark('revert', ev), of: i });
  return saveEvent(m.id, { ...base, hist: nh });
}
function lastMine(all) {
  const me = deviceIdLocal(); let best = null;
  for (const ev of all) {
    const i = undoable(ev); if (i < 0) continue; const h = ev.hist[i];
    if (h.dev === me && (!best || h.t > best.h.t)) best = { ev, h };
  }
  return best;
}
// 何をどう変えたか（履歴の1行）
const FL = { loc: '場所', at: '時刻', kind: 'イベント', pid: '選手', pid2: '受け手', assist: 'アシスト', result: '結果', n: '進入人数', cls: '局面', sp: 'セットプレー', gtype: '種類', sz: 'SZ', zone: 'ゾーン', card: 'カード', fsp: '種類', method: '方法', og: 'OG', period: 'ピリオド', endPeriod: '終わりのピリオド', endAt: '4×3の終わり' };
function diffText(a, b, nm, periods) {
  const lists = { result: RESULTS, cls: CLS, sp: SETP, fsp: FSP, method: METHODS, zone: ZONES, card: [...CARDS_OPP] };
  const v = (k, x, e) => {
    if (x == null || x === '') return '—';
    if (k === 'at' || k === 'endAt') { const pl = periods.find((p) => p.key === (k === 'at' ? e.period : e.endPeriod)); return pl ? mmss(Math.round((pl.len - x) / 1000)) : String(x); }
    if (k === 'kind') return KIND[x]?.label || x;
    if (k === 'loc') return areaOf(x)?.area || '—';
    if (k === 'period' || k === 'endPeriod') return periods.find((p) => p.key === x)?.label || x;
    if (['pid', 'pid2', 'assist'].includes(k)) return x === UNKNOWN ? '不明' : x === OPP_OG ? '相手OG' : x === NO_ASSIST ? 'なし' : nm(x);
    if (lists[k]) return (lists[k].find((y) => y[0] === x) || [])[1] || x;
    return String(x);
  };
  const out = [];
  for (const k of Object.keys(FL)) if (JSON.stringify(a[k] ?? null) !== JSON.stringify(b[k] ?? null)) out.push(`${FL[k]} ${v(k, a[k], a)}→${v(k, b[k], b)}`);
  return out.join('、') || '（変更なし）';
}
const ACT = { add: '記録した', edit: '直した', del: '削除した', revert: '取り消した' };

// 担当者の表示：名前を入れていなければ「未設定」（記録の印には今までどおり iPad・PC が付く）
const whoLabel = () => { try { return localStorage.getItem('fpt.deviceName') || '未設定'; } catch { return '未設定'; } };
// rt：試合ページの「リアルタイム入力」から開いたとき（中身は同じ。見出しだけ変える）
export function vEvents(m, { rt = false } = {}) {
  const title = rt ? 'リアルタイム入力' : 'イベント入力';
  const opsC = watchOps(m.id); const evC = watchEvents(m.id);
  if (!opsC.ready && !opsC.list.length) return { active: 'acts', html: '<p class="mu pad">読み込み中…</p>' };
  const cfg = cfgOf(m);
  const st = replay(opsC.list, cfg);
  st.sig = periodSig(opsC.list); // MATCH PLAYの記録が変わったあとの古い修正は使わない（マッチレビューと同じ）
  const M = matchModel(st, Date.now(), m.fix);
  const periods = M.periods;
  const pOrder = PERIODS.map((p) => p.key);
  if (ui.m !== m.id) {
    const live = periods.find((p) => p.status === 'live');
    const last = [...periods].reverse().find((p) => p.status === 'done');
    ui = { m: m.id, period: (live || last || periods[0]).key, sec: null, kind: null, f: {}, edit: null, clsTouched: false, todo: todoFor === m.id, rechecked: false };
  }
  if (todoFor === m.id) { ui.todo = true; ui.ltab = 'ev'; todoFor = null; }
  // ⚠（要確認）を今の記録で判定し直す：開いたときと、出場の記録（MATCH PLAYの取り消し・リセット・あとからの交代、記録の修正）が変わったとき（記4）
  ensureChecks(m, M, evC);
  const per = periods.find((p) => p.key === ui.period) || periods[0];
  const lenSec = Math.round(per.len / 1000);
  if (ui.sec == null) ui.sec = lenSec;
  const events = sortEvents(liveEvents(evC.list), pOrder);
  const nm = (pid) => `${cfg.members?.[pid]?.no ?? '?'} ${playerById(pid)?.last || ''}`.trim();
  const sp = splitOf(m); const role = roleOf(m, sp.n);
  const crumbE = `<div class="crumb"><a class="btn sm mpback" href="#/m/${m.id}">‹ 試合ページ</a><a href="#/m/${m.id}">vs ${esc(m.opponent)}</a> › ${title}</div>`;
  // 分担しているのに、この端末の担当がまだ決まっていない → まず担当を選ぶ
  if (sp.n > 1 && role == null) {
    return { active: 'acts', html: `${crumbE}<h1>${title}：どの担当ですか？</h1>
      <p class="mu">この試合は ${sp.n}人で分けて入力します。この端末で入力する担当を押してください（あとから変えられます）。担当者：<b>${esc(whoLabel())}</b> <button class="btn xs" id="evWho">変える</button></p>
      <div class="rolepick">${Array.from({ length: sp.n }, (_, i) => `<button class="card" data-role="${i}"><b>${roleName(m, i)}</b><span>${kindsShown(kindsOf(sp, i)).map(kindLabel).join('・')}</span></button>`).join('')}</div>
      <p><a class="btn" href="#/m/${m.id}/split">入力担当の設定</a></p>`,
      bind: (root) => { root.querySelectorAll('[data-role]').forEach((b) => { b.onclick = () => {
        const i = +b.dataset.role; const plan = (m.evSplit?.names || [])[i];
        if (plan && plan !== devName()) { try { localStorage.setItem('fpt.deviceName', plan); } catch {} toast(`担当者を「${plan}」にしました`); }
        setRole(m, i); render(); }; }); const w = root.querySelector('#evWho'); if (w) w.onclick = () => changeWho(m); } };
  }
  const mine = sp.n > 1 ? kindsOf(sp, role) : ALLK;
  { const me = (m.evRoles || {})[deviceId()]; if (sp.n > 1 && role != null && (!me || me.role !== role || me.name !== devName())) setRole(m, role); }

  // ---------- 左：入力したイベント ----------
  const counts = Object.fromEntries(periods.map((p) => [p.key, events.filter((e) => e.period === p.key).length]));
  if (!ui.listPer || !periods.some((p) => p.key === ui.listPer)) ui.listPer = ui.period;
  const cardMap = cardsOf(events, periods.map((p) => p.key));
  // 絞り込み：todo＝未入力（基本）・要確認、detail＝詳細の空き
  const isDet = (e) => missingLv(e, goalName).detail > 0;
  const remOf = (k, at) => { const p = periods.find((x) => x.key === k); return p ? `${p.label} ${mmss(Math.round((p.len - at) / 1000))}` : ''; };
  const todoN = events.filter((e) => isTodo(e, goalName)).length, detN = events.filter(isDet).length;
  if (ui.todo && !todoN) ui.todo = false;
  if (ui.det && !detN) ui.det = false;
  const rows = events.filter((e) => (ui.todo ? isTodo(e, goalName) : ui.det ? isDet(e) : e.period === ui.listPer)).map((e) => {
    const pl = periods.find((p) => p.key === e.period); const rem = Math.round((pl.len - e.at) / 1000);
    const lv = missingLv(e, goalName); const miss = lv.basic;
    const dup = events.some((x) => x !== e && x.kind === e.kind && x.period === e.period && Math.abs(x.at - e.at) <= 3000 && x.dev && e.dev && x.dev !== e.dev);
    const by = (e.hist || [])[0]?.by;
    return `<button class="evr ${ui.edit === e.id ? 'sel' : ''}" data-ev="${e.id}"><span class="t">${ui.todo ? `<small class="evper">${pl.label}</small>` : ui.det ? `<small class="evper">${pl.label}</small>` : ''}${mmss(rem)}${e.role != null && sp.n > 1 ? `<span class="who r${e.role}" title="${esc(by || '')}">${e.role + 1}</span>` : ''}</span><span class="k ${KIND[e.kind].team === 'opp' ? 'opp' : ''}">${KIND[e.kind].label}</span>
      <span class="d">${esc(cardMap.get(e.id) === 'y2' && e.card === 'yellow' ? summary(e, nm, goalName).replace('イエロー', 'イエロー2枚目（退場）') : summary(e, nm, goalName, remOf))}${miss ? ` <span class="miss">未入力 ${miss}</span>` : ''}${lv.detail ? ` <span class="missd">詳細 ${lv.detail}</span>` : ''}${e.check ? ` <span class="evchk" title="${esc(e.checkWhy || '')}">⚠ 要確認</span>` : ''}${e.checkOk ? ' <span class="evok">このままにした</span>' : ''}${dup ? ' <span class="evdup">同じイベントが2回入っているかも</span>' : ''}${by ? ` <span class="evby">${esc(by)}</span>` : ''}</span></button>`;
  }).join('') || '<p class="mu" style="padding:8px 14px">まだありません</p>';
  const all = evC.list;
  const histRows = all.flatMap((e) => { const u = undoable(e); return (e.hist || []).map((h, i) => ({ e, h, i, last: i === e.hist.length - 1, can: i === u })); }).filter((x) => x.h.act !== 'add').sort((a, b) => b.h.t - a.h.t);
  const evDesc = (e) => { const pl = periods.find((p) => p.key === e.period); return `${KIND[e.kind]?.label || ''} ${pl?.label || ''} ${pl ? mmss(Math.round((pl.len - e.at) / 1000)) : ''}`; };
  const hhmm = (t) => { const d = new Date(t); return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`; };
  const histHTML = histRows.map(({ e, h, i, last, can }) => {
    const after = last ? e : { ...e, ...(e.hist[i + 1]?.prev || {}) };
    const txt = h.act === 'del' ? `<span class="hdel">削除</span> ${esc(evDesc(h.prev || e))}`
      : h.act === 'revert' ? `取り消し：${esc(evDesc(e))}`
      : `${esc(evDesc(after))}　${esc(diffText(h.prev || {}, after, nm, periods))}`;
    const canUndo = can;
    return `<div class="hr ${h.undone ? 'undone' : ''}"><span class="tm">${hhmm(h.t)}</span><span class="tx"><b>${esc(h.by || '?')}</b>：${txt}${h.undone ? '（取り消し済み）' : ''}</span>${canUndo ? `<button class="btn xs" data-rv="${e.id}">${h.act === 'del' ? '元に戻す' : '取り消す'}</button>` : '<span></span>'}</div>`;
  }).join('') || '<p class="mu" style="padding:8px 4px">まだありません（直したり削除したりすると、ここに残ります）</p>';
  const ltabs = `<div class="ltabs"><button class="${ui.ltab !== 'hist' ? 'on' : ''}" data-ltab="ev">イベント</button><button class="${ui.ltab === 'hist' ? 'on' : ''}" data-ltab="hist">直した履歴</button></div>`;
  const list = ui.ltab === 'hist' ? `<div class="card evlist evhist">${ltabs}<h3>直した履歴（新しい順）</h3><div class="hrows">${histHTML}</div>
    <p class="mu" style="font-size:12px">取り消すと、そのイベントだけが前の状態に戻ります（ほかの人の入力はそのまま）。同じイベントは、新しい変更から順に取り消せます。</p></div>` : `<div class="card evlist">${ltabs}<h3>入力したイベント（時刻順）</h3>
    <div class="perh">${periods.map((p) => `<button class="btn sm ${!ui.todo && !ui.det && p.key === ui.listPer ? 'pri' : ''}" data-lper="${p.key}">${p.label} ${counts[p.key]}件</button>`).join('')}${todoN ? `<button class="btn sm todo ${ui.todo ? 'on' : ''}" id="evTodo">未入力・要確認 ${todoN}件</button>` : ''}${detN ? `<button class="btn sm det ${ui.det ? 'on' : ''}" id="evDet">○詳細が空き ${detN}件</button>` : ''}</div>
    ${ui.todo ? '<div class="evtodo">●基本の項目が空いているか ⚠ 要確認が残っているイベントだけを並べています（前半・後半とも）。押すと直せます。埋め終わると一覧から消えます</div>' : ui.det ? '<div class="evtodo det">○詳細の項目が空いているイベントだけを並べています（前半・後半とも）。埋めると資料が充実します。空いていても「記録完了」にはなります</div>' : ''}
    <div class="evrows">${rows}</div></div>`;

  // ---------- 右：入力 ----------
  const evBtn = (k) => `<button class="btn ${KIND[k].team === 'opp' ? 'o' : ''} ${ui.kind === k ? 'on' : ''}" data-kind="${k}">${sp.n <= 1 && (k === 'fspat' || k === 'fspdf') ? KIND[k].label : KIND[k].short || KIND[k].label}</button>`; // 1人のときは FINISH SET PLAY も1行
  const step1 = `<div class="step"><span class="num">1</span><div>
      <div class="st">時刻<small>映像のスコアボードと同じ残り時間。「1205」で 12:05</small></div>
      <div class="evtime"><div class="evper">${periods.map((p) => `<button class="btn ${p.key === ui.period ? 'pri' : ''}" data-per="${p.key}">${p.label}</button>`).join('')}</div>
        <div class="evkp">${keypadHTML({ steps: [-1, 1], id: 'evkp' })}</div></div></div></div>`;
  // 分担しているときは担当のイベントだけを出す（担当以外は入れない＝しっかり分業。見逃しは試合後に「1人（全部）」で直す）
  const showAll = sp.n <= 1;
  // 相手の退場（4×3）：1人のときはサブイベントの横、分担しているときは被ファールの担当が入れる
  const mineRow = sp.n > 1 ? `<div class="mainev bigrow">${mine.map(evBtn).join('')}${mine.includes('fouled') ? evBtn('oej') : ''}</div>` : '';
  const step2 = `<div class="step"><span class="num">2</span><div>
      <div class="st">イベント<small>${sp.n > 1 ? `${roleName(m, role)}が入力するイベント` : 'メインイベント：上が自チーム、下が相手チーム'}</small></div>${mineRow}${showAll ? `
      <div class="mainev"><span class="lab own">自チーム</span>${MAIN_OWN.map(evBtn).join('')}<span class="lab opp">相手チーム</span>${MAIN_OPP.map(evBtn).join('')}</div>
      <div class="subev"><span class="lab">サブイベント</span>${SUBS.map(evBtn).join('')}${evBtn('oej')}</div>` : ''}${contRow(mine)}</div></div>`;
  const lm = lastMine(all);
  const undoBtn = `<button class="btn evundo" id="evUndo" ${lm ? '' : 'disabled'}>↶ 1つ戻す${lm ? `（${ACT[lm.h.act]}：${esc(evDesc(lm.h.act === 'add' ? lm.ev : lm.h.prev || lm.ev))}）` : ''}</button>`;
  const editing = ui.edit ? all.find((x) => x.id === ui.edit) : null;
  // 未4：⚠のイベントは「このままにする」で要確認を外せる（選手を変えると、また判定する）
  const keepBtn = editing?.check ? `<div class="evkeep"><span>⚠ 要確認：${esc(editing.checkWhy || '記録上この時刻にピッチにいない選手を選んでいます')}</span><button class="btn" id="evKeep">このままにする</button></div>` : '';
  const foot = ui.edit
    ? `${keepBtn}<div class="foot"><button class="btn dangerline" id="evDel">このイベントを削除</button><span class="sp"></span><button class="btn" id="evCancel">やめる</button><button class="btn pri" id="evSave" ${ui.kind ? '' : 'disabled'}>直す</button></div>`
    : `<div class="foot">${undoBtn}<span class="mu">時刻とイベントだけで記録できます。空けた分は資料で「—」や「未入力 n」になり、あとで埋められます</span><button class="btn" id="evCancel" ${ui.kind ? '' : 'disabled'}>やめる</button><button class="btn pri" id="evSave" ${ui.kind ? '' : 'disabled'}>記録する（時刻はそのまま）</button></div>`;
  const ctx = { m, cfg, M, st, events, per, nm, all, sp, role };
  VID.ctx = ctx;
  const form = `<div class="card evform">${ui.edit ? '<div class="evediting">入力したイベントを直しています</div>' : ''}${step1}${step2}<div id="evDyn">${dynHTML(ctx)}</div>${foot}</div>`;

  return {
    active: 'acts',
    html: `<div class="crumb"><a class="btn sm mpback" href="#/m/${m.id}">‹ 試合ページ</a><a href="#/m/${m.id}">vs ${esc(m.opponent)}</a> › ${title}</div>
      <div class="row between"><h1 style="margin:0">${title}</h1><span class="mu">記録した時点で試合の記録になり、マッチレビューにすぐ反映されます</span></div>
      <div class="evrole"><span class="rl">入力の担当人数</span><b>${sp.n}人</b>${sp.n > 1 ? `<span class="rl">この端末</span><b>${roleName(m, role)}</b><span class="mu">${kindsShown(mine).map(kindLabel).join('・')}</span><button class="btn sm" id="evRoleChange">担当を変える</button>` : '<span class="mu">（1人で全部のイベントを入力）</span>'}
        <a class="btn sm" href="#/m/${m.id}/split">入力担当の設定</a><button class="btn sm" id="evKeys" title="PCのキーボードで入力するときのキー">⌨ キー操作</button><button class="btn sm ${VID.open ? 'pri' : ''}" id="evVid">🎬 動画を見ながら入力${VID.open ? '（開いています）' : ''}</button><button class="dev" id="evWho">担当者：<b>${esc(whoLabel())}</b> <span>変える</span></button></div>
      <div class="evw mt ${VID.open ? 'vid' : ''}"><div class="evleft">${VID.open ? vidPanel(m, M) : ''}${list}</div>${form}</div>`,
    bind: (root) => bindEv(root, ctx),
  };
}

// ---------- ③④（イベントごとに変わる部分） ----------
// 入力の3段階（2026-10-16 決定）：●基本＝試合の概略に必要／○詳細＝資料を充実させる／△任意＝今は資料に使わない
const BAS = '<span class="lv b">●基本</span>';
const DET = '<span class="lv d">○詳細</span>';
const OPT = '<span class="lv o">△任意</span>';
const LV_NOTE = '<div class="lvnote"><span class="lv b">●基本</span>試合の概略に必要（空きは「未入力」）<span class="lv d">○詳細</span>資料を充実させる<span class="lv o">△任意</span>今は資料に使わない</div>';
function curEv(ctx) {
  const at = Math.max(0, ctx.per.len - ui.sec * 1000);
  return { ...ui.f, id: ui.edit, kind: ui.kind, period: ui.period, at, side: ui.f.side || (isFsp(ui.kind) ? 'after' : 'before') };
}
function dynHTML(ctx) {
  const { cfg, M, per, nm } = ctx;
  if (!ui.kind) return '<div class="evhint">② のイベントを押すと、選手と結果の欄が出ます。</div>';
  const ev = curEv(ctx); const f = ui.f; const k = ui.kind; const own = KIND[k].team === 'own';
  const lenSec = Math.round(per.len / 1000);
  const timeOk = ui.sec >= 0 && ui.sec <= lenSec;
  if (!timeOk) return `<div class="evhint err">時刻は ${mmss(lenSec)}〜0:00 の範囲で入れてください（${per.label}の長さ）。</div>`;
  const on = pitchAt(M, ui.period, ev.at, ev.side);
  const subHere = subAtSecond(M, ui.period, ev.at);
  const sideSw = subHere ? `<span class="sidesw">この秒に交代があります：<button class="btn sm ${ev.side === 'before' ? 'pri' : ''}" data-side="before">交代前の5人</button><button class="btn sm ${ev.side === 'after' ? 'pri' : ''}" data-side="after">交代後の5人</button></span>` : '';
  const players = (key, { exclude = null, oppOG = false, unknown = true, none = false } = {}) => {
    const sel = f[key];
    const cards = on.map((pid) => `<button class="pc2 ${cfg.members?.[pid]?.pos === 'GK' ? 'gk' : ''} ${sel === pid ? 'on' : ''}" data-pick="${key}" data-v="${pid}" ${pid === exclude ? 'disabled' : ''}><span class="n">${esc(cfg.members?.[pid]?.no ?? '?')}</span><span class="nm">${esc(playerById(pid)?.last || '')}</span></button>`).join('');
    const other = sel && sel !== UNKNOWN && sel !== OPP_OG && sel !== NO_ASSIST && !on.includes(sel)
      ? `<button class="pc2 on chk2" data-pick="${key}" data-v="${sel}"><span class="n">${esc(cfg.members?.[sel]?.no ?? '?')}</span><span class="nm">${esc(playerById(sel)?.last || '')} ⚠</span></button>` : '';
    return `<div class="pl">${cards}${other}</div><div class="pl2"><button class="btn" data-other="${key}">ほかの選手…</button>${unknown ? `<button class="btn ${sel === UNKNOWN ? 'on' : ''}" data-pick="${key}" data-v="${UNKNOWN}">不明</button>` : ''}${oppOG ? `<button class="btn ${sel === OPP_OG ? 'on' : ''}" data-pick="${key}" data-v="${OPP_OG}">相手OG</button>` : ''}${none ? `<button class="btn ${sel === NO_ASSIST ? 'on' : ''}" data-pick="${key}" data-v="${NO_ASSIST}">なし（ドリブル・こぼれ球）</button>` : ''}<button class="btn ${sel == null ? 'on soft' : ''}" data-pick="${key}" data-v="">あとで</button></div>
      ${other ? `<div class="evwarn">⚠ ${esc(nm(sel))} は記録上この時刻にピッチにいません。このまま記録すると「要確認」になります（交代の時刻のずれを試合後に直します）</div>` : ''}`;
  };
  const choice = (key, list, { dis = [] } = {}) => `<div class="ch">${list.map(([v, l]) => `<button class="btn ${String(f[key]) === String(v) ? 'on' : ''}" data-set="${key}" data-v="${v}" ${dis.includes(v) ? 'disabled' : ''}>${l}</button>`).join('')}</div>`;
  const row = (label, mark, body, hint = '') => `<div class="rrow"><label>${label}${mark}</label><div>${body}${hint ? `<div class="hint">${hint}</div>` : ''}</div></div>`;
  const step = (n, title, body) => `<div class="step"><span class="num">${n}</span><div><div class="st">${title}</div>${body}</div></div>`;
  const at5 = `<small>${mmss(ui.sec)} にピッチにいた5人</small>${sideSw}`;
  // 場所（コートの図。2026-10-22）：押した点を残し、エリア・ZONE・SZの中かを自動で決める
  const locStep = (n) => {
    const a = areaOf(f.loc); const opp = KIND[k].team === 'opp' && k !== 'oej';
    // ラストパスの場所も同じ図で（自チームのシュート・得点。2026-10-22）
    const lpOk = (k === 'shot' || k === 'szshot' || (k === 'goal' && f.pid !== OPP_OG)) && (k === 'goal' ? f.assist !== NO_ASSIST : f.lp !== NO_ASSIST);
    if (!lpOk) ui.locMode = 'shot';
    const lpMode = lpOk && ui.locMode === 'lp'; const la = areaOf(f.lpLoc);
    const modes = lpOk ? `<div class="locmode"><button class="btn sm ${lpMode ? '' : 'on'}" data-locmode="shot">● ${k === 'goal' ? '得点' : 'シュート'}の場所</button><button class="btn sm ${lpMode ? 'on' : ''}" data-locmode="lp">◆ ラストパスの場所${la ? `：${la.area}` : ''}</button></div>` : '';
    const marks = [...(f.loc ? [{ loc: f.loc, cls: opp ? 'o' : 'w' }] : []), ...(lpOk && f.lpLoc ? [{ loc: f.lpLoc, cls: 'lp', shape: 'diamond' }] : [])];
    const auto = !a ? '' : (k === 'shot' || k === 'szshot') ? (a.sz ? '→ SZの中なので「SZ内シュート」として記録します' : '→ SZの外なので「シュート」として記録します')
      : (k === 'oshot' || k === 'oszshot') ? (a.osz ? '→ 自陣のSZの中なので「被SZ内シュート」として記録します' : '→ 自陣のSZの外なので「被シュート」として記録します')
      : k === 'goal' ? `→ SZ${a.sz ? '内' : '外'}` : k === 'conc' ? (isOGg(f.gtype) ? '' : `→ SZ${a.osz ? '内' : '外'}`) : (k === 'rec' || k === 'lost') ? `→ ゾーン ${a.zone}` : '';
    const nmA = a ? `<b>${a.area}</b><span>（${a.zone.replace('Z', 'ZONE ')}${a.sz ? '・SZの中' : ''}${a.oarea ? `・自陣のゴール前：${a.oarea.replace('被', '')}` : ''}）</span>` : '<span class="mu">コートを押すと、その場所を記録します</span>';
    return step(n, `場所 ${OPT}<small>コートを押す（自チームは右のゴールへ${opp ? '、相手は左のゴールへ' : ''}攻める）</small>`,
      `${modes}<div class="evcourt">${courtSVG({ marks, opp, line: lpOk && f.loc && f.lpLoc ? [f.lpLoc, f.loc] : null })}</div><div class="locinfo">${nmA}${auto ? `<em>${auto}</em>` : ''}${(lpMode ? f.lpLoc : f.loc) ? `<button class="btn sm" data-locclr>${lpMode ? 'ラストパスの場所' : '場所'}を消す</button>` : ''}</div>`);
  };
  const nCount = (sz) => choice('n', [0, 1, 2, 3, 4, 5].map((x) => [x, `${x}人`]), { dis: sz ? [0] : [] });
  const clsRow = () => row('分類', DET, `${choice('cls', CLS)}${f.cls === 'set' ? `<div class="sp2"><span style="margin:0 8px 0 0">セットプレーの種類 ${OPT}</span>${choice('sp', SETP)}</div>` : ''}`,
    ui.clsAutoNote || '');
  const gtList = goalTypes().filter((o) => !o.hidden || o.id === f.gtype).map((o) => [o.id, o.name]);
  let html = k === 'osz' || k === 'oej' ? '' : LV_NOTE;
  if (k === 'oej') {
    const ps = M.periods; const pi = (key) => ps.findIndex((p) => p.key === key);
    const lab = (key, at) => { const p = ps.find((x) => x.key === key); return p ? `${p.label} ${mmss(Math.round((p.len - at) / 1000))}` : '—'; };
    const endOk = f.endPeriod != null && f.endAt != null;
    const bad = endOk && (pi(f.endPeriod) < pi(ui.period) || (f.endPeriod === ui.period && f.endAt <= ev.at));
    const editEnd = ui.oejStep === 'end';
    const endPers = ps.filter((p) => pi(p.key) >= pi(ui.period));
    html += step(3, '4×3の時間帯（相手の退場）', `<div class="oejsw"><button class="btn ${editEnd ? '' : 'pri'}" data-oejstep="start">退場の時刻<b>${lab(ui.period, ev.at)}</b></button><span>〜</span><button class="btn ${editEnd ? 'pri' : ''}" data-oejstep="end">4×3の終わり<b>${endOk ? lab(f.endPeriod, f.endAt) : '—'}</b></button></div>
      <div class="hint">押した方の時刻を、上の数字のボタンで入れます（映像のスコアボードの残り時間）。${editEnd ? '' : '退場の時刻は、①の時刻です。'}</div>
      ${editEnd ? `<div class="ch oejper">${endPers.map((p) => `<button class="btn ${p.key === f.endPeriod ? 'on' : ''}" data-endper="${p.key}">${p.label}</button>`).join('')}</div>` : ''}
      <div class="hint">初めの終わりは、退場からプレーイングタイムで2:00後（次のピリオドにまたがることもあります）。その前にこちらが得点したときは、その得点の時刻です。${ui.endTouched ? ' <button class="btn sm" data-oejauto>初めの終わりに戻す</button>' : '（いまは初めの終わり）'}</div>
      ${bad ? '<div class="evwarn">⚠ 4×3の終わりが、退場の時刻より前になっています</div>' : ''}
      <div class="hint">相手の選手は記録しません。分析で「相手の退場（4×3）」の時間帯に使います。</div>`);
    return html;
  }
  if (isShot(k)) {
    const sz = isSZ(k);
    html += own ? step(3, `打った選手とラストパス ${at5}`, row('打った選手', DET, players('pid')) + row('ラストパス', OPT, players('lp', { exclude: f.pid, none: true }), 'シュートの1つ前のパスを出した選手')) : step(3, '選手', `<div class="mu">相手チームのイベントなので、選手は選びません${sideSw ? '　' + sideSw : ''}</div>`);
    html += locStep(4);
    html += step(5, '結果', row('結果', BAS, choice('result', RESULTS)) +
      row('ゾーン内の人数', sz ? OPT : DET, nCount(sz), sz ? 'SZ内は打った選手を1人目に数えるので0人は押せません' : 'シュートの瞬間にSZの中にいた攻撃側の人数（0人＝人無）') + clsRow());
  } else if (k === 'z4' || k === 'sz') {
    const meth = row('方法', DET, choice('method', METHODS));
    const who = f.method === 'pass'
      ? row('出し手', DET, players('pid', { exclude: f.pid2 })) + row('受け手', DET, players('pid2', { exclude: f.pid }))
      : f.method ? row('進入した選手', DET, players('pid')) : '<div class="hint">方法を選ぶと選手の欄が出ます（パス＝出し手と受け手、ドリブル・リバウンド＝1人）</div>';
    html += step(3, `進入の方法と選手 ${at5}`, meth + who);
    if (k === 'z4') html += step(4, '結果', clsRow());
  } else if (k === 'oz4') {
    html += step(3, '選手', '<div class="mu">相手チームのイベントなので、選手も方法も記録しません</div>') + step(4, '結果', clsRow());
  } else if (k === 'osz') {
    html += step(3, '選手', '<div class="mu">相手チームのSZ進入は、時刻だけを記録します（ほかに入れる項目はありません）</div>');
  } else if (k === 'goal') {
    const ogg = f.pid === OPP_OG;
    html += step(3, `得点者とアシスト ${at5}`, row('得点者', BAS, players('pid', { oppOG: true })) +
      (ogg ? '' : row('アシスト', DET, `<div class="ch">${on.filter((p) => p !== f.pid).map((p) => `<button class="btn ${f.assist === p ? 'on' : ''}" data-set="assist" data-v="${p}">${esc(nm(p))}</button>`).join('')}<button class="btn ${f.assist === NO_ASSIST ? 'on' : ''}" data-set="assist" data-v="${NO_ASSIST}">なし</button><button class="btn ${f.assist == null ? 'on soft' : ''}" data-set="assist" data-v="">あとで</button></div>`)));
    if (!ogg) html += locStep(4);
    html += step(ogg ? 4 : 5, '結果', ogg ? '<div class="mu">相手のオウンゴール：得点の種類は「OG」、アシストは「なし」が自動で入ります。シュートには数えません</div>'
      : row('得点の種類', DET, choice('gtype', gtList.filter(([id]) => !isOGg(id)))) + row('SZ内／SZ外', DET, choice('sz', [['in', 'SZ内'], ['out', 'SZ外']])) +
        (f.sz ? row('ゾーン内の人数', f.sz === 'in' ? OPT : DET, nCount(f.sz === 'in')) : '') +
        '<div class="hint">得点は「枠内シュート」としても数えるので、同じ場面のシュートは入れません。分類は種類から自動で付きます</div>');
  } else if (k === 'conc') {
    const og = isOGg(f.gtype);
    html += step(3, `失点の種類 ${DET}`, choice('gtype', gtList));
    if (!og) html += locStep(4);
    html += step(og ? 4 : 5, og ? 'オウンゴール' : '結果', og
      ? row('OGの選手', DET, players('og', { unknown: true })) + '<div class="hint">OGのときは「SZ内／SZ外」と「ゾーン内の人数」は入れません。シュートにも数えません</div>'
      : row('SZ内／SZ外', DET, choice('sz', [['in', 'SZ内'], ['out', 'SZ外']])) + (f.sz ? row('ゾーン内の人数', f.sz === 'in' ? OPT : DET, nCount(f.sz === 'in'), '相手の人数') : '') +
        '<div class="hint">失点は「枠内の被シュート」としても数えるので、同じ場面の被シュートは入れません</div>');
  } else if (isFsp(k)) {
    html += step(3, `種類 ${DET}`, choice('fsp', FSP));
    // サイン名（自チームの FINISH SET PLAY。2026-10-23）：前に使ったサインを押すか、新しい名前を書く。種類が同じサインを先に並べる
    if (k === 'fspat') {
      const signs = signList();
      const ord = [...signs].sort((a, b) => (signTypeOf(b) === f.fsp) - (signTypeOf(a) === f.fsp));
      html += step(4, `サイン名 ${OPT}`, `<div class="ch signs">${ord.map((n) => `<button class="btn ${f.sign === n ? 'on' : ''}" data-set="sign" data-v="${esc(n)}">${esc(n)}</button>`).join('')}</div>
        <div class="signnew"><input id="evSign" placeholder="新しいサイン名（例：CK-①、KI-B）" value="${f.sign && !signs.includes(f.sign) ? esc(f.sign) : ''}" maxlength="30"><span class="mu">書いて「記録する」を押すと、次からボタンで選べます</span></div>`);
    }
  } else if (k === 'rec' || k === 'lost') {
    html += step(3, `${k === 'rec' ? 'ボールを奪った選手' : 'ボールを失った選手'} ${DET}${at5}`, players('pid'));
    html += locStep(4);
    html += step(5, 'ゾーン', row('ゾーン', OPT, `<div class="ch zch">${ZONES.map(([z, c]) => `<button class="btn ${f.zone === z ? 'on' : ''}" data-set="zone" data-v="${z}">${z}<span class="zcap">${c}</span></button>`).join('')}</div>`));
  } else if (k === 'foul' || k === 'fouled') {
    html += step(3, `${k === 'foul' ? 'ファールをした選手' : 'ファールを受けた選手'} ${k === 'foul' ? DET : OPT}${at5}`, players('pid'));
    html += locStep(4);
    html += step(5, 'カード', row('カード', BAS, choice('card', k === 'fouled' ? CARDS_OPP : CARDS), k === 'fouled' ? '相手選手へのカード' : '同じ選手の2枚目のイエローは、自動で「イエロー2枚目（退場）」として数えます'));
  }
  return html;
}

// ---------- 操作 ----------
function startKind(ctx, k) {
  // 直しているイベントの種類を変えたときは、新しい種類に合う項目だけを残す（記3）
  const keep = ui.edit ? cleanFields({ ...ui.f, kind: k }, goalName) : {};
  delete keep.kind;
  ui.kind = k; ui.clsTouched = !!(ui.edit && keep.cls);
  ui.f = keep;
  if ((k === 'foul' || k === 'fouled') && !ui.f.card) ui.f.card = 'none';
  if (k === 'oej') { ui.oejStep = 'start'; ui.endTouched = !!(ui.f.endPeriod != null && ui.f.endAt != null); }
  applyAuto(ctx);
}
// 相手の退場：終わりを自分で直していなければ、退場の時刻から初めの終わりを付け直す
function oejAuto(ctx) {
  if (ui.kind !== 'oej' || ui.endTouched) return;
  const at = curEv(ctx).at; if (!(at >= 0)) return;
  Object.assign(ui.f, oejDefaultEnd(ctx.M, ctx.events.filter((e) => e.id !== ui.edit), ui.period, at));
}
function applyAuto(ctx) {
  oejAuto(ctx);
  ui.clsAutoNote = '';
  if (!ui.kind || !hasCls(ui.kind) || ui.clsTouched) return;
  const c = autoCls(ctx.M, ctx.events, curEv(ctx));
  ui.f.cls = c || undefined;
  if (c === 'special') ui.clsAutoNote = '自チームがGKをフィールドの選手と入れ替えていた区間か相手の5×4の時間帯なので「特殊局面」にしています（変えられます）';
  if (c === 'set') ui.clsAutoNote = '前後5秒以内にFINISH SET PLAYがあるので「セットプレー」にしています（変えられます）';
}
// 場所を入れて、場所から決まる項目を入れる。種類が変わったら true（上のボタンも描き直す）
function setLoc(loc) {
  if (ui.locMode === 'lp' && (ui.kind === 'shot' || ui.kind === 'szshot' || ui.kind === 'goal')) { ui.f.lpLoc = loc; ui.locMode = 'shot'; return false; } // ラストパスの場所を押したら、次はシュートの場所に戻す
  ui.f.loc = loc; const a = areaOf(loc); const k0 = ui.kind; if (!a) return false;
  if (k0 === 'shot' || k0 === 'szshot') ui.kind = a.sz ? 'szshot' : 'shot';
  else if (k0 === 'oshot' || k0 === 'oszshot') ui.kind = a.osz ? 'oszshot' : 'oshot';
  else if (k0 === 'goal' && ui.f.pid !== OPP_OG) ui.f.sz = a.sz ? 'in' : 'out';
  else if (k0 === 'conc' && !isOGg(ui.f.gtype)) ui.f.sz = a.osz ? 'in' : 'out';
  else if (k0 === 'rec' || k0 === 'lost') ui.f.zone = a.zone;
  if (ui.f.n === 0 && (isSZ(ui.kind) || ui.f.sz === 'in')) delete ui.f.n; // SZ内は0人はない
  return ui.kind !== k0;
}
// ---------- つづけて入力（2026-10-22）：記録した直後に、同じ時刻で続きのイベントを入れる（選手・局面を引き継ぐ） ----------
const NEXT = {
  z4: ['sz', 'shot', 'szshot', 'goal', 'lost'], sz: ['szshot', 'shot', 'goal', 'lost'], shot: ['shot', 'szshot', 'goal', 'rec', 'lost'], szshot: ['szshot', 'shot', 'goal', 'rec', 'lost'],
  rec: ['z4', 'sz', 'shot', 'szshot', 'lost'], lost: ['oz4', 'osz', 'oshot', 'oszshot', 'rec'], fspat: ['shot', 'szshot', 'goal'],
  oz4: ['osz', 'oshot', 'oszshot', 'conc', 'rec'], osz: ['oszshot', 'oshot', 'conc', 'rec'], oshot: ['oshot', 'oszshot', 'conc', 'rec'], oszshot: ['oszshot', 'oshot', 'conc', 'rec'],
  fspdf: ['oshot', 'oszshot', 'conc'], foul: ['fspdf'], fouled: ['fspat'],
};
function contRow(mine) {
  const L = ui.cont; if (!L || ui.kind || ui.edit) return '';
  const ks = (NEXT[L.kind] || []).filter((k) => mine.includes(k)); if (!ks.length) return '';
  return `<div class="controw"><span class="lab">つづけて</span><span class="mu">${esc(KIND[L.kind].label)}の続き（同じ時刻・選手・局面を引き継ぐ）</span>${ks.map((k) => `<button class="btn sm ${KIND[k].team === 'opp' ? 'o' : ''}" data-cont="${k}">${KIND[k].label}</button>`).join('')}</div>`;
}
function contStart(ctx, k) {
  const L = ui.cont; ui.cont = null; startKind(ctx, k); if (!L) return;
  const same = KIND[k].team === KIND[L.kind].team;
  if (same && KIND[k].team === 'own') {
    const pass = (L.kind === 'z4' || L.kind === 'sz') && L.method === 'pass';
    const who = pass ? L.pid2 : L.pid;
    if (who && who !== UNKNOWN && who !== OPP_OG) ui.f.pid = who;
    if (pass && L.pid) { if (k === 'goal') ui.f.assist = L.pid; else if (k === 'shot' || k === 'szshot') ui.f.lp = L.pid; }
  }
  if (L.cls && hasCls(k) && (same || L.kind === 'lost' || L.kind === 'rec')) { ui.f.cls = L.kind === 'lost' || L.kind === 'rec' ? (same ? L.cls : 'trans') : L.cls; ui.clsTouched = true; ui.clsAutoNote = ''; }
  else if ((L.kind === 'rec' || L.kind === 'lost') && hasCls(k)) { ui.f.cls = 'trans'; ui.clsTouched = true; ui.clsAutoNote = 'ボールを奪った・失った直後なので「トランジション」にしています（変えられます）'; }
}

// ---------- キーボード（PC。2026-10-22） ----------
const KEYS = { KeyS: ['shot', 'oshot'], KeyA: ['szshot', 'oszshot'], KeyZ: ['z4', 'oz4'], KeyX: ['sz', 'osz'], KeyG: ['goal', 'conc'], KeyC: ['fspat', 'fspdf'], KeyR: ['rec', null], KeyL: ['lost', null], KeyF: ['foul', 'fouled'] };
const RKEYS = { KeyI: 'in', KeyO: 'out', KeyB: 'block', KeyP: 'post' };
let keysOn = false, numBuf = '', numTimer = null;
function keyHelp() {
  const row = (k, t) => `<tr><td><kbd>${k}</kbd></td><td>${t}</td></tr>`;
  const md = openModal(`<h2>キー操作（PC）</h2><p class="mu">入力の欄にいないときに使えます。Shift を押しながらだと相手チームのイベントになります。</p>
    <table class="keyt">${row('S', 'シュート（Shift：被シュート）')}${row('A', 'SZ内シュート（Shift：被SZ内シュート）')}${row('Z', 'Z4進入（Shift：被Z4進入）')}${row('X', 'SZ進入（Shift：被SZ進入）')}${row('G', '得点（Shift：失点）')}${row('C', 'FINISH SET PLAY AT（Shift：DF）')}${row('R', 'ボールリカバリー')}${row('L', 'ボールロスト')}${row('F', 'ファール（Shift：被ファール）')}
    ${row('数字', 'イベントを選ぶ前：時刻（今までどおり）／イベントを選んだあと：選手の背番号（打った選手 → ラストパス、得点者 → アシスト などの順に入る）')}${row('I・O・B・P', 'シュートの結果：枠内・枠外・ブロック・ポスト')}${row('Enter', '記録する')}${row('Esc', 'やめる')}
    ${row('Space', '動画の再生・止める（動画を開いているとき）')}${row('← →', '動画を1秒戻す・進める（Shift で5秒）')}</table>
    <div class="row end"><button class="btn" data-c>閉じる</button></div>`);
  md.querySelector('[data-c]').onclick = closeModal;
}
function installKeys() {
  if (keysOn) return; keysOn = true;
  addEventListener('keydown', (e) => {
    const c = VID.ctx; if (!c || !/\/events/.test(location.hash) || !document.querySelector('.evform')) return;
    if (e.target.closest?.('input,textarea,select') || document.querySelector('.modal-bg') || e.metaKey || e.ctrlKey || e.altKey) return;
    const stop = () => { e.preventDefault(); e.stopPropagation(); };
    const v = VID.open && VID.url ? VID.el : null;
    if (e.code === 'Space' && v) { stop(); if (v.paused) v.play(); else v.pause(); return; }
    if ((e.code === 'ArrowLeft' || e.code === 'ArrowRight') && v) { stop(); v.currentTime = Math.max(0, v.currentTime + (e.code === 'ArrowLeft' ? -1 : 1) * (e.shiftKey ? 5 : 1)); return; }
    if (e.code === 'Escape') { stop(); resetForm(); ui.cont = null; render(); return; }
    if (e.key === '?' || (e.code === 'KeyH' && !e.shiftKey)) { stop(); keyHelp(); return; }
    if (KEYS[e.code]) {
      const k = KEYS[e.code][e.shiftKey ? 1 : 0]; if (!k) return; stop();
      const mine = c.sp.n > 1 ? kindsOf(c.sp, c.role) : ALLK;
      if (!mine.includes(k)) { toast(`${KIND[k].label}はこの端末の担当ではありません`); return; }
      if (ui.cont && (NEXT[ui.cont.kind] || []).includes(k)) contStart(c, k); else { ui.cont = null; startKind(c, k); }
      render(); return;
    }
    if (RKEYS[e.code] && ui.kind && isShot(ui.kind)) { stop(); ui.f.result = RKEYS[e.code]; render(); return; }
    if (/^[0-9]$/.test(e.key) && ui.kind) {
      stop(); numBuf += e.key; clearTimeout(numTimer);
      const members = c.cfg.members || {};
      const done = () => {
        const no = numBuf; numBuf = '';
        const pid = Object.keys(members).find((p) => String(members[p].no) === no);
        if (!pid) { toast(`背番号 ${no} の選手は試合メンバーにいません`); return; }
        const k = ui.kind; const f = ui.f;
        const order = isShot(k) && KIND[k].team === 'own' ? ['pid', 'lp'] : k === 'goal' ? ['pid', 'assist'] : (k === 'z4' || k === 'sz') ? (f.method === 'pass' ? ['pid', 'pid2'] : ['pid']) : ['rec', 'lost', 'foul', 'fouled'].includes(k) ? ['pid'] : [];
        if (!order.length) { toast('このイベントは選手を選びません'); return; }
        const key = order.find((x) => f[x] == null) || order[order.length - 1];
        if (key !== 'pid' && f.pid === pid) { toast('同じ選手です'); return; }
        f[key] = pid; afterPick(key); render();
      };
      // 2けたの背番号を待つ（1けたで決まるときはすぐ）
      const two = Object.values(members).some((m) => String(m.no).length > numBuf.length && String(m.no).startsWith(numBuf));
      if (numBuf.length >= 2 || !two) done(); else numTimer = setTimeout(done, 650);
    }
  }, true);
}

// FINISH SET PLAY のサイン名：チームで使ったことのある名前（設定に覚える）と、種類ごとに使った回数（並べる順に使う）
// 並び順：いちばん最近使ったものが先頭。いま選んでいる種類（CK など）で前に使ったサインをさらに先に出す
const signList = () => (teamSettings().fspSigns || []).filter(Boolean);
const signTypeOf = (n) => (teamSettings().fspSignType || {})[n];
function rememberSign(ev) {
  if (!ev.sign) return;
  const list = [ev.sign, ...signList().filter((n) => n !== ev.sign)].slice(0, 60);
  if (list.join('\u0001') === signList().join('\u0001') && signTypeOf(ev.sign) === ev.fsp) return;
  const st = D.team?.settings || {};
  put(teamPath(), { settings: { ...st, fspSigns: list, fspSignType: { ...(st.fspSignType || {}), [ev.sign]: ev.fsp || null } } });
}

function resetForm() { ui.locMode = 'shot'; ui.kind = null; ui.f = {}; ui.edit = null; ui.clsTouched = false; ui.clsAutoNote = ''; ui.oejStep = 'start'; ui.endTouched = false; }

function bindEv(root, ctx) {
  const { m, cfg, per } = ctx;
  const lenSec = Math.round(per.len / 1000);
  const dyn = () => { root.querySelector('#evDyn').innerHTML = dynHTML(ctx); };
  // 相手の退場の「4×3の終わり」を入れているときは、同じ数字のボタンで終わりの時刻を入れる
  const endP = ui.kind === 'oej' && ui.oejStep === 'end' ? ctx.M.periods.find((p) => p.key === ui.f.endPeriod) : null;
  VID.ctx = ctx; installKeys();
  root.addEventListener('keydown', (e) => { if (e.target.id === 'evSign' && e.key === 'Enter' && !e.isComposing && ui.kind) { e.preventDefault(); e.target.blur(); save(ctx); } });
  root.addEventListener('input', (e) => { if (e.target.id !== 'evSign') return; ui.f.sign = e.target.value.trim() || undefined; root.querySelectorAll('.signs .btn.on').forEach((b) => b.classList.remove('on')); });
  if (VID.open && VID.url) { const slot = root.querySelector('#evVidSlot'); if (slot) { slot.appendChild(vidEl()); const n = root.querySelector('.evvid .vnow'); if (n) n.innerHTML = vidNow(ctx); } }
  { const fi = root.querySelector('#evVidFile'); if (fi) fi.onchange = () => { const file = fi.files?.[0]; if (!file) return; if (VID.url) URL.revokeObjectURL(VID.url); VID.url = URL.createObjectURL(file); VID.name = file.name; const v = vidEl(); v.src = VID.url; render(); }; }
  const kp = endP ? bindKeypad(root.querySelector('.evkp'), {
    init: Math.max(0, Math.round((endP.len - (ui.f.endAt ?? endP.len)) / 1000)), min: 0, max: Math.round(endP.len / 1000),
    onChange: (v) => { if (v.ok) { const at = endP.len - v.sec * 1000; if (at !== ui.f.endAt) { ui.f.endAt = at; ui.endTouched = true; dyn(); kp && kp.note(`4×3の終わり：${endP.label}（経過 ${mmss(Math.round(at / 1000))}）`); } } },
    onEnter: () => save(ctx),
  }) : bindKeypad(root.querySelector('.evkp'), {
    init: Math.max(0, Math.min(ui.sec, lenSec)), min: 0, max: lenSec,
    onChange: (v) => { if (v.ok && v.sec !== ui.sec) { ui.sec = v.sec; applyAuto(ctx); dyn(); } else if (!v.ok) { ui.sec = v.sec ?? -1; dyn(); } },
    onEnter: () => { if (ui.kind) save(ctx); },
  });
  if (endP) kp.note(`4×3の終わり：${endP.label}（経過 ${mmss(Math.round((ui.f.endAt ?? 0) / 1000))}）`);
  else kp.note(`${per.label}（経過 ${mmss(Math.max(0, lenSec - ui.sec))}）`);
  // コートを押す → 場所。シュートは SZの中か外かで種類を、得点・失点は SZ内／SZ外を、ロスト・リカバリーはゾーンを自動で入れる
  root.addEventListener('click', (e) => {
    const svg = e.target.closest('.evcourt svg'); if (!svg || !ui.kind) return;
    const loc = locFromEvent(svg, e); if (!loc) return;
    if (setLoc(loc)) render(); else dyn();
  });
  root.addEventListener('click', async (e) => {
    const b = e.target.closest('button'); if (!b || b.disabled) return;
    if (b.dataset.locclr != null) { if (ui.locMode === 'lp') delete ui.f.lpLoc; else delete ui.f.loc; return dyn(); }
    if (b.dataset.locmode) { ui.locMode = b.dataset.locmode; return dyn(); }
    if (b.dataset.cont) { contStart(ctx, b.dataset.cont); return render(); }
    if (b.id === 'evKeys') return keyHelp();
    if (b.id === 'evVid') { VID.open = !VID.open; return render(); }
    if (b.id === 'evVidClose') { VID.open = false; if (VID.el) VID.el.pause(); return render(); }
    if (b.dataset.vk) { const s = syncOf(m.id); s[b.dataset.vk] = { v: Math.round(VID.el.currentTime * 10) / 10, name: VID.name }; saveSync(m.id, s); toast(`${periodLabel(b.dataset.vk)}のキックオフを合わせました`); return render(); }
    if (b.dataset.vs != null) { const v = vidEl(); const d = +b.dataset.vs; if (!d) { if (v.paused) v.play(); else v.pause(); } else { v.currentTime = Math.max(0, v.currentTime + d); } setTimeout(() => { const t = root.querySelector('[data-vs="0"]'); if (t) t.textContent = v.paused ? '▶ 再生' : '❚❚ 止める'; }, 50); return; }
    if (b.dataset.per) { ui.period = b.dataset.per; ui.listPer = b.dataset.per; applyAuto(ctx); return render(); }
    if (b.dataset.lper) { ui.listPer = b.dataset.lper; ui.todo = false; ui.det = false; return render(); }
    if (b.id === 'evTodo') { ui.todo = !ui.todo; ui.det = false; return render(); }
    if (b.id === 'evDet') { ui.det = !ui.det; ui.todo = false; return render(); }
    if (b.dataset.ltab) { ui.ltab = b.dataset.ltab; return render(); }
    if (b.id === 'evWho') return changeWho(m);
    if (b.id === 'evRoleChange') { setRole(m, null); return render(); }
    if (b.dataset.rv) { const ev = ctx.all.find((x) => x.id === b.dataset.rv); if (ev && revertLast(m, ev)) { toast('取り消しました'); afterWrite(ctx); } return render(); }
    if (b.id === 'evUndo') { const lm = lastMine(ctx.all); if (lm && revertLast(m, lm.ev)) { toast(`1つ戻しました（${ACT[lm.h.act]}を取り消し）`); afterWrite(ctx); } resetForm(); return render(); }
    if (b.dataset.kind) { startKind(ctx, b.dataset.kind); return render(); }
    if (b.dataset.oejstep) { ui.oejStep = b.dataset.oejstep; return render(); }
    if (b.dataset.endper) { const p = ctx.M.periods.find((x) => x.key === b.dataset.endper); ui.f.endPeriod = p.key; if (!(ui.f.endAt <= p.len)) ui.f.endAt = p.len; ui.endTouched = true; return render(); }
    if (b.dataset.oejauto != null) { ui.endTouched = false; oejAuto(ctx); return render(); }
    if (b.id === 'evKeep') {
      const ev = ctx.all.find((x) => x.id === ui.edit); if (!ev) return;
      patchEvent(m.id, ev.id, { checkOk: true, check: false, checkWhy: '' });
      toast('要確認を外しました（このままにする）'); resetForm(); return render();
    }
    if (b.dataset.side) { ui.f.side = b.dataset.side; applyAuto(ctx); return dyn(); }
    if (b.dataset.pick) { const v = b.dataset.v || undefined; ui.f[b.dataset.pick] = ui.f[b.dataset.pick] === v && v ? undefined : v; afterPick(b.dataset.pick); return dyn(); }
    if (b.dataset.set) {
      const key = b.dataset.set; let v = b.dataset.v === '' ? undefined : b.dataset.v;
      if (key === 'n') v = v == null ? undefined : +v;
      ui.f[key] = ui.f[key] === v ? undefined : v;
      if (key === 'cls') { ui.clsTouched = true; ui.clsAutoNote = ''; if (ui.f.cls !== 'set') delete ui.f.sp; }
      if (key === 'method' && ui.f.method !== 'pass') delete ui.f.pid2;
      if (key === 'sz') { if (ui.f.n === 0 && ui.f.sz === 'in') delete ui.f.n; }
      if (key === 'gtype' && ui.kind === 'conc' && !isOGg(ui.f.gtype)) { delete ui.f.og; } else if (key === 'gtype' && ui.kind === 'conc') { delete ui.f.sz; delete ui.f.n; }
      return dyn();
    }
    if (b.dataset.other) return pickOther(ctx, b.dataset.other, dyn);
    if (b.dataset.ev) { loadEvent(ctx, b.dataset.ev); return render(); }
    if (b.id === 'evCancel') { resetForm(); return render(); }
    if (b.id === 'evDel') {
      if (!(await confirmBox({ title: 'このイベントを削除しますか？', body: '<p>マッチレビューなどの数字からも消えます。</p>', ok: '削除する', danger: true }))) return;
      { const old = ctx.all.find((x) => x.id === ui.edit); if (old) { writeEv(m, { ...old, deleted: true }, 'del', old); afterWrite(ctx); } }
      toast('削除しました'); resetForm(); return render();
    }
    if (b.id === 'evSave') return save(ctx);
  });
}
function afterPick(key) {
  if ((ui.kind === 'shot' || ui.kind === 'szshot') && key === 'pid' && ui.f.lp === ui.f.pid) delete ui.f.lp;
  if (ui.kind === 'goal' && key === 'pid') {
    if (ui.f.pid === OPP_OG) { ui.f.gtype = ogId() || undefined; ui.f.assist = NO_ASSIST; delete ui.f.sz; delete ui.f.n; }
    else if (ui.f.assist === ui.f.pid) delete ui.f.assist;
    if (ui.f.pid !== OPP_OG && isOGg(ui.f.gtype)) { delete ui.f.gtype; if (ui.f.assist === NO_ASSIST) delete ui.f.assist; }
  }
}
function pickOther(ctx, key, dyn) {
  const { cfg, M } = ctx; const ev = curEv(ctx);
  const on = new Set(pitchAt(M, ev.period, ev.at, ev.side));
  const ids = Object.keys(cfg.members || {}).sort((a, b) => (parseInt(cfg.members[a].no, 10) || 999) - (parseInt(cfg.members[b].no, 10) || 999));
  const md = openModal(`<h2>ほかの選手を選ぶ</h2><p class="mu">試合メンバー全員から選べます。記録上この時刻にベンチにいる選手を選ぶと「要確認」になります。</p>
    <div class="otherpl">${ids.map((pid) => `<button class="pc2 ${cfg.members[pid].pos === 'GK' ? 'gk' : ''}" data-op="${pid}"><span class="n">${esc(cfg.members[pid].no ?? '?')}</span><span class="nm">${esc(playerById(pid)?.last || '')}</span><span class="tag ${on.has(pid) ? 'on' : ''}">${on.has(pid) ? 'ピッチ' : 'ベンチ'}</span></button>`).join('')}</div>
    <div class="mfoot"><button class="btn" data-c>やめる</button></div>`, { wide: true });
  md.querySelector('[data-c]').onclick = closeModal;
  md.addEventListener('click', (e) => { const b = e.target.closest('[data-op]'); if (!b) return; ui.f[key] = b.dataset.op; afterPick(key); closeModal(); dyn(); });
}
function loadEvent(ctx, id) {
  const ev = ctx.events.find((x) => x.id === id); if (!ev) return;
  const p = ctx.M.periods.find((x) => x.key === ev.period);
  ui.edit = id; ui.period = ev.period; ui.listPer = ev.period; ui.kind = ev.kind;
  ui.sec = Math.round((p.len - ev.at) / 1000);
  ui.f = Object.fromEntries(FIELDS.filter((k) => ev[k] != null).map((k) => [k, ev[k]]));
  if (ev.side) ui.f.side = ev.side;
  ui.clsTouched = true; ui.clsAutoNote = '';
  ui.oejStep = 'start'; ui.endTouched = ev.kind === 'oej' && ev.endPeriod != null;
  // 動画を開いていれば、その場面の3秒前へ（止めたまま。時刻は記録のまま）
  if (VID.open && VID.url && VID.el) { const v = videoAtClock(runOf(ctx), syncOf(ctx.m.id), VID.name, ev.period, ev.at); if (v != null) { VID.skip = true; VID.el.pause(); VID.el.currentTime = Math.max(0, v - 3); } }
}
async function save(ctx) {
  const { m, M, per } = ctx;
  const lenSec = Math.round(per.len / 1000);
  if (!(ui.sec >= 0 && ui.sec <= lenSec)) return toast(`時刻は ${mmss(lenSec)}〜0:00 の範囲で入れてください`);
  if (!ui.kind) return toast('イベントを選んでください');
  const base = curEv(ctx);
  const old = ui.edit ? ctx.all.find((x) => x.id === ui.edit) : null;
  // 直すときは元のイベントから始める（Sportscodeから取り込んだ印 src・imp や担当などを残す。記1）
  const start = old ? Object.fromEntries(Object.entries(old).filter(([k]) => !FIELDS.includes(k) && !['hist', 'dev', 't', 'check', 'checkWhy'].includes(k))) : {};
  const raw = { ...start, id: ui.edit || undefined, kind: ui.kind, period: ui.period, at: base.at, side: base.side, seq: old ? old.seq : Date.now() };
  for (const k of FIELDS) if (ui.f[k] != null && ui.f[k] !== '') raw[k] = ui.f[k];
  // その種類の項目だけを残す（記3）
  const ev = cleanFields(raw, goalName);
  if (ev.kind === 'oej') {
    const pi = (k) => M.periods.findIndex((p) => p.key === k);
    if (ev.endPeriod == null || ev.endAt == null) Object.assign(ev, oejDefaultEnd(M, ctx.events.filter((e) => e.id !== ui.edit), ev.period, ev.at));
    if (pi(ev.endPeriod) < pi(ev.period) || (ev.endPeriod === ev.period && ev.endAt <= ev.at)) return toast('4×3の終わりが、退場の時刻より前になっています');
  }
  if (old) {
    if (old.role != null) ev.role = old.role;
    if (old.src === 'sportscode') ev.impEdited = true; // 取り込んだあとアプリで直した（取り込み直しの画面で知らせる）
    delete ev.impWhy; // 取り込みで分からなかったこと（同じグループに2つのラベルなど）は、直した＝確かめたとして外す
    // 選手・時刻を変えたら「このままにする」を外して、もう一度判定する（未4）
    const same = [...PLAYER_KEYS, 'period', 'at', 'side'].every((k) => (old[k] ?? null) === (ev[k] ?? null));
    if (!same) delete ev.checkOk;
  } else if (ctx.sp.n > 1) ev.role = ctx.role;
  const others = ctx.all.filter((x) => x.id !== ev.id);
  const { check, why } = checkOf(M, ev, cardIssues([...others, ev], M.periods.map((p) => p.key)));
  ev.check = check; ev.checkWhy = why || undefined;
  const saved = writeEv(m, ev, old ? 'edit' : 'add', old);
  if (ev.kind === 'fspat') rememberSign(ev);
  afterWrite(ctx);
  const was = ui.edit; const sec = ui.sec;
  toast(`${was ? '直しました' : '記録しました'}：${mmss(sec)} ${KIND[ev.kind].label}${saved.check ? '（要確認）' : ''}`);
  resetForm(); ui.listPer = ui.period;
  ui.cont = was ? null : saved; // つづけて入力（同じ時刻で、選手・局面を引き継いで次のイベントへ）
  render();
  // 被ファールでレッドかイエロー2枚目：相手の退場（4×3の時間帯）も作るか聞く（決8）
  const red = (c) => c === 'red' || c === 'y2';
  if (ev.kind === 'fouled' && red(ev.card) && !(old && old.kind === 'fouled' && red(old.card))
    && !ctx.all.some((x) => !x.deleted && x.kind === 'oej' && x.period === ev.period && Math.abs(x.at - ev.at) <= 5000)) {
    const end = oejDefaultEnd(M, ctx.all.filter((x) => !x.deleted), ev.period, ev.at);
    const pl = (k, at) => { const p = M.periods.find((x) => x.key === k); return p ? `${p.label} 残り${mmss(Math.round((p.len - at) / 1000))}` : ''; };
    const ok = await confirmBox({ title: '相手の退場（4×3の時間帯）も作りますか？', ok: '作る', cancel: '作らない',
      body: `<p>相手の選手が退場したので、こちらが4×3になる時間帯を「相手の退場」として記録します。</p><p>退場：${esc(pl(ev.period, ev.at))}　〜　4×3の終わり：${esc(pl(end.endPeriod, end.endAt))}（2:00後。その前にこちらが得点したら、その時刻）</p><p class="mu">あとでイベント入力で直せます。</p>` });
    if (ok) {
      const oej = { kind: 'oej', period: ev.period, at: ev.at, side: ev.side, seq: Date.now(), ...end, check: false };
      if (ev.role != null) oej.role = ev.role;
      writeEv(m, oej, 'add', null);
      toast('相手の退場（4×3の時間帯）も記録しました'); render();
    }
  }
}
// 記録・直し・削除・取り消しのあと：カード（3枚目のイエロー）などほかのイベントの⚠も付け直す
function afterWrite(ctx) { recheckEvents(ctx.m, ctx.M, watchEvents(ctx.m.id).list, { quiet: true }); }

// ⚠（要確認）を今の記録で判定し直し、変わったものだけ保存して知らせる（2026-10-16 決定）
// 書くのは ⚠ と理由だけ（文書の中のほかの項目・入れた端末は変えない。記4）
export function recheckEvents(m, M, list, { quiet = false } = {}) {
  const ch = recheckAll(M, list);
  if (!ch.length) return ch;
  for (const { ev, check, why } of ch) patchEvent(m.id, ev.id, { check, checkWhy: why });
  const on = ch.filter((x) => x.check && !x.ev.check).length, off = ch.filter((x) => !x.check && x.ev.check).length;
  // 知らせるのはイベント入力の画面を開いているときだけ（ほかの画面では黙って直す）
  if (!quiet && (on || off) && location.hash.startsWith(`#/m/${m.id}/events`)) toast(`⚠要確認を見直しました（新しく ${on}件／外れた ${off}件）`);
  return ch;
}
// 出場の記録が変わったときだけ⚠を付け直す（開いたとき・MATCH PLAYの記録や記録の修正が変わったとき。記4）
// ほかの画面（マッチレビュー・MATCH PLAY など）からも呼べる：ensureChecks(m, M, watchEvents(m.id))
const chkMemo = {};
export function ensureChecks(m, M, evC, { quiet = false } = {}) {
  if (!evC?.ready) return [];
  const sig = pitchSig(M);
  if (chkMemo[m.id] === sig) return [];
  chkMemo[m.id] = sig;
  return recheckEvents(m, M, evC.list, { quiet });
}
