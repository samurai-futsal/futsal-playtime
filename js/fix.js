// 記録の修正 (spec 8章). Works on a draft kept on this device; 「保存」 writes it to the match
// (match.fix) and adds a line to the history (fixlog). The MATCH PLAY op log is never changed:
// the review and analysis use the saved correction instead of the MATCH PLAY record for that period.
import { S as D, playerById, opts, put, teamPath, watchOps, watchFixLog, addFixLog, teamSettings } from './store.js';
import { replay, periodLen, PERIODS, periodLabel } from './engine.js';
import { replayToFix, seatWalk, fixData, checkFix, periodSig, newEvId, matchModel } from './model.js';
import { $, esc, openModal, closeModal, confirmBox, toast, optionTags } from './ui.js';
import { keypadHTML, bindKeypad } from './keypad.js';
import { render, setLeaveGuard } from './views.js';
import { devName } from './matchplay.js';

const mmss = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const TABS = [['sub', '交代'], ['lineup', 'スタメン'], ['eject', '退場・空席'], ['pp', 'パワープレー'], ['info', '試合情報'], ['log', '履歴']];
const LATER = [['event', 'イベント'], ['check', '要確認']];
const key = (m) => `fpt.fix.${m.id}`;
let ui = { tab: 'sub', period: null };

// ---------- draft ----------
function cfgOf(m) { return { times: m.times || {}, members: m.members || {}, setplayAuto: teamSettings().setplayAuto || 60 }; }
function loadDraft(m) { try { const d = JSON.parse(localStorage.getItem(key(m)) || 'null'); return d && d.matchId === m.id ? d : null; } catch { return null; } }
function storeDraft(m, d) { try { localStorage.setItem(key(m), JSON.stringify(d)); } catch {} }
function dropDraft(m) { try { localStorage.removeItem(key(m)); } catch {} }
const clone = (x) => JSON.parse(JSON.stringify(x));
const INFO_KEYS = ['date', 'opponent', 'category', 'kickoff', 'venue', 'memo'];

// The starting point: the saved correction where it is still valid, otherwise the MATCH PLAY record
function baseline(m, st, sig) {
  const periods = {};
  for (const p of PERIODS) {
    if (st.periods[p.key].status !== 'done') continue;
    const saved = m.fix?.periods?.[p.key];
    if (saved && saved.basis === sig[p.key]) periods[p.key] = clone(saved);
    else periods[p.key] = { ...replayToFix(st, p.key), basis: sig[p.key] };
    periods[p.key].len = periodLen(st.cfg, p.key);
  }
  const info = Object.fromEntries(INFO_KEYS.map((k) => [k, m[k] ?? '']));
  return { matchId: m.id, periods, info, changes: [], undo: [] };
}
function dirty(d) { return d && d.changes.length > 0; }

