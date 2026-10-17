// MATCH PLAY — the iPad screen used on the bench during the match (spec 11章).
import { S as D, matchById, playerById, playerName, put, teamPath, watchOps, addOp, deviceId, now as srvNow } from './store.js';
import {
  replay, nowElapsed, perLen, PERIODS, periodLabel, seatView, contTime, restTime, playerPeriodTime,
  playerMatchTime, playerCounts, setplayLeft, setplayOn, carryOf, describeOp, ejectLeft, ejectCarryIn,
} from './engine.js';
import { $, $$, esc, openModal, closeModal, confirmBox, confirmTwice, toast } from './ui.js';
import { render } from './views.js';
import { keypadHTML, bindKeypad } from './keypad.js';

let tick = null, heartbeat = null, mountedId = null, ejectMode = false, autoStopFor = null, lastPpAuto = 0;
let lastTap = { k: null, t: 0 }; // 2回押しを防ぐ（同じカード・ボタンを300ms以内にもう一度押しても受け付けない。試10）
// 補充：空席を押して選ぶ枠 {seat, afterGoal}。2分経過を知らせた空席（同じ空席で2回知らせない）
let fillSeat = null; const fillReadyShown = new Set();
const mmss = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const mmssFloor = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

export function unmountPlay() {
  const was = mountedId;
  clearInterval(tick); tick = null; clearInterval(heartbeat); heartbeat = null; mountedId = null; ejectMode = false; fillSeat = null;
  document.body.classList.remove('playmode'); document.body.style.touchAction = '';
  if (was) wakeCheck(); // ピリオドが記録中なら、マッチレビューなどを見ている間も画面を暗くしない（試5）
}

// ---------- 画面の消灯防止（spec 4章）：MATCH PLAYを開いている間と、ピリオドが記録中の間（ほかの画面を見ていても）----------
let wakeLock = null, wakeFor = null, wakeTimer = null, wakeAsking = false;
function liveNow(id) {
  const m = matchById(id); if (!m) return false;
  const st = replay(watchOps(id).list, cfgOf(m));
  return st.periods[st.current].status === 'live';
}
function wakeCheck() {
  if (wakeFor && (mountedId === wakeFor || liveNow(wakeFor))) { keepAwake(); return; }
  releaseWake();
}
function startWake(id) {
  if (wakeFor !== id) releaseWake();
  wakeFor = id;
  document.addEventListener('visibilitychange', onVis);
  if (!wakeTimer) wakeTimer = setInterval(wakeCheck, 10000);
  keepAwake();
}
function releaseWake() {
  clearInterval(wakeTimer); wakeTimer = null; wakeFor = null;
  document.removeEventListener('visibilitychange', onVis);
  try { wakeLock?.release(); } catch {} wakeLock = null;
}
function onVis() { if (!document.hidden) wakeCheck(); } // 画面を戻したら取り直す（隠れると自動で外れるため）
async function keepAwake() {
  if (document.hidden || wakeAsking || (wakeLock && !wakeLock.released)) return;
  if (!('wakeLock' in navigator)) return;
  wakeAsking = true;
  try { const l = await navigator.wakeLock.request('screen'); if (wakeFor) wakeLock = l; else l.release(); } catch {} finally { wakeAsking = false; }
}

function cfgOf(m) {
  // timesFixed：記録の修正の「試合情報」でピリオドの長さを直した試合（その長さで数え直す。足1）
  return { times: m.times || {}, members: m.members || {}, setplayAuto: (D.team?.settings?.setplayAuto) || 60, timesFixed: !!m.timesFixed };
}
function draftKey(m, period) { return `fpt.lineup.${m.id}.${period}`; }
// 先発の5枠（左から seat 0〜4）。空いた枠は詰めずに空欄のまま残す。
function getDraft(m, period) {
  let a = []; try { a = JSON.parse(localStorage.getItem(draftKey(m, period)) || '[]'); } catch {}
  return [0, 1, 2, 3, 4].map((i) => (a[i] && m.members?.[a[i]] ? a[i] : null));
}
const filled = (d) => d.filter(Boolean).length;
// GKは一番左の枠、FPは左から2番目以降を順に埋め、最後に一番左の枠（GKを入れない場合）
function slotFor(m, draft, pid) {
  const gk = m.members?.[pid]?.pos === 'GK';
  const order = gk ? [0, 1, 2, 3, 4] : [1, 2, 3, 4, 0];
  return order.find((i) => !draft[i]);
}
function setDraft(m, period, arr) { try { localStorage.setItem(draftKey(m, period), JSON.stringify(arr)); } catch {} }

