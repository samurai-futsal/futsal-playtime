// Sportscode（XML）の書き出し画面（試合ページ）。XML を作るのは sportscode.js
import { S, watchOps, watchEvents, opts, teamSettings, playerById, put, teamPath } from './store.js';
import { replay } from './engine.js';
import { matchModel, toRunning, periodSig } from './model.js';
import { esc, toast } from './ui.js';
import { render } from './views.js';
import { buildXML, buildCSV, DEFAULT_LEAD, LEAD_LABEL } from './sportscode.js';
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
  const shift = {};
  const lead = loadLead();
  const ps = R.periods.filter((p) => p.status !== 'none' && st.periods[p.key]?.kickT != null);
  const name = (pid) => { const p = playerById(pid); return p ? `${p.last} ${p.first || ''}`.trim() : ''; };
  const rel = (k, at) => R.relOf(k, at);
  // 前半のキックオフを 0:00 とし、後半（延長も）は前のピリオドの終わりのすぐあとに続ける（2026-10-16 決定。細かい位置は Sportscode 側で合わせる）
  const ko = {}; { let t = 0; for (const p of ps) { ko[p.key] = +t.toFixed(3); t += p.elapsed / 1000; } }
  const cards = ps.map((p, i) => {
    const k0 = ko[p.key]; const prev = ps[i - 1];
    const goals = evs.filter((e) => e.period === p.key && (e.kind === 'goal' || e.kind === 'conc')).sort((a, b) => a.at - b.at);
    const vt = (e) => (k0 == null ? '—' : fmtT(+k0 + (+shift[p.key] || 0) + rel(p.key, e.at) / 1000));
    const gt = goals.length ? `<table class="sctb"><tr><th>得点・失点</th><th>試合の時計（経過）</th><th>XMLの時刻</th></tr>${goals.map((e) => `<tr><td class="${e.kind === 'goal' ? 'w' : 'o'}">${e.kind === 'goal' ? '得点' : '失点'}${e.kind === 'goal' && e.pid && e.pid !== OPP_OG && e.pid !== UNKNOWN ? '（' + esc(name(e.pid)) + '）' : ''}</td><td>${fmtT(e.at / 1000).replace(/\.0$/, '')}</td><td><b>${vt(e)}</b></td></tr>`).join('')}</table><p class="mu sm">XMLの時刻です。Sportscode でタイムラインを動画に合わせたあと、ゴールの場面と合っているかの確認に使えます</p>` : '<p class="mu sm">このピリオドに得点・失点はありません</p>';
    return `<div class="card sccard"><h3>${p.label}<small>実際の長さ ${fmtT(p.elapsed / 1000).replace(/\.\d$/, '')}（キックオフから時計が0:00になるまで）</small></h3>
      <div class="scrow"><span class="scpos">XMLの ${fmtT(k0).replace(/\.0$/, '')} ＝ ${p.label}のキックオフ${prev ? `（${prev.label}の終わりのすぐあと）` : ''}</span><span class="sp"></span><span class="scbtns"><button class="btn pri" data-dl="${p.key}" data-fmt="xml">${p.label}のXML</button><button class="btn" data-dl="${p.key}" data-fmt="csv">CSV（Sportscode用）</button><button class="btn" data-dl="${p.key}" data-fmt="xls">CSV（Excel用）</button></span></div></div>`;
  }).join('');
  const leadT = `<table class="sctb"><tr><th>コード</th><th>イベントの何秒前から</th><th>何秒後まで</th></tr>${Object.keys(DEFAULT_LEAD).map((k) => `<tr><td>${LEAD_LABEL[k]}</td><td><input data-lead="${k}:0" value="${lead[k][0]}" inputmode="decimal"></td><td><input data-lead="${k}:1" value="${lead[k][1]}" inputmode="decimal"></td></tr>`).join('')}</table>`;
  const html = `<div class="crumb"><a class="btn sm mpback" href="#/m/${m.id}">‹ 試合ページ</a><a href="#/m/${m.id}">vs ${esc(m.opponent)}</a> › Sportscode（XML・CSV）</div>
    <h1>Sportscode（XML・CSV）の書き出し</h1>
    <p class="mu">前半のキックオフを 0:00 として、MATCH PLAYの実際の時刻（ランニングタイム）でピリオドごとのXMLまたはCSVを書き出します（前半・後半は別のファイル）。CSVはSportscodeの書き出しと同じ形で、Sportscodeへの読み込み用と、Excelで開く用（日本語が文字化けしない形）の2つを選べます。後半は前半の終わりのすぐあとに続けます。動画との位置合わせは Sportscode 側で行ってください。</p>
    <div class="card"><div class="scrow"><label class="ck"><input type="checkbox" id="scP" ${opt.players ? 'checked' : ''}>出場の帯（#背番号の行。時計が動いていた区間ごと）</label>
      <label class="ck"><input type="checkbox" id="scE" ${opt.events ? 'checked' : ''}>イベント（今のコードウィンドウと同じコード名：シュート、ゾーン4進入、SETPLAY AT、ROBO、ファウルなど）${evs.length ? `　${evs.length}件` : '　（まだありません）'}</label></div></div>
    ${ps.length ? cards : '<div class="card empty">キックオフを押したピリオドがありません</div>'}
    <details class="card"><summary><b>イベントの長さ（コードごとの前後の秒数）</b>　今のコーディングと同じ長さにします</summary>${leadT}<p class="mu sm">この端末で覚えます。イベントの時刻は試合の時計（1秒単位）から求めるので、時計が止まっている間に起きたイベント（ボールが外に出た直後など）は、動画とずれることがあります。シュートなどは時計が止まった瞬間、SETPLAY は再開の瞬間に合わせています</p></details>`;
  return {
    active: 'acts', html: `<div class="scw">${html}</div>`,
    bind: (root) => {
      root.querySelector('#scP').onchange = (e) => { opt.players = e.target.checked; };
      root.querySelector('#scE').onchange = (e) => { opt.events = e.target.checked; };
      root.querySelectorAll('[data-lead]').forEach((i) => i.onchange = () => { const [k, j] = i.dataset.lead.split(':'); const L = loadLead(); L[k] = [...L[k]]; L[k][+j] = +i.value || 0; try { localStorage.setItem(LKEY, JSON.stringify(L)); } catch {} });
      root.querySelectorAll('[data-dl]').forEach((b) => b.onclick = () => {
        const k = b.dataset.dl; const p = ps.find((x) => x.key === k);
        const r = buildXML({ M, R, st, members: m.members || {}, events: evs, goalName: gn, key: k, ko: ko[k], shift: shift[k], lead: loadLead(), name, withPlayers: opt.players, withEvents: opt.events });
        const fmt = b.dataset.fmt; const base = `vs${m.opponent || ''}_${p.label}_${(m.date || '').replace(/-/g, '')}`;
        const timeline = `${S.team?.name || ''} vs ${m.opponent || ''}`.trim();
        // Excel用は先頭に BOM を付ける（Excel で開いたときに日本語が文字化けしないように）。Sportscode用は Sportscode の書き出しと同じ BOM なし
        const body = fmt === 'xml' ? r.xml : buildCSV(r, timeline, { bom: fmt === 'xls' });
        const blob = new Blob([body], { type: fmt === 'xml' ? 'application/xml' : 'text/csv' });
        const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
        a.download = `${base}${fmt === 'xls' ? '_Excel用' : ''}.${fmt === 'xml' ? 'xml' : 'csv'}`; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 4000);
        toast(`${p.label}の${fmt === 'xml' ? 'XML' : fmt === 'csv' ? 'CSV（Sportscode用）' : 'CSV（Excel用）'}を書き出しました（出場の帯 ${r.players}本・イベント ${r.events}件）`);
      });
    },
  };
}