// ---------- view ----------
export function vFix(m) {
  const opsC = watchOps(m.id);
  if (!opsC.ready && !opsC.list.length) return { active: 'acts', html: '<p class="mu pad">読み込み中…</p>' };
  if (ui.m !== m.id) ui = { tab: 'sub', period: null, m: m.id };
  const cfg = cfgOf(m);
  const st = replay(opsC.list, cfg); const sig = periodSig(opsC.list);
  let d = loadDraft(m);
  const base = baseline(m, st, sig);
  if (!d) d = base;
  // a period whose MATCH PLAY record changed after the draft was made cannot be kept
  for (const k of Object.keys(d.periods)) if (!base.periods[k] || d.periods[k].basis !== base.periods[k].basis) { delete d.periods[k]; }
  for (const k of Object.keys(base.periods)) if (!d.periods[k]) d.periods[k] = base.periods[k];
  const keys = PERIODS.map((p) => p.key).filter((k) => d.periods[k]);
  setLeaveGuard(dirty(d) ? leaveGuard(m) : null);
  const live = PERIODS.find((p) => st.periods[p.key].status === 'live');
  const crumb = `<div class="crumb"><a href="#/m/${m.id}">vs ${esc(m.opponent)}</a> › 記録の修正</div>`;
  if (!keys.length) {
    return { active: 'acts', html: `${crumb}<h1>記録の修正</h1><div class="card empty">終わったピリオドがまだありません。${live ? `${periodLabel(live.key)}が終わると直せるようになります（ハーフタイムに前半を直すこともできます）。` : 'MATCH PLAYで記録したピリオドが終わると、ここで直せます。'}</div>` };
  }
  if (!keys.includes(ui.period)) ui.period = keys[0];
  const k = ui.period; const fp = d.periods[k];
  const errs = keys.flatMap((x) => checkFix(d.periods[x], cfg, `${periodLabel(x)}：`));
  const stale = PERIODS.filter((p) => m.fix?.periods?.[p.key] && st.periods[p.key].status === 'done' && m.fix.periods[p.key].basis !== sig[p.key]).map((p) => p.label);

  const head = `<div class="fxhead">
    <div class="fxper">${keys.map((x) => `<button class="btn ${x === k ? 'pri' : ''}" data-per="${x}">${periodLabel(x)}</button>`).join('')}
      ${live ? `<span class="mu">${periodLabel(live.key)}は試合中のため、終わってから直せます</span>` : ''}</div>
    <div class="fxsave"><span class="fxstate ${dirty(d) ? 'on' : ''}">${dirty(d) ? `保存していない修正 ${d.changes.length}件` : '保存済み'}</span>
      <button class="btn" id="fxUndo" ${d.undo.length ? '' : 'disabled'}>↶ 1つ戻す</button>
      <button class="btn" id="fxDiscard" ${dirty(d) ? '' : 'disabled'}>破棄</button>
      <button class="btn pri" id="fxSave" ${dirty(d) && !errs.length ? '' : 'disabled'}>保存</button></div></div>
    ${stale.length ? `<div class="fxwarn">MATCH PLAYの記録があとから変わったため（リセットなど）、${stale.join('・')}の保存した修正は使われていません。もう一度直してください。</div>` : ''}
    ${errs.length ? `<div class="fxerr"><b>矛盾があるため保存できません</b><ul>${errs.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div>` : ''}
    <div class="fxtabs">${TABS.map(([t, l]) => `<button class="fxtab ${ui.tab === t ? 'on' : ''}" data-tab="${t}">${l}</button>`).join('')}${LATER.map(([, l]) => `<span class="fxtab off">${l}<small>④で</small></span>`).join('')}</div>`;

  const body = { sub: tabSub, lineup: tabLineup, eject: tabEject, pp: tabPP, info: tabInfo, log: tabLog }[ui.tab](m, d, k, fp, cfg);
  return {
    active: 'acts',
    html: `${crumb}<h1>記録の修正</h1><p class="mu">直した内容は下書きとしてこの端末に残ります。「保存」を押すと試合の記録に確定し、マッチレビューと分析に反映されます。時刻は残り時間（スコアボードと同じ）で、経過時間を小さく添えています。</p>${head}<div class="fxbody">${body}</div>`,
    bind: (root) => bindFix(root, m, d, k, cfg, st, sig),
  };
}

// ---------- helpers on a period draft ----------
const lenOf = (fp) => fp.len || fp.elapsed;
const rem = (fp, at) => mmss(lenOf(fp) - at);
const remEl = (fp, at) => `<b>${rem(fp, at)}</b><small>（経過 ${mmss(at)}）</small>`;
function badge(cfg, pid) { const mm = cfg.members?.[pid] || {}; return pid ? `<span class="no ${mm.pos === 'GK' ? 'gk' : 'fp'}">${esc(mm.no ?? '?')}</span>` : ''; }
function nm(cfg, pid) { return pid ? `${badge(cfg, pid)} ${esc(playerById(pid)?.last || '')}` : '<span class="mu">空席</span>'; }
function plain(cfg, pid) { return pid ? `${cfg.members?.[pid]?.no ?? '?'} ${playerById(pid)?.last || ''}` : '空席'; }
function outOf(fp, ev) { const w = seatWalk(fp)[ev.seat].segs.find((g) => g.endEv === ev.id); return w ? w.pid : null; }
function onPitchAt(fp, at) { return seatWalk(fp).map((w) => { const g = w.segs.find((x) => x.from <= at && at < x.to) || w.segs[w.segs.length - 1]; return { seat: w.seat, pid: g.pid }; }); }
function bounds(fp, ev) { // the time range this event can move in (between the neighbours on the same place)
  const same = fp.ev.filter((e) => e.seat === ev.seat).sort((a, b) => a.at - b.at);
  const i = same.findIndex((e) => e.id === ev.id);
  return { lo: i > 0 ? same[i - 1].at : 0, hi: i < same.length - 1 ? same[i + 1].at : fp.elapsed };
}
function periodTimes(fp, key) {
  const t = {}; for (const s of fixData(fp, key).stints) { t[s.pid] = (t[s.pid] || 0) + (s.to - s.from); } return t;
}
const memberList = (cfg) => Object.keys(cfg.members || {}).sort((a, b) => (parseInt(cfg.members[a].no, 10) || 999) - (parseInt(cfg.members[b].no, 10) || 999));

// ---------- 交代 ----------
function tabSub(m, d, k, fp, cfg) {
  const W = seatWalk(fp); const L = fp.elapsed || 1;
  const pc = (v) => (v / L * 100).toFixed(3);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => `<span style="left:${f * 100}%">${mmss(lenOf(fp) - f * fp.elapsed)}</span>`).join('');
  const rows = W.map((w) => `<div class="gtr"><span class="gtl">場所${w.seat + 1}</span><div class="gtt">${w.segs.map((g) => {
    const wide = (g.to - g.from) / L > 0.07;
    const cls = !g.pid ? 'emp' : cfg.members?.[g.pid]?.pos === 'GK' ? 'gk' : '';
    return `<span class="gts ${cls}" style="left:${pc(g.from)}%;width:${pc(g.to - g.from)}%" title="${esc(plain(cfg, g.pid))}">${wide ? esc(g.pid ? plain(cfg, g.pid) : '空席') : ''}</span>`;
  }).join('')}${w.segs.filter((g) => g.startEv).map((g) => { const e = fp.ev.find((x) => x.id === g.startEv); return e?.kind === 'sub' ? `<button class="gtk" style="left:${pc(g.from)}%" data-edit="${e.id}" title="この交代を直す"></button>` : ''; }).join('')}</div></div>`).join('');
  const subs = fp.ev.filter((e) => e.kind === 'sub').sort((a, b) => a.at - b.at);
  const list = subs.length ? subs.map((e) => `<tr><td>${remEl(fp, e.at)}</td><td>場所${e.seat + 1}</td><td>${nm(cfg, outOf(fp, e))}</td><td>→</td><td>${nm(cfg, e.in)}</td>
      <td class="fxact"><button class="btn sm" data-edit="${e.id}">直す</button><button class="btn sm" data-miss="${e.id}">押し間違い</button></td></tr>`).join('')
    : '<tr><td colspan="6" class="mu" style="text-align:center">このピリオドの交代はありません</td></tr>';
  return `<div class="card"><div class="gtax"><span></span><div>${ticks}</div></div>${rows}
      <p class="mu" style="margin:8px 0 0">○の印（交代の区切り）か、下の一覧の「直す」を押すと、時刻・OUT・INを直せます。</p></div>
    <div class="card"><div class="row between"><h2 class="h" style="margin:0">${periodLabel(k)}の交代（${subs.length}回）</h2><button class="btn pri" id="fxAddSub">＋ 交代を追加</button></div>
    <table class="fxtb"><tr><th>残り時間</th><th>場所</th><th>OUT</th><th></th><th>IN</th><th></th></tr>${list}</table>
    <p class="mu">「押し間違い」：その交代と、それを直すためにあとで押した逆の交代（同じ選手同士を戻した交代）をまとめて消し、出場をつなげます。</p></div>`;
}