// ---------- view ----------
export function vPlay(m) {
  const opsC = watchOps(m.id);
  if (!opsC.ready && !opsC.list.length) return { full: true, html: '<p class="pad mu">読み込み中…</p>' };
  const cfg = cfgOf(m);
  const st = replay(opsC.list, cfg);
  const per = st.periods[st.current];
  const live = per.status === 'live';
  const len = perLen(st, st.current);
  const t = Date.now();
  const el = nowElapsed(st, t);
  const running = per.runningSince != null;
  const spOn = live && setplayOn(st, el); // 1:00で自動終了したら、次の操作を待たずに終わったものとして見せる（試2）
  const timeUp = live && !running && el >= len; // 0:00になって止まったまま（ピリオド終了を押していない）
  const carryIn = !live && per.status === 'none' && !st.matchOver && !st.askExtra ? ejectCarryIn(st) : []; // 前のピリオドから持ち越した退場の空席（決6）
  const need = 5 - carryIn.length; // 先発に必要な人数（持ち越した空席の数だけ少なくてよい）
  const members = Object.entries(m.members || {}).map(([pid, v]) => ({ pid, ...v, p: playerById(pid) }))
    .sort((a, b) => (a.pos === 'GK') - (b.pos === 'GK') || (parseInt(a.no, 10) || 999) - (parseInt(b.no, 10) || 999));
  if (fillSeat && (!live || !st.empty[fillSeat.seat])) fillSeat = null;
  const draft = live ? [null, null, null, null, null] : getDraft(m, st.current);
  const view = live ? seatView(st, el) : [0, 1, 2, 3, 4].map((i) => ({ seat: i, pid: draft[i] || null, draft: true }));
  const onPitch = new Set(view.filter((v) => v.pid).map((v) => v.pid));
  const replacedOuts = st.batch.outs.filter((o) => !view.some((v) => v.pid === o.pid)).map((o) => o.pid);
  const ct = m.colorTimer || { orange: 120, red: 180 };
  const other = otherDevice(m);
  const ownTO = st.timeouts.filter((x) => x.period === st.current && x.team === 'own').length;
  const oppTO = st.timeouts.filter((x) => x.period === st.current && x.team === 'opp').length;
  const isExtra = PERIODS.find((p) => p.key === st.current)?.extra;
  const n = members.length;
  const cols = n <= 14 ? 7 : n <= 21 ? 7 : 9;

  const num = (pid, cls = '') => {
    const mm = m.members[pid] || {};
    return `<span class="pnum ${mm.pos === 'GK' ? 'gk' : 'fp'} ${mm.pp ? 'pp' : ''} ${cls}">${esc(mm.no ?? '')}</span>`;
  };
  // 背番号と姓を横に並べて大きく（どのカードも同じ大きさ。姓は3文字まで同じ大きさ、4文字以上だけ少し小さく）
  const nameRow = (pid, last) => `<div class="nr">${num(pid)}<div class="pn ${[...(last || '')].length > 3 ? 'long' : ''}">${esc(last || '')}</div></div>`;
  const stats = (pid, rest) => {
    const pc = playerCounts(st, pid, st.current);
    const at = frozenAt(st, pid, el); // 交代待ちの間は、OUTの時点で止めて見せる
    // 見出しを小さく上、時間を大きく、回数を下。休憩だけは「休憩 0:00」と横並び（0.3.5）
    const col = (label, attr, v, cnt) => `<div class="sc"><span class="sl">${label}</span><b class="sv" ${attr}="${pid}">${v}</b><span class="sn">${cnt}回</span></div>`;
    return `<div class="pst">${col('ピリオド', 'data-pt', mmssFloor(playerPeriodTime(st, pid, st.current, at)), pc.period)}${col('試合', 'data-mt', mmssFloor(playerMatchTime(st, pid, at)), pc.match)}${rest !== undefined ? `<div class="sr"><span class="sl">休憩</span><b class="sv" data-rest="${pid}">${rest == null ? '—' : mmssFloor(rest)}</b></div>` : ''}</div>`;
  };
  const pitchCard = (v) => {
    if (!v.pid) {
      if (v.empty) {
        const left = ejectLeft(v.empty, el);
        const picking = fillSeat && fillSeat.seat === v.seat;
        const state = picking ? 'pick' : left > 0 ? 'wait' : 'ok';
        const inner = picking ? '<div class="ejbig">選手を選んでください</div>'
          : left > 0 ? `<div class="ejw" data-ej="${v.seat}">補充まで ${mmss(left)}</div>` : '<div class="ejbig">補充できます</div><div class="tapme">ここを押す</div>';
        return `<button class="pc empty ${state}" data-empty="${v.seat}"><div class="emp">空席</div><div class="mu">退場：${esc(playerName(playerById(v.empty.pid)))}</div>${inner}</button>`;
      }
      return `<div class="pc emptyd" data-seat="${v.seat}"><div class="emp">${live ? '' : '先発を選ぶ'}</div><div class="mu">${live ? '' : 'ベンチの選手を押す'}</div></div>`;
    }
    const p = playerById(v.pid); const mm = m.members[v.pid] || {};
    const c = live ? contTime(st, v.pid, el, v) : 0;
    const col = mm.pos === 'GK' ? '' : c >= ct.red * 1000 ? 'red' : c >= ct.orange * 1000 ? 'orange' : '';
    return `<button class="pc ${v.waiting ? 'waiting' : ''} ${v.tentative ? 'tent' : ''} ${ejectMode ? 'ejpick' : ''}" data-p="${v.pid}" data-kind="${v.waiting ? 'waiting' : v.tentative ? 'tent' : v.draft ? 'draft' : 'on'}">
      ${nameRow(v.pid, p?.last)}
      ${v.waiting ? `<div class="wt">交代待ち（OUT ${mmss(len - v.outAt)}）</div>` : v.tentative ? '<div class="wt tn">仮に入る（押すと取り消し）</div>' : `<div class="ct ${col}" data-ct="${v.pid}">${mmssFloor(c)}</div>`}
      ${stats(v.pid)}</button>`;
  };
  const benchCard = (mb) => {
    const pid = mb.pid;
    if (onPitch.has(pid)) return `<div class="bc ghost"><span class="gx"><b>${esc(mb.no ?? '')}</b>出場中</span></div>`;
    const ej = st.ejected.has(pid);
    const waitingOut = replacedOuts.includes(pid);
    const carry = live ? carryOf(st, pid, el) : null;
    const rest = live ? restTime(st, pid, el) : restTime(st, pid, 0);
    return `<button class="bc ${ej ? 'ej' : ''} ${waitingOut ? 'wout' : ''}" data-b="${pid}" ${ej ? 'disabled' : ''}>
      ${nameRow(pid, mb.p?.last)}
      ${ej ? '<div class="tag ej">退場</div>' : waitingOut ? '<div class="tag w">交代待ち（押すと取り消し）</div>' : ''}
      ${carry != null ? `<span class="cont" data-cont="${pid}">続き ${mmssFloor(carry)}</span>` : ''}
      ${stats(pid, rest)}</button>`;
  };

  const btn = (id, label, sub = '', cls = '', dis = false) => `<button class="cb ${cls}" id="${id}" ${dis ? 'disabled' : ''}>${label}${sub ? `<small>${sub}</small>` : ''}</button>`;
  const ppLabel = st.ppActive ? '5x4 終了' : 'パワープレー開始';
  const stateMsg = st.matchOver ? '試合終了' : st.askExtra ? '後半終了' : !live ? (per.status === 'none' ? '開始前' : '') : running ? '計測中' : '停止中';
  const banner = [];
  if (other) banner.push(`<div class="pbanner warn">別の端末（${esc(other)}）で記録中です。同じ試合を2台で操作しないでください。<button class="btn sm" id="btnTake">この端末で記録する</button></div>`);

  return {
    full: true,
    html: `<div class="play" style="touch-action:manipulation">
    <div class="ptop">
      <div class="pl">
        <a class="cb back" href="#/m/${m.id}">‹ 試合ページ</a>
        <button class="cb per" id="btnPer">${periodLabel(st.current)} ▾</button>
      </div>
      <div class="clockbox">
        <div class="clock ${running ? 'run' : ''}" id="clock">${mmss(len - el)}</div>
        <div class="row">
          <span class="stchip ${running ? 'on' : ''}">${stateMsg}</span>
          <a class="stchip rv" href="#/m/${m.id}/review">マッチレビュー ›</a>
        </div>
      </div>
      <div class="cbs">
        ${btn('btnAdj', '時刻合わせ', '', '', !live)}
        ${btn('btnSp', spOn ? 'セットプレー終了' : 'セットプレー', '', spOn ? 'on' : '', !live)}
        ${btn('btnEj', '退場', '', '', !live)}
        ${btn('btnUndo', '↶ 1つ戻す', '', '', !st.lastUndoable)}
        ${btn('btnTO', 'タイムアウト', isExtra ? '延長は不可' : `自 残${1 - ownTO}・相手 残${1 - oppTO}`, 'teal', !live || isExtra)}
        ${btn('btnPP', ppLabel, st.ppActive ? '' : '自／相手を選ぶ', 'amber', !live)}
        ${btn('btnEnd', 'ピリオド終了', '', 'purple', !live)}
        ${btn('btnReset', 'リセット', '', 'reset')}
      </div>
      <div class="ss">
        <button class="big start" id="btnStart" ${running || st.matchOver || st.askExtra || (!live && filled(draft) < need) || (live && el >= len) ? 'disabled' : ''}>▶<span>スタート</span></button>
        <button class="big stop" id="btnStop" ${!running ? 'disabled' : ''}>❚❚<span>ストップ</span></button>
      </div>
    </div>
    ${banner.join('')}
    ${st.matchOver ? `<div class="pbanner done">試合が終わりました。お疲れさまでした。<a class="btn sm" href="#/m/${m.id}">試合ページへ</a></div>` : ''}
    ${timeUp ? `<div class="pbanner warn">時間になりました：ピリオド終了を押してください <button class="btn sm pri" id="btnEnd2">ピリオド終了</button></div>` : ''}
    ${st.askExtra ? `<div class="pbanner">後半が終わりました。延長戦を行いますか？ <button class="btn sm pri" id="btnExtraYes">延長戦を行う</button><button class="btn sm" id="btnExtraNo">行わない（試合終了）</button></div>` : ''}
    <div class="plabel st"><span>ピッチ</span><div class="stmid">
      ${ejectMode ? '<span class="stchip ej">退場する選手をピッチから押してください</span><button class="btn sm" id="btnEjCancel">やめる</button>' : ''}
      ${carryIn.map((c) => `<span class="stchip ej">退場：${esc(playerName(playerById(c.pid)))}　補充まで ${mmss(c.left)}（前のピリオドから持ち越し。枠を1つ空けたまま始められます）</span>`).join('')}
      ${!ejectMode ? st.empty.map((e, i) => {
        if (!e) return '';
        if (fillSeat && fillSeat.seat === i) return '<span class="stchip pick">ベンチから補充する選手を押してください</span><button class="btn sm" id="btnFillCancel">やめる</button>';
        const left = ejectLeft(e, el); const nm = esc(playerName(playerById(e.pid)));
        return left > 0 ? `<span class="stchip ej" data-ejc="${i}">退場：${nm}　補充まで ${mmss(left)}（失点で補充するときは、空席を押す）</span>`
          : '<span class="stchip ejok">補充できます：空席を押して、入る選手を選ぶ</span>';
      }).join('') : ''}
      ${st.ppActive ? `<span class="stchip pp ${t - lastPpAuto < 4000 ? 'flash' : ''}">5×4（パワープレー）${st.ppActive.team === 'own' ? '自チーム' : '相手チーム'}</span>` : ''}
      ${spOn ? `<span class="stchip sp" id="spChip">セットプレー中（自動終了まで ${mmss(setplayLeft(st, el))}）</span>` : ''}
    </div><span>${view.filter((v) => v.pid).length} / 5</span></div>
    <div class="pitch">${view.map(pitchCard).join('')}</div>
    <div class="plabel"><span>ベンチ（並びは固定）</span>${!live && !st.matchOver && !st.askExtra ? `<span>${carryIn.length ? `先発の${need}〜5人を選んで「スタート」` : '先発の5人を選んで「スタート」'}</span>` : ''}</div>
    <div class="bench" style="grid-template-columns:repeat(${cols},minmax(0,1fr));flex-grow:${Math.ceil(n / cols) * 0.8}">${members.map(benchCard).join('')}</div>
  </div>`,
    bind(root) { bindPlay(root, m, st, cfg, draft); },
  };
}
// 交代待ちの選手の時間は、OUTを押した時点で止めて見せる（spec 3章）
function frozenAt(st, pid, el) {
  const o = st.batch.outs.find((x) => x.pid === pid);
  return o ? Math.min(o.outAt, el) : el;
}
// ピリオド終了の確認の文（手動の「ピリオド終了」と0:00の自動の確認で同じ。試8）
function endBody(st, lead) {
  const warn = [];
  if (st.batch.outs.length) warn.push('<p>交代待ちの選手がいます。終わっていない交代は取り消し、OUTを押した選手は最後まで出場したものとして記録します（仮に入った選手はベンチに戻ります）。</p>');
  const el = nowElapsed(st);
  if (st.empty.some((e) => e && ejectLeft(e, el) > 0)) warn.push('<p>補充を待っている退場の空席は、残りの時間ごと次のピリオドに持ち越します。</p>');
  return (lead || '') + (warn.length ? warn.join('') : lead ? '' : '<p>間違えたときは「1つ戻す」で取り消せます。</p>');
}
// 操作のあと：試合の状態を書き、試合が終わったときの知らせを出す
function afterOp(m, cfg, before) {
  const after = replay(watchOps(m.id).list, cfg);
  syncStatus(m, after);
  if (!before.matchOver && after.matchOver) onMatchFinished(m);
  return after;
}
// 試合の記録が終わった（最後のピリオドの終了、または延長戦を「行わない」）。ここで試合が終わったことが確定する
function onMatchFinished(m) {} // eslint-disable-line no-unused-vars

