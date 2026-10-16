// Sportscode（XML）の書き出し画面（試合ページ）。XML を作るのは sportscode.js
import { S, watchOps, watchEvents, opts, teamSettings, playerById, put, teamPath } from './store.js';
import { replay } from './engine.js';
import { matchModel, toRunning, periodSig } from './model.js';
import { esc, toast } from './ui.js';
import { render } from './views.js';
import { buildXML, DEFAULT_LEAD, LEAD_LABEL } from './sportscode.js';
import { OPP_OG, UNKNOWN } from './events.js';

// ---------- 画面（試合ページ「Sportscode（XML）」） ----------

const LKEY = 'fpt.scLead';
const loadLead = () => { try { return { ...DEFAULT_LEAD, ...JSON.parse(localStorage.getItem(LKEY) || '{}') }; } catch { return { ...DEFAULT_LEAD }; } };
const parseT = (v) => { const s = String(v ?? '').trim(); if (!s) return null; const m = s.match(/^(\d+):(\d{1,2}(?:\.\d+)?)$/); if (m) return +m[1] * 60 + +m[2]; return Number.isFinite(+s) ? +s : null; };
const fmtT = (sec) => (sec == null ? '' : `${Math.floor(sec / 60)}:${(sec % 60).toFixed(1).padStart(4, '0')}`);
let opt = { players: true, events: true };

