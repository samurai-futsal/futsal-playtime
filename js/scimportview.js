// Sportscode からの取り込み画面（試合ページ「Sportscodeから取り込み」）。読み方は scimport.js。
// ファイル（XML か CSV）を選ぶ → Kick Off でピリオドを決める → 件数と得点を確かめる → 取り込む（前回 Sportscode から取り込んだ分だけ置き換える）。
import { S, watchOps, watchEvents, opts, teamSettings, saveEvent, put, teamPath } from './store.js';
import { replay, periodLabel } from './engine.js';
import { matchModel, toRunning, periodSig } from './model.js';
import { KIND, checkOf, cardIssues, OPP_OG, UNKNOWN } from './events.js';
import { ppWindows } from './teamstats.js';
import { parseSC, buildImportFiles, kickOffs, periodFromName, DEFAULT_LEAD, LEAD_LABEL } from './scimport.js';
import { esc, toast, confirmBox } from './ui.js';
import { render } from './views.js';

let guarded = false;
const fresh = (m) => ({ m, files: [], shift: {} });
let st8 = fresh(null);
let fileSeq = 0;
const mmss = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const leadOf = () => ({ ...DEFAULT_LEAD, ...(teamSettings().scLead || {}) });
const LEN_NAME = { shot: 'シュート', ent: 'ゾーン進入', foul: 'ファウル', rl: 'ROBO・PERDIDA' };
const lenKey = (c) => (/シュート/.test(c) ? 'shot' : /進入/.test(c) ? 'ent' : /ファウル|ファール/.test(c) ? 'foul' : /ROBO|PERDIDA|リカバリー|ロスト/.test(c) ? 'rl' : null);

