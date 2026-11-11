// Sportscode からの取り込み画面（試合ページ「Sportscodeから取り込み」）。読み方は scimport.js。
// ファイル（XML か CSV）を選ぶ → Kick Off でピリオドを決める → 件数と得点を確かめる → 取り込む（前回 Sportscode から取り込んだ分だけ置き換える）。
import { S, watchOps, watchEvents, opts, teamSettings, saveEvent, put, teamPath, watchScFiles, saveScFile } from './store.js';
import { replay, periodLabel } from './engine.js';
import { matchModel, toRunning, periodSig } from './model.js';
import { KIND, checkOf, cardIssues, OPP_OG, UNKNOWN } from './events.js';
import { ppWindows } from './teamstats.js';
import { parseSC, buildImportFiles, kickOffs, periodFromName, DEFAULT_LEAD, LEAD_LABEL, eventCodeCount } from './scimport.js';
import { playOpsFromSC } from './scplay.js';
import { addOp } from './store.js';
import { PERIODS } from './engine.js';
import { esc, toast, confirmBox } from './ui.js';
import { render } from './views.js';
import { scBaseline, scPlanFor, scApplyPlans, scPreviewFix, scOrigin, totalsOf, scNm } from './fix.js';

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
const isEdited = (e) => e.impEdited || e.src !== 'sportscode' || (e.hist || []).some((h) => h.act === 'edit' || h.act === 'revert');
const dt = (t) => { const d = new Date(t); return `${d.getMonth() + 1}/${d.getDate()} ${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`; };
// 取り込み済み（ピリオドごと）：件数・ファイル名・日時。ファイル名は 2026-10-17 から各イベントに残す（それより前は「記録なし」）
function importedByPeriod(list, M) {
  const by = new Map();
  for (const e of list) if (!e.deleted && isImp(e)) { const g = by.get(e.period) || { n: 0, files: new Map(), t: 0, edited: 0 }; g.n++; if (e.impFile) g.files.set(e.impFile, (g.files.get(e.impFile) || 0) + 1); g.t = Math.max(g.t, +e.imp || 0); if (isEdited(e)) g.edited++; by.set(e.period, g); }
  return M.periods.filter((p) => by.has(p.key)).map((p) => { const g = by.get(p.key); return { key: p.key, label: p.label, ...g, name: [...g.files.keys()].join('・') || '' }; });
}
// ファイルを選ぶ・ドラッグ＆ドロップ・一覧から消す（イベントの取り込みと、記録を作る画面の両方）
// 記録の修正「Sportscodeから直す」で読み込んだファイルを、そのままイベントの取り込みに渡す（選び直さなくてよいように。2026-11-11）
export function handOffScFiles(mId, files) {
  st8 = fresh(mId);
  st8.files = files.map((f) => ({ id: 'f' + (++fileSeq), name: f.name, parsed: f.parsed, assign: [], guess: null }));
}
function bindFiles(root) {
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
  root.querySelectorAll('[data-fdel]').forEach((b) => b.onclick = () => { st8.files = st8.files.filter((x) => x.id !== b.dataset.fdel); render(); });
}
// MATCH PLAY の記録がない試合：Sportscode の「#背番号」の行から、出場・交代・時計の記録を作る（2026-10-22）
// 作ったあとは、そのままいつもの「イベントの取り込み」に進む（同じファイルを使う）
function buildPlay(m, st) {
  const files = st8.files.filter((f) => kickOffs(f.parsed.instances).length);
  const keys = PERIODS.filter((p) => !p.extra || m.times?.extra).map((p) => p.key);
  const head = `<div class="card sibuild"><h3>2. 出場・交代・時計の記録を作る</h3><p class="mu sm">この試合は MATCH PLAY の記録がありません。Sportscode の「#背番号」の行（その選手がピッチにいて時計が動いている間）から、交代・時計の止まり・出場時間の記録を作ります。作ったあとは、続けてイベントを取り込めます。</p>`;
  if (!st8.files.length) return { html: `${head}<p class="mu">上でファイルを読み込んでください（前半・後半のファイルを一緒に読み込めます）。</p></div>`, bind: () => {} };
  if (!files.length) return { html: `${head}<div class="siwarn">⚠ 読み込んだファイルに Kick Off の印がありません。</div></div>`, bind: () => {} };
  const hasPl = (f, a, b) => f.parsed.instances.some((i) => /^#\s*\d+$/.test(i.code) && i.start >= a - 1 && i.start < b);
  for (const f of files) {
    const kos = kickOffs(f.parsed.instances);
    if (f.assign.length === kos.length && f.mode === 'build') continue;
    f.mode = 'build'; let n = 0;
    f.assign = kos.map((k, i) => { if (!hasPl(f, k.start, kos[i + 1] ? kos[i + 1].start : 1e9)) return '-'; if (kos.length === 1) return periodFromName(f.name) || keys[0]; return keys[n++] || '-'; });
  }
  const many = files.length > 1;
  const rows = files.flatMap((f) => kickOffs(f.parsed.instances).map((k, i) => ({ f, i, k, key: f.assign[i] })));
  const sel = (r) => `<select data-bsg="${r.f.id}:${r.i}">${keys.map((k) => `<option value="${k}" ${k === r.key ? 'selected' : ''}>${periodLabel(k)}</option>`).join('')}<option value="-" ${r.key === '-' ? 'selected' : ''}>使わない</option></select>`;
  const asg = rows.map((r) => `<div class="sirow"><span class="sikick"><b>${many ? `${esc(r.f.name)}：` : ''}Kick Off ${r.i + 1}（動画 ${mmss(r.k.start * 1000)}）</b><span class="siar">→</span>${sel(r)}</span></div>`).join('');
  const used = rows.map((r) => r.key).filter((k) => k && k !== '-');
  const dup = [...new Set(used.filter((k, i) => used.indexOf(k) !== i))];
  if (dup.length) return { html: `${head}${asg}<div class="siwarn">⚠ ${dup.map(periodLabel).join('・')}が2つ以上の Kick Off で選ばれています。</div></div>`, bind: bindAsg };
  // 背番号 → 試合メンバー
  const byNo = Object.fromEntries(Object.entries(m.members || {}).filter(([, v]) => v.no != null && v.no !== '').map(([pid, v]) => [String(v.no), pid]));
  const order = (k) => keys.indexOf(k);
  const fl = files.map((f) => { const kos = kickOffs(f.parsed.instances); return { name: f.name, instances: f.parsed.instances, periods: kos.map((k, i) => ({ key: f.assign[i], ko: k.start, to: kos[i + 1] ? kos[i + 1].start : 1e9 })).filter((x) => x.key && x.key !== '-').sort((a, b) => order(a.key) - order(b.key)) }; })
    .filter((x) => x.periods.length).sort((a, b) => order(a.periods[0].key) - order(b.periods[0].key));
  const lenOf = (k) => (PERIODS.find((p) => p.key === k)?.extra ? (m.times?.extraHalf || 5) : (m.times?.half || 20)) * 60000;
  const gks = Object.entries(m.members || {}).filter(([, v]) => v.pos === 'GK').map(([pid]) => pid);
  const nm = (pid) => `${m.members?.[pid]?.no ?? ''} ${S.players.find((p) => p.id === pid)?.last || ''}`.trim();
  st8.gk = st8.gk || {};
  const res = playOpsFromSC({ files: fl, byNo, lenMs: lenOf('1H'), gk: st8.gk, startT: Date.parse(`${m.date || '2026-01-01'}T${m.kickoff || '12:00'}:00+09:00`) || Date.now() });
  // 延長のピリオドの長さは別（作った記録の kickoff の長さを直す）
  for (const o of res.ops) if (o.type === 'kickoff') o.len = lenOf(o.period);
  st8.build = res;
  const per = Object.entries(res.info).sort((a, b) => order(a[0]) - order(b[0])).map(([k, x]) => {
    const needGK = !x.ok && x.lineup.length === 4 && gks.length;
    return `<div class="sibper"><b>${periodLabel(k)}</b>${x.ok ? `<span>時計が動いた時間 <b>${mmss(x.play * 1000)}</b></span><span>時計の区切り ${x.segs}回</span><span>交代 ${x.subs}回</span><span class="mu">先発：${x.lineup.map(nm).join('・')}</span>` : ''}
      ${x.warn.map((w) => `<div class="siwarn">⚠ ${esc(w)}</div>`).join('')}
      ${needGK || st8.gk[k] ? `<div class="sigk">GK の行がファイルにありません。このピリオドに出ていたGK：<select data-gk="${k}"><option value="">選んでください</option>${gks.map((p) => `<option value="${p}" ${st8.gk[k] === p ? 'selected' : ''}>${esc(nm(p))}</option>`).join('')}</select>（時計が動いた間ずっと出ていたものとして作ります）</div>` : ''}</div>`;
  }).join('');
  const miss = res.missing.length ? `<div class="siwarn">⚠ 試合メンバーにない背番号：${res.missing.map((n) => '#' + n).join('・')}。<a href="#/m/${m.id}/members">試合メンバー</a>に入れてから作ってください。</div>` : '';
  const can = !res.missing.length && Object.values(res.info).length && Object.values(res.info).every((x) => x.ok);
  const html = `${head}<details class="siadj"><summary>ピリオドの当て方（${rows.map((r) => `${many ? esc(r.f.name) + ' ' : ''}Kick Off ${r.i + 1} → ${r.key === '-' ? '使わない' : periodLabel(r.key)}`).join('、')}）</summary>${asg}</details>
    <div class="sibpers">${per}</div>${miss}
    <div class="row end"><button class="btn pri" id="siBuild" ${can ? '' : 'disabled'}>この内容で試合の記録を作る</button></div>
    <p class="mu sm">作った記録は、MATCH PLAY で記録したものと同じように、マッチレビュー・分析・記録の修正で使えます。動画を見ながらのイベント入力でも、この XML と同じ動画を開けば時刻が自動で合います（Kick Off の位置が同じとき）。</p></div>`;
  function bindAsg(root) { root.querySelectorAll('[data-bsg]').forEach((s2) => s2.onchange = () => { const [fid, i] = s2.dataset.bsg.split(':'); const x = st8.files.find((y) => y.id === fid); if (x) x.assign[+i] = s2.value; render(); }); }
  return { html, bind: (root) => {
    bindAsg(root);
    root.querySelectorAll('[data-gk]').forEach((s2) => s2.onchange = () => { st8.gk[s2.dataset.gk] = s2.value || undefined; render(); });
    const b = root.querySelector('#siBuild');
    if (b) b.onclick = async () => {
      const r = st8.build; if (!r?.ops.length) return;
      if (!(await confirmBox({ title: '試合の記録を作りますか？', body: `<p>${Object.keys(r.info).map(periodLabel).join('・')}の出場・交代・時計の記録を作ります（${r.ops.length}件の操作）。</p><p>あとから直すときは「記録の修正」を使います。</p>`, ok: '作る' }))) return;
      for (const o of r.ops) addOp(m.id, o);
      put(teamPath('matches', m.id), { status: 'done', recSrc: 'sportscode', vclock: Object.fromEntries(Object.entries(r.vclock).map(([k, v]) => [k, { base: v.base, file: v.file }])) });
      // 続けてイベントを取り込めるように、ピリオドの当て方はそのまま使う
      for (const f of st8.files) f.mode = null;
      toast('試合の記録を作りました。続けてイベントを取り込めます');
      render();
    };
  } };
}
export function vScImport(m) {
  if (st8.m !== m.id) st8 = fresh(m.id);
  const opsC = watchOps(m.id); const evC = watchEvents(m.id);
  if (!opsC.ready && !opsC.list.length) return { active: 'acts', html: '<p class="mu pad">読み込み中…</p>' };
  const cfg = { times: m.times || {}, members: m.members || {}, timesFixed: !!m.timesFixed, setplayAuto: teamSettings().setplayAuto || 60 };
  const st = replay(opsC.list, cfg); st.sig = periodSig(opsC.list);
  const M = matchModel(st, Date.now(), m.fix); const R = toRunning(M, st); const M0 = M;
  const started = M.periods.filter((p) => st.periods[p.key]?.kickT != null);
  const crumb = `<div class="crumb"><a class="btn sm mpback" href="#/m/${m.id}">‹ 試合ページ</a><a href="#/m/${m.id}">vs ${esc(m.opponent)}</a> › Sportscodeから取り込み</div>`;
  const intro = `<h1>Sportscodeから取り込み</h1><p class="mu">Sportscode で書き出した XML か CSV を選ぶと、イベント入力に自動で記録します（シュート、ゾーン進入、FINISH SET PLAY（SETPLAY）、リカバリー・ロスト（ROBO・PERDIDA）、ファール（ファウル））。時刻は Kick Off の印と MATCH PLAY の時計の記録から試合の時計に直します。試合が終わったピリオドは、ファイルの「#背番号」の行から出場・交代も一緒に直せます（下の「3」。チェックを外せば、出場・交代は MATCH PLAY の記録のまま）。</p>${Object.values(m.fix?.periods || {}).some((fp) => fp.sc) ? `<div class="fxinfo">ℹ ${Object.entries(m.fix.periods).filter(([, fp]) => fp.sc).map(([k]) => periodLabel(k)).join('・')}は「記録の修正」で Sportscode の XML（${esc([...new Set(Object.values(m.fix.periods).filter((fp) => fp.sc).map((fp) => fp.sc.file))].join('、'))}）から直してあるので、同じ XML を取り込むと、その XML の時計で時刻を決めます（イベントと出場がそろいます）。交代の前後3秒以内のイベントと、時計が止まっている間に交代があったイベントには「要確認」を付けます。</div>` : ''}`;
  // ファイルを選ぶ（ボタン）と、ドラッグ＆ドロップの枠を分ける。読み込んだファイルは一覧に出し、1つずつ消せる（2026-10-17）
  const fileList = st8.files.length ? `<div class="sifiles">${st8.files.map((f) => { const k = kickOffs(f.parsed.instances).length;
    return `<div class="sifile"><span class="sifn">📄 ${esc(f.name)}</span><span class="mu sm">${f.parsed.kind === 'csv' ? 'CSV' : 'XML'}・${f.parsed.instances.length}件・Kick Off ${k}つ</span>${k ? '' : '<span class="tag warn">Kick Off の印がないので取り込めません</span>'}<button class="btn sm danger" data-fdel="${f.id}">× 消す</button></div>`; }).join('')}</div>` : '';
  const pick = `<div class="card"><h3>1. ファイルを読み込む</h3><p class="mu sm">前半だけ・後半だけ・両方入ったファイルのどれでも取り込めます。前半と後半のファイルを2つ一緒に読み込むこともできます。</p>
    <div class="sipick"><label class="filebtn btn pri">ファイルを選ぶ（XML・CSV）<input type="file" id="siFile" accept=".xml,.csv,.XML,.CSV,text/xml,text/csv,application/xml" multiple hidden></label>
    <div class="sidrop" id="siDrop"><b>ここにファイルをドラッグ＆ドロップ</b><span>XML・CSV　2つ同時でも大丈夫です</span></div></div>${fileList}</div>`;
  if (!started.length) { const b = buildPlay(m, st); return { active: 'acts', html: `<div class="scw siw">${crumb}<h1>Sportscodeから取り込み</h1><p class="mu">この試合は MATCH PLAY の記録がありません。Sportscode で書き出した XML か CSV から、まず出場・交代・時計の記録を作り、続けてイベント（シュート、ゾーン進入、FINISH SET PLAY、リカバリー・ロスト、ファール）を取り込みます。</p>${pick}${b.html}</div>`, bind: (root) => { bindFiles(root); b.bind(root); } }; }
  return vFiles(m, { st, M, R, evC, crumb });
}


// ============ ファイルと使い道（2026-11-11 作り直し） ============
// ピリオドごとに「出場・交代の元」（MATCH PLAY か、ファイル1つ）と「イベントの元」（ファイル1つか、なし）を決める。
// 取り込んだファイルは試合に残す（scfiles）。表のプルダウンで使い道を変えると、下に「何が替わるか」を出し、「変更を反映」で反映する。
// 新しいファイルを足すと、終わったピリオドで #背番号 の行があれば出場・交代に、イベントのコードがあればイベントに、初めから選んでおく。
// 取り込んだイベントをアプリで直していても、入れ直すと直しは消える（置き換える前に件数を知らせる。2026-11-11 決定）。
let fu = { m: null, target: {}, shift: {}, adjOpen: false };
const pcache = new Map();
const instOf = (f) => { const k = f.id + ':' + (f.t || ''); if (!pcache.has(k)) { let a = []; try { a = JSON.parse(f.data || '[]').map(([code, start, end, labels]) => ({ code, start, end, labels: labels || [] })); } catch {} pcache.set(k, a); } return pcache.get(k); };
const packInst = (list) => JSON.stringify(list.map((i) => [i.code, +(+i.start).toFixed(3), +(+i.end).toFixed(3), ...(i.labels?.length ? [i.labels] : [])]));
const hasPlayRows = (inst, a, b) => inst.some((i) => /^#\s*\d+$/.test(i.code) && i.start >= a - 1 && i.start < b);
function defaultAssign(inst, name, keys) {
  const kos = kickOffs(inst); if (kos.length === 1) { const g = periodFromName(name); return [keys.includes(g) ? g : keys[0] || '-']; }
  let n = 0; return kos.map((k, i) => { const b = kos[i + 1] ? kos[i + 1].start - 1 : 1e9; const evN = inst.filter((x) => x.start >= k.start - 1 && x.start < b).length; if (!evN) return '-'; return keys[n++] || '-'; });
}
// そのファイルの、そのピリオドの範囲（Kick Off の順で決めたもの）
function rangeOf(f, key) {
  const inst = instOf(f); const kos = kickOffs(inst); const i = (f.assign || []).indexOf(key); if (i < 0 || !kos[i]) return null;
  return { ko: kos[i].start, to: kos[i + 1] ? kos[i + 1].start - 1 : 1e9, i };
}
function loadFiles(m, list, keys, doneKeys) {
  const all = [...list]; const ok = all.filter((x) => /\.(xml|csv)$/i.test(x.name));
  if (!ok.length) { toast('XML か CSV のファイルを選んでください'); return; }
  if (ok.length < all.length) toast(`XML・CSV 以外の ${all.length - ok.length}つのファイルは読み込みませんでした`);
  Promise.all(ok.map((file) => file.text().then((text) => ({ name: file.name, parsed: parseSC(text) })))).then((add) => {
    const have = watchScFiles(m.id).list.filter((f) => !f.deleted);
    for (const a of add) {
      if (!kickOffs(a.parsed.instances).length) { toast(`${a.name}：Kick Off の印がないので使えません`); continue; }
      const data = packInst(a.parsed.instances);
      if (data.length > 900000) { toast(`${a.name}：ファイルが大きすぎて残せません`); continue; }
      const same = have.find((f) => f.name === a.name);
      const assign = defaultAssign(a.parsed.instances, a.name, keys);
      const f = saveScFile(m.id, { id: same?.id, name: a.name, kind: a.parsed.kind, data, assign, addedAt: Date.now(), deleted: false });
      // 初めの使い道：終わったピリオドで #背番号 の行があれば出場・交代、イベントのコードがあればイベント
      const inst = a.parsed.instances; const kos = kickOffs(inst);
      assign.forEach((k, i) => {
        if (!k || k === '-') return; const r = { ko: kos[i].start, to: kos[i + 1] ? kos[i + 1].start - 1 : 1e9 };
        const t = (fu.target[k] = fu.target[k] || {});
        if (doneKeys.includes(k) && hasPlayRows(inst, r.ko, r.to)) t.play = f.id;
        if (inst.some((x) => x.start >= r.ko - 1 && x.start < r.to && eventCodeCount([x]))) t.ev = f.id;
      });
    }
    render();
  });
}
function vFiles(m, { st, M, R, evC, crumb }) {
  if (fu.m !== m.id) fu = { m: m.id, target: {}, shift: {}, adjOpen: false };
  const fC = watchScFiles(m.id);
  const files = fC.list.filter((f) => !f.deleted).sort((a, b) => (a.addedAt || 0) - (b.addedAt || 0));
  const byId = Object.fromEntries(files.map((f) => [f.id, f]));
  const started = M.periods.filter((p) => st.periods[p.key]?.kickT != null);
  const keys = started.map((p) => p.key);
  const base = scBaseline(m); const doneKeys = keys.filter((k) => base.d.periods[k]);
  const org = m.fix ? scOrigin(m, base) : null;
  const sigOf = (fp) => JSON.stringify([fp.lineup, (fp.ev || []).map((e) => [e.kind, e.seat, Math.round(e.at / 1000), e.in || null]).sort(), (fp.pp || []).map((x) => [x.team, Math.round(x.from / 1000), Math.round(x.to / 1000)])]);
  const live = evC.list.filter((e) => !e.deleted);
  const fileByName = (n) => files.find((f) => f.name === n);
  // 今の使い道
  const cur = {};
  for (const k of keys) {
    const fp = m.fix?.periods?.[k];
    const play = fp?.sc ? (byId[fp.sc.fileId]?.id || fileByName(fp.sc.file)?.id || `name:${fp.sc.file}`) : 'mp';
    const imp = live.filter((e) => e.period === k && isImp(e));
    const names = [...new Set(imp.map((e) => (e.impFileId && byId[e.impFileId] ? e.impFileId : fileByName(e.impFile)?.id || `name:${e.impFile || ''}`)))];
    cur[k] = { play, ev: imp.length ? names[0] : 'none', evN: imp.length, evEdited: imp.filter(isEdited).length, appN: live.filter((e) => e.period === k && !isImp(e)).length, manual: !!fp && !fp.sc && !!org?.periods?.[k] && sigOf(fp) !== sigOf(org.periods[k]) };
  }
  // 目標（表で選んだもの）。選べないもの（消したファイルなど）は今のままにする
  const tgt = {};
  for (const k of keys) {
    const t = fu.target[k] || {}; const c = cur[k];
    const playOk = (v) => v === 'mp' || (byId[v] && doneKeys.includes(k) && (() => { const r = rangeOf(byId[v], k); return r && hasPlayRows(instOf(byId[v]), r.ko, r.to); })());
    const evOk = (v) => v === 'none' || (byId[v] && rangeOf(byId[v], k));
    tgt[k] = { play: t.play != null && playOk(t.play) ? t.play : c.play, ev: t.ev != null && evOk(t.ev) ? t.ev : c.ev };
  }
  const label = (v, k) => (v === 'mp' ? (cur[k].manual && cur[k].play === 'mp' ? 'MATCH PLAY（手で直した記録）' : 'MATCH PLAY') : v === 'none' ? 'なし' : byId[v] ? byId[v].name : `${String(v).replace(/^name:/, '') || 'ファイル名の記録なし'}（ファイルは残っていません）`);
  // 替わるもの
  const playCh = keys.filter((k) => tgt[k].play !== cur[k].play);
  const evRedo = keys.filter((k) => tgt[k].ev !== cur[k].ev || (playCh.includes(k) && byId[tgt[k].ev]));
  const plansF = scPlanFor(m, base, playCh.filter((k) => byId[tgt[k].play]).map((k) => { const f = byId[tgt[k].play]; const r = rangeOf(f, k); return { key: k, instances: instOf(f), ko: r.ko, to: r.to, file: f.name }; }));
  const plans = {};
  for (const k of playCh) { if (tgt[k].play === 'mp') plans[k] = { mp: true, ok: true, errs: [], file: 'MATCH PLAY', cur: base.d.periods[k] }; else if (plansF[k]) { plans[k] = plansF[k]; if (plansF[k].ok) plansF[k].fp.sc.fileId = tgt[k].play; } }
  const badPlay = playCh.filter((k) => !plans[k] || !plans[k].ok || plans[k].errs.length);
  const ksPlay = playCh.filter((k) => !badPlay.includes(k));
  const fixX = ksPlay.length ? scPreviewFix(m, base, ksPlay, plans) : m.fix;
  const Mx = ksPlay.length ? matchModel(st, Date.now(), fixX) : M; const Rx = ksPlay.length ? toRunning(Mx, st) : R;
  // イベント：替えるピリオドの分だけ、ファイルごとに取り込む
  const lead = leadOf(); const goalTypes = opts('goalTypes', true).map((o) => ({ id: o.id, name: o.name }));
  const evFiles = [...new Set(evRedo.map((k) => tgt[k].ev).filter((v) => byId[v]))];
  const ruler = {}; // ピリオド → 'xml'（出場と同じ XML の時計）| 'same'（別のファイルだが同じ動画）| 'mp'（MATCH PLAY の時計）
  const scClocks = {};
  for (const k of evRedo) {
    const f = byId[tgt[k].ev]; if (!f) continue; const sc = fixX?.periods?.[k]?.sc; const r = rangeOf(f, k);
    if (sc && (sc.fileId === f.id || sc.file === f.name)) { ruler[k] = 'xml'; scClocks[k] = sc; }
    else if (sc && r && Math.abs(sc.ko - r.ko) < 2) { ruler[k] = 'same'; scClocks[k] = sc; }
    else ruler[k] = sc ? 'diff' : 'mp';
  }
  const res = evFiles.length ? buildImportFiles(evFiles.map((id) => ({ instances: instOf(byId[id]), assign: (byId[id].assign || []).map((k) => (evRedo.includes(k) && tgt[k].ev === id ? k : '-')), fid: id })), { R: Rx, M: Mx, W: ppWindows(Mx), members: m.members || {}, players: S.players, goalTypes, lead, shift: fu.shift, scClocks }) : null;
  const newEv = res ? res.events : [];
  const oldEv = live.filter((e) => evRedo.includes(e.period) && isImp(e));
  const editedOld = oldEv.filter(isEdited);
  fu.calc = { base, plans, ksPlay, Mx, newEv, oldEv, editedOld, evRedo, tgt, byId };

  // ---------- 画面 ----------
  const intro = `<h1>Sportscodeから取り込み</h1><p class="mu">Sportscode で書き出した XML・CSV を取り込んで、ピリオドごとに<b>出場・交代</b>と<b>イベント</b>に使います。表で「どのファイルを何に使うか」を選ぶと、下に何が替わるかが出るので、確かめてから「変更を反映」を押します。選んだ所しか替わりません。取り込んだファイルは試合に残るので、あとから使い道を変えられます。</p>`;
  const opt = (v, txt, sel) => `<option value="${esc(v)}" ${sel ? 'selected' : ''}>${esc(txt)}</option>`;
  const rows = keys.map((k) => {
    const isDone = doneKeys.includes(k);
    const playOpts = [opt('mp', 'MATCH PLAY' + (cur[k].manual && cur[k].play === 'mp' ? '（手で直した記録）' : ''), tgt[k].play === 'mp'), ...files.filter((f) => { const r = rangeOf(f, k); return r && hasPlayRows(instOf(f), r.ko, r.to); }).map((f) => opt(f.id, f.name, tgt[k].play === f.id))];
    if (String(cur[k].play).startsWith('name:')) playOpts.push(opt(cur[k].play, label(cur[k].play, k), tgt[k].play === cur[k].play));
    const evOpts = [opt('none', 'なし', tgt[k].ev === 'none'), ...files.filter((f) => rangeOf(f, k)).map((f) => opt(f.id, f.name, tgt[k].ev === f.id))];
    if (String(cur[k].ev).startsWith('name:')) evOpts.push(opt(cur[k].ev, label(cur[k].ev, k), tgt[k].ev === cur[k].ev));
    const chP = tgt[k].play !== cur[k].play, chE = evRedo.includes(k);
    return `<tr><td class="l"><b>${periodLabel(k)}</b>${isDone ? '' : '<small class="mu">（試合中）</small>'}</td>
      <td class="${chP ? 'ch' : ''}">${isDone ? `<select data-tp="${k}">${playOpts.join('')}</select>` : '<span class="mu">MATCH PLAY（ピリオドが終わると選べます）</span>'}${chP ? `<small class="was">今：${esc(label(cur[k].play, k))}</small>` : ''}</td>
      <td class="${chE ? 'ch' : ''}"><select data-te="${k}">${evOpts.join('')}</select><small class="mu">${cur[k].evN ? `今 ${cur[k].evN}件` : ''}</small>${chE && tgt[k].ev === cur[k].ev ? '<small class="was">出場が替わるので、新しい時計で入れ直します</small>' : chE ? `<small class="was">今：${esc(label(cur[k].ev, k))}</small>` : ''}</td>
      <td>${cur[k].appN}件</td></tr>`;
  }).join('');
  const table = `<div class="card"><h3>使い道（ピリオドごと）</h3><table class="fxtb sfu"><tr><th class="l"></th><th>出場・交代</th><th>イベント（ファイル）</th><th>アプリで入れたイベント</th></tr>${rows}</table>
    <p class="mu sm">出場・交代は MATCH PLAY かファイル1つ、イベントはファイル1つか「なし」。アプリで入れたイベントは、ファイルを替えても残ります。</p></div>`;
  // ファイルの一覧
  const usedBy = (id) => keys.flatMap((k) => [cur[k].play === id ? `${periodLabel(k)}の出場・交代` : null, cur[k].ev === id ? `${periodLabel(k)}のイベント` : null]).filter(Boolean);
  const fileRows = files.map((f) => {
    const inst = instOf(f); const kos = kickOffs(inst); const used = usedBy(f.id);
    const asg = kos.map((k, i) => `<span class="sfa">Kick Off ${i + 1}（動画 ${mmss(k.start * 1000)}）→ <select data-fa="${f.id}:${i}">${keys.map((x) => opt(x, periodLabel(x), (f.assign || [])[i] === x)).join('')}${opt('-', '使わない', (f.assign || [])[i] === '-')}</select></span>`).join('');
    const playR = keys.filter((k) => { const r = rangeOf(f, k); return r && hasPlayRows(inst, r.ko, r.to); });
    return `<div class="sff"><div class="sffh"><b>📄 ${esc(f.name)}</b><span class="mu sm">${f.kind === 'csv' ? 'CSV' : 'XML'}・${inst.length}件・${f.addedAt ? dt(f.addedAt) + ' に取り込み' : ''}</span>
      <button class="btn sm danger" data-fdelx="${f.id}" ${used.length ? 'disabled title="使っているファイルは消せません。上の表で使い道を外してから消してください"' : ''}>× 消す</button></div>
      <div class="mu sm">中身：${playR.length ? `#背番号の行あり（${playR.map(periodLabel).join('・')}）` : '#背番号の行なし'}・イベントのコード ${eventCodeCount(inst)}件　｜　使っている所：${used.length ? used.join('、') : 'なし'}</div><div class="sfas">${asg}</div></div>`;
  }).join('');
  const pick = `<div class="card"><h3>取り込んだファイル</h3>${fileRows || '<p class="mu">まだありません。</p>'}
    <div class="sipick" style="margin-top:10px"><label class="filebtn btn pri">ファイルを足す（XML・CSV）<input type="file" id="sfFile" accept=".xml,.csv,.XML,.CSV,text/xml,text/csv,application/xml" multiple hidden></label>
    <div class="sidrop" id="sfDrop"><b>ここにファイルをドラッグ＆ドロップ</b><span>前半・後半のファイルを一緒に入れられます</span></div></div>
    <p class="mu sm">足したファイルは、終わったピリオドで #背番号 の行があれば出場・交代に、イベントのコードがあればイベントに、初めから選んでおきます（上の表で変えられます）。同じ名前のファイルを足すと、新しい中身に置き換わります。</p></div>`;
  // 替わるもの
  let change = '';
  if (playCh.length || evRedo.length) {
    const cfg = base.cfg; const origin = playCh.some((k) => tgt[k].play === 'mp') ? scOrigin(m, base) : null;
    const pcards = playCh.map((k) => {
      const P = plans[k]; const curP = base.d.periods[k];
      if (!P) return `<div class="scper"><b>${periodLabel(k)}の出場・交代</b><div class="siwarn">⚠ このファイルから作れません</div></div>`;
      if (!P.ok) return `<div class="scper"><b>${periodLabel(k)}の出場・交代</b><div class="siwarn">⚠ ${esc(P.err)}</div>${P.missing?.length ? `<div class="siwarn">⚠ 試合メンバーにない背番号：${P.missing.map((n) => '#' + n).join('・')}</div>` : ''}</div>`;
      const nf = P.mp ? origin.periods[k] : P.fp;
      const A = totalsOf(curP, k), B = totalsOf(nf, k);
      const ids = [...new Set([...Object.keys(A), ...Object.keys(B)])].sort((a, b) => (cfg.members?.[a]?.pos === 'GK') - (cfg.members?.[b]?.pos === 'GK') || (parseInt(cfg.members?.[a]?.no, 10) || 999) - (parseInt(cfg.members?.[b]?.no, 10) || 999));
      const trs = ids.map((pid) => { const a = A[pid] || 0, b = B[pid] || 0, df = b - a; return `<tr class="${Math.abs(df) >= 20000 ? 'scbig' : ''}"><td class="l">${scNm(cfg, pid)}</td><td>${mmss(a)}</td><td><b>${mmss(b)}</b></td><td class="${df > 0 ? 'up' : df < 0 ? 'dn' : ''}">${Math.abs(df) < 1000 ? '±0' : (df > 0 ? '+' : '−') + mmss(Math.abs(df))}</td></tr>`; }).join('');
      return `<div class="scper on"><b>${periodLabel(k)}の出場・交代：${esc(label(cur[k].play, k))} → ${esc(label(tgt[k].play, k))}</b>
        ${P.mp ? `<div class="mu sm">MATCH PLAY で記録したままの形に戻します${cur[k].manual ? '（手で直した分も戻ります）' : ''}。</div>` : `<div class="scsum"><span>XML の時計 <b>${mmss(P.play * 1000)}</b> → ${mmss(curP.len || curP.elapsed)} に合わせる</span><span>交代 ${curP.ev.filter((e) => e.kind === 'sub').length}回 → <b>${P.fp.ev.filter((e) => e.kind === 'sub').length}回</b></span><span>GK：${P.gkFromXml ? 'XML の行' : '今の記録の GK（XML の FP の人数から）'}</span></div>${P.warn.map((w) => `<div class="fxinfo">ℹ ${esc(w)}</div>`).join('')}`}
        ${P.errs.length ? `<div class="fxerr"><b>このままでは替えられません</b><ul>${P.errs.map((e) => `<li>${esc(e)}</li>`).join('')}</ul></div>` : ''}
        <details open><summary>選手ごとの出場時間（今／替えたあと／差）</summary><table class="fxtb sctb"><tr><th class="l">選手</th><th>今</th><th>替えたあと</th><th>差</th></tr>${trs}</table></details></div>`;
    }).join('');
    const cnt = {}; for (const e of newEv) cnt[e.kind] = (cnt[e.kind] || 0) + 1;
    const order = ['shot', 'szshot', 'goal', 'z4', 'sz', 'fspat', 'oshot', 'oszshot', 'conc', 'oz4', 'osz', 'fspdf', 'rec', 'lost', 'foul', 'fouled'];
    const ecards = evRedo.map((k) => {
      const n = newEv.filter((e) => e.period === k).length, o = oldEv.filter((e) => e.period === k).length, ed = editedOld.filter((e) => e.period === k).length;
      const rl = ruler[k] === 'xml' ? '出場と同じ XML の時計で時刻を決めます（ぴったりそろいます）' : ruler[k] === 'same' ? '出場のファイルと同じ動画なので、出場の XML の時計で時刻を決めます' : ruler[k] === 'diff' ? '⚠ 出場のファイルと動画が違うので、MATCH PLAY の時計で時刻を決めます（誰が出ていたときかがずれることがあります）' : 'MATCH PLAY の時計で時刻を決めます';
      return `<div class="scper on"><b>${periodLabel(k)}のイベント：${esc(label(cur[k].ev, k))}（${o}件） → ${esc(label(tgt[k].ev, k))}（${n}件）</b>${tgt[k].ev !== 'none' ? `<div class="mu sm">${rl}</div>` : ''}${ed ? `<div class="siwarn">⚠ 今のイベントのうち <b>${ed}件はアプリで直してあります</b>。替えると、その直しは消えます。</div>` : ''}</div>`;
    }).join('');
    const warn = res ? [
      ...(res.unknownCodes.length ? [`読まないコード：${res.unknownCodes.map(([c, n]) => `${esc(c)}（${n}）`).join('、')}`] : []),
      ...(res.unmatched.length ? [`試合メンバーに見つからない選手：${res.unmatched.map(([c, n]) => `${esc(c)}（${n}）`).join('、')}`] : []),
      ...(res.warnings || []).map(([w, n]) => `${esc(w)}：${n}件`),
      ...(newEv.some((e) => /同じグループに2つ以上/.test(e.impWhy || '')) ? [`同じグループに2つ以上のラベルが付いたイベント：${newEv.filter((e) => /同じグループに2つ以上/.test(e.impWhy || '')).length}件（「要確認」にします）`] : []),
    ] : [];
    const chk = newEv.filter((e) => e.impWhy && !/同じグループに2つ以上/.test(e.impWhy)).length;
    const nm = (pid) => (pid === OPP_OG ? '相手OG' : pid && pid !== UNKNOWN ? `${m.members?.[pid]?.no ?? ''} ${S.players.find((p) => p.id === pid)?.last || ''}` : '');
    const goals = newEv.filter((e) => e.kind === 'goal' || e.kind === 'conc');
    const gT = goals.length ? `<table class="sctb"><tr><th></th><th>時刻（経過）</th><th>残り</th><th>得点者</th></tr>${goals.map((e) => { const p = Mx.periods.find((x) => x.key === e.period); return `<tr><td class="${e.kind === 'goal' ? 'w' : 'o'}">${e.kind === 'goal' ? '得点' : '失点'}</td><td>${p?.label || ''} ${mmss(e.at)}</td><td>${mmss((p?.len || 0) - e.at)}</td><td>${esc(nm(e.pid))}</td></tr>`; }).join('')}</table>` : '';
    const can = !badPlay.length;
    change = `<div class="card sfch"><h3>替わるもの</h3>${pcards}${ecards}
      ${newEv.length ? `<div class="sicnt">${order.filter((k) => cnt[k]).map((k) => `<span class="${KIND[k].team === 'opp' ? 'o' : 'w'}">${KIND[k].label}<b>${cnt[k]}</b></span>`).join('')}</div>${gT}` : ''}
      ${chk ? `<p class="mu sm">交代の前後3秒以内と、時計が止まっている間に交代があったイベント ${chk}件は「要確認」にします（動画で確かめて「このままにする」）。</p>` : ''}
      ${warn.length ? `<div class="siwarn">${warn.map((w) => `<div>⚠ ${w}</div>`).join('')}</div>` : ''}
      <div class="row end" style="gap:10px"><button class="btn" id="sfReset">選び直す（今のままに戻す）</button><button class="btn pri" id="sfGo" ${can ? '' : 'disabled'}>変更を反映</button></div></div>`;
  }
  const leadT = `<details class="card"><summary><b>コードごとの前後の秒数</b>　チームで覚えます</summary><table class="sctb"><tr><th>コード</th><th>コードの開始から何秒後がプレーの瞬間か</th></tr>${Object.keys(DEFAULT_LEAD).map((k) => `<tr><td>${LEAD_LABEL[k]}</td><td><input data-ld="${k}" value="${lead[k]}" inputmode="decimal"> 秒</td></tr>`).join('')}</table>
    <p class="mu sm">MATCH PLAY の時計で入れるときだけ：<span>${keys.map((k) => `${periodLabel(k)} <input data-sh="${k}" value="${fu.shift[k] ?? ''}" placeholder="0" inputmode="decimal" style="width:4em"> 秒ずらす`).join('　')}</span></p></details>`;
  return {
    active: 'acts', html: `<div class="scw siw">${crumb}${intro}${table}${change}${pick}${leadT}</div>`,
    bind: (root) => {
      root.querySelectorAll('[data-tp]').forEach((s2) => s2.onchange = () => { (fu.target[s2.dataset.tp] = fu.target[s2.dataset.tp] || {}).play = s2.value; render(); });
      root.querySelectorAll('[data-te]').forEach((s2) => s2.onchange = () => { (fu.target[s2.dataset.te] = fu.target[s2.dataset.te] || {}).ev = s2.value; render(); });
      root.querySelectorAll('[data-fa]').forEach((s2) => s2.onchange = () => { const [id, i] = s2.dataset.fa.split(':'); const f = byId[id]; if (!f) return; const a = [...(f.assign || [])]; a[+i] = s2.value; saveScFile(m.id, { ...f, assign: a }); render(); });
      root.querySelectorAll('[data-fdelx]').forEach((b) => b.onclick = async () => { const f = byId[b.dataset.fdelx]; if (!f) return; if (!(await confirmBox({ title: 'ファイルを消しますか？', body: `<p>${esc(f.name)} をこの試合から消します。今の記録（出場・イベント）は変わりません。</p>`, ok: '消す', danger: true }))) return; saveScFile(m.id, { id: f.id, name: f.name, deleted: true, data: '' }); for (const k of keys) { const t = fu.target[k]; if (t?.play === f.id) delete t.play; if (t?.ev === f.id) delete t.ev; } render(); });
      root.querySelectorAll('[data-sh]').forEach((i) => i.onchange = () => { const v = i.value.trim(); fu.shift[i.dataset.sh] = v === '' ? 0 : +v || 0; render(); });
      root.querySelectorAll('[data-ld]').forEach((i) => i.onchange = () => { const L = { ...(teamSettings().scLead || {}) }; L[i.dataset.ld] = +i.value || 0; put(teamPath(), { settings: { ...(S.team?.settings || {}), scLead: L } }); if (S.team) S.team.settings = { ...(S.team.settings || {}), scLead: L }; render(); });
      const fi = root.querySelector('#sfFile'); if (fi) fi.onchange = () => { if (fi.files?.length) loadFiles(m, fi.files, keys, doneKeys); fi.value = ''; };
      const dz = root.querySelector('#sfDrop');
      if (dz) {
        let depth = 0; const hasFile = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
        dz.addEventListener('dragenter', (e) => { if (!hasFile(e)) return; e.preventDefault(); depth++; dz.classList.add('over'); });
        dz.addEventListener('dragover', (e) => { if (!hasFile(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
        dz.addEventListener('dragleave', () => { depth = Math.max(0, depth - 1); if (!depth) dz.classList.remove('over'); });
        dz.addEventListener('drop', (e) => { if (!hasFile(e)) return; e.preventDefault(); e.stopPropagation(); depth = 0; dz.classList.remove('over'); if (e.dataTransfer.files?.length) loadFiles(m, e.dataTransfer.files, keys, doneKeys); });
      }
      if (!guarded) { guarded = true; for (const t of ['dragover', 'drop']) document.addEventListener(t, (e) => { if (location.hash.includes('/scimport') && [...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); if (t === 'drop' && !e.target.closest?.('#siDrop,#sfDrop')) toast('点線の枠の中に落としてください'); } }); }
      const rs = root.querySelector('#sfReset'); if (rs) rs.onclick = () => { fu.target = {}; render(); };
      const go = root.querySelector('#sfGo');
      if (go) go.onclick = async () => {
        const c = fu.calc; if (!c) return;
        const lines = [...c.ksPlay.map((k) => `${periodLabel(k)}の出場・交代 → ${esc(label(c.tgt[k].play, k))}`), ...c.evRedo.map((k) => `${periodLabel(k)}のイベント → ${esc(label(c.tgt[k].ev, k))}`)];
        if (!(await confirmBox({ title: '変更を反映しますか？', body: `<ul>${lines.map((l) => `<li>${l}</li>`).join('')}</ul>${c.editedOld.length ? `<p><b>アプリで直した取り込みのイベント ${c.editedOld.length}件の直しは消えます。</b></p>` : ''}<p>出場・交代は「記録の修正」の「1つ戻す」で戻せます。</p>`, ok: '反映する', danger: c.editedOld.length > 0 }))) return;
        if (c.ksPlay.length) scApplyPlans(m, c.base, c.ksPlay, c.plans);
        for (const e of c.oldEv) saveEvent(m.id, { ...e, deleted: true });
        const t = Date.now(); let n = 0, chk = 0;
        const oldIds = new Set(c.oldEv.map((e) => e.id));
        const kept = evC.list.filter((e) => !e.deleted && !oldIds.has(e.id));
        const evs = c.newEv.map((e, i) => { const f = c.byId[c.tgt[e.period].ev]; const ev = { ...e, imp: t, impFile: f?.name || '', impFileId: f?.id, seq: t + i, id: `sc${t.toString(36)}_${i}` }; delete ev.check; return ev; });
        const cards = cardIssues([...kept, ...evs], c.Mx.periods.map((p) => p.key));
        for (const ev of evs) { const r = checkOf(c.Mx, ev, cards); ev.check = r.check; if (r.why) ev.checkWhy = r.why; if (ev.check) chk++; saveEvent(m.id, ev); n++; }
        fu.target = {};
        toast(`反映しました${c.ksPlay.length ? `（出場・交代 ${c.ksPlay.map(periodLabel).join('・')}）` : ''}${n ? `（イベント ${n}件${chk ? `・要確認 ${chk}件` : ''}）` : ''}`);
        render();
      };
    },
  };
}
