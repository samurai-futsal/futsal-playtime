// イベント入力（spec 13章）。試合後に映像を見ながらでも、試合中のリアルタイム入力でも同じ画面。
// 入力の順番：時刻 → イベント → 選手 → 結果。「記録する」を押した時点で記録になる（時刻は残る）。
// 入れないと記録できないのは時刻とイベントだけ。● は資料に出る項目（空けた分は「未入力」の印）。
import { watchOps, watchEvents, saveEvent, deleteEvent, playerById, opts, teamSettings } from './store.js';
import { replay, PERIODS, periodLabel } from './engine.js';
import { matchModel } from './model.js';
import { esc, openModal, closeModal, confirmBox, toast } from './ui.js';
import { keypadHTML, bindKeypad } from './keypad.js';
import { render } from './views.js';
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

export function vEvents(m) {
  const opsC = watchOps(m.id); const evC = watchEvents(m.id);
  if (!opsC.ready && !opsC.list.length) return { active: 'acts', html: '<p class="mu pad">読み込み中…</p>' };
  const cfg = cfgOf(m);
  const st = replay(opsC.list, cfg);
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

  // ---------- 左：入力したイベント ----------
  const counts = Object.fromEntries(periods.map((p) => [p.key, events.filter((e) => e.period === p.key).length]));
  if (!ui.listPer || !periods.some((p) => p.key === ui.listPer)) ui.listPer = ui.period;
  const rows = events.filter((e) => e.period === ui.listPer).map((e) => {
    const pl = periods.find((p) => p.key === e.period); const rem = Math.round((pl.len - e.at) / 1000);
    const miss = missing(e, goalName);
    return `<button class="evr ${ui.edit === e.id ? 'sel' : ''}" data-ev="${e.id}"><span class="t">${mmss(rem)}</span><span class="k ${KIND[e.kind].team === 'opp' ? 'opp' : ''}">${KIND[e.kind].label}</span>
      <span class="d">${esc(summary(e, nm, goalName))}${miss ? ` <span class="miss">未入力 ${miss}</span>` : ''}${e.check ? ' <span class="evchk">⚠ 要確認</span>' : ''}</span></button>`;
  }).join('') || '<p class="mu" style="padding:8px 14px">まだありません</p>';
  const list = `<div class="card evlist"><h3>入力したイベント（時刻順）</h3>
    <div class="perh">${periods.map((p) => `<button class="btn sm ${p.key === ui.listPer ? 'pri' : ''}" data-lper="${p.key}">${p.label} ${counts[p.key]}件</button>`).join('')}</div>
    <div class="evrows">${rows}</div></div>`;

  // ---------- 右：入力 ----------
  const evBtn = (k) => `<button class="btn ${KIND[k].team === 'opp' ? 'o' : ''} ${ui.kind === k ? 'on' : ''}" data-kind="${k}">${KIND[k].short || KIND[k].label}</button>`;
  const step1 = `<div class="step"><span class="num">1</span><div>
      <div class="st">時刻<small>映像のスコアボードと同じ残り時間。「1205」で 12:05</small></div>
      <div class="evtime"><div class="evper">${periods.map((p) => `<button class="btn ${p.key === ui.period ? 'pri' : ''}" data-per="${p.key}">${p.label}</button>`).join('')}</div>
        <div class="evkp">${keypadHTML({ steps: [-1, 1], id: 'evkp' })}</div></div></div></div>`;
  const step2 = `<div class="step"><span class="num">2</span><div>
      <div class="st">イベント<small>メインイベント：上が自チーム、下が相手チーム</small></div>
      <div class="mainev"><span class="lab own">自チーム</span>${MAIN_OWN.map(evBtn).join('')}<span class="lab opp">相手チーム</span>${MAIN_OPP.map(evBtn).join('')}</div>
      <div class="subev"><span class="lab">サブイベント</span>${SUBS.map(evBtn).join('')}</div></div></div>`;
  const foot = ui.edit
    ? `<div class="foot"><button class="btn dangerline" id="evDel">このイベントを削除</button><span class="sp"></span><button class="btn" id="evCancel">やめる</button><button class="btn pri" id="evSave" ${ui.kind ? '' : 'disabled'}>直す</button></div>`
    : `<div class="foot"><span class="mu">時刻とイベントだけで記録できます。● を空けた分は資料で「—」になり、あとで埋められます</span><button class="btn" id="evCancel" ${ui.kind ? '' : 'disabled'}>やめる</button><button class="btn pri" id="evSave" ${ui.kind ? '' : 'disabled'}>記録する（時刻はそのまま）</button></div>`;
  const ctx = { m, cfg, M, events, per, nm };
  const form = `<div class="card evform">${ui.edit ? '<div class="evediting">入力したイベントを直しています</div>' : ''}${step1}${step2}<div id="evDyn">${dynHTML(ctx)}</div>${foot}</div>`;

  return {
    active: 'acts',
    html: `<div class="crumb"><a href="#/m/${m.id}">vs ${esc(m.opponent)}</a> › イベント入力</div>
      <div class="row between"><h1 style="margin:0">イベント入力</h1><span class="mu">記録した時点で試合の記録になり、マッチレビューにすぐ反映されます</span></div>
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
      deleteEvent(m.id, ui.edit); toast('削除しました'); resetForm(); return render();
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
  const saved = saveEvent(m.id, ev);
  const was = ui.edit;
  toast(`${was ? '直しました' : '記録しました'}：${mmss(ui.sec)} ${KIND[ui.kind].label}${saved.check ? '（要確認）' : ''}`);
  resetForm(); ui.listPer = ui.period;
  render();
}
