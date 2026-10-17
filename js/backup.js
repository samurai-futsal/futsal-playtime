// バックアップ：書き出し・試合が終わったときのお知らせ・ファイルから戻す（spec 5章）。
import { S, put, fbHandle, saveOptions, markMatchChanged } from './store.js';
import { checkFile, fileCounts, planRestore, reviveDates, SUBS, MSUBS } from './restoreplan.js';
import { $$, esc, openModal, closeModal, confirmTwice, toast } from './ui.js';
import { render } from './views.js';

let appVersion = '';
export function setBackupVersion(v) { appVersion = v; }

// 最後にバックアップを書き出した時刻：クラウド（config/global.lastBackup）。古い版の端末の記録（この端末だけ）も見る
export function lastBackupAt() {
  let local = 0; try { local = +localStorage.getItem('fpt.lastBackup') || 0; } catch {}
  return Math.max(S.lastBackup || 0, local);
}
function markBackedUp() {
  const t = Date.now();
  try { localStorage.setItem('fpt.lastBackup', String(t)); } catch {}
  put(['config', 'global'], { lastBackup: t });
}

// ---------- 書き出し ----------
// 全チームの記録を読む。ネットにつながっていないときは端末に残っている分だけになるので、fromCache で知らせる
async function readAll() {
  const { fsM, db } = fbHandle();
  let fromCache = false;
  const note = (s) => { if (s?.metadata?.fromCache) fromCache = true; return s; };
  const getDocSafe = async (ref) => {
    try { return note(await fsM.getDoc(ref)); } catch (e) {
      if (fsM.getDocFromCache) { fromCache = true; try { return await fsM.getDocFromCache(ref); } catch { return null; } }
      throw e;
    }
  };
  const col = async (...p) => note(await fsM.getDocs(fsM.collection(db, ...p))).docs.map((d) => ({ id: d.id, ...d.data() }));
  const out = { app: 'futsal-playtime', version: appVersion, exportedAt: new Date().toISOString(), config: {}, teams: [] };
  const [g, teams] = await Promise.all([getDocSafe(fsM.doc(db, 'config', 'global')), col('teams')]);
  out.config.global = g && g.exists() ? g.data() : null;
  // 読み出しはまとめて並べて行う（1件ずつ待たない）
  out.teams = await Promise.all(teams.map(async (t) => {
    const [players, activities, matches] = await Promise.all(SUBS.map((sub) => col('teams', t.id, sub)));
    await Promise.all(matches.map(async (m) => {
      const subs = await Promise.all(MSUBS.map((sub) => col('teams', t.id, 'matches', m.id, sub)));
      MSUBS.forEach((sub, i) => { m[sub] = subs[i]; });
    }));
    return { ...t, players, activities, matches };
  }));
  return { out, fromCache };
}
const stamp = () => { const d = new Date(); return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`; };
function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
export async function exportBackup() {
  let res;
  toast('バックアップを作っています…');
  try { res = await readAll(); } catch (e) { console.error(e); toast('書き出せませんでした（' + (e.code || e.message) + '）'); return; }
  const { out, fromCache } = res;
  const json = JSON.stringify(out, (k, v) => (v && typeof v.toDate === 'function' ? v.toDate().toISOString() : v), 2);
  const name = `出場時間_バックアップ_${stamp()}.json`;
  const blob = new Blob([json], { type: 'application/json' });
  let file = null; try { file = new File([blob], name, { type: 'application/json' }); } catch {}
  const canShare = !!(file && navigator.share && navigator.canShare && navigator.canShare({ files: [file] }));
  if (!canShare && !fromCache) { download(blob, name); markBackedUp(); toast('バックアップを書き出しました'); return; }
  // 共有（iPad・PC）：共有 →「"ファイル"に保存」で、ファイルアプリやフォルダを選んで保存できる。ダウンロードもそのまま選べる
  const m = openModal(`<h2>バックアップの準備ができました</h2><div class="mbody">
    ${fromCache ? '<div class="note bad"><b>ネットにつながっていないため、この端末にある記録だけです。</b>ほかの端末で入れた記録が入っていないことがあります。ネットにつながってから、もう一度書き出してください。</div>' : ''}
    <p class="mu">ファイル名：${esc(name)}（${Math.ceil(blob.size / 1024)} KB）</p>
    ${canShare ? '<p class="mu">「共有」を押して、出てきた一覧から「"ファイル"に保存」などを選ぶと、保存する場所を選べます。</p>' : ''}
  </div><div class="mfoot"><button class="btn" data-c>やめる</button><button class="btn ${canShare ? '' : 'pri'}" data-dl>ダウンロード</button>${canShare ? '<button class="btn pri" data-sh>共有 → ファイルに保存</button>' : ''}</div>`);
  m.querySelector('[data-c]').onclick = closeModal;
  m.querySelector('[data-dl]').onclick = () => { download(blob, name); markBackedUp(); closeModal(); toast('バックアップを書き出しました'); };
  const sh = m.querySelector('[data-sh]');
  sh && (sh.onclick = async () => {
    try { await navigator.share({ files: [file], title: name }); markBackedUp(); closeModal(); toast('バックアップを保存しました'); }
    catch (e) { if (e?.name !== 'AbortError') toast('共有できませんでした。「ダウンロード」を使ってください'); }
  });
}

// ---------- 試合が終わったときのお知らせ（未2） ----------
// reason：同じ理由で何度も聞かないための印（例 'end:' + 試合のid）。ほかの画面のお知らせが出ているときは、閉じてから出す
export function promptBackup(reason = '') {
  if (reason) {
    try {
      const asked = JSON.parse(localStorage.getItem('fpt.bkAsked') || '[]');
      if (asked.includes(reason)) return;
      asked.push(reason); localStorage.setItem('fpt.bkAsked', JSON.stringify(asked.slice(-100)));
    } catch {}
  }
  let tries = 0;
  const show = () => {
    if (document.querySelector('.modal-bg') && tries++ < 150) { setTimeout(show, 800); return; }
    const lb = lastBackupAt();
    const m = openModal(`<h2>試合が終わりました。バックアップを書き出しますか？</h2><div class="mbody bkask">
      <p class="mu">全チームの記録をファイルに残しておくと、端末が壊れたときも戻せます。最後に書き出した日時：${lb ? new Date(lb).toLocaleString('ja-JP') : 'まだありません'}</p></div>
      <div class="mfoot"><button class="btn" data-later>あとで</button><button class="btn pri" data-go>書き出す</button></div>`);
    m.querySelector('[data-later]').onclick = closeModal;
    m.querySelector('[data-go]').onclick = () => { closeModal(); exportBackup(); };
  };
  show();
}

// ---------- ファイルから戻す（未1） ----------
const LABEL = { teams: 'チーム', players: '選手', activities: '活動', matches: '試合', ops: '交代・時計の記録', events: 'イベント', fixlog: '記録の修正の履歴' };
const countTable = (c) => `<table class="rstab">${Object.keys(LABEL).map((k) => `<tr><th>${LABEL[k]}</th><td>${c[k]}${k === 'players' ? '人' : '件'}</td></tr>`).join('')}</table>`;

export async function restoreFromFile(f) {
  let o;
  try { o = JSON.parse(await f.text()); } catch { return toast('ファイルが読めません（バックアップのファイルを選んでください）'); }
  const bad = checkFile(o); if (bad) return toast(bad);
  const all = fileCounts(o);
  const when = o.exportedAt ? new Date(o.exportedAt).toLocaleString('ja-JP') : '不明';
  const m = openModal(`<h2>ファイルから戻す</h2><div class="mbody">
    <p>書き出した日時：<b>${esc(when)}</b>（バージョン ${esc(o.version || '不明')}）</p>
    <div class="rsgrid"><div><h3>ファイルの中身</h3>${countTable(all)}</div>
    <div><h3>戻すチーム</h3>${o.teams.map((t) => { const c = fileCounts(o, [t.id]); return `<label class="pick"><input type="checkbox" data-team="${esc(t.id)}" checked>${esc(t.name || '（名前なし）')}${t.deleted ? '（削除したチーム）' : ''}<small class="mu">　試合 ${c.matches}件・選手 ${c.players}人</small></label>`; }).join('') || '<p class="mu">チームがありません</p>'}</div></div>
    <h3>戻し方</h3>
    <label class="rad rsmode"><input type="radio" name="rsMode" value="add" checked><span><b>足りない記録だけを足す</b>（おすすめ）<br><small class="mu">ネット上の保存に無い記録だけを足します。ネット上の保存にある記録は変えません。削除した記録は戻しません。</small></span></label>
    <label class="rad rsmode"><input type="radio" name="rsMode" value="replace"><span><b>丸ごと置き換える</b><br><small class="mu">選んだチームの記録を、ファイルの中身に置き換えます。ファイルのあとで入れた記録は消えます。</small></span></label>
  </div><div class="mfoot"><button class="btn" data-c>やめる</button><button class="btn pri" data-next>次へ（確かめる）</button></div>`, { wide: true });
  m.querySelector('[data-c]').onclick = closeModal;
  m.querySelector('[data-next]').onclick = async () => {
    const teamIds = $$('[data-team]', m).filter((x) => x.checked).map((x) => x.dataset.team);
    const mode = m.querySelector('[name=rsMode]:checked').value;
    if (!teamIds.length) return toast('戻すチームを選んでください');
    if (!navigator.onLine) return toast('ネットにつながっているときに使えます（ネット上の保存と比べるため）');
    const btn = m.querySelector('[data-next]'); btn.disabled = true; btn.textContent = 'ネット上の保存と比べています…';
    let cloud;
    try { cloud = await readCloud(o, teamIds); } catch (e) { console.error(e); closeModal(); return toast('ネット上の保存を読めませんでした（' + (e.code || e.message) + '）'); }
    if (cloud.fromCache) { closeModal(); return toast('ネット上の保存につながっていないため、戻せません。ネットにつながってから、もう一度お試しください'); }
    const plan = planRestore(o, cloud, { mode, teamIds, cloudGlobal: S.globalRaw });
    confirmPlan(o, plan, mode, teamIds);
  };
}
// クラウドの今の記録（選んだチームの分）。ファイルにもクラウドにもある試合は、その中の記録も読む
async function readCloud(o, teamIds) {
  const { fsM, db } = fbHandle();
  let fromCache = false;
  const note = (s) => { if (s?.metadata?.fromCache) fromCache = true; return s; };
  const map = (snap) => Object.fromEntries(snap.docs.map((d) => [d.id, d.data()]));
  const teams = {};
  await Promise.all(o.teams.filter((t) => teamIds.includes(t.id)).map(async (t) => {
    const [td, ...subs] = await Promise.all([fsM.getDoc(fsM.doc(db, 'teams', t.id)).then(note), ...SUBS.map((s) => fsM.getDocs(fsM.collection(db, 'teams', t.id, s)).then(note))]);
    const ct = { data: td.exists() ? td.data() : null, sub: {} };
    SUBS.forEach((s, i) => { ct[s] = map(subs[i]); });
    await Promise.all((t.matches || []).filter((x) => ct.matches[x.id]).map(async (x) => {
      const ss = await Promise.all(MSUBS.map((s) => fsM.getDocs(fsM.collection(db, 'teams', t.id, 'matches', x.id, s)).then(note)));
      ct.sub[x.id] = Object.fromEntries(MSUBS.map((s, i) => [s, map(ss[i])]));
    }));
    teams[t.id] = ct;
  }));
  return { teams, fromCache };
}
function confirmPlan(o, plan, mode, teamIds) {
  const c = plan.count; const nOpt = Object.values(plan.options).reduce((n, x) => n + Object.keys(x).length, 0);
  const nothing = !plan.writes.length && !nOpt;
  const m = openModal(`<h2>${mode === 'add' ? '足りない記録だけを足す' : '丸ごと置き換える'}</h2><div class="mbody">
    <div class="rsgrid"><div><h3>戻すファイルの中身（選んだチーム）</h3>${countTable(fileCounts(o, teamIds))}</div>
    <div><h3>ネット上の保存に書くこと</h3><table class="rstab">
      <tr><th>足す記録</th><td>${c.added}件</td></tr>
      ${mode === 'replace' ? `<tr><th>ファイルの内容で置き換える記録</th><td>${c.replaced}件</td></tr><tr><th>ファイルに無いので消す記録</th><td>${c.removed}件</td></tr>` : `<tr><th>ネット上の保存にあるので変えない記録</th><td>${c.kept}件</td></tr>`}
      ${c.skippedDeleted ? `<tr><th>削除してあるので戻さない記録</th><td>${c.skippedDeleted}件</td></tr>` : ''}
      ${nOpt ? `<tr><th>足す選択肢</th><td>${nOpt}件</td></tr>` : ''}
    </table></div></div>
    ${nothing ? '<div class="note">足りない記録はありません。ネット上の保存にすべて入っています。</div>' : ''}
    ${mode === 'replace' ? '<div class="note bad">置き換えると、ファイルのあとで入れた記録（交代・イベント・修正など）は消えます。元に戻せません。</div>' : ''}
  </div><div class="mfoot"><button class="btn" data-c>やめる</button>${nothing ? '' : `<button class="btn ${mode === 'replace' ? 'danger' : 'pri'}" data-go>${mode === 'add' ? '足す' : '置き換える'}</button>`}</div>`, { wide: true });
  m.querySelector('[data-c]').onclick = closeModal;
  const go = m.querySelector('[data-go]');
  go && (go.onclick = async () => {
    if (mode === 'replace') {
      const names = o.teams.filter((t) => teamIds.includes(t.id)).map((t) => `「${esc(t.name || '')}」`).join('');
      const ok = await confirmTwice(
        { title: '丸ごと置き換えますか？', body: `<p>${names}の記録を、ファイル（${esc(o.exportedAt ? new Date(o.exportedAt).toLocaleString('ja-JP') : '')}）の中身に置き換えます。</p>`, ok: '置き換える', danger: true },
        { title: '本当に置き換えますか？', body: '<p>ファイルのあとで入れた記録は消えます。元に戻せません。</p>', ok: '置き換える', danger: true });
      if (!ok) return;
    }
    applyPlan(plan);
  });
}
async function applyPlan(plan) {
  const { fsM, db } = fbHandle();
  const toTs = fsM.Timestamp?.fromDate ? (d) => fsM.Timestamp.fromDate(d) : null;
  const m = openModal('<h2>戻しています…</h2><div class="mbody"><p id="rsProg">0%</p><p class="mu">終わるまで、この画面のままお待ちください。</p></div>');
  const prog = (t) => { const el = m.querySelector('#rsProg'); if (el) el.textContent = t; };
  try {
    const N = 400; // 1回にまとめて書く数（Firestore の上限は500）
    for (let i = 0; i < plan.writes.length; i += N) {
      const b = fsM.writeBatch(db);
      for (const w of plan.writes.slice(i, i + N)) {
        const ref = fsM.doc(db, ...w.path);
        if (w.op === 'delete') b.delete(ref);
        else b.set(ref, reviveDates(w.data, toTs), w.op === 'merge' ? { merge: true } : undefined);
      }
      await b.commit();
      // 試合の記録（ops・イベント）を戻したら、その試合の「変わった印」も書きかえる（ほかの端末が端末の保存だけで済ませないように）
      for (const k of new Set(plan.writes.slice(i, i + N).filter((w) => w.path[0] === 'teams' && w.path[2] === 'matches' && w.path.length >= 4).map((w) => w.path[1] + '/' + w.path[3]))) markMatchChanged(...k.split('/'));
      prog(`${Math.min(100, Math.round((i + N) / plan.writes.length * 100))}%（${Math.min(plan.writes.length, i + N)} / ${plan.writes.length}件）`);
    }
    for (const [k, patch] of Object.entries(plan.options)) saveOptions(k, patch);
    closeModal();
    toast(`戻しました（${plan.writes.length}件）`);
    render();
  } catch (e) {
    console.error(e); closeModal();
    toast('途中で止まりました（' + (e.code || e.message) + '）。もう一度「足りない記録だけを足す」で続きを戻せます');
  }
}