// ---------- スタメン ----------
function tabLineup(m, d, k, fp, cfg) {
  const ms = memberList(cfg);
  return `<div class="card"><h2 class="h" style="margin-top:0">${periodLabel(k)}のスタメン（各場所の最初の選手）</h2>
    <div class="fxlu">${fp.lineup.map((pid, i) => `<label>場所${i + 1}</label><select data-lu="${i}">${ms.map((x) => `<option value="${x}" ${x === pid ? 'selected' : ''}>${esc(plain(cfg, x))}${cfg.members[x].pos === 'GK' ? '（GK）' : ''}</option>`).join('')}</select>`).join('')}</div>
    <p class="mu">変えると、その場所の最初の交代まで、選んだ選手が出場していたことになります。</p></div>`;
}

// ---------- 退場・空席 ----------
function tabEject(m, d, k, fp, cfg) {
  const ej = fp.ev.filter((e) => e.kind === 'eject').sort((a, b) => a.at - b.at);
  const rows = ej.length ? ej.map((e) => {
    const fill = fp.ev.find((x) => x.kind === 'fill' && x.seat === e.seat && x.at >= e.at && !fp.ev.some((y) => y.kind === 'eject' && y.seat === e.seat && y.at > e.at && y.at <= x.at));
    const early = fill && fill.at - e.at < 120000;
    return `<tr><td>${remEl(fp, e.at)}</td><td>${nm(cfg, outOf(fp, e))}</td>
      <td><select data-reason="${e.id}"><option value="">（未選択）</option><option value="red" ${e.reason === 'red' ? 'selected' : ''}>レッド</option><option value="y2" ${e.reason === 'y2' ? 'selected' : ''}>イエロー2枚目</option></select></td>
      <td>${fill ? `${remEl(fp, fill.at)}<br>${nm(cfg, fill.in)}${early ? ' <span class="tag">2分経過前（失点による補充）</span>' : ''}` : '<span class="mu">補充なし（最後まで空席）</span>'}</td>
      <td class="fxact"><button class="btn sm" data-ejedit="${e.id}">直す</button><button class="btn sm dangerline" data-ejdel="${e.id}">退場を削除</button></td></tr>`;
  }).join('') : '<tr><td colspan="5" class="mu" style="text-align:center">このピリオドの退場はありません</td></tr>';
  return `<div class="card"><div class="row between"><h2 class="h" style="margin:0">${periodLabel(k)}の退場・空席</h2><button class="btn" id="fxAddEj">＋ 退場を追加</button></div>
    <table class="fxtb"><tr><th>退場の時刻</th><th>退場した選手</th><th>理由</th><th>補充（時刻・選手）</th><th></th></tr>${rows}</table>
    <p class="mu">空席の時間は誰の出場時間にも入りません。退場を削除すると、退場した選手は補充の時刻まで出場していたことになります。理由はレッドカードのイベントにも使います（④）。</p></div>`;
}