function otherDevice(m) {
  const lv = m.live; if (!lv || lv.dev === deviceId()) return null;
  if (Date.now() - (lv.ms || 0) > 90000) return null;
  return lv.name || '別の端末';
}

// ---------- actions ----------
function bindPlay(root, m, st, cfg, draft) {
  const live = st.periods[st.current].status === 'live';
  const send = (op) => {
    // 同じ試合を2台で操作しない（spec 5章）：別の端末で記録中なら、この端末は見るだけ
    if (otherDevice(matchById(m.id) || m)) { toast('別の端末で記録中です。この端末で記録するときは、上の「この端末で記録する」を押してください'); return null; }
    const before = replay(watchOps(m.id).list, cfg);
    const o = addOp(m.id, { ...op, period: st.current });
    const after = afterOp(m, cfg, before);
    after.notices.forEach((nt) => {
      if (nt.kind === 'needOut') toast('先に交代する選手のOUTを押してください');
      if (nt.kind === 'noGK') toast('GKがピッチにいません');
      if (nt.kind === 'twoGK') toast('GKはピッチに1人までです。先にピッチのGKを押してください');
      if (nt.kind === 'ppAuto') { lastPpAuto = Date.now(); toast('5x4（自チームのパワープレー）を開始しました'); }
    });
    return o;
  };
  if (mountedId !== m.id) {
    unmountPlay(); mountedId = m.id;
    document.body.classList.add('playmode'); document.body.style.touchAction = 'manipulation'; // iPadのダブルタップでの拡大を防ぐ
    startWake(m.id);
    // 記録中の印（spec 5章）：別の端末が記録中（印が新しい）なら、開いても取らずに見るだけで始める。
    // 取るのは「この端末で記録する」を押したときだけ（試3）。別の端末の印が古くなったら、この端末が記録する
    const beat = () => { if (otherDevice(matchById(m.id) || m)) return; put(teamPath('matches', m.id), { live: { dev: deviceId(), ms: Date.now(), name: devName() } }); };
    beat(); heartbeat = setInterval(beat, 30000);
    tick = setInterval(() => updateTick(m), 250);
  }

  // 先に読む：2回押しを防ぐ（試10）。退場の選手を選んでいる間にほかを押したら、退場をやめる（試9）
  root.addEventListener('click', (e) => {
    const el = e.target.closest('[data-p],[data-b],[data-empty],[data-cont],button,a');
    if (!el) return;
    const k = el.dataset.p != null ? 'p' + el.dataset.p : el.dataset.b != null ? 'b' + el.dataset.b : el.dataset.empty != null ? 'e' + el.dataset.empty
      : el.dataset.cont != null ? 'c' + el.dataset.cont : el.id ? '#' + el.id : null;
    const now = Date.now();
    if (k && lastTap.k === k && now - lastTap.t < 300) { e.stopPropagation(); e.preventDefault(); return; }
    lastTap = { k, t: now };
    if (ejectMode && el.dataset.p == null && el.id !== 'btnEj' && el.id !== 'btnEjCancel') {
      ejectMode = false;
      if (el.matches('button[id], a')) { setTimeout(rerender, 0); return; } // ボタンはそのまま動かす（ストップなど）
      e.stopPropagation(); toast('退場をやめました'); rerender();
    }
  }, true);

  root.addEventListener('click', async (e) => {
    const pc = e.target.closest('[data-p]');
    const bc = e.target.closest('[data-b]');
    const ct = e.target.closest('[data-cont]');
    if (ct) {
      e.stopPropagation();
      const pid = ct.dataset.cont;
      if (await confirmBox({ title: `${playerName(playerById(pid))} の連続出場タイマーを0:00からにしますか？`, body: '<p>セットプレー前の時間の続きではなく、次に入ったときに0:00から数えます。</p>', ok: '0:00からにする' })) send({ type: 'contReset', pid });
      return;
    }
    const ec = e.target.closest('[data-empty]');
    if (ec) { // 補充：空席を押す → （2分前は確認）→ ベンチの選手を押す
      const seat = Number(ec.dataset.empty); const emp = st.empty[seat]; if (!emp) return;
      if (fillSeat && fillSeat.seat === seat) { fillSeat = null; rerender(); return; }
      if (ejectLeft(emp, nowElapsed(st)) > 0) {
        if (!(await confirmBox({ title: '2分経過前です。失点による補充ですか？', body: '<p>補充のタイミングは審判が決めます。失点による補充なら「補充する」を押し、続けてベンチから入る選手を押してください。</p>', ok: '補充する' }))) return;
        fillSeat = { seat, afterGoal: true };
      } else fillSeat = { seat, afterGoal: false };
      rerender(); return;
    }
    if (pc) {
      const pid = pc.dataset.p, kind = pc.dataset.kind;
      if (kind === 'draft') { setDraft(m, st.current, draft.map((x) => (x === pid ? null : x))); rerender(); return; } // 枠は空欄のまま
      if (ejectMode) {
        ejectMode = false;
        // 仮に入っている選手はまだピッチに入っていないので、退場にできない（記録にならない操作を残さない。試9）
        if (kind === 'tent') { toast('仮に入っている選手は、まだピッチに入っていないので退場にできません'); rerender(); return; }
        if (await confirmBox({ title: `${m.members[pid]?.no} ${playerName(playerById(pid))} を退場にしますか？`, body: '<p>その枠は空席になり、補充まで2:00を数えます。</p>', ok: '退場にする', danger: true })) send({ type: 'eject', pid });
        else rerender();
        return;
      }
      if (kind === 'waiting') { send({ type: 'in', pid }); return; } // OUTの取り消し
      send({ type: 'out', pid }); return;
    }
    if (bc) {
      const pid = bc.dataset.b;
      if (!live) {
        if (st.matchOver || st.askExtra) return;
        if (draft.includes(pid)) return;
        const isG = (x) => m.members?.[x]?.pos === 'GK';
        if (isG(pid) && draft.some((x) => x && isG(x))) { toast('GKは1人までです。ピッチのGKを押すとベンチに戻せます'); return; }
        const slot = slotFor(m, draft, pid);
        if (slot == null) { toast('先発は5人です。ピッチの選手を押すとベンチに戻せます'); return; }
        const next = [...draft]; next[slot] = pid; setDraft(m, st.current, next); rerender(); return;
      }
      if (st.batch.outs.some((o) => o.pid === pid)) { send({ type: 'in', pid }); return; } // 取り消し
      const isG = (x) => m.members?.[x]?.pos === 'GK';
      if (fillSeat && st.empty[fillSeat.seat]) { // 空席を押したあとなら、交代待ちがあっても押した空席に入る
        if (isG(pid) && (st.seats.some((x) => x && isG(x)) || st.batch.ins.some(isG))) { toast('GKはピッチに1人までです。先にピッチのGKを押してください'); return; }
        const f = fillSeat; fillSeat = null;
        send({ type: 'in', pid, seat: f.seat, ...(f.afterGoal ? { afterGoal: true } : {}) }); return;
      }
      { // GKはピッチに1人まで（交代で出るGKの代わりなら入れる）
        const outIds = new Set(st.batch.outs.map((o) => o.pid));
        if (isG(pid) && st.seats.filter((x) => x && !outIds.has(x) && isG(x)).length + st.batch.ins.filter(isG).length >= 1) {
          toast('GKはピッチに1人までです。先にピッチのGKを押してください'); return;
        }
      }
      if (st.batch.outs.length > st.batch.ins.length) { send({ type: 'in', pid }); return; }
      if (st.empty.some((x) => x)) { toast('交代はピッチの選手を、補充は空席を先に押してください'); return; }
      toast('先に交代する選手のOUTを押してください');
    }
  });

  const on = (id, fn) => { const b = $('#' + id, root.parentNode || document); b && (b.onclick = fn); };
  on('btnStart', () => {
    if (!live) {
      const need = 5 - (st.periods[st.current].status === 'none' ? ejectCarryIn(st).length : 0);
      if (filled(draft) < need) return toast(need < 5 ? `先発の${need}人以上を選んでください` : '先発の5人を選んでください');
      // ピリオドの長さとセットプレーの自動終了は、キックオフのときの設定を記録に残す（足1）
      if (send({ type: 'kickoff', lineup: draft, len: perLen(st, st.current), spAuto: cfg.setplayAuto })) setDraft(m, st.current, []);
    } else send({ type: 'start' });
  });
  on('btnStop', () => send({ type: 'stop' }));
  on('btnUndo', () => {
    const op = st.lastUndoable; if (!op) return;
    if (!send({ type: 'undo' })) return;
    autoStopFor = null; // 0:00の自動停止を取り消したときは、もう一度止めて確認する（試7）
    toast('取り消しました：' + describeOp(op, (pid) => `${m.members[pid]?.no ?? ''}番`));
  });
  on('btnSp', () => send({ type: setplayOn(st, nowElapsed(st)) ? 'setplayEnd' : 'setplay' }));
  on('btnEj', () => { ejectMode = true; fillSeat = null; rerender(); });
  on('btnEjCancel', () => { ejectMode = false; rerender(); });
  on('btnFillCancel', () => { fillSeat = null; rerender(); });
  on('btnTake', () => put(teamPath('matches', m.id), { live: { dev: deviceId(), ms: Date.now(), name: devName() } }));
  on('btnExtraYes', () => send({ type: 'extra', yes: true }));
  on('btnExtraNo', () => send({ type: 'extra', yes: false }));
  on('btnAdj', () => adjustModal(m, st, cfg, send));
  on('btnTO', () => timeoutModal(st, send));
  on('btnPP', () => {
    if (st.ppActive) { send({ type: 'ppEnd' }); return; }
    const md = openModal(`<h2>パワープレー開始</h2><div class="mbody"><p class="mu">5x4の時間帯を記録します。終わったら「5x4 終了」を押してください（ピリオドの終了でも終わります）。</p>
      <div class="row"><button class="btn pri" data-t="own">自チーム</button><button class="btn pri" data-t="opp">相手チーム</button></div></div>
      <div class="mfoot"><button class="btn" data-c>やめる</button></div>`);
    md.querySelector('[data-c]').onclick = closeModal;
    md.addEventListener('click', (e) => { const b = e.target.closest('[data-t]'); if (b) { closeModal(); send({ type: 'pp', team: b.dataset.t }); } });
  });
  const endQ = async () => {
    if (await confirmBox({ title: `${periodLabel(st.current)}を終了しますか？`, body: endBody(st), ok: '終了する' })) send({ type: 'periodEnd' });
  };
  on('btnEnd', endQ); on('btnEnd2', endQ);
  on('btnPer', () => periodModal(st, send));
  on('btnReset', () => resetModal(m, st, send));
}
export function devName() {
  try { const n = localStorage.getItem('fpt.deviceName'); if (n) return n; } catch {}
  return /iPad|Macintosh.*Mobile|Macintosh(?!.*Chrome).*Safari/.test(navigator.userAgent) && 'ontouchend' in document ? 'iPad' : 'PC';
}
function rerender() { render(); }

