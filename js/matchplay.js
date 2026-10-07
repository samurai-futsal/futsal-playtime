// MATCH PLAY — the iPad screen used on the bench during the match (spec 11章).
import { S as D, matchById, playerById, playerName, put, teamPath, watchOps, addOp, deviceId, now as srvNow } from './store.js';
import {
  replay, nowElapsed, periodLen, PERIODS, periodLabel, seatView, contTime, restTime, playerPeriodTime,
  playerMatchTime, playerCounts, setplayLeft, describeOp, EJECT_WAIT,
} from './engine.js';
import { $, $$, esc, openModal, closeModal, confirmBox, confirmTwice, toast } from './ui.js';
import { render } from './views.js';

let tick = null, wakeLock = null, heartbeat = null, mountedId = null, ejectMode = false, autoStopFor = null, lastPpAuto = 0;
const mmss = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const mmssFloor = (ms) => { const s = Math.max(0, Math.floor(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

export function unmountPlay() {
  clearInterval(tick); tick = null; clearInterval(heartbeat); heartbeat = null; mountedId = null; ejectMode = false;
  try { wakeLock?.release(); } catch {} wakeLock = null;
  document.removeEventListener('visibilitychange', onVis);
  document.body.classList.remove('playmode');
}
function onVis() { if (!document.hidden) keepAwake(); }
async function keepAwake() { try { if ('wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen'); } catch {} }

function cfgOf(m) {
  return { times: m.times || {}, members: m.members || {}, setplayAuto: (D.team?.settings?.setplayAuto) || 60 };
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
  const len = periodLen(cfg, st.current);
  const t = Date.now();
  const el = nowElapsed(st, t);
  const running = per.runningSince != null;
  const members = Object.entries(m.members || {}).map(([pid, v]) => ({ pid, ...v, p: playerById(pid) }))
    .sort((a, b) => (a.pos === 'GK') - (b.pos === 'GK') || (parseInt(a.no, 10) || 999) - (parseInt(b.no, 10) || 999));
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
    // 見出しを小さく上、時間を大きく、回数を下。休憩だけは「休憩 0:00」と横並び（0.3.5）
    const col = (label, attr, v, cnt) => `<div class="sc"><span class="sl">${label}</span><b class="sv" ${attr}="${pid}">${v}</b><span class="sn">${cnt}回</span></div>`;
    return `<div class="pst">${col('ピリオド', 'data-pt', mmssFloor(playerPeriodTime(st, pid, st.current, el)), pc.period)}${col('試合', 'data-mt', mmssFloor(playerMatchTime(st, pid, el)), pc.match)}${rest !== undefined ? `<div class="sr"><span class="sl">休憩</span><b class="sv" data-rest="${pid}">${rest == null ? '—' : mmssFloor(rest)}</b></div>` : ''}</div>`;
  };
  const pitchCard = (v) => {
    if (!v.pid) {
      if (v.empty) {
        const left = EJECT_WAIT - (el - v.empty.from);
        return `<div class="pc empty" data-seat="${v.seat}"><div class="emp">空席</div><div class="mu">退場：${esc(playerName(playerById(v.empty.pid)))}</div>
          <div class="ejw" data-ej="${v.seat}">${left > 0 ? `補充まで ${mmss(left)}` : '<b>補充できます</b>（ベンチの選手を押す）'}</div></div>`;
      }
      return `<div class="pc emptyd" data-seat="${v.seat}"><div class="emp">${live ? '' : '先発を選ぶ'}</div><div class="mu">${live ? '' : 'ベンチの選手を押す'}</div></div>`;
    }
    const p = playerById(v.pid); const mm = m.members[v.pid] || {};
    const c = live ? contTime(st, v.pid, el, v) : 0;
    const col = mm.pos === 'GK' ? '' : c >= ct.red * 1000 ? 'red' : c >= ct.orange * 1000 ? 'orange' : '';
    return `<button class="pc ${v.waiting ? 'waiting' : ''} ${v.tentative ? 'tent' : ''} ${ejectMode ? 'ejpick' : ''}" data-p="${v.pid}" data-kind="${v.waiting ? 'waiting' : v.tentative ? 'tent' : v.draft ? 'draft' : 'on'}">
      ${nameRow(v.pid, p?.last)}
      ${v.waiting ? `<div class="wt">交代待ち（OUT ${mmss(len - v.outAt)}）</div>` : `<div class="ct ${col}" data-ct="${v.pid}">${mmssFloor(c)}</div>`}
      ${stats(v.pid)}</button>`;
  };
  const benchCard = (mb) => {
    const pid = mb.pid;
    if (onPitch.has(pid)) return `<div class="bc ghost"><span class="gx"><b>${esc(mb.no ?? '')}</b>出場中</span></div>`;
    const ej = st.ejected.has(pid);
    const waitingOut = replacedOuts.includes(pid);
    const carry = st.carry[pid];
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
  if (ejectMode) banner.push('<div class="pbanner red">退場する選手をピッチから押してください <button class="btn sm" id="btnEjCancel">やめる</button></div>');

  return {
    full: true,
    html: `<div class="play">
    <div class="ptop">
      <div class="pl">
        <a class="cb back" href="#/m/${m.id}">‹ 試合ページ</a>
        <button class="cb per" id="btnPer">${periodLabel(st.current)} ▾</button>
      </div>
      <div class="clockbox">
        <div class="clock ${running ? 'run' : ''}" id="clock">${mmss(len - el)}</div>
        <div class="row">
          <span class="stchip ${running ? 'on' : ''}">${stateMsg}</span>
          <a class="stchip rv" href="#/soon/${encodeURIComponent('マッチレビュー')}">マッチレビュー ›</a>
        </div>
      </div>
      <div class="cbs">
        ${btn('btnAdj', '時刻合わせ', '', '', !live)}
        ${btn('btnSp', st.setplay ? 'セットプレー終了' : 'セットプレー', '', st.setplay ? 'on' : '', !live)}
        ${btn('btnEj', '退場', '', '', !live)}
        ${btn('btnUndo', '↶ 1つ戻す', '', '', !st.lastUndoable)}
        ${btn('btnTO', 'タイムアウト', isExtra ? '延長は不可' : `自 残${1 - ownTO}・相手 残${1 - oppTO}`, 'teal', !live || isExtra)}
        ${btn('btnPP', ppLabel, st.ppActive ? '' : '自／相手を選ぶ', 'amber', !live)}
        ${btn('btnEnd', 'ピリオド終了', '', 'purple', !live)}
        ${btn('btnReset', 'リセット', '', 'reset')}
      </div>
      <div class="ss">
        <button class="big start" id="btnStart" ${running || st.matchOver || st.askExtra || (!live && filled(draft) !== 5) || (live && el >= len) ? 'disabled' : ''}>▶<span>スタート</span></button>
        <button class="big stop" id="btnStop" ${!running ? 'disabled' : ''}>❚❚<span>ストップ</span></button>
      </div>
    </div>
    ${banner.join('')}
    ${st.matchOver ? `<div class="pbanner done">試合が終わりました。お疲れさまでした。<a class="btn sm" href="#/m/${m.id}">試合ページへ</a></div>` : ''}
    ${st.askExtra ? `<div class="pbanner">後半が終わりました。延長戦を行いますか？ <button class="btn sm pri" id="btnExtraYes">延長戦を行う</button><button class="btn sm" id="btnExtraNo">行わない（試合終了）</button></div>` : ''}
    <div class="plabel st"><span>ピッチ</span><div class="stmid">
      ${st.ppActive ? `<span class="stchip pp ${t - lastPpAuto < 4000 ? 'flash' : ''}">5×4（パワープレー）${st.ppActive.team === 'own' ? '自チーム' : '相手チーム'}</span>` : ''}
      ${st.setplay ? `<span class="stchip sp" id="spChip">セットプレー中（自動終了まで ${mmss(setplayLeft(st, el))}）</span>` : ''}
    </div><span>${view.filter((v) => v.pid).length} / 5</span></div>
    <div class="pitch">${view.map(pitchCard).join('')}</div>
    <div class="plabel"><span>ベンチ（並びは固定）</span>${!live && !st.matchOver && !st.askExtra ? '<span>先発の5人を選んで「スタート」</span>' : ''}</div>
    <div class="bench" style="grid-template-columns:repeat(${cols},minmax(0,1fr));flex-grow:${Math.ceil(n / cols) * 0.8}">${members.map(benchCard).join('')}</div>
  </div>`,
    bind(root) { bindPlay(root, m, st, cfg, draft); },
  };
}

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
    const o = addOp(m.id, { ...op, period: st.current });
    const after = replay(watchOps(m.id).list, cfg);
    after.notices.forEach((nt) => {
      if (nt.kind === 'needOut') toast('先に交代する選手のOUTを押してください');
      if (nt.kind === 'noGK') toast('GKがピッチにいません');
      if (nt.kind === 'twoGK') toast('GKはピッチに1人までです。先にピッチのGKを押してください');
      if (nt.kind === 'ppAuto') { lastPpAuto = Date.now(); toast('5x4（自チームのパワープレー）を開始しました'); }
    });
    syncStatus(m, after);
    return o;
  };
  if (mountedId !== m.id) {
    unmountPlay(); mountedId = m.id;
    document.body.classList.add('playmode');
    keepAwake(); document.addEventListener('visibilitychange', onVis);
    const beat = () => put(teamPath('matches', m.id), { live: { dev: deviceId(), ms: Date.now(), name: devName() } });
    beat(); heartbeat = setInterval(beat, 30000);
    tick = setInterval(() => updateTick(m), 250);
  }

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
    if (pc) {
      const pid = pc.dataset.p, kind = pc.dataset.kind;
      if (kind === 'draft') { setDraft(m, st.current, draft.map((x) => (x === pid ? null : x))); rerender(); return; } // 枠は空欄のまま
      if (ejectMode) {
        ejectMode = false;
        if (await confirmBox({ title: `${m.members[pid]?.no} ${playerName(playerById(pid))} を退場にしますか？`, body: '<p>その枠は空席になり、補充まで2:00を数えます。自チームのレッドカードとして記録します（理由は試合後に選べます）。</p>', ok: '退場にする', danger: true })) send({ type: 'eject', pid });
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
      { // GKはピッチに1人まで（交代で出るGKの代わりなら入れる）
        const isG = (x) => m.members?.[x]?.pos === 'GK';
        const outIds = new Set(st.batch.outs.map((o) => o.pid));
        if (isG(pid) && st.seats.filter((x) => x && !outIds.has(x) && isG(x)).length + st.batch.ins.filter(isG).length >= 1) {
          toast('GKはピッチに1人までです。先にピッチのGKを押してください'); return;
        }
      }
      if (st.batch.outs.length > st.batch.ins.length) { send({ type: 'in', pid }); return; }
      const es = st.empty.findIndex((x) => x);
      if (es >= 0) {
        const el = nowElapsed(st);
        if (el - st.empty[es].from < EJECT_WAIT) {
          if (!(await confirmBox({ title: '2分経過前です。失点による補充ですか？', body: '<p>補充のタイミングは審判が決めます。失点による補充なら「補充する」を押してください。</p>', ok: '補充する' }))) return;
          send({ type: 'in', pid, afterGoal: true }); return;
        }
        send({ type: 'in', pid }); return;
      }
      toast('先に交代する選手のOUTを押してください');
    }
  });

  const on = (id, fn) => { const b = $('#' + id, root.parentNode || document); b && (b.onclick = fn); };
  on('btnStart', () => {
    if (!live) {
      if (filled(draft) !== 5) return toast('先発の5人を選んでください');
      send({ type: 'kickoff', lineup: draft }); setDraft(m, st.current, []);
    } else send({ type: 'start' });
  });
  on('btnStop', () => send({ type: 'stop' }));
  on('btnUndo', () => {
    const op = st.lastUndoable; if (!op) return;
    send({ type: 'undo' });
    toast('取り消しました：' + describeOp(op, (pid) => `${m.members[pid]?.no ?? ''}番`));
  });
  on('btnSp', () => send({ type: st.setplay ? 'setplayEnd' : 'setplay' }));
  on('btnEj', () => { ejectMode = true; rerender(); });
  on('btnEjCancel', () => { ejectMode = false; rerender(); });
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
  on('btnEnd', async () => {
    if (await confirmBox({ title: `${periodLabel(st.current)}を終了しますか？`, body: st.batch.outs.length ? '<p>交代待ちの選手がいます。入っていない分は、最後まで出場したものとして記録します。</p>' : '<p>間違えたときは「1つ戻す」で取り消せます。</p>', ok: '終了する' })) send({ type: 'periodEnd' });
  });
  on('btnPer', () => periodModal(st, send));
  on('btnReset', () => resetModal(m, st, send));
}
function devName() {
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
  const len = periodLen(cfg, st.current);
  const t = Date.now();
  const el = nowElapsed(st, t);
  const clock = $('#clock'); if (clock) clock.textContent = mmss(len - el);
  if (per.runningSince != null && el >= len && autoStopFor !== per.runningSince) {
    // 0:00 → 時計を自動で止め、「ピリオドを終了しますか？」(spec 4章)
    autoStopFor = per.runningSince;
    const stopT = per.runningSince + (len - per.elapsed);
    addOp(m.id, { type: 'stop', period: st.current, t: stopT }); // exact moment the clock reached 0:00
    confirmBox({ title: `${periodLabel(st.current)}を終了しますか？`, body: '<p>時計が0:00になりました。公式の時計がまだ残っている場合は「いいえ」を押し、「時刻合わせ」でスコアボードの残り時間に合わせてから続けてください。</p>', ok: 'はい（終了する）', cancel: 'いいえ' })
      .then((yes) => { if (yes) { addOp(m.id, { type: 'periodEnd', period: st.current }); syncStatus(m, replay(watchOps(m.id).list, cfg)); } });
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
    const a = document.querySelector(`[data-pt="${CSS.escape(pid)}"]`); if (a) a.textContent = mmssFloor(playerPeriodTime(st, pid, st.current, el));
    const b = document.querySelector(`[data-mt="${CSS.escape(pid)}"]`); if (b) b.textContent = mmssFloor(playerMatchTime(st, pid, el));
    const r = document.querySelector(`[data-rest="${CSS.escape(pid)}"]`); if (r) { const x = restTime(st, pid, el); r.textContent = x == null ? '—' : mmssFloor(x); }
  });
  st.empty.forEach((e, i) => {
    const w = document.querySelector(`[data-ej="${i}"]`); if (!w || !e) return;
    const left = EJECT_WAIT - (el - e.from);
    w.innerHTML = left > 0 ? `補充まで ${mmss(left)}` : '<b>補充できます</b>（ベンチの選手を押す）';
  });
  const sp = $('#spChip');
  if (sp) { const l = setplayLeft(st, el); if (l <= 0) rerender(); else sp.textContent = `セットプレー中（自動終了まで ${mmss(l)}）`; }
}