// ---------- パワープレー ----------
function tabPP(m, d, k, fp, cfg) {
  const list = (fp.pp || []).slice().sort((a, b) => a.from - b.from);
  const rows = list.length ? list.map((x) => `<tr><td>${x.team === 'own' ? '自チーム' : '相手チーム'}</td><td>${remEl(fp, x.from)}</td><td>${remEl(fp, x.to)}</td><td>${mmss(x.to - x.from)}</td>
    <td class="fxact"><button class="btn sm" data-ppedit="${x.id}">直す</button><button class="btn sm dangerline" data-ppdel="${x.id}">削除</button></td></tr>`).join('')
    : '<tr><td colspan="5" class="mu" style="text-align:center">このピリオドの5×4の時間帯はありません</td></tr>';
  return `<div class="card"><div class="row between"><h2 class="h" style="margin:0">${periodLabel(k)}の5×4の時間帯</h2><button class="btn" id="fxAddPP">＋ 5×4の時間帯を追加</button></div>
    <table class="fxtb"><tr><th>チーム</th><th>開始</th><th>終了</th><th>長さ</th><th></th></tr>${rows}</table>
    <p class="mu">特殊局面（自チームのGKがいない区間）は交代の記録から計算されるので、「交代」タブで直します。</p></div>`;
}

// ---------- 試合情報 ----------
function tabInfo(m, d) {
  const v = d.info; const t = m.times || {};
  return `<div class="card"><div class="grid2">
    <div><label for="fiDate">日付</label><input id="fiDate" data-info="date" type="date" value="${esc(v.date)}"></div>
    <div><label for="fiOpp">対戦相手</label><input id="fiOpp" data-info="opponent" value="${esc(v.opponent)}"></div>
    <div><label for="fiCat">試合の区分（任意）</label><select id="fiCat" data-info="category">${optionTags(opts('matchCategories'), v.category, { blank: 'なし' })}</select></div>
    <div><label for="fiKo">キックオフ時刻（任意）</label><input id="fiKo" data-info="kickoff" type="time" value="${esc(v.kickoff)}"></div>
    <div class="span2"><label for="fiVenue">会場（任意）</label><input id="fiVenue" data-info="venue" value="${esc(v.venue)}"></div>
    <div class="span2"><label for="fiMemo">メモ（任意）</label><textarea id="fiMemo" data-info="memo" rows="2">${esc(v.memo)}</textarea></div></div>
    <p class="mu">前後半の長さ：${t.half || 20}分${t.extra ? `／延長 ${t.extraHalf || 5}分` : ''}（長さの直し方は次の版で入ります）。最終スコアとPK戦はイベント入力（④）で入れます。</p></div>`;
}