// The match status shown everywhere (準備中 → 試合中 → 未入力あり/記録完了). ①②の段階ではイベントがないので終了＝記録完了。
function syncStatus(m, st) {
  const any = PERIODS.some((p) => st.periods[p.key].status !== 'none');
  const want = st.matchOver ? 'done' : any ? 'playing' : 'prep';
  if (m.status !== want) put(teamPath('matches', m.id), { status: want, ...(want === 'done' ? { endedAt: srvNow() } : {}) });
}

// ---------- every 250ms: clock and times, auto stop at 0:00 ----------
function updateTick(m0) {
  const m = matchById(m0.id); if (!m || !location.hash.endsWith('/play')) { unmountPlay(); return; }
  const cfg = cfgOf(m);
  const st = replay(watchOps(m.id).list, cfg);
  const per = st.periods[st.current];
  if (per.status !== 'live') return;
  const len = perLen(st, st.current);
  const t = Date.now();
  const el = nowElapsed(st, t);
  const clock = $('#clock'); if (clock) clock.textContent = mmss(len - el);
  // 0:00の自動停止は、記録しているこの端末だけ（見るだけの端末は記録しない）
  if (per.runningSince != null && el >= len && autoStopFor !== per.runningSince && !otherDevice(m)) {
    // 0:00 → 時計を自動で止め、「ピリオドを終了しますか？」(spec 4章)
    autoStopFor = per.runningSince;
    const stopT = per.runningSince + (len - per.elapsed);
    addOp(m.id, { type: 'stop', period: st.current, t: stopT }); // exact moment the clock reached 0:00
    confirmBox({ title: `${periodLabel(st.current)}を終了しますか？`, body: endBody(st, '<p>時計が0:00になりました。公式の時計がまだ残っている場合は「いいえ」を押し、「時刻合わせ」でスコアボードの残り時間に合わせてから続けてください。</p>'), ok: 'はい（終了する）', cancel: 'いいえ' })
      .then((yes) => {
        if (!yes) return;
        const mm = matchById(m.id) || m; const c2 = cfgOf(mm);
        const before = replay(watchOps(m.id).list, c2);
        // 確認の間に「1つ戻す」などで状態が変わっていたら終了しない（時間になりましたの表示から終了できる）
        if (before.current !== st.current || before.periods[st.current].status !== 'live' || before.periods[st.current].runningSince != null || otherDevice(mm)) return;
        addOp(m.id, { type: 'periodEnd', period: st.current }); afterOp(mm, c2, before);
      });
    return;
  }
  const view = seatView(st, el);
  const ct = m.colorTimer || { orange: 120, red: 180 };
  view.forEach((v) => {
    if (!v.pid) return;
    const e = document.querySelector(`[data-ct="${CSS.escape(v.pid)}"]`);
    if (e) {
      const c = contTime(st, v.pid, el, v);
      e.textContent = mmssFloor(c);
      const gk = m.members[v.pid]?.pos === 'GK';
      e.className = 'ct ' + (gk ? '' : c >= ct.red * 1000 ? 'red' : c >= ct.orange * 1000 ? 'orange' : '');
    }
  });
  Object.keys(m.members || {}).forEach((pid) => {
    const at = frozenAt(st, pid, el);
    const a = document.querySelector(`[data-pt="${CSS.escape(pid)}"]`); if (a) a.textContent = mmssFloor(playerPeriodTime(st, pid, st.current, at));
    const b = document.querySelector(`[data-mt="${CSS.escape(pid)}"]`); if (b) b.textContent = mmssFloor(playerMatchTime(st, pid, at));
    const r = document.querySelector(`[data-rest="${CSS.escape(pid)}"]`); if (r) { const x = restTime(st, pid, el); r.textContent = x == null ? '—' : mmssFloor(x); }
  });
  let needRerender = false;
  st.empty.forEach((e, i) => {
    if (!e) return;
    const left = ejectLeft(e, el);
    if (left <= 0) {
      // 2分経過：知らせて表示を切り替える（見出しの行を緑に、空席のカードを光らせる、画面下に知らせ）
      const key = `${m.id}|${st.current}|${i}|${e.from}`;
      if (!fillReadyShown.has(key)) { fillReadyShown.add(key); toast(`${playerName(playerById(e.pid))}の空席に補充できます。空席を押して、入る選手を選んでください`); }
      if (document.querySelector(`[data-ej="${i}"]`)) needRerender = true;
      return;
    }
    const w = document.querySelector(`[data-ej="${i}"]`); if (w) w.textContent = `補充まで ${mmss(left)}`;
    const c = document.querySelector(`[data-ejc="${i}"]`); if (c) c.textContent = `退場：${playerName(playerById(e.pid))}　補充まで ${mmss(left)}（失点で補充するときは、空席を押す）`;
  });
  if (needRerender) rerender();
  // セットプレーの自動終了：時間になったら1回だけ描き直す（描き直したあとは表示が消えるので、続けて描き直さない。試2）
  const sp = $('#spChip');
  if (sp) { const l = setplayLeft(st, el); if (!setplayOn(st, el)) rerender(); else sp.textContent = `セットプレー中（自動終了まで ${mmss(l)}）`; }
}

