// Sportscode からの取り込み画面（試合ページ「Sportscodeから取り込み」）。読み方は scimport.js。
// ファイル（XML か CSV）を選ぶ → Kick Off でピリオドを決める → 件数と得点を確かめる → 取り込む（前回 Sportscode から取り込んだ分だけ置き換える）。
import { S, watchOps, watchEvents, opts, teamSettings, saveEvent, put, teamPath } from './store.js';
import { replay, periodLabel } from './engine.js';
import { matchModel, toRunning, periodSig } from './model.js';
import { KIND, checkOf, cardIssues, OPP_OG, UNKNOWN } from './events.js';
import { ppWindows } from './teamstats.js';
import { parseSC, buildImport, kickOffs, DEFAULT_LEAD, LEAD_LABEL } from './scimport.js';
import { esc, toast, confirmBox } from './ui.js';
import { render } from './views.js';

let st8 = { m: null, file: null, text: null, parsed: null, assign: [], shift: {} };
const mmss = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const leadOf = () => ({ ...DEFAULT_LEAD, ...(teamSettings().scLead || {}) });
const LEN_NAME = { shot: 'シュート', ent: 'ゾーン進入', foul: 'ファウル', rl: 'ROBO・PERDIDA' };
const lenKey = (c) => (/シュート/.test(c) ? 'shot' : /進入/.test(c) ? 'ent' : /ファウル|ファール/.test(c) ? 'foul' : /ROBO|PERDIDA|リカバリー|ロスト/.test(c) ? 'rl' : null);