// ---------- 履歴 ----------
function tabLog(m) {
  const c = watchFixLog(m.id);
  const types = ['交代', 'スタメン', '退場', 'パワープレー', '試合情報'];
  const f = ui.logType || '';
  const items = c.list.slice().sort((a, b) => b.t - a.t).flatMap((r) => (r.items || []).slice().reverse().filter((it) => !f || it.type === f).map((it) => ({ ...it, r })));
  const fmt = (t) => { const x = new Date(t); return `${x.getMonth() + 1}/${x.getDate()} ${String(x.getHours()).padStart(2, '0')}:${String(x.getMinutes()).padStart(2, '0')}`; };
  return `<div class="card"><div class="row between"><h2 class="h" style="margin:0">修正の履歴（新しい順）</h2>
    <select id="fxLogType" style="width:auto;min-width:200px"><option value="">すべての種類</option>${types.map((t) => `<option ${t === f ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
    <table class="fxtb"><tr><th>日時</th><th>端末</th><th>種類</th><th>内容（変更前 → 変更後）</th></tr>
    ${items.length ? items.map((it) => `<tr><td>${fmt(it.r.t)}</td><td>${esc(it.r.devName || '')}</td><td>${esc(it.type)}</td><td>${esc(it.text)}</td></tr>`).join('') : '<tr><td colspan="4" class="mu" style="text-align:center">まだ修正していません</td></tr>'}</table></div>`;
}

// ---------- actions ----------
function bindFix(root, m, d, k, cfg, st, sig) {
  const fp = d.periods[k];
  const commit = (type, text, mutate) => {
    d.undo.push(clone({ periods: d.periods, info: d.info, changes: d.changes }));
    if (d.undo.length > 50) d.undo.shift();
    mutate();
    d.changes.push({ type, text: `${['試合情報'].includes(type) ? '' : periodLabel(k) + ' '}${text}` });
    storeDraft(m, d); render();
  };
  root.addEventListener('click', async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.per) { ui.period = b.dataset.per; return render(); }
    if (b.dataset.tab) { ui.tab = b.dataset.tab; return render(); }
    if (b.dataset.edit) return subModal(m, d, k, fp, cfg, b.dataset.edit, commit);
    if (b.dataset.miss) return missPress(fp, cfg, b.dataset.miss, commit);
    if (b.id === 'fxAddSub') return subModal(m, d, k, fp, cfg, null, commit);
    if (b.dataset.ejedit) return ejectModal(fp, cfg, b.dataset.ejedit, commit);
    if (b.dataset.ejdel) return ejectDelete(fp, cfg, b.dataset.ejdel, commit);
    if (b.id === 'fxAddEj') return ejectModal(fp, cfg, null, commit);
    if (b.dataset.ppedit) return ppModal(fp, b.dataset.ppedit, commit);
    if (b.dataset.ppdel) { const x = fp.pp.find((y) => y.id === b.dataset.ppdel); return commit('パワープレー', `5×4（${x.team === 'own' ? '自' : '相手'}）残り${rem(fp, x.from)}〜${rem(fp, x.to)} を削除`, () => { fp.pp = fp.pp.filter((y) => y.id !== x.id); }); }
    if (b.id === 'fxAddPP') return ppModal(fp, null, commit);
    if (b.id === 'fxUndo') { const u = d.undo.pop(); if (u) { Object.assign(d, u); storeDraft(m, d); render(); } return; }
    if (b.id === 'fxDiscard') {
      if (await confirmBox({ title: '保存していない修正を破棄しますか？', body: `<p>前回の保存からの修正（${d.changes.length}件）がすべて取り消されます。</p>`, ok: '破棄する', danger: true })) { dropDraft(m); setLeaveGuard(null); toast('修正を破棄しました'); render(); }
      return;
    }
    if (b.id === 'fxSave') return save(m, d, cfg);
  });
  root.addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.lu != null) { const i = +t.dataset.lu; const old = fp.lineup[i]; commit('スタメン', `場所${i + 1}のスタメン ${plain(cfg, old)} → ${plain(cfg, t.value)}`, () => { fp.lineup[i] = t.value; }); }
    if (t.dataset.reason) { const ev = fp.ev.find((x) => x.id === t.dataset.reason); const L = { '': '未選択', red: 'レッド', y2: 'イエロー2枚目' }; commit('退場', `${plain(cfg, outOf(fp, ev))} の退場の理由 ${L[ev.reason || '']} → ${L[t.value]}`, () => { ev.reason = t.value || null; }); }
    if (t.dataset.info) { const f = t.dataset.info; const lab = { date: '日付', opponent: '対戦相手', category: '試合の区分', kickoff: 'キックオフ時刻', venue: '会場', memo: 'メモ' }[f]; const old = d.info[f]; if (old !== t.value) commit('試合情報', `${lab} ${old || '（なし）'} → ${t.value || '（なし）'}`, () => { d.info[f] = t.value; }); }
    if (t.id === 'fxLogType') { ui.logType = t.value; render(); }
  });
}

// 時刻の入力つきの小さな画面
function timeField(fp, id, at, lo, hi, title) {
  return `<div class="fxtime"><div class="fxtl">${title}<small>入れられる範囲：残り ${rem(fp, hi)} 〜 ${rem(fp, lo)}</small></div>${keypadHTML({ steps: [-5, -1, 1, 5], id })}</div>`;
}
function remToAt(fp, sec) { return Math.max(0, Math.min(fp.elapsed, lenOf(fp) - sec * 1000)); }

function subModal(m, d, k, fp, cfg, id, commit) {
  const ev = id ? fp.ev.find((x) => x.id === id) : null;
  const ms = memberList(cfg);
  const opt = (sel) => ms.map((x) => `<option value="${x}" ${x === sel ? 'selected' : ''}>${esc(plain(cfg, x))}</option>`).join('');
  let lo = 0, hi = fp.elapsed; if (ev) ({ lo, hi } = bounds(fp, ev));
  const out0 = ev ? outOf(fp, ev) : null;
  const md = openModal(`<h2>${ev ? `交代を直す（${periodLabel(k)} 残り${rem(fp, ev.at)}）` : `交代を追加（${periodLabel(k)}）`}</h2>
    <div class="fxmod">${timeField(fp, 'kpSub', ev ? ev.at : fp.elapsed / 2, lo, hi, '交代の時刻（残り時間）')}
      <div class="fxside">
        <label>OUT（その場所に座っていた選手）</label><select id="fxOut">${ev ? opt(out0) : '<option value="">時刻を入れると選べます</option>'}</select>
        <label>IN（入った選手）</label><select id="fxIn">${opt(ev ? ev.in : '')}</select>
        <div id="fxPrev" class="fxprev"></div></div></div>
    <div class="mfoot">${ev ? '<button class="btn dangerline" data-del>この交代を削除</button><span class="sp"></span>' : ''}<button class="btn" data-c>やめる</button><button class="btn pri" data-ok>反映</button></div>`, { wide: true });
  const outSel = md.querySelector('#fxOut'), inSel = md.querySelector('#fxIn');
  // build the edited copy of the period from the current inputs
  const draftOf = () => {
    const v = kp.value(); if (!v.ok) return { err: v.msg };
    const at = remToAt(fp, v.sec);
    const f2 = clone(fp);
    if (ev) {
      const e2 = f2.ev.find((x) => x.id === ev.id); e2.at = at; e2.in = inSel.value;
      if (outSel.value && outSel.value !== out0) { // OUTした選手を変える＝その区切りの前に座っていた選手を入れ替える
        const prev = f2.ev.filter((x) => x.seat === ev.seat && x.at <= ev.at && x.id !== ev.id && x.kind !== 'eject').sort((a, b) => a.at - b.at).pop();
        if (prev) prev.in = outSel.value; else f2.lineup[ev.seat] = outSel.value;
      }
    } else {
      const seat = onPitchAt(f2, at).find((x) => x.pid === outSel.value)?.seat;
      if (seat == null) return { err: 'OUTする選手を選んでください' };
      f2.ev.push({ id: newEvId(), kind: 'sub', seat, at, in: inSel.value });
    }
    if (inSel.value === (ev ? (outSel.value || out0) : outSel.value)) return { err: 'OUTとINが同じ選手です' };
    return { f2, at };
  };
  const preview = () => {
    if (!ev) { // 追加：その時刻にピッチにいる選手からOUTを選ぶ
      const v = kp.value();
      if (v.ok) { const at = remToAt(fp, v.sec); const on = onPitchAt(fp, at).filter((x) => x.pid); const cur = outSel.value; outSel.innerHTML = on.map((x) => `<option value="${x.pid}" ${x.pid === cur ? 'selected' : ''}>${esc(plain(cfg, x.pid))}（場所${x.seat + 1}）</option>`).join(''); }
    }
    const r = draftOf(); const box = md.querySelector('#fxPrev');
    if (r.err) { box.innerHTML = `<p class="err">${esc(r.err)}</p>`; return; }
    const a = periodTimes(fp, k), b = periodTimes(r.f2, k);
    const ch = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((pid) => (a[pid] || 0) !== (b[pid] || 0));
    const errs = checkFix(r.f2, cfg);
    box.innerHTML = `<b>出場時間の変化（${periodLabel(k)}）</b>${ch.length ? `<table>${ch.map((pid) => `<tr><td>${nm(cfg, pid)}</td><td>${mmss(a[pid] || 0)} → <b>${mmss(b[pid] || 0)}</b></td></tr>`).join('')}</table>` : '<p class="mu">変化なし</p>'}${errs.length ? `<p class="err">${errs.map(esc).join('<br>')}</p>` : ''}`;
  };
  const kp = bindKeypad(md, { init: Math.round((lenOf(fp) - (ev ? ev.at : fp.elapsed / 2)) / 1000), min: Math.round((lenOf(fp) - hi) / 1000), max: Math.round((lenOf(fp) - lo) / 1000), onChange: () => setTimeout(preview) });
  outSel.onchange = preview; inSel.onchange = preview; preview();
  md.querySelector('[data-c]').onclick = closeModal;
  const del = md.querySelector('[data-del]');
  if (del) del.onclick = () => { closeModal(); commit('交代', `残り${rem(fp, ev.at)} ${plain(cfg, out0)} → ${plain(cfg, ev.in)} を削除`, () => { fp.ev = fp.ev.filter((x) => x.id !== ev.id); }); };
  md.querySelector('[data-ok]').onclick = () => {
    const r = draftOf(); if (r.err) return toast(r.err);
    closeModal();
    const newOut = ev ? (outSel.value || out0) : outSel.value;
    const text = ev ? `残り${rem(fp, ev.at)} ${plain(cfg, out0)} → ${plain(cfg, ev.in)} を 残り${rem(fp, r.at)} ${plain(cfg, newOut)} → ${plain(cfg, inSel.value)} に`
      : `交代を追加：残り${rem(fp, r.at)} ${plain(cfg, newOut)} → ${plain(cfg, inSel.value)}`;
    commit('交代', text, () => { fp.ev = r.f2.ev; fp.lineup = r.f2.lineup; });
  };
}

// 押し間違い：この交代と、それを直すために押した逆の交代（同じ場所で同じ選手同士を戻した交代）をまとめて消す
async function missPress(fp, cfg, id, commit) {
  const ev = fp.ev.find((x) => x.id === id); const out = outOf(fp, ev);
  const rev = fp.ev.filter((x) => x.kind === 'sub' && x.seat === ev.seat && x.at > ev.at).sort((a, b) => a.at - b.at)
    .find((x) => x.in === out && outOf(fp, x) === ev.in);
  const body = rev
    ? `<p>残り${rem(fp, ev.at)}の「${esc(plain(cfg, out))} → ${esc(plain(cfg, ev.in))}」と、直すために押した残り${rem(fp, rev.at)}の「${esc(plain(cfg, ev.in))} → ${esc(plain(cfg, out))}」をまとめて消します。</p><p>${esc(plain(cfg, out))} は途切れずに出場し、${esc(plain(cfg, ev.in))} のこの間の出場は消えます。</p>`
    : `<p>このあとに、同じ選手同士を戻した交代が見つかりません。この交代（${esc(plain(cfg, out))} → ${esc(plain(cfg, ev.in))}）だけを消し、${esc(plain(cfg, out))} が次の交代まで出場していたことにしますか？</p>`;
  if (!(await confirmBox({ title: '押し間違いとして消しますか？', body, ok: '消す' }))) return;
  commit('交代', rev ? `押し間違い：残り${rem(fp, ev.at)} ${plain(cfg, out)} → ${plain(cfg, ev.in)} と 残り${rem(fp, rev.at)} の戻しの交代を削除` : `押し間違い：残り${rem(fp, ev.at)} ${plain(cfg, out)} → ${plain(cfg, ev.in)} を削除`,
    () => { fp.ev = fp.ev.filter((x) => x.id !== ev.id && x.id !== rev?.id); });
}

function ejectModal(fp, cfg, id, commit) {
  const ev = id ? fp.ev.find((x) => x.id === id) : null;
  const fill = ev ? fp.ev.find((x) => x.kind === 'fill' && x.seat === ev.seat && x.at >= ev.at) : null;
  const ms = memberList(cfg);
  const md = openModal(`<h2>${ev ? '退場を直す' : '退場を追加'}</h2>
    <div class="fxmod">${timeField(fp, 'kpEj', ev ? ev.at : fp.elapsed / 2, 0, fp.elapsed, '退場の時刻（残り時間）')}
      <div class="fxside"><label>退場した選手</label><select id="ejWho"></select>
        <label><input type="checkbox" id="ejHasFill" ${fill || !ev ? 'checked' : ''}> 補充した</label>
        <label>補充の時刻（残り時間）</label><input id="ejFillT" inputmode="numeric" value="${fill ? rem(fp, fill.at) : ''}" placeholder="例 12:30">
        <label>補充した選手</label><select id="ejFillWho">${ms.map((x) => `<option value="${x}" ${x === fill?.in ? 'selected' : ''}>${esc(plain(cfg, x))}</option>`).join('')}</select>
        <p class="mu">補充の時刻は「12:30」または「1230」の形で入れてください。</p></div></div>
    <div class="mfoot"><button class="btn" data-c>やめる</button><button class="btn pri" data-ok>反映</button></div>`, { wide: true });
  const who = md.querySelector('#ejWho');
  const kp = bindKeypad(md, { init: Math.round((lenOf(fp) - (ev ? ev.at : fp.elapsed / 2)) / 1000), min: Math.round((lenOf(fp) - fp.elapsed) / 1000), max: Math.round(lenOf(fp) / 1000), onChange: () => setTimeout(refreshWho) });
  function refreshWho() {
    const v = kp.value(); if (!v.ok) return; const at = remToAt(fp, v.sec);
    const cur = who.value || (ev ? outOf(fp, ev) : '');
    const on = onPitchAt(fp, at).filter((x) => x.pid);
    who.innerHTML = on.map((x) => `<option value="${x.pid}" ${x.pid === cur ? 'selected' : ''}>${esc(plain(cfg, x.pid))}（場所${x.seat + 1}）</option>`).join('');
  }
  if (ev) { const o = outOf(fp, ev); who.innerHTML = `<option value="${o}">${esc(plain(cfg, o))}</option>`; } else refreshWho();
  md.querySelector('[data-c]').onclick = closeModal;
  md.querySelector('[data-ok]').onclick = () => {
    const v = kp.value(); if (!v.ok) return toast(v.msg);
    const at = remToAt(fp, v.sec);
    const f2 = clone(fp);
    const seat = ev ? ev.seat : onPitchAt(f2, at).find((x) => x.pid === who.value)?.seat;
    if (seat == null) return toast('退場した選手を選んでください');
    f2.ev = f2.ev.filter((x) => x.id !== ev?.id && x.id !== fill?.id);
    f2.ev.push({ id: ev?.id || newEvId(), kind: 'eject', seat, at, reason: ev?.reason || null });
    if (md.querySelector('#ejHasFill').checked) {
      const mt = md.querySelector('#ejFillT').value.trim().match(/^(\d{1,2}):?(\d{2})$/);
      if (!mt || +mt[2] > 59) return toast('補充の時刻を「12:30」の形で入れてください');
      const fat = remToAt(fp, +mt[1] * 60 + +mt[2]);
      if (fat < at) return toast('補充の時刻が退場より前になっています');
      f2.ev.push({ id: fill?.id || newEvId(), kind: 'fill', seat, at: fat, in: md.querySelector('#ejFillWho').value });
    }
    const errs = checkFix(f2, cfg); if (errs.length) return toast(errs[0]);
    closeModal();
    commit('退場', `${ev ? '退場を直す' : '退場を追加'}：残り${rem(fp, at)} ${plain(cfg, who.value || outOf(fp, ev))}`, () => { fp.ev = f2.ev; });
  };
}
async function ejectDelete(fp, cfg, id, commit) {
  const ev = fp.ev.find((x) => x.id === id); const who = outOf(fp, ev);
  const fill = fp.ev.find((x) => x.kind === 'fill' && x.seat === ev.seat && x.at >= ev.at);
  if (!(await confirmBox({ title: '退場を削除しますか？', body: `<p>${esc(plain(cfg, who))} は${fill ? `補充の時刻（残り${rem(fp, fill.at)}）まで` : '最後まで'}出場していたことになります。${fill ? `補充した選手はその時刻に交代で入ったことになります。` : ''}</p>`, ok: '削除する', danger: true }))) return;
  commit('退場', `${plain(cfg, who)} の退場（残り${rem(fp, ev.at)}）を削除`, () => {
    fp.ev = fp.ev.filter((x) => x.id !== ev.id);
    if (fill) fill.kind = 'sub';
  });
}

function ppModal(fp, id, commit) {
  const x = id ? fp.pp.find((y) => y.id === id) : null;
  let step = 'from'; const v = { team: x?.team || 'own', from: x ? x.from : 0, to: x ? x.to : fp.elapsed };
  const md = openModal(`<h2>${x ? '5×4の時間帯を直す' : '5×4の時間帯を追加'}</h2>
    <div class="row"><button class="btn ${v.team === 'own' ? 'pri' : ''}" data-tm="own">自チーム</button><button class="btn ${v.team === 'opp' ? 'pri' : ''}" data-tm="opp">相手チーム</button></div>
    <div class="row" style="margin-top:8px"><button class="btn pri" data-st="from">開始 <b id="ppF">${rem(fp, v.from)}</b></button><button class="btn" data-st="to">終了 <b id="ppT">${rem(fp, v.to)}</b></button></div>
    <div class="ppk">${keypadHTML({ steps: [-5, -1, 1, 5] })}</div>
    <div class="mfoot"><button class="btn" data-c>やめる</button><button class="btn pri" data-ok>反映</button></div>`);
  const kp = bindKeypad(md, { init: Math.round((lenOf(fp) - v.from) / 1000), min: Math.round((lenOf(fp) - fp.elapsed) / 1000), max: Math.round(lenOf(fp) / 1000), onChange: (r) => { if (r.ok) { v[step] = remToAt(fp, r.sec); md.querySelector(step === 'from' ? '#ppF' : '#ppT').textContent = rem(fp, v[step]); } } });
  md.addEventListener('click', (e) => {
    const t = e.target.closest('[data-tm]'); if (t) { v.team = t.dataset.tm; md.querySelectorAll('[data-tm]').forEach((b) => b.classList.toggle('pri', b === t)); }
    const s = e.target.closest('[data-st]'); if (s) { step = s.dataset.st; md.querySelectorAll('[data-st]').forEach((b) => b.classList.toggle('pri', b === s)); kp.set(Math.round((lenOf(fp) - v[step]) / 1000)); }
  });
  md.querySelector('[data-c]').onclick = closeModal;
  md.querySelector('[data-ok]').onclick = () => {
    if (!(v.to > v.from)) return toast('終了が開始より後になるようにしてください');
    closeModal();
    commit('パワープレー', `${x ? '5×4を直す' : '5×4を追加'}：${v.team === 'own' ? '自チーム' : '相手チーム'} 残り${rem(fp, v.from)}〜${rem(fp, v.to)}`, () => {
      if (x) Object.assign(x, v); else fp.pp = [...(fp.pp || []), { id: newEvId(), ...v }];
    });
  };
}

function save(m, d, cfg) {
  const periods = {};
  for (const [k, fp] of Object.entries(d.periods)) { const { len, ...rest } = fp; periods[k] = rest; }
  const info = {}; for (const f of INFO_KEYS) if ((m[f] ?? '') !== d.info[f]) info[f] = d.info[f];
  if (info.opponent === '' || info.date === '') return toast('日付と対戦相手は空にできません');
  put(teamPath('matches', m.id), { fix: { periods, savedAt: Date.now(), dev: devName() }, ...info });
  addFixLog(m.id, { devName: devName(), items: d.changes });
  dropDraft(m); setLeaveGuard(null);
  toast(`修正を保存しました（${d.changes.length}件）。マッチレビューに反映されます`);
  render();
}

// 保存せずに画面を離れようとしたとき（下書きは端末に残る）
function leaveGuard(m) {
  return (next) => {
    if (next.startsWith(`#/m/${m.id}/fix`)) return true;
    const d = loadDraft(m); if (!dirty(d)) return true;
    confirmBox({ title: '保存していない修正があります', body: `<p>修正（${d.changes.length}件）はまだ保存されていません。下書きはこの端末に残るので、あとで「記録の修正」を開くと続きから直せます。</p>`, ok: '保存せずに移動', cancel: '修正を続ける' })
      .then((ok) => { if (ok) { setLeaveGuard(null); location.hash = next; } });
    return false;
  };
}