// ---------- modals ----------
function adjustModal(m, st, cfg, send) {
  const len = periodLen(cfg, st.current);
  let rem = Math.ceil((len - nowElapsed(st)) / 1000);
  const md = openModal(`<h2>時刻合わせ</h2><div class="mbody"><p class="mu">スコアボードと同じ残り時間に直して「決定」を押してください。</p>
    <div class="adj"><button class="btn" data-d="-1">－1秒</button><input id="adjIn" inputmode="numeric" value="${mmss(rem * 1000)}"><button class="btn" data-d="1">＋1秒</button></div></div>
    <div class="mfoot"><button class="btn" data-c>やめる</button><button class="btn pri" data-s>決定</button></div>`);
  const inp = $('#adjIn');
  const parse = () => { const mt = inp.value.trim().match(/^(\d{1,2})(?::?(\d{2}))?$/); if (!mt) return null; return mt[2] != null ? +mt[1] * 60 + +mt[2] : (inp.value.length > 2 ? Math.floor(+inp.value / 100) * 60 + (+inp.value % 100) : +mt[1] * 60); };
  md.addEventListener('click', (e) => {
    const d = e.target.closest('[data-d]'); if (!d) return;
    const v = parse(); if (v == null) return; rem = Math.max(0, Math.min(len / 1000, v + +d.dataset.d)); inp.value = mmss(rem * 1000);
  });
  md.querySelector('[data-c]').onclick = closeModal;
  md.querySelector('[data-s]').onclick = () => {
    const v = parse(); if (v == null || v > len / 1000) return toast(`0:00〜${mmss(len)} の範囲で入れてください`);
    closeModal(); send({ type: 'adjust', elapsed: len - v * 1000 }); toast(`残り ${mmss(v * 1000)} に合わせました`);
  };
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
  const rec = PERIODS.filter((p) => st.periods[p.key].status !== 'none');
  if (!rec.length) { toast('まだ記録がありません'); return; }
  const md = openModal(`<h2>リセット（ピリオドを選んでやり直す）</h2><div class="mbody">
    <p class="mu">消えるのは、選んだピリオドの交代・時計・退場の記録と先発の5人です。ほかのピリオドの記録は残ります。やり直した直後なら「1つ戻す」で元に戻せます。</p>
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
