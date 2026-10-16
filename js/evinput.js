// イベント入力（spec 13章）。試合後に映像を見ながらでも、試合中のリアルタイム入力でも同じ画面。
// 入力の順番：時刻 → イベント → 選手 → 結果。「記録する」を押した時点で記録になる（時刻は残る）。
// 入れないと記録できないのは時刻とイベントだけ。● は資料に出る項目（空けた分は「未入力」の印）。
import { S as D, watchOps, watchEvents, saveEvent, playerById, opts, teamSettings, put, teamPath, deviceId } from './store.js';
import { replay, PERIODS, periodLabel } from './engine.js';
import { matchModel, periodSig } from './model.js';
import { esc, openModal, closeModal, confirmBox, toast } from './ui.js';
import { keypadHTML, bindKeypad } from './keypad.js';
import { render } from './views.js';
import { devName } from './matchplay.js';
import {
  KIND, MAIN_OWN, MAIN_OPP, SUBS, RESULTS, CLS, SETP, FSP, METHODS, ZONES, CARDS, UNKNOWN, OPP_OG, NO_ASSIST,
  isShot, isSZ, isFsp, hasCls, isOG, missing, pitchAt, subAtSecond, autoCls, needsCheck, liveEvents, sortEvents, summary,
} from './events.js';

const mmss = (sec) => `${Math.floor(sec / 60)}:${String(Math.max(0, sec) % 60).padStart(2, '0')}`;
let ui = { m: null };
const FIELDS = ['pid', 'pid2', 'assist', 'method', 'result', 'n', 'cls', 'sp', 'gtype', 'sz', 'zone', 'card', 'fsp', 'og'];

function cfgOf(m) { return { times: m.times || {}, members: m.members || {}, setplayAuto: teamSettings().setplayAuto || 60 }; }
const goalTypes = () => opts('goalTypes', true);
const goalName = (id) => goalTypes().find((o) => o.id === id)?.name || '';
const ogId = () => goalTypes().find((o) => o.name === 'OG')?.id || null;


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
function roleOf(m, n) {
  if (n <= 1) return 0;
  try { const v = parseInt(localStorage.getItem(roleKey(m)), 10); return Number.isInteger(v) && v >= 0 && v < n ? v : null; } catch { return null; }
}
function setRole(m, v) { try { if (v == null) localStorage.removeItem(roleKey(m)); else localStorage.setItem(roleKey(m), String(v)); } catch {} }
const roleName = (sp, i) => `担当${i + 1}${sp.names[i] ? `（${esc(sp.names[i])}）` : ''}`;
const kindsOf = (sp, i) => ALLK.filter((k) => sp.assign[k] === i);
const kindLabel = (k) => KIND[k].label;