// Sportscode から取り込んだイベント（以前の版でアプリで直して印が消えたものも、直した履歴から見分ける）
const isImp = (e) => e.src === 'sportscode' || (e.hist || []).some((h) => h.prev?.src === 'sportscode');
export function vScImport(m) {
  if (st8.m !== m.id) st8 = { m: m.id, file: null, text: null, parsed: null, assign: [], shift: {} };
  const opsC = watchOps(m.id); const evC = watchEvents(m.id);
  if (!opsC.ready && !opsC.list.length) return { active: 'acts', html: '<p class="mu pad">読み込み中…</p>' };
  const cfg = { times: m.times || {}, members: m.members || {}, setplayAuto: teamSettings().setplayAuto || 60 };
  const st = replay(opsC.list, cfg); st.sig = periodSig(opsC.list);
  const M = matchModel(st, Date.now(), m.fix); const R = toRunning(M, st);
  const started = M.periods.filter((p) => st.periods[p.key]?.kickT != null);
  const crumb = `<div class="crumb"><a class="btn sm mpback" href="#/m/${m.id}">‹ 試合ページ</a><a href="#/m/${m.id}">vs ${esc(m.opponent)}</a> › Sportscodeから取り込み</div>`;
  const intro = `<h1>Sportscodeから取り込み</h1><p class="mu">Sportscode で書き出した XML か CSV を選ぶと、イベント入力に自動で記録します（シュート、ゾーン進入、SETPLAY、ROBO・PERDIDA、ファウル）。時刻は Kick Off の印と MATCH PLAY の時計の記録から試合の時計に直します。出場（#背番号の行）は取り込みません（MATCH PLAY の記録を使います）。</p>`;
  const pick = `<div class="card"><div class="scrow"><label class="filebtn btn pri">ファイルを選ぶ（XML・CSV）<input type="file" id="siFile" accept=".xml,.csv,.XML,.CSV,text/xml,text/csv,application/xml" hidden></label>
    ${st8.file ? `<span class="scpos">${esc(st8.file)}（${st8.parsed?.kind === 'csv' ? 'CSV' : 'XML'}・${st8.parsed?.instances.length || 0}件）</span>` : '<span class="mu">前半だけ・後半だけ・両方入ったファイルのどれでも取り込めます</span>'}</div></div>`;
  if (!started.length) return { active: 'acts', html: `<div class="scw">${crumb}${intro}<div class="card empty">MATCH PLAY でキックオフを押したピリオドがありません。時計の記録を使うので、先に MATCH PLAY の記録が必要です。</div></div>` };
  let body = '';
  if (st8.parsed) {
    const inst = st8.parsed.instances; const kos = kickOffs(inst);
    if (!kos.length) body = '<div class="card empty">このファイルには Kick Off の印がありません。前半・後半のキックオフに「Kick Off」を付けて書き出したファイルを選んでください。</div>';
    else {
      // Kick Off の順にピリオドを当てる（1つだけなら選べる。初めはまだ取り込んでいないピリオド）
      if (st8.assign.length !== kos.length) {
        const have = new Set(evC.list.filter((e) => !e.deleted && isImp(e)).map((e) => e.period));
        const firstFree = started.findIndex((p) => !have.has(p.key));
        const base = kos.length === 1 ? Math.max(0, firstFree) : 0;
        st8.assign = kos.map((_, i) => started[Math.min(started.length - 1, base + i)]?.key);
      }
      const lead = leadOf();
      // ピリオドの範囲はプレーの瞬間（コードの開始＋リード）と Kick Off で分ける（記14）
      const periods = kos.map((k, i) => ({ key: st8.assign[i], ko: k.start, shift: +st8.shift[st8.assign[i]] || 0, from: i ? k.start : -1e9, to: kos[i + 1] ? kos[i + 1].start : 1e9 }));
      const goalTypes = opts('goalTypes', true).map((o) => ({ id: o.id, name: o.name }));
      const res = buildImport({ instances: inst, periods, R, M, W: ppWindows(M), members: m.members || {}, players: S.players, goalTypes, lead });
      st8.res = res; st8.periods = periods;
      const keys = new Set(periods.map((p) => p.key));
      const old = evC.list.filter((e) => !e.deleted && isImp(e) && keys.has(e.period));
      const edited = old.filter((e) => e.impEdited || e.src !== 'sportscode' || (e.hist || []).some((h) => h.act === 'edit' || h.act === 'revert'));
      const appMade = evC.list.filter((e) => !e.deleted && !isImp(e) && keys.has(e.period)).length;
      // コードごとの長さが前回と違うものを知らせる（リードがずれている可能性）
      const lens = {}; for (const i of inst) { const k = lenKey(i.code); if (k) (lens[k] = lens[k] || []).push(+(i.end - i.start).toFixed(1)); }
      const mode = (a) => { const c = {}; let best = null; for (const v of a) { c[v] = (c[v] || 0) + 1; if (best == null || c[v] > c[best]) best = v; } return best; };
      const nowLen = Object.fromEntries(Object.entries(lens).map(([k, a]) => [k, mode(a)]));
      const prevLen = teamSettings().scLens || {};
      const lenWarn = Object.entries(nowLen).filter(([k, v]) => prevLen[k] != null && Math.abs(prevLen[k] - v) >= 0.5).map(([k, v]) => `${LEN_NAME[k]}の長さが${prevLen[k]}秒 → ${v}秒に変わっています。下の「コードごとのリード」を確かめてください`);
      st8.nowLen = nowLen;
      const per = periods.map((p, i) => `<div class="sirow"><b>Kick Off ${i + 1}（動画 ${mmss(kos[i].start * 1000)}）</b>→<select data-asg="${i}">${started.map((x) => `<option value="${x.key}" ${x.key === p.key ? 'selected' : ''}>${x.label}</option>`).join('')}</select>
        <label>全体をずらす（秒）<input data-sh="${p.key}" value="${st8.shift[p.key] ?? ''}" placeholder="0" inputmode="decimal"></label></div>`).join('');
      const cnt = {}; for (const e of res.events) cnt[e.kind] = (cnt[e.kind] || 0) + 1;
      const order = ['shot', 'szshot', 'goal', 'z4', 'sz', 'fspat', 'oshot', 'oszshot', 'conc', 'oz4', 'osz', 'fspdf', 'rec', 'lost', 'foul', 'fouled'];
      const cntT = `<div class="sicnt">${order.filter((k) => cnt[k]).map((k) => `<span class="${KIND[k].team === 'opp' ? 'o' : 'w'}">${KIND[k].label}<b>${cnt[k]}</b></span>`).join('')}</div>`;
      const nm = (pid) => (pid === OPP_OG ? '相手OG' : pid && pid !== UNKNOWN ? `${m.members?.[pid]?.no ?? ''} ${S.players.find((p) => p.id === pid)?.last || ''}` : '');
      const gn = (id) => goalTypes.find((g) => g.id === id)?.name || '';
      const goals = res.events.filter((e) => e.kind === 'goal' || e.kind === 'conc');
      const gT = goals.length ? `<table class="sctb"><tr><th></th><th>時刻（経過）</th><th>残り</th><th>得点者</th><th>得点の種類</th></tr>${goals.map((e) => { const p = M.periods.find((x) => x.key === e.period); return `<tr><td class="${e.kind === 'goal' ? 'w' : 'o'}">${e.kind === 'goal' ? '得点' : '失点'}</td><td>${p?.label || ''} ${mmss(e.at)}</td><td>${mmss((p?.len || 0) - e.at)}</td><td>${esc(nm(e.pid))}</td><td>${e.gtype ? esc(gn(e.gtype)) : '<span class="mu">未入力</span>'}</td></tr>`; }).join('')}</table><p class="mu sm">試合の時刻（スコアボードの残り時間）と合っているか確かめてください。ずれているときは「全体をずらす」で直します</p>` : '<p class="mu sm">得点・失点はありません</p>';
      const warn = [
        ...lenWarn,
        ...(res.unknownCodes.length ? [`読まないコード：${res.unknownCodes.map(([c, n]) => `${esc(c)}（${n}）`).join('、')}`] : []),
        ...(res.unknownLabels.length ? [`読まないラベルのグループ：${res.unknownLabels.map(([c, n]) => `${esc(c)}（${n}）`).join('、')}`] : []),
        ...(res.unmatched.length ? [`試合メンバーに見つからない選手（同じ名字が2人いる・名前の一部だけ合うときも、選手は空けて取り込みます）：${res.unmatched.map(([c, n]) => `${esc(c)}（${n}）`).join('、')}`] : []),
        ...(res.warnings || []).map(([w, n]) => `${esc(w)}：${n}件`),
        ...(res.events.some((e) => e.impWhy) ? [`同じグループに2つ以上のラベルが付いたイベント：${res.events.filter((e) => e.impWhy).length}件（1つ目のラベルで取り込み、「要確認」にします。イベント入力で確かめてください）`] : []),
      ];
      const leadT = `<table class="sctb"><tr><th>コード</th><th>コードの開始から何秒後がプレーの瞬間か（リード）</th></tr>${Object.keys(DEFAULT_LEAD).map((k) => `<tr><td>${LEAD_LABEL[k]}</td><td><input data-ld="${k}" value="${lead[k]}" inputmode="decimal"> 秒</td></tr>`).join('')}</table>`;
      body = `<div class="card"><h3>ピリオドと時刻合わせ</h3>${per}</div>
        <div class="card"><h3>取り込むイベント ${res.events.length}件</h3>${cntT}${gT}
          ${warn.length ? `<div class="siwarn">${warn.map((w) => `<div>⚠ ${w}</div>`).join('')}</div>` : ''}
          <p class="mu sm">${[...keys].map((k) => periodLabel(k)).join('・')}：前回 Sportscode から取り込んだイベント ${old.length}件を、この${res.events.length}件に置き換えます${edited.length ? `（そのうち <b>${edited.length}件はアプリで直してあります</b>）` : ''}。アプリで入力したイベント ${appMade}件と MATCH PLAY の記録はそのまま残ります。アシスト・進入の方法などファイルにない項目は未入力のまま残るので、あとでイベント入力で埋められます。</p>
          <div class="row end"><button class="btn pri" id="siGo" ${res.events.length ? '' : 'disabled'}>取り込む（${res.events.length}件）</button></div></div>
        <details class="card"><summary><b>コードごとのリード</b>　チームで覚えます</summary>${leadT}<p class="mu sm">リードを直したあとは、もう一度「取り込む」（置き換え）を押すと時刻がすべて直ります</p></details>`;
      st8.old = old; st8.edited = edited;
    }
  }
  return {
    active: 'acts', html: `<div class="scw siw">${crumb}${intro}${pick}${body}</div>`,
    bind: (root) => {
      const f = root.querySelector('#siFile');
      f.onchange = () => { const file = f.files?.[0]; if (!file) return; const r = new FileReader(); r.onload = () => { st8.file = file.name; st8.text = String(r.result); st8.parsed = parseSC(st8.text); st8.assign = []; st8.shift = {}; render(); }; r.readAsText(file); };
      root.querySelectorAll('[data-asg]').forEach((s) => s.onchange = () => { st8.assign[+s.dataset.asg] = s.value; render(); });
      root.querySelectorAll('[data-sh]').forEach((i) => i.onchange = () => { const v = i.value.trim(); st8.shift[i.dataset.sh] = v === '' ? 0 : +v || 0; render(); });
      root.querySelectorAll('[data-ld]').forEach((i) => i.onchange = () => { const L = { ...(teamSettings().scLead || {}) }; L[i.dataset.ld] = +i.value || 0; put(teamPath(), { settings: { ...(S.team?.settings || {}), scLead: L } }); if (S.team) S.team.settings = { ...(S.team.settings || {}), scLead: L }; render(); });
      const go = root.querySelector('#siGo');
      if (go) go.onclick = async () => {
        if (st8.edited?.length && !(await confirmBox({ title: '取り込み直しますか？', body: `前回取り込んだイベントのうち ${st8.edited.length}件は、アプリで直してあります。置き換えると、その直しは消えます。`, ok: '置き換える', danger: true }))) return;
        for (const e of st8.old || []) saveEvent(m.id, { ...e, deleted: true });
        // seq＝取り込んだ時刻＋順番（同じ秒のイベントも取り込んだ順に並ぶ。記14）
        const t = Date.now(); let n = 0, chk = 0;
        const oldIds = new Set((st8.old || []).map((e) => e.id));
        const kept = evC.list.filter((e) => !e.deleted && !oldIds.has(e.id));
        const evs = st8.res.events.map((e, i) => { const ev = { ...e, imp: t, seq: t + i, id: `sc${t.toString(36)}_${i}` }; delete ev.check; return ev; });
        const cards = cardIssues([...kept, ...evs], M.periods.map((p) => p.key));
        for (const ev of evs) { const c = checkOf(M, ev, cards); ev.check = c.check; if (c.why) ev.checkWhy = c.why; if (ev.check) chk++; saveEvent(m.id, ev); n++; }
        put(teamPath(), { settings: { ...(S.team?.settings || {}), scLens: { ...(teamSettings().scLens || {}), ...st8.nowLen } } });
        toast(`${n}件を取り込みました${chk ? `（要確認 ${chk}件）` : ''}`);
        st8 = { m: m.id, file: null, text: null, parsed: null, assign: [], shift: {} };
        location.hash = `#/m/${m.id}/review`;
      };
    },
  };
}