// ---------- modals ----------
function adjustModal(m, st, cfg, send) {
  // 時刻合わせ：「:」は常に表示。数字のボタンで右から入れる（1→4→5→0 で 14:50）。±ボタンで数秒だけ直せる。iPadのキーボードは使わない
  const len = perLen(st, st.current);
  const nowRem = () => Math.max(0, Math.ceil((len - nowElapsed(st)) / 1000));
  const md = openModal(`<div class="adjm"><h2>時刻合わせ</h2><p class="mu">スコアボードと同じ残り時間にして「決定」を押してください。</p>
    ${keypadHTML()}<div class="mfoot"><button class="btn" data-c>やめる</button><button class="btn pri" data-s>決定</button></div></div>`);
  const ok = () => {
    const v = kp.value(); if (!v.ok) return toast(v.msg);
    close(); send({ type: 'adjust', elapsed: len - v.sec * 1000 }); toast(`残り ${mmss(v.sec * 1000)} に合わせました`);
  };
  // 時計が動いている間は、どれかのボタンを押すまで今の残り時間のまま動かし続け、±は押したときの残り時間に足す（試4）
  const kp = bindKeypad(md, { init: nowRem(), min: 0, max: len / 1000, onEnter: ok, live: nowRem });
  const showNow = () => { kp.refresh(); kp.note(`今のアプリの残り時間 <span id="adjNow">${mmss(nowRem() * 1000)}</span>`); };
  showNow();
  const nowTimer = setInterval(() => { if (!document.body.contains(md)) { clearInterval(nowTimer); return; } showNow(); }, 250);
  const close = () => { clearInterval(nowTimer); closeModal(); };
  md.querySelector('[data-c]').onclick = close;
  md.querySelector('[data-s]').onclick = ok;
}
function timeoutModal(st, send) {
  const used = (tm) => st.timeouts.some((x) => x.period === st.current && x.team === tm);
  const md = openModal(`<h2>タイムアウト</h2><div class="mbody"><p class="mu">前半・後半とも各チーム1回まで。時計は動かしません（必要ならストップを押してください）。</p>
    <div class="row"><button class="btn pri" data-t="own" ${used('own') ? 'disabled' : ''}>自チーム${used('own') ? '（済）' : ''}</button>
    <button class="btn pri" data-t="opp" ${used('opp') ? 'disabled' : ''}>相手チーム${used('opp') ? '（済）' : ''}</button></div></div>
    <div class="mfoot"><button class="btn" data-c>やめる</button></div>`);
  md.querySelector('[data-c]').onclick = closeModal;
  md.addEventListener('click', (e) => { const b = e.target.closest('[data-t]'); if (b && !b.disabled) { closeModal(); send({ type: 'timeout', team: b.dataset.t }); toast(`タイムアウト（${b.dataset.t === 'own' ? '自チーム' : '相手'}）を記録しました`); } });
}
function periodModal(st, send) {
  const live = st.periods[st.current].status === 'live';
  const list = PERIODS.filter((p) => !p.extra || st.extraDecided || st.cfg.times?.extra);
  const md = openModal(`<h2>記録するピリオド</h2><div class="mbody"><p class="mu">記録がないピリオドだけ選べます。記録があるピリオドをやり直すときは「リセット」を使ってください。</p>
    <div class="col">${list.map((p) => { const s = st.periods[p.key].status; const can = s === 'none' && !live; return `<button class="btn ${p.key === st.current ? 'pri' : ''}" data-k="${p.key}" ${can ? '' : 'disabled'}>${p.label}${s === 'done' ? '（記録あり）' : s === 'live' ? '（記録中）' : ''}</button>`; }).join('')}</div></div>
    <div class="mfoot"><button class="btn" data-c>閉じる</button></div>`);
  md.querySelector('[data-c]').onclick = closeModal;
  md.addEventListener('click', (e) => { const b = e.target.closest('[data-k]'); if (b && !b.disabled) { closeModal(); send({ type: 'select', to: b.dataset.k }); } });
}
function resetModal(m, st, send) {
  // ピリオドの記録中は、そのピリオドか試合全体だけ（記録中のピリオドを止めずにほかのピリオドを消さない。試1）
  const live = st.periods[st.current].status === 'live';
  const rec = PERIODS.filter((p) => st.periods[p.key].status !== 'none' && (!live || p.key === st.current));
  if (!rec.length) { toast('まだ記録がありません'); return; }
  const md = openModal(`<h2>リセット（ピリオドを選んでやり直す）</h2><div class="mbody">
    <p class="mu">消えるのは、選んだピリオドの交代・時計・退場の記録と先発の5人です。ほかのピリオドの記録は残ります。やり直した直後なら「1つ戻す」で元に戻せます。</p>
    ${live ? `<p class="mu">${periodLabel(st.current)}の記録中は、${periodLabel(st.current)}か試合全体だけをリセットできます。ほかのピリオドは、${periodLabel(st.current)}が終わってから選べます。</p>` : ''}
    <div class="col">${rec.map((p) => `<button class="btn ${p.key === st.current ? 'pri' : ''}" data-k="${p.key}">${p.label}</button>`).join('')}
    <button class="btn dangerline" data-k="all">試合全体（すべてのピリオド）</button></div></div>
    <div class="mfoot"><button class="btn" data-c>やめる</button></div>`);
  md.querySelector('[data-c]').onclick = closeModal;
  md.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-k]'); if (!b) return;
    const k = b.dataset.k; closeModal();
    const label = k === 'all' ? '試合全体' : periodLabel(k);
    const ok = await confirmTwice(
      { title: `${label}をリセットしますか？`, body: `<p>${label}の交代・時計・退場の記録が消え、開始前の状態に戻ります。</p>`, ok: 'リセットする', danger: true },
      { title: '本当にリセットしますか？', body: '<p>やり直した直後なら「1つ戻す」で元に戻せます。</p>', ok: 'リセットする', danger: true });
    if (ok) { send({ type: 'reset', scope: k }); toast(`${label}をリセットしました`); }
  });
}