// 分担を決める画面（イベント入力から開く）
export function vSplit(m) {
  const sp = splitOf(m);
  const prev = D.matches.filter((x) => x.id !== m.id && !x.deleted && x.evSplit && (x.date || '') <= (m.date || '9999')).sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0];
  const cell = (k, i) => `<td class="${sp.assign[k] === i ? 'on' : ''}"><button class="spc" data-sk="${k}" data-si="${i}" aria-label="${kindLabel(k)}を担当${i + 1}に">${sp.assign[k] === i ? '✓' : ''}</button></td>`;
  const rowsOf = (ks, cls) => ks.map((k) => `<tr><td class="ev ${cls}">${kindLabel(k)}</td>${Array.from({ length: sp.n }, (_, i) => cell(k, i)).join('')}</tr>`).join('');
  const cnt = (i) => kindsOf(sp, i).length;
  const html = `<div class="crumb"><a class="btn sm mpback" href="#/m/${m.id}">‹ 試合ページ</a><a href="#/m/${m.id}">vs ${esc(m.opponent)}</a> › <a href="#/m/${m.id}/events">イベント入力</a> › 入力担当の設定</div>
    <div class="row between"><h1 style="margin:0">入力担当の設定</h1><a class="btn pri" href="#/m/${m.id}/events">イベント入力へ ›</a></div>
    <p class="mu">何人で入力するかと、それぞれが入れるイベントを決めます。どのイベントも必ず1人だけが担当します（押した担当に移ります）。この試合のすべての端末に同じ分担が出て、試合中でも変えられます。</p>
    <div class="card"><h3>① 入力の担当人数</h3><div class="seg spn">${[1, 2, 3, 4, 5].map((v) => `<button data-sn="${v}" class="${sp.n === v ? 'on' : ''}">${v === 1 ? '1人（全部）' : v + '人'}</button>`).join('')}</div>
      ${sp.n > 1 ? `<div class="spnames">${sp.names.map((nm, i) => `<label>担当${i + 1}の名前（任意）<input id="spName${i}" data-sname="${i}" value="${esc(nm)}" placeholder="例：谷本"></label>`).join('')}</div>` : ''}</div>
    ${sp.n > 1 ? `<div class="spgrid"><div class="card"><h3>② それぞれが入れるイベント（押した担当に移ります）</h3>
      <table class="sptb"><tr><th style="text-align:left">イベント</th>${sp.names.map((nm, i) => `<th>担当${i + 1}<small>${esc(nm) || '&nbsp;'}</small><small>${cnt(i)}個</small></th>`).join('')}</tr>
      ${rowsOf(MAIN_OWN, 'own')}<tr class="sep"><td colspan="${sp.n + 1}"></td></tr>${rowsOf(MAIN_OPP, 'opp')}<tr class="sep"><td colspan="${sp.n + 1}"></td></tr>${rowsOf(SUBS, 'sub')}</table></div>
      <div><div class="card sppre"><h3>よく使う分け方（押すと②が切りかわる）</h3>
        ${PRESETS.map(([id, l]) => `<button data-sp="${id}"><b>${l}</b><small>${Array.from({ length: sp.n }, (_, i) => `担当${i + 1}＝${ALLK.filter((k) => presetAssign(id, sp.n)[k] === i).map(kindLabel).join('・')}`).join('　')}</small></button>`).join('')}
        <button data-sp="prev" ${prev ? '' : 'disabled'}><b>前の試合と同じ</b><small>${prev ? `vs ${esc(prev.opponent)}（${esc(prev.date || '')}）の分担をそのまま使う` : '分担を決めた前の試合がありません'}</small></button></div>
        <div class="card"><h3>各端末では</h3><p class="mu" style="margin:0">イベント入力を開くと「どの担当ですか？」と聞かれ、担当を押すだけ。その担当のイベントだけが大きく出ます。ほかのイベントも「＋ほかのイベントも出す」で入れられます。</p></div></div></div>`
    : '<div class="card"><p class="mu" style="margin:0">1人で全部のイベントを入力します（今までと同じ）。何人かで分ける時は、上で人数を選んでください。</p></div>'}`;
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
const FL = { at: '時刻', kind: 'イベント', pid: '選手', pid2: '受け手', assist: 'アシスト', result: '結果', n: '進入人数', cls: '局面', sp: 'セットプレー', gtype: '種類', sz: 'SZ', zone: 'ゾーン', card: 'カード', fsp: '種類', method: '方法', og: 'OG', period: 'ピリオド' };
function diffText(a, b, nm, periods) {
  const lists = { result: RESULTS, cls: CLS, sp: SETP, fsp: FSP, method: METHODS, zone: ZONES, card: CARDS };
  const v = (k, x, e) => {
    if (x == null || x === '') return '—';
    if (k === 'at') { const pl = periods.find((p) => p.key === e.period); return pl ? mmss(Math.round((pl.len - x) / 1000)) : String(x); }
    if (k === 'kind') return KIND[x]?.label || x;
    if (k === 'period') return periods.find((p) => p.key === x)?.label || x;
    if (['pid', 'pid2', 'assist'].includes(k)) return x === UNKNOWN ? '不明' : x === OPP_OG ? '相手OG' : x === NO_ASSIST ? 'なし' : nm(x);
    if (lists[k]) return (lists[k].find((y) => y[0] === x) || [])[1] || x;
    return String(x);
  };
  const out = [];
  for (const k of Object.keys(FL)) if (JSON.stringify(a[k] ?? null) !== JSON.stringify(b[k] ?? null)) out.push(`${FL[k]} ${v(k, a[k], a)}→${v(k, b[k], b)}`);
  return out.join('、') || '（変更なし）';
}
const ACT = { add: '記録した', edit: '直した', del: '削除した', revert: '取り消した' };