export function vSportscode(m) {
  const opsC = watchOps(m.id); const evC = watchEvents(m.id);
  if (!opsC.ready && !opsC.list.length) return { active: 'acts', html: '<p class="mu pad">読み込み中…</p>' };
  const cfg = { times: m.times || {}, members: m.members || {}, setplayAuto: teamSettings().setplayAuto || 60 };
  const st = replay(opsC.list, cfg); st.sig = periodSig(opsC.list);
  const M = matchModel(st, Date.now(), m.fix); const R = toRunning(M, st);
  const gn = (id) => opts('goalTypes', true).find((o) => o.id === id)?.name || '';
  const evs = evC.list.filter((e) => !e.deleted);
  const ko = m.scKO || {}; const shift = m.scShift || {};
  const lead = loadLead();
  const ps = R.periods.filter((p) => p.status !== 'none' && st.periods[p.key]?.kickT != null);
  const name = (pid) => { const p = playerById(pid); return p ? `${p.last} ${p.first || ''}`.trim() : ''; };
  const rel = (k, at) => R.relOf(k, at);
  const cards = ps.map((p, i) => {
    const k0 = ko[p.key]; const prev = ps[i - 1];
    const goals = evs.filter((e) => e.period === p.key && (e.kind === 'goal' || e.kind === 'conc')).sort((a, b) => a.at - b.at);
    const vt = (e) => (k0 == null ? '—' : fmtT(+k0 + (+shift[p.key] || 0) + rel(p.key, e.at) / 1000));
    const gt = goals.length ? `<table class="sctb"><tr><th>得点・失点</th><th>試合の時計（経過）</th><th>動画の時刻</th></tr>${goals.map((e) => `<tr><td class="${e.kind === 'goal' ? 'w' : 'o'}">${e.kind === 'goal' ? '得点' : '失点'}${e.kind === 'goal' && e.pid && e.pid !== OPP_OG && e.pid !== UNKNOWN ? '（' + esc(name(e.pid)) + '）' : ''}</td><td>${fmtT(e.at / 1000).replace(/\.0$/, '')}</td><td><b>${vt(e)}</b></td></tr>`).join('')}</table><p class="mu sm">動画のこの時刻にゴールの場面があるか確かめてください。ずれているときは「全体をずらす」で直します</p>` : '<p class="mu sm">このピリオドに得点・失点はありません（動画の時刻を確かめるときは、キックオフの位置を見直してください）</p>';
    return `<div class="card sccard"><h3>${p.label}<small>実際の長さ ${fmtT(p.elapsed / 1000).replace(/\.\d$/, '')}（キックオフから時計が0:00になるまで）</small></h3>
      <div class="scrow"><label>動画上のキックオフの位置<input data-ko="${p.key}" value="${fmtT(k0)}" placeholder="例 2:04.5"></label>
        <label>全体をずらす（秒）<input data-shift="${p.key}" value="${shift[p.key] ?? ''}" placeholder="0" inputmode="decimal"></label>
        ${prev ? `<button class="btn sm" data-follow="${p.key}" title="ハーフタイムをカットして、前のピリオドのすぐあとに続く1本の動画のとき">${prev.label}のすぐあとに続く</button>` : ''}
        <span class="sp"></span><button class="btn pri" data-dl="${p.key}" ${k0 == null ? 'disabled' : ''}>${p.label}のXMLを書き出す</button></div>${gt}</div>`;
  }).join('');
  const leadT = `<table class="sctb"><tr><th>コード</th><th>イベントの何秒前から</th><th>何秒後まで</th></tr>${Object.keys(DEFAULT_LEAD).map((k) => `<tr><td>${LEAD_LABEL[k]}</td><td><input data-lead="${k}:0" value="${lead[k][0]}" inputmode="decimal"></td><td><input data-lead="${k}:1" value="${lead[k][1]}" inputmode="decimal"></td></tr>`).join('')}</table>`;
  const html = `<div class="crumb"><a class="btn sm mpback" href="#/m/${m.id}">‹ 試合ページ</a><a href="#/m/${m.id}">vs ${esc(m.opponent)}</a> › Sportscode（XML）</div>
    <h1>Sportscode（XML）の書き出し</h1>
    <p class="mu">動画上のキックオフの位置を入れると、MATCH PLAYの実際の時刻から動画の時刻を計算して、ピリオドごとのXMLを書き出します（前半・後半は別のファイル）。動画はハーフタイムをカットしている前提です。</p>
    <div class="card"><div class="scrow"><label class="ck"><input type="checkbox" id="scP" ${opt.players ? 'checked' : ''}>出場の帯（#背番号の行。時計が動いていた区間ごと）</label>
      <label class="ck"><input type="checkbox" id="scE" ${opt.events ? 'checked' : ''}>イベント（今のコードウィンドウと同じコード名：シュート、ゾーン4進入、SETPLAY AT、ROBO、ファウルなど）${evs.length ? `　${evs.length}件` : '　（まだありません）'}</label></div></div>
    ${ps.length ? cards : '<div class="card empty">キックオフを押したピリオドがありません</div>'}
    <details class="card"><summary><b>イベントの長さ（コードごとの前後の秒数）</b>　今のコーディングと同じ長さにします</summary>${leadT}<p class="mu sm">この端末で覚えます。イベントの時刻は試合の時計（1秒単位）から求めるので、時計が止まっている間に起きたイベント（ボールが外に出た直後など）は、動画とずれることがあります。シュートなどは時計が止まった瞬間、SETPLAY は再開の瞬間に合わせています</p></details>`;
  return {
    active: 'acts', html: `<div class="scw">${html}</div>`,
    bind: (root) => {
      root.querySelector('#scP').onchange = (e) => { opt.players = e.target.checked; };
      root.querySelector('#scE').onchange = (e) => { opt.events = e.target.checked; };
      root.querySelectorAll('[data-ko]').forEach((i) => i.onchange = () => { const v = parseT(i.value); if (i.value.trim() && v == null) { toast('「2:04.5」か「124.5」の形で入れてください'); return; } put(teamPath('matches', m.id), { scKO: { ...ko, [i.dataset.ko]: v } }); m.scKO = { ...ko, [i.dataset.ko]: v }; render(); });
      root.querySelectorAll('[data-shift]').forEach((i) => i.onchange = () => { const v = i.value.trim() === '' ? null : +i.value; if (v != null && !Number.isFinite(v)) return; put(teamPath('matches', m.id), { scShift: { ...shift, [i.dataset.shift]: v } }); m.scShift = { ...shift, [i.dataset.shift]: v }; render(); });
      root.querySelectorAll('[data-follow]').forEach((b) => b.onclick = () => {
        const i = ps.findIndex((p) => p.key === b.dataset.follow); const prev = ps[i - 1];
        if (ko[prev.key] == null) { toast(`先に${prev.label}のキックオフの位置を入れてください`); return; }
        const v = +(ko[prev.key] + prev.elapsed / 1000).toFixed(3);
        put(teamPath('matches', m.id), { scKO: { ...ko, [b.dataset.follow]: v } }); m.scKO = { ...ko, [b.dataset.follow]: v }; render();
      });
      root.querySelectorAll('[data-lead]').forEach((i) => i.onchange = () => { const [k, j] = i.dataset.lead.split(':'); const L = loadLead(); L[k] = [...L[k]]; L[k][+j] = +i.value || 0; try { localStorage.setItem(LKEY, JSON.stringify(L)); } catch {} });
      root.querySelectorAll('[data-dl]').forEach((b) => b.onclick = () => {
        const k = b.dataset.dl; const p = ps.find((x) => x.key === k);
        const r = buildXML({ M, R, st, members: m.members || {}, events: evs, goalName: gn, key: k, ko: ko[k], shift: shift[k], lead: loadLead(), name, withPlayers: opt.players, withEvents: opt.events });
        const blob = new Blob([r.xml], { type: 'application/xml' });
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
        a.download = `vs${m.opponent || ''}_${p.label}_${(m.date || '').replace(/-/g, '')}.xml`; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
        toast(`${p.label}のXMLを書き出しました（出場の帯 ${r.players}本・イベント ${r.events}件）`);
      });
    },
  };
}