// Sportscode から取り込んだイベント（以前の版でアプリで直して印が消えたものも、直した履歴から見分ける）
const isImp = (e) => e.src === 'sportscode' || (e.hist || []).some((h) => h.prev?.src === 'sportscode');
export function vScImport(m) {
  if (st8.m !== m.id) st8 = fresh(m.id);
  const opsC = watchOps(m.id); const evC = watchEvents(m.id);
  if (!opsC.ready && !opsC.list.length) return { active: 'acts', html: '<p class="mu pad">読み込み中…</p>' };
  const cfg = { times: m.times || {}, members: m.members || {}, timesFixed: !!m.timesFixed, setplayAuto: teamSettings().setplayAuto || 60 };
  const st = replay(opsC.list, cfg); st.sig = periodSig(opsC.list);
  const M = matchModel(st, Date.now(), m.fix); const R = toRunning(M, st);
  const started = M.periods.filter((p) => st.periods[p.key]?.kickT != null);
  const crumb = `<div class="crumb"><a class="btn sm mpback" href="#/m/${m.id}">‹ 試合ページ</a><a href="#/m/${m.id}">vs ${esc(m.opponent)}</a> › Sportscodeから取り込み</div>`;
  const intro = `<h1>Sportscodeから取り込み</h1><p class="mu">Sportscode で書き出した XML か CSV を選ぶと、イベント入力に自動で記録します（シュート、ゾーン進入、FINISH SET PLAY（SETPLAY）、リカバリー・ロスト（ROBO・PERDIDA）、ファール（ファウル））。時刻は Kick Off の印と MATCH PLAY の時計の記録から試合の時計に直します。出場（#背番号の行）は取り込みません（MATCH PLAY の記録を使います）。</p>`;
  // ファイルを選ぶ（ボタン）と、ドラッグ＆ドロップの枠を分ける。読み込んだファイルは一覧に出し、1つずつ消せる（2026-10-17）
  const fileList = st8.files.length ? `<div class="sifiles">${st8.files.map((f) => { const k = kickOffs(f.parsed.instances).length;
    return `<div class="sifile"><span class="sifn">📄 ${esc(f.name)}</span><span class="mu sm">${f.parsed.kind === 'csv' ? 'CSV' : 'XML'}・${f.parsed.instances.length}件・Kick Off ${k}つ</span>${k ? '' : '<span class="tag warn">Kick Off の印がないので取り込めません</span>'}<button class="btn sm danger" data-fdel="${f.id}">× 消す</button></div>`; }).join('')}</div>` : '';
  const pick = `<div class="card"><h3>1. ファイルを読み込む</h3><p class="mu sm">前半だけ・後半だけ・両方入ったファイルのどれでも取り込めます。前半と後半のファイルを2つ一緒に読み込むこともできます。</p>
    <div class="sipick"><label class="filebtn btn pri">ファイルを選ぶ（XML・CSV）<input type="file" id="siFile" accept=".xml,.csv,.XML,.CSV,text/xml,text/csv,application/xml" multiple hidden></label>
    <div class="sidrop" id="siDrop"><b>ここにファイルをドラッグ＆ドロップ</b><span>XML・CSV　2つ同時でも大丈夫です</span></div></div>${fileList}</div>`;
  if (!started.length) return { active: 'acts', html: `<div class="scw">${crumb}${intro}<div class="card empty">MATCH PLAY でキックオフを押したピリオドがありません。時計の記録を使うので、先に MATCH PLAY の記録が必要です。</div></div>` };
  let body = '';
  const files = st8.files.filter((f) => kickOffs(f.parsed.instances).length);
  if (st8.files.length && !files.length) body = '<div class="card empty">読み込んだファイルには Kick Off の印がありません。前半・後半のキックオフに「Kick Off」を付けて書き出したファイルを選んでください。</div>';
  else if (files.length) {
    {
      // Kick Off の順にピリオドを当てる。Kick Off が1つ（片方のピリオドだけのファイル）なら、ファイル名から推測して選んでおく。
      // 推測できないときは、ピリオドを選ぶまで件数と置き換えの説明を出さない（SCI-01）
      for (const f of files) {
        const kos = kickOffs(f.parsed.instances);
        if (f.assign.length !== kos.length) {
          if (kos.length === 1) { const g = periodFromName(f.name); f.guess = started.some((p) => p.key === g) ? g : null; f.assign = [f.guess]; }
          else { f.guess = null; f.assign = kos.map((_, i) => started[Math.min(started.length - 1, i)]?.key); }
        }
      }
      const rows = files.flatMap((f) => kickOffs(f.parsed.instances).map((k, i) => ({ f, i, k, key: f.assign[i] })));
      const many = files.length > 1;
      const rowHtml = (r, need) => `<div class="sirow"><span class="sikick"><b>${many ? `${esc(r.f.name)}：` : ''}Kick Off ${r.i + 1}（動画 ${mmss(r.k.start * 1000)}）</b><span class="siar">→</span><select data-asg="${r.f.id}:${r.i}" class="${r.key ? '' : 'sineed'}">${r.key ? '' : '<option value="" selected disabled>選んでください</option>'}${started.map((x) => `<option value="${x.key}" ${x.key === r.key ? 'selected' : ''}>${x.label}</option>`).join('')}</select>${r.key && r.f.guess === r.key && kickOffs(r.f.parsed.instances).length === 1 ? '<span class="mu sm siguess">ファイル名から選びました</span>' : ''}</span>
        ${need ? '' : `<label>全体をずらす（秒）<input data-sh="${r.key}" value="${st8.shift[r.key] ?? ''}" placeholder="0" inputmode="decimal"></label>`}</div>`;
      const dupKeys = (() => { const ks = rows.map((r) => r.key).filter(Boolean); return [...new Set(ks.filter((k, i) => ks.indexOf(k) !== i))]; })();
      if (rows.some((r) => !r.key) || dupKeys.length) {
        const msg = dupKeys.length ? `<p class="siwarn">⚠ ${dupKeys.map((k) => periodLabel(k)).join('・')}が2つ以上の Kick Off で選ばれています。どれか1つにしてください。</p>`
          : `<p class="mu sm">ファイル名からピリオドが分からなかった（または MATCH PLAY にそのピリオドの記録がない）ファイルがあります。ピリオドを選ぶと、取り込む件数が出ます。</p>`;
        body = `<div class="card"><h3>2. どのピリオドのファイルですか？</h3>${rows.map((r) => rowHtml(r, true)).join('')}${msg}</div>`;
      } else {
      const lead = leadOf();
      const inst = files.flatMap((f) => f.parsed.instances);
      const goalTypes = opts('goalTypes', true).map((o) => ({ id: o.id, name: o.name }));
      // ピリオドの範囲はプレーの瞬間（コードの開始＋リード）と Kick Off で分ける（記14）。ファイルが2つなら、ファイルごとに分けてからまとめる
      const res = buildImportFiles(files.map((f) => ({ instances: f.parsed.instances, assign: f.assign })), { R, M, W: ppWindows(M), members: m.members || {}, players: S.players, goalTypes, lead, shift: st8.shift });
      const periods = res.periods;
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
      const lenWarn = Object.entries(nowLen).filter(([k, v]) => prevLen[k] != null && Math.abs(prevLen[k] - v) >= 0.5).map(([k, v]) => `${LEN_NAME[k]}の長さが${prevLen[k]}秒 → ${v}秒に変わっています。下の「コードごとの前後の秒数」を確かめてください`);
      st8.nowLen = nowLen;
      const per = rows.map((r) => rowHtml(r, false)).join('');
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
      const leadT = `<table class="sctb"><tr><th>コード</th><th>コードの開始から何秒後がプレーの瞬間か</th></tr>${Object.keys(DEFAULT_LEAD).map((k) => `<tr><td>${LEAD_LABEL[k]}</td><td><input data-ld="${k}" value="${lead[k]}" inputmode="decimal"> 秒</td></tr>`).join('')}</table>`;
      // ピリオドと時刻はアプリが自動で合わせる（ファイル名→ピリオド、Kick Off の印＋MATCH PLAY の時計→試合の時刻）。
      // ふだんは1行だけ出し、直す欄は「ずれているとき」を開いたときだけ（2026-10-17）
      const shifted = rows.some((r) => +st8.shift[r.key]);
      const auto = rows.map((r) => `${files.length > 1 || kickOffs(r.f.parsed.instances).length > 1 ? `${esc(r.f.name)}${kickOffs(r.f.parsed.instances).length > 1 ? ` の Kick Off ${r.i + 1}` : ''} → ` : ''}${periodLabel(r.key)}${+st8.shift[r.key] ? `（${st8.shift[r.key]}秒ずらす）` : ''}`).join('、');
      const adj = `<details class="siadj" id="siAdj" ${st8.adjOpen || shifted ? 'open' : ''}><summary>ピリオドや時刻を直す（ずれているときだけ）</summary>${per}
        <p class="mu sm">時刻は、ファイルの Kick Off の印をキックオフとして、MATCH PLAY の時計の記録（時計が止まっていた時間も含む）から自動で直しています。Sportscode で Kick Off の印を付けた位置がずれていたときだけ、「全体をずらす」で直します。</p></details>`;
      body = `<div class="card"><h3>2. ピリオドと時刻合わせ</h3><p class="siauto">✓ ピリオドと時刻は自動で合わせました：${auto}</p>${adj}</div>
        <div class="card"><h3>3. 取り込むイベント ${res.events.length}件</h3>${cntT}${gT}
          ${res.near?.length ? `<div class="sinear">ℹ 名前が少し違いますが、名字で合わせました（違っていたら、選手の登録か Sportscode のラベルを直して取り込み直してください）：${res.near.map(([c, n]) => `${esc(c)}（${n}）`).join('、')}</div>` : ''}
          ${warn.length ? `<div class="siwarn">${warn.map((w) => `<div>⚠ ${w}</div>`).join('')}</div>` : ''}
          <p class="mu sm">${[...keys].map((k) => periodLabel(k)).join('・')}：前回 Sportscode から取り込んだイベント ${old.length}件を、この${res.events.length}件に置き換えます${edited.length ? `（そのうち <b>${edited.length}件はアプリで直してあります</b>）` : ''}。アプリで入力したイベント ${appMade}件と MATCH PLAY の記録はそのまま残ります。アシスト・進入の方法などファイルにない項目は未入力のまま残るので、あとでイベント入力で埋められます。</p>
          <div class="row end"><button class="btn pri" id="siGo" ${res.events.length ? '' : 'disabled'}>取り込む（${res.events.length}件）</button></div></div>
        <details class="card"><summary><b>コードごとの前後の秒数</b>　チームで覚えます</summary>${leadT}<p class="mu sm">秒数を直したあとは、もう一度「取り込む」（置き換え）を押すと時刻がすべて直ります</p></details>`;
      st8.old = old; st8.edited = edited;
      }
    }
  }
  return {
    active: 'acts', html: `<div class="scw siw">${crumb}${intro}${pick}${body}</div>`,
    bind: (root) => {
      const f = root.querySelector('#siFile');
      // 読み込んだファイルは一覧に足す（同じ名前のファイルは新しいほうに置き換える）。XML・CSV 以外は読まずに知らせる
      const loadAll = (list) => {
        const ok = [...list].filter((x) => /\.(xml|csv)$/i.test(x.name)), ng = list.length - ok.length;
        if (ng) toast(ok.length ? `XML・CSV 以外の ${ng}つのファイルは読み込みませんでした` : 'XML か CSV のファイルを選んでください');
        if (!ok.length) return;
        Promise.all(ok.map((file) => file.text().then((text) => ({ id: 'f' + (++fileSeq), name: file.name, parsed: parseSC(text), assign: [], guess: null })))).then((add) => {
          st8.files = [...st8.files.filter((x) => !add.some((a) => a.name === x.name)), ...add];
          render();
        });
      };
      f.onchange = () => { if (f.files?.length) loadAll(f.files); f.value = ''; };
      // ドラッグ＆ドロップ（PC）：枠の中に落とす。上に持ってくると枠が光る。枠の外に落としたときは、ブラウザがファイルを開かないように止めて知らせる
      if (!guarded) { guarded = true; for (const t of ['dragover', 'drop']) document.addEventListener(t, (e) => { if (location.hash.includes('/scimport') && [...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); if (t === 'drop' && !e.target.closest?.('#siDrop')) toast('点線の枠の中に落としてください'); } }); }
      const dz = root.querySelector('#siDrop');
      if (dz) {
        let depth = 0;
        const hasFile = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
        dz.addEventListener('dragenter', (e) => { if (!hasFile(e)) return; e.preventDefault(); depth++; dz.classList.add('over'); });
        dz.addEventListener('dragover', (e) => { if (!hasFile(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
        dz.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) dz.classList.remove('over'); });
        dz.addEventListener('drop', (e) => { if (!hasFile(e)) return; e.preventDefault(); e.stopPropagation(); depth = 0; dz.classList.remove('over'); if (e.dataTransfer.files?.length) loadAll(e.dataTransfer.files); });
      }
      const ad = root.querySelector('#siAdj'); if (ad) ad.addEventListener('toggle', () => { st8.adjOpen = ad.open; });
      root.querySelectorAll('[data-fdel]').forEach((b) => b.onclick = () => { st8.files = st8.files.filter((x) => x.id !== b.dataset.fdel); render(); });
      root.querySelectorAll('[data-asg]').forEach((sel) => sel.onchange = () => { const [fid, i] = sel.dataset.asg.split(':'); const x = st8.files.find((y) => y.id === fid); if (x) { x.assign[+i] = sel.value; x.guess = null; } render(); });
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
        st8 = fresh(m.id);
        location.hash = `#/m/${m.id}/review`;
      };
    },
  };
}