export function vEvents(m) {
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
    ui = { m: m.id, period: (live || last || periods[0]).key, sec: null, kind: null, f: {}, edit: null, clsTouched: false };
  }
  const per = periods.find((p) => p.key === ui.period) || periods[0];
  const lenSec = Math.round(per.len / 1000);
  if (ui.sec == null) ui.sec = lenSec;
  const events = sortEvents(liveEvents(evC.list), pOrder);
  const nm = (pid) => `${cfg.members?.[pid]?.no ?? '?'} ${playerById(pid)?.last || ''}`.trim();
  const sp = splitOf(m); const role = roleOf(m, sp.n);
  const crumbE = `<div class="crumb"><a class="btn sm mpback" href="#/m/${m.id}">‹ 試合ページ</a><a href="#/m/${m.id}">vs ${esc(m.opponent)}</a> › イベント入力</div>`;
  // 分担しているのに、この端末の担当がまだ決まっていない → まず担当を選ぶ
  if (sp.n > 1 && role == null) {
    return { active: 'acts', html: `${crumbE}<h1>イベント入力：どの担当ですか？</h1>
      <p class="mu">この試合は ${sp.n}人で分けて入力します。この端末で入力する担当を押してください（あとから変えられます）。担当者：<b>${esc(devName())}</b>（名前は「設定」の「担当者の名前（この端末）」で変えられます）</p>
      <div class="rolepick">${Array.from({ length: sp.n }, (_, i) => `<button class="card" data-role="${i}"><b>${roleName(sp, i)}</b><span>${kindsOf(sp, i).map(kindLabel).join('・')}</span></button>`).join('')}</div>
      <p><a class="btn" href="#/m/${m.id}/split">入力担当の設定</a></p>`,
      bind: (root) => root.querySelectorAll('[data-role]').forEach((b) => { b.onclick = () => { setRole(m, +b.dataset.role); render(); }; }) };
  }
  const mine = sp.n > 1 ? kindsOf(sp, role) : ALLK;

  // ---------- 左：入力したイベント ----------
  const counts = Object.fromEntries(periods.map((p) => [p.key, events.filter((e) => e.period === p.key).length]));
  if (!ui.listPer || !periods.some((p) => p.key === ui.listPer)) ui.listPer = ui.period;
  const rows = events.filter((e) => e.period === ui.listPer).map((e) => {
    const pl = periods.find((p) => p.key === e.period); const rem = Math.round((pl.len - e.at) / 1000);
    const miss = missing(e, goalName);
    const dup = events.some((x) => x !== e && x.kind === e.kind && x.period === e.period && Math.abs(x.at - e.at) <= 3000 && x.dev && e.dev && x.dev !== e.dev);
    const by = (e.hist || [])[0]?.by;
    return `<button class="evr ${ui.edit === e.id ? 'sel' : ''}" data-ev="${e.id}"><span class="t">${mmss(rem)}${e.role != null && sp.n > 1 ? `<span class="who r${e.role}" title="${esc(by || '')}">${e.role + 1}</span>` : ''}</span><span class="k ${KIND[e.kind].team === 'opp' ? 'opp' : ''}">${KIND[e.kind].label}</span>
      <span class="d">${esc(summary(e, nm, goalName))}${miss ? ` <span class="miss">未入力 ${miss}</span>` : ''}${e.check ? ' <span class="evchk">⚠ 要確認</span>' : ''}${dup ? ' <span class="evdup">重なっているかも</span>' : ''}${by ? ` <span class="evby">${esc(by)}</span>` : ''}</span></button>`;
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
    <div class="perh">${periods.map((p) => `<button class="btn sm ${p.key === ui.listPer ? 'pri' : ''}" data-lper="${p.key}">${p.label} ${counts[p.key]}件</button>`).join('')}</div>
    <div class="evrows">${rows}</div></div>`;

  // ---------- 右：入力 ----------
  const evBtn = (k) => `<button class="btn ${KIND[k].team === 'opp' ? 'o' : ''} ${ui.kind === k ? 'on' : ''}" data-kind="${k}">${KIND[k].short || KIND[k].label}</button>`;
  const step1 = `<div class="step"><span class="num">1</span><div>
      <div class="st">時刻<small>映像のスコアボードと同じ残り時間。「1205」で 12:05</small></div>
      <div class="evtime"><div class="evper">${periods.map((p) => `<button class="btn ${p.key === ui.period ? 'pri' : ''}" data-per="${p.key}">${p.label}</button>`).join('')}</div>
        <div class="evkp">${keypadHTML({ steps: [-1, 1], id: 'evkp' })}</div></div></div></div>`;
  const showAll = sp.n <= 1 || ui.showAll;
  const mineRow = sp.n > 1 ? `<div class="mainev bigrow">${mine.map(evBtn).join('')}</div>
      <button class="btn sm moreev" id="evShowAll">${ui.showAll ? '− ほかのイベントをしまう' : '＋ ほかのイベントも出す'}</button>` : '';
  const step2 = `<div class="step"><span class="num">2</span><div>
      <div class="st">イベント<small>${sp.n > 1 ? `${roleName(sp, role)}のイベントを大きく出しています` : 'メインイベント：上が自チーム、下が相手チーム'}</small></div>${mineRow}${showAll ? `
      <div class="mainev"><span class="lab own">自チーム</span>${MAIN_OWN.map(evBtn).join('')}<span class="lab opp">相手チーム</span>${MAIN_OPP.map(evBtn).join('')}</div>
      <div class="subev"><span class="lab">サブイベント</span>${SUBS.map(evBtn).join('')}</div>` : ''}</div></div>`;
  const lm = lastMine(all);
  const undoBtn = `<button class="btn evundo" id="evUndo" ${lm ? '' : 'disabled'}>↶ 1つ戻す${lm ? `（${ACT[lm.h.act]}：${esc(evDesc(lm.h.act === 'add' ? lm.ev : lm.h.prev || lm.ev))}）` : ''}</button>`;
  const foot = ui.edit
    ? `<div class="foot"><button class="btn dangerline" id="evDel">このイベントを削除</button><span class="sp"></span><button class="btn" id="evCancel">やめる</button><button class="btn pri" id="evSave" ${ui.kind ? '' : 'disabled'}>直す</button></div>`
    : `<div class="foot">${undoBtn}<span class="mu">時刻とイベントだけで記録できます。● を空けた分は資料で「—」になり、あとで埋められます</span><button class="btn" id="evCancel" ${ui.kind ? '' : 'disabled'}>やめる</button><button class="btn pri" id="evSave" ${ui.kind ? '' : 'disabled'}>記録する（時刻はそのまま）</button></div>`;
  const ctx = { m, cfg, M, events, per, nm, all, sp, role };
  const form = `<div class="card evform">${ui.edit ? '<div class="evediting">入力したイベントを直しています</div>' : ''}${step1}${step2}<div id="evDyn">${dynHTML(ctx)}</div>${foot}</div>`;

  return {
    active: 'acts',
    html: `<div class="crumb"><a class="btn sm mpback" href="#/m/${m.id}">‹ 試合ページ</a><a href="#/m/${m.id}">vs ${esc(m.opponent)}</a> › イベント入力</div>
      <div class="row between"><h1 style="margin:0">イベント入力</h1><span class="mu">記録した時点で試合の記録になり、マッチレビューにすぐ反映されます</span></div>
      <div class="evrole"><span class="rl">入力の担当人数</span><b>${sp.n}人</b>${sp.n > 1 ? `<span class="rl">この端末</span><b>${roleName(sp, role)}</b><span class="mu">${mine.map(kindLabel).join('・')}</span><button class="btn sm" id="evRoleChange">担当を変える</button>` : '<span class="mu">（1人で全部のイベントを入力）</span>'}
        <a class="btn sm" href="#/m/${m.id}/split">入力担当の設定</a><span class="dev">担当者：<b>${esc(devName())}</b></span></div>
      <div class="evw mt">${list}${form}</div>`,
    bind: (root) => bindEv(root, ctx),
  };
}

// ---------- ③④（イベントごとに変わる部分） ----------
const OPT = '<span class="opt">任意</span>';
const REQ = '<span class="req">●</span>';
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
  const players = (key, { exclude = null, oppOG = false, unknown = true } = {}) => {
    const sel = f[key];
    const cards = on.map((pid) => `<button class="pc2 ${cfg.members?.[pid]?.pos === 'GK' ? 'gk' : ''} ${sel === pid ? 'on' : ''}" data-pick="${key}" data-v="${pid}" ${pid === exclude ? 'disabled' : ''}><span class="n">${esc(cfg.members?.[pid]?.no ?? '?')}</span><span class="nm">${esc(playerById(pid)?.last || '')}</span></button>`).join('');
    const other = sel && sel !== UNKNOWN && sel !== OPP_OG && sel !== NO_ASSIST && !on.includes(sel)
      ? `<button class="pc2 on chk2" data-pick="${key}" data-v="${sel}"><span class="n">${esc(cfg.members?.[sel]?.no ?? '?')}</span><span class="nm">${esc(playerById(sel)?.last || '')} ⚠</span></button>` : '';
    return `<div class="pl">${cards}${other}</div><div class="pl2"><button class="btn" data-other="${key}">ほかの選手…</button>${unknown ? `<button class="btn ${sel === UNKNOWN ? 'on' : ''}" data-pick="${key}" data-v="${UNKNOWN}">不明</button>` : ''}${oppOG ? `<button class="btn ${sel === OPP_OG ? 'on' : ''}" data-pick="${key}" data-v="${OPP_OG}">相手OG</button>` : ''}<button class="btn ${sel == null ? 'on soft' : ''}" data-pick="${key}" data-v="">あとで</button></div>
      ${other ? `<div class="evwarn">⚠ ${esc(nm(sel))} は記録上この時刻にピッチにいません。このまま記録すると「要確認」になります（交代の時刻のずれを試合後に直します）</div>` : ''}`;
  };
  const choice = (key, list, { dis = [] } = {}) => `<div class="ch">${list.map(([v, l]) => `<button class="btn ${String(f[key]) === String(v) ? 'on' : ''}" data-set="${key}" data-v="${v}" ${dis.includes(v) ? 'disabled' : ''}>${l}</button>`).join('')}</div>`;
  const row = (label, mark, body, hint = '') => `<div class="rrow"><label>${label}${mark}</label><div>${body}${hint ? `<div class="hint">${hint}</div>` : ''}</div></div>`;
  const step = (n, title, body) => `<div class="step"><span class="num">${n}</span><div><div class="st">${title}</div>${body}</div></div>`;
  const at5 = `<small>${mmss(ui.sec)} にピッチにいた5人</small>${sideSw}`;
  const nCount = (sz) => choice('n', [0, 1, 2, 3, 4, 5].map((x) => [x, `${x}人`]), { dis: sz ? [0] : [] });
  const clsRow = () => row('分類', REQ, `${choice('cls', CLS)}${f.cls === 'set' ? `<div class="sp2"><span class="opt" style="margin:0 8px 0 0">セットプレーの種類（任意）</span>${choice('sp', SETP)}</div>` : ''}`,
    ui.clsAutoNote || '');
  const gtList = goalTypes().filter((o) => !o.hidden || o.id === f.gtype).map((o) => [o.id, o.name]);
  let html = '';
  if (isShot(k)) {
    const sz = isSZ(k);
    html += own ? step(3, `打った選手 ${REQ}${at5}`, players('pid')) : step(3, '選手', `<div class="mu">相手チームのイベントなので、選手は選びません${sideSw ? '　' + sideSw : ''}</div>`);
    html += step(4, '結果', row('結果', REQ, choice('result', RESULTS)) +
      row('ゾーン内の人数', sz ? OPT : REQ, nCount(sz), sz ? 'SZ内は打った選手を1人目に数えるので0人は押せません（任意）' : 'シュートの瞬間にSZの中にいた攻撃側の人数（0人＝人無）') + clsRow());
  } else if (k === 'z4' || k === 'sz') {
    const meth = row('方法', OPT, choice('method', METHODS));
    const who = f.method === 'pass'
      ? row('出し手', OPT, players('pid', { exclude: f.pid2 })) + row('受け手', OPT, players('pid2', { exclude: f.pid }))
      : f.method ? row('進入した選手', OPT, players('pid')) : '<div class="hint">方法を選ぶと選手の欄が出ます（パス＝出し手と受け手、ドリブル・リバウンド＝1人）</div>';
    html += step(3, `進入の方法と選手 ${OPT}${at5}`, meth + who);
    if (k === 'z4') html += step(4, '結果', clsRow());
  } else if (k === 'oz4') {
    html += step(3, '選手', '<div class="mu">相手チームのイベントなので、選手も方法も記録しません</div>') + step(4, '結果', clsRow());
  } else if (k === 'osz') {
    html += step(3, '選手', '<div class="mu">相手チームのSZ進入は、時刻だけを記録します（ほかに入れる項目はありません）</div>');
  } else if (k === 'goal') {
    const ogg = f.pid === OPP_OG;
    html += step(3, `得点者とアシスト ${at5}`, row('得点者', REQ, players('pid', { oppOG: true })) +
      (ogg ? '' : row('アシスト', REQ, `<div class="ch">${on.filter((p) => p !== f.pid).map((p) => `<button class="btn ${f.assist === p ? 'on' : ''}" data-set="assist" data-v="${p}">${esc(nm(p))}</button>`).join('')}<button class="btn ${f.assist === NO_ASSIST ? 'on' : ''}" data-set="assist" data-v="${NO_ASSIST}">なし</button><button class="btn ${f.assist == null ? 'on soft' : ''}" data-set="assist" data-v="">あとで</button></div>`)));
    html += step(4, '結果', ogg ? '<div class="mu">相手のオウンゴール：得点の種類は「OG」、アシストは「なし」が自動で入ります。シュートには数えません</div>'
      : row('得点の種類', REQ, choice('gtype', gtList.filter(([, n]) => !isOG(n)))) + row('SZ内／SZ外', REQ, choice('sz', [['in', 'SZ内'], ['out', 'SZ外']])) +
        (f.sz ? row('ゾーン内の人数', f.sz === 'in' ? OPT : REQ, nCount(f.sz === 'in'), f.sz === 'in' ? 'SZ内は任意' : '') : '') +
        '<div class="hint">得点は「枠内シュート」としても数えるので、同じ場面のシュートは入れません。分類は種類から自動で付きます</div>');
  } else if (k === 'conc') {
    const og = isOG(goalName(f.gtype));
    html += step(3, `失点の種類 ${REQ}`, choice('gtype', gtList));
    html += step(4, og ? 'オウンゴール' : '結果', og
      ? row('OGの選手', OPT, players('og', { unknown: true })) + '<div class="hint">OGのときは「SZ内／SZ外」と「ゾーン内の人数」は入れません。シュートにも数えません</div>'
      : row('SZ内／SZ外', REQ, choice('sz', [['in', 'SZ内'], ['out', 'SZ外']])) + (f.sz ? row('ゾーン内の人数', f.sz === 'in' ? OPT : REQ, nCount(f.sz === 'in'), '相手の人数') : '') +
        '<div class="hint">失点は「枠内の被シュート」としても数えるので、同じ場面の被シュートは入れません</div>');
  } else if (isFsp(k)) {
    html += step(3, `種類 ${REQ}`, choice('fsp', FSP));
  } else if (k === 'rec' || k === 'lost') {
    html += step(3, `${k === 'rec' ? 'ボールを奪った選手' : 'ボールを失った選手'} ${REQ}${at5}`, players('pid'));
    html += step(4, '場所', row('ゾーン', OPT, `<div class="ch zch">${ZONES.map(([z, c]) => `<button class="btn ${f.zone === z ? 'on' : ''}" data-set="zone" data-v="${z}">${z}<span class="zcap">${c}</span></button>`).join('')}</div>`));
  } else if (k === 'foul' || k === 'fouled') {
    html += step(3, `${k === 'foul' ? 'ファールをした選手' : 'ファールを受けた選手'} ${REQ}${at5}`, players('pid'));
    html += step(4, 'カード', row('カード', REQ, choice('card', CARDS), k === 'fouled' ? '相手選手へのカード' : ''));
  }
  return html;
}

// ---------- 操作 ----------
function startKind(ctx, k) {
  const keep = ui.edit ? ui.f : {};
  ui.kind = k; ui.clsTouched = !!(ui.edit && keep.cls);
  ui.f = ui.edit ? keep : {};
  if ((k === 'foul' || k === 'fouled') && !ui.f.card) ui.f.card = 'none';
  applyAuto(ctx);
}
function applyAuto(ctx) {
  ui.clsAutoNote = '';
  if (!ui.kind || !hasCls(ui.kind) || ui.clsTouched) return;
  const c = autoCls(ctx.M, ctx.events, curEv(ctx));
  ui.f.cls = c || undefined;
  if (c === 'special') ui.clsAutoNote = '自チームのGKがいない区間か相手の5×4の時間帯なので「特殊局面」にしています（変えられます）';
  if (c === 'set') ui.clsAutoNote = '前後5秒以内にFINISH SET PLAYがあるので「セットプレー」にしています（変えられます）';
}
function resetForm() { ui.kind = null; ui.f = {}; ui.edit = null; ui.clsTouched = false; ui.clsAutoNote = ''; }

function bindEv(root, ctx) {
  const { m, cfg, per } = ctx;
  const lenSec = Math.round(per.len / 1000);
  const dyn = () => { root.querySelector('#evDyn').innerHTML = dynHTML(ctx); };
  const kp = bindKeypad(root.querySelector('.evkp'), {
    init: Math.max(0, Math.min(ui.sec, lenSec)), min: 0, max: lenSec,
    onChange: (v) => { if (v.ok && v.sec !== ui.sec) { ui.sec = v.sec; applyAuto(ctx); dyn(); } else if (!v.ok) { ui.sec = v.sec ?? -1; dyn(); } },
    onEnter: () => { if (ui.kind) save(ctx); },
  });
  kp.note(`${per.label}（経過 ${mmss(Math.max(0, lenSec - ui.sec))}）`);
  root.addEventListener('click', async (e) => {
    const b = e.target.closest('button'); if (!b || b.disabled) return;
    if (b.dataset.per) { ui.period = b.dataset.per; ui.listPer = b.dataset.per; applyAuto(ctx); return render(); }
    if (b.dataset.lper) { ui.listPer = b.dataset.lper; return render(); }
    if (b.dataset.ltab) { ui.ltab = b.dataset.ltab; return render(); }
    if (b.id === 'evShowAll') { ui.showAll = !ui.showAll; return render(); }
    if (b.id === 'evRoleChange') { setRole(m, null); return render(); }
    if (b.dataset.rv) { const ev = ctx.all.find((x) => x.id === b.dataset.rv); if (ev && revertLast(m, ev)) toast('取り消しました'); return render(); }
    if (b.id === 'evUndo') { const lm = lastMine(ctx.all); if (lm && revertLast(m, lm.ev)) toast(`1つ戻しました（${ACT[lm.h.act]}を取り消し）`); resetForm(); return render(); }
    if (b.dataset.kind) { startKind(ctx, b.dataset.kind); return render(); }
    if (b.dataset.side) { ui.f.side = b.dataset.side; applyAuto(ctx); return dyn(); }
    if (b.dataset.pick) { const v = b.dataset.v || undefined; ui.f[b.dataset.pick] = ui.f[b.dataset.pick] === v && v ? undefined : v; afterPick(b.dataset.pick); return dyn(); }
    if (b.dataset.set) {
      const key = b.dataset.set; let v = b.dataset.v === '' ? undefined : b.dataset.v;
      if (key === 'n') v = v == null ? undefined : +v;
      ui.f[key] = ui.f[key] === v ? undefined : v;
      if (key === 'cls') { ui.clsTouched = true; ui.clsAutoNote = ''; if (ui.f.cls !== 'set') delete ui.f.sp; }
      if (key === 'method' && ui.f.method !== 'pass') delete ui.f.pid2;
      if (key === 'sz') { if (ui.f.n === 0 && ui.f.sz === 'in') delete ui.f.n; }
      if (key === 'gtype' && ui.kind === 'conc' && !isOG(goalName(ui.f.gtype))) delete ui.f.og;
      return dyn();
    }
    if (b.dataset.other) return pickOther(ctx, b.dataset.other, dyn);
    if (b.dataset.ev) { loadEvent(ctx, b.dataset.ev); return render(); }
    if (b.id === 'evCancel') { resetForm(); return render(); }
    if (b.id === 'evDel') {
      if (!(await confirmBox({ title: 'このイベントを削除しますか？', body: '<p>マッチレビューなどの数字からも消えます。</p>', ok: '削除する', danger: true }))) return;
      { const old = ctx.all.find((x) => x.id === ui.edit); if (old) writeEv(m, { ...old, deleted: true }, 'del', old); }
      toast('削除しました'); resetForm(); return render();
    }
    if (b.id === 'evSave') return save(ctx);
  });
}
function afterPick(key) {
  if (ui.kind === 'goal' && key === 'pid') {
    if (ui.f.pid === OPP_OG) { ui.f.gtype = ogId() || undefined; ui.f.assist = NO_ASSIST; delete ui.f.sz; delete ui.f.n; }
    else if (ui.f.assist === ui.f.pid) delete ui.f.assist;
    if (ui.f.pid !== OPP_OG && isOG(goalName(ui.f.gtype))) { delete ui.f.gtype; if (ui.f.assist === NO_ASSIST) delete ui.f.assist; }
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
}
function save(ctx) {
  const { m, M, per } = ctx;
  const lenSec = Math.round(per.len / 1000);
  if (!(ui.sec >= 0 && ui.sec <= lenSec)) return toast(`時刻は ${mmss(lenSec)}〜0:00 の範囲で入れてください`);
  if (!ui.kind) return toast('イベントを選んでください');
  const base = curEv(ctx);
  const ev = { id: ui.edit || undefined, kind: ui.kind, period: ui.period, at: base.at, side: base.side, seq: ui.edit ? ctx.events.find((x) => x.id === ui.edit)?.seq : Date.now() };
  // そのイベントに関係する項目だけを残す
  for (const k of FIELDS) if (ui.f[k] != null && ui.f[k] !== '') ev[k] = ui.f[k];
  if (!hasCls(ui.kind)) { delete ev.cls; delete ev.sp; }
  if (ev.cls !== 'set') delete ev.sp;
  if (!isShot(ui.kind) && ui.kind !== 'goal' && ui.kind !== 'conc') delete ev.n;
  if (ev.method !== 'pass') delete ev.pid2;
  ev.check = needsCheck(M, ev);
  const old = ui.edit ? ctx.all.find((x) => x.id === ui.edit) : null;
  if (old) { if (old.role != null) ev.role = old.role; } else if (ctx.sp.n > 1) ev.role = ctx.role;
  const saved = writeEv(m, ev, old ? 'edit' : 'add', old);
  const was = ui.edit;
  toast(`${was ? '直しました' : '記録しました'}：${mmss(ui.sec)} ${KIND[ui.kind].label}${saved.check ? '（要確認）' : ''}`);
  resetForm(); ui.listPer = ui.period;
  render();
}
