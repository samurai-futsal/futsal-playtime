// Data layer. All data lives in Firestore with the on-device cache enabled, so every write is
// saved on the device first and sent to the cloud when online (spec 5章).
// Records are never hard-deleted from the app: deletion sets `deleted: true` so that a deletion
// also syncs to other devices (spec 5章「削除の同期」).
//
// Layout:
//   config/global                      全チーム共通の選択肢（活動の種類・試合の区分・得点失点の種類）
//   teams/{teamId}                     チーム（name, archived, deleted, settings{...}）
//   teams/{teamId}/players/{id}        選手マスター
//   teams/{teamId}/activities/{id}     活動（members: {playerId: {no}} = 招集メンバー）
//   teams/{teamId}/matches/{id}        試合（members: {playerId: {no,pos,pp,order}} = 試合メンバー）

import { todoCount } from './events.js';
import { DEFAULT_OPTIONS, OPT_KEYS, readOptions, hasMap, fullMap, nameTaken, renamePatch, resolveDoc, normalizeWrite } from './options.js';

export { DEFAULT_OPTIONS };
export const DEFAULT_TEAM_SETTINGS = { colorOrange: 120, colorRed: 180, setplayAuto: 60, refMin: 120, setMin: 60, runOrange: 180, runRed: 300 };
export const DEFAULT_TIMES = { half: 20, extra: false, extraHalf: 5 };

let F = null; // { fsM, db }
const listeners = new Set();
export const S = {
  ready: { global: false, teams: false, team: false },
  global: null,          // { activityTypes:[{id,name,hidden,order}], ... }（options.js）
  globalRaw: {},         // config/global の中身そのまま
  lastBackup: 0,         // 最後にバックアップを書き出した時刻（config/global.lastBackup、全端末で共通）
  teams: [],             // all teams (not deleted)
  teamId: null,
  team: null,
  players: [], activities: [], matches: [],
  pending: false,        // any local write not yet confirmed by the server
  fromCache: true,
};
const pend = {};
let unsubTeam = [];
// 活動・試合は読んだままの形を取っておき、選択肢の今の名前をそろえた写しを S に出す（名前を変えたらすぐ全部に出る）
const raw = { activities: [], matches: [] };
function derive() {
  if (!S.global) return;
  S.activities = raw.activities.map((a) => resolveDoc(a, S.global.activityTypes, 'type', 'typeId'));
  S.matches = raw.matches.map((m) => resolveDoc(m, S.global.matchCategories, 'category', 'categoryId'));
}

export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
let queued = false;
let soon = null, soonAt = 0; // emitSoon（下）
function emit() {
  if (queued) return; queued = true;
  queueMicrotask(() => { queued = false; if (soon) { clearTimeout(soon); soon = null; } listeners.forEach((f) => f()); }); // 待っている描き直しも、この1回で済む
}
// 一覧の知らせ（スナップショット）から描き直すときは、少しまとめてから：分析で全試合を開くと、試合ごとの記録・イベントの知らせが
// 何十件も続けて届き、そのたびに画面全体を描き直していた（50試合で140回・数秒）。続けて届く間は 0.2秒に1回まで。
// この端末の操作（addOp・saveEvent など）はこれまでどおりすぐ描き直す。
function emitSoon() {
  if (soon) return;
  soon = setTimeout(() => { soon = null; soonAt = Date.now(); emit(); }, Math.max(30, soonAt + 200 - Date.now()));
}
// 同期待ち：見ている一覧の「まだ送っていない書き込み」に加えて、この端末が書いてまだサーバーに届いていない
// 書き込みすべて（記録の修正の履歴、ほかのチームの記録など、いま見ていないものも）を数える。
// 書き込みの数え方は setDoc / バッチの完了だけで行い、一覧の知らせの中では何も書かない。
let inflight = 0, bootPending = false;
function updPending() {
  const p = inflight > 0 || bootPending || Object.values(pend).some(Boolean);
  if (p !== S.pending) { S.pending = p; emit(); }
}
function track(key, snap) {
  pend[key] = snap.metadata.hasPendingWrites;
  S.pending = inflight > 0 || bootPending || Object.values(pend).some(Boolean);
  S.fromCache = snap.metadata.fromCache;
}
function counted(p) {
  inflight++; updPending();
  const done = () => { inflight--; updPending(); };
  p.then(done, done);
  return p;
}

export function initStore(fsM, db) {
  // setDoc と writeBatch().commit() を数える版に包む（store.js のどの書き込みも同期の表示に入る）
  const wrapped = {
    ...fsM,
    setDoc: (...a) => counted(fsM.setDoc(...a)),
    ...(fsM.deleteDoc ? { deleteDoc: (...a) => counted(fsM.deleteDoc(...a)) } : {}),
    ...(fsM.writeBatch ? { writeBatch: (...a) => { const b = fsM.writeBatch(...a); const c = b.commit.bind(b); b.commit = () => counted(c()); return b; } } : {}),
  };
  F = { fsM: wrapped, db };
  // 前に開いたときの、まだ送れていない書き込み（アプリを閉じる前のもの）も「同期待ち」に入れる
  if (fsM.waitForPendingWrites) {
    bootPending = true;
    fsM.waitForPendingWrites(db).catch(() => {}).finally(() => { bootPending = false; updPending(); });
  }
  const { onSnapshot, doc, collection } = fsM;
  onSnapshot(doc(db, 'config', 'global'), { includeMetadataChanges: true }, (snap) => {
    track('global', snap);
    const v = snap.exists() ? snap.data() : {};
    S.globalRaw = v;
    S.global = readOptions(v);
    S.lastBackup = typeof v.lastBackup === 'number' ? v.lastBackup : 0;
    S.ready.global = true; derive(); emit();
  }, onErr);
  onSnapshot(collection(db, 'teams'), { includeMetadataChanges: true }, (snap) => {
    track('teams', snap);
    S.teams = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((t) => !t.deleted)
      .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'ja'));
    S.ready.teams = true;
    if (S.teamId) S.team = S.teams.find((t) => t.id === S.teamId) || null;
    emit();
  }, onErr);
}
export const fbHandle = () => F; // バックアップ（backup.js）用

export let lastError = null;
function onErr(e) { lastError = e; console.error(e); emit(); }

export function selectTeam(teamId) {
  if (S.teamId === teamId && unsubTeam.length) return;
  unsubTeam.forEach((u) => u()); unsubTeam = [];
  S.teamId = teamId; S.players = []; S.activities = []; S.matches = []; raw.activities = []; raw.matches = [];
  S.team = S.teams.find((t) => t.id === teamId) || null;
  S.ready.team = false;
  try { teamId ? localStorage.setItem('fpt.team', teamId) : localStorage.removeItem('fpt.team'); } catch {}
  if (!teamId) { emit(); return; }
  const { onSnapshot, collection } = F.fsM;
  let got = 0;
  for (const [key, field] of [['players', 'players'], ['activities', 'activities'], ['matches', 'matches']]) {
    unsubTeam.push(onSnapshot(collection(F.db, 'teams', teamId, key), { includeMetadataChanges: true }, (snap) => {
      track(key, snap);
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((x) => !x.deleted);
      if (field === 'players') S.players = list; else { raw[field] = list; derive(); }
      if (field === 'matches') { matchesSync = !snap.metadata.fromCache && !snap.metadata.hasPendingWrites; sweepLive(); noteLiveAll(); }
      if (++got >= 3) S.ready.team = true;
      emitSoon();
    }, onErr));
  }
  emit();
}

export function newId(coll = 'x') { return F.fsM.doc(F.fsM.collection(F.db, coll)).id; }

// Write with merge. Not awaited by callers: offline writes resolve only once they reach the server.
export function put(path, data) {
  const { setDoc, doc, serverTimestamp } = F.fsM;
  // 試合の区分・活動の種類は、名前で渡されても選択肢の id で保存する（options.js）
  if (path[0] === 'teams' && path.length === 4 && S.global) {
    if (path[2] === 'matches') data = normalizeWrite(data, S.global.matchCategories, 'category', 'categoryId');
    if (path[2] === 'activities') data = normalizeWrite(data, S.global.activityTypes, 'type', 'typeId');
  }
  const ref = doc(F.db, ...path);
  setDoc(ref, { ...data, updatedAt: serverTimestamp() }, { merge: true }).catch(onErr);
}
export const del = () => F.fsM.deleteField();
export const now = () => F.fsM.serverTimestamp();

// ---------- helpers on top of the state ----------
export const teamPath = (...rest) => ['teams', S.teamId, ...rest];
export const teamSettings = () => ({ ...DEFAULT_TEAM_SETTINGS, ...(S.team?.settings || {}) });
export const opts = (k, includeHidden = false) => (S.global?.[k] || []).filter((o) => includeHidden || !o.hidden);
// 選択肢を1件ずつ書く（optMap に merge。2台で同時に別の選択肢を直しても消し合わない）。
// patch = { [id]: {name?, hidden?, order?} }。まだ古い形（配列）のときは、今の一覧をまるごと新しい形にして書く。
export function saveOptions(k, patch) {
  const base = hasMap(S.globalRaw, k) ? {} : fullMap(S.global[k]);
  for (const [id, p] of Object.entries(patch)) base[id] = { ...(base[id] || {}), ...p };
  put(['config', 'global'], { optMap: { [k]: base } });
}
// 名前を変える／足す。同じ名前があれば false
export function renameOption(k, id, name) {
  if (nameTaken(S.global[k], name, id)) return false;
  const o = S.global[k].find((x) => x.id === id); if (!o) return false;
  saveOptions(k, { [id]: renamePatch(o, name) }); return true;
}
export function addOption(k, name) {
  if (nameTaken(S.global[k], name)) return false;
  const order = Math.max(-1, ...S.global[k].map((o, i) => (Number.isFinite(o.order) && o.order < 1e9 ? o.order : i))) + 1;
  saveOptions(k, { ['o' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5)]: { name, hidden: false, order } }); return true;
}
// 消す（一度も使っていない選択肢だけ。使ったかどうかは呼ぶ側で確かめる）
export function deleteOption(k, id) {
  const base = hasMap(S.globalRaw, k) ? {} : fullMap(S.global[k]);
  base[id] = del();
  put(['config', 'global'], { optMap: { [k]: base } });
}
export function moveOption(k, from, to) {
  const list = [...S.global[k]]; const [x] = list.splice(from, 1); list.splice(to, 0, x);
  saveOptions(k, Object.fromEntries(list.map((o, i) => [o.id, { order: i }])));
}
export const optName = (k, id) => (S.global?.[k] || []).find((o) => o.id === id)?.name || '';
export { OPT_KEYS };
export const playerById = (id) => S.players.find((p) => p.id === id);
export const activityById = (id) => S.activities.find((a) => a.id === id);
export const matchById = (id) => S.matches.find((m) => m.id === id);
export const playerName = (p) => (p ? `${p.last || ''} ${p.first || ''}`.trim() : '（不明な選手）');

export function sortPlayers(list) {
  return [...list].sort((a, b) => (a.pos === b.pos ? 0 : a.pos === 'GK' ? -1 : 1)
    || (a.kana || a.last || '').localeCompare(b.kana || b.last || '', 'ja'));
}
export function matchesOf(activityId) {
  return S.matches.filter((m) => m.activityId === activityId)
    .sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.kickoff || '').localeCompare(b.kickoff || '') || (a.createdOrder || 0) - (b.createdOrder || 0));
}
// 試合の状態（spec 14章）。①の段階では「準備中」「準備完了」まで。
export function matchStatus(m) {
  if (m.status === 'playing') return '試合中';
  if (m.status === 'done') return m.evTodo > 0 ? '未入力あり' : '記録完了';
  return Object.keys(m.members || {}).length >= 5 ? '準備完了' : '準備中';
}
// A player counts as 出場済み once a match they are a member of has started. Used to protect records.
export function playedPlayerIds(activityId = null) {
  const ids = new Set();
  for (const m of S.matches) {
    if (activityId && m.activityId !== activityId) continue;
    if (m.status === 'playing' || m.status === 'done') Object.keys(m.members || {}).forEach((id) => ids.add(id));
  }
  return ids;
}
export function inAnyMatch(playerId) { return S.matches.some((m) => (m.members || {})[playerId]); }
export const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

// ---------- 記録（ops・イベント）の読み方：読み取り回数を抑える（2026-10-17 決13） ----------
// 無料プラン（Spark）は1日5万回まで読める。前は分析で全試合を開くと、試合ごとに ops とイベントの「聞き続ける読み方」
// （onSnapshot）を2つずつ付けたままにしていた。アプリを開き直して30分以上たつと、聞き始めるたびに全部の文書を
// サーバーから読み直す（1試合 約400件 → 100試合で約4万回）。そこで読み方を2つに分ける：
//  ① 聞き続ける（live）：試合中の試合と、画面に開いている試合（#/m/{id}… の画面：試合ページ・MATCH PLAY・
//     イベント入力・マッチレビュー・記録の修正など）だけ。ほかの端末の記録がすぐ届く（これまでどおり）。
//  ② 1回だけ読む（snap）：それ以外（終わった試合を分析・書き出しで使うとき）。
//     試合の文書（matches/{id}）に「変わった印」revOps・revEv を持たせ、この端末で ops・イベントを書くたびに
//     新しい値に書きかえる（同じ一瞬の書き込みは1回にまとめる。flushRev）。試合の一覧は聞き続けているので、
//     ほかの端末が書きかえた印もすぐ届く。
//     端末には「この試合の ops を、印が r のときに n 件、まるごと受け取った」というメモ（localStorage fpt.rc）を残す。
//     読むとき：メモの印が今の印と同じなら、端末の保存（Firestore のキャッシュ、getDocsFromCache）から読む＝
//     サーバーの読み取りは0回。件数が n より少ない（保存が消されていた）・印が違う・メモがないときだけ、
//     サーバーから読む（getDocs）。オフラインのときは getDocs が端末の保存を返すので、それを出して、
//     つながったら（online）読み直す。
//  安全のため：一覧の知らせ（onSnapshot の中）では何も書かない（前に evTodo の書き込みで止まらなくなったことがある）。
//  印を書くのは、この端末の書き込み（addOp・saveEvent・patchEvent・バックアップから戻す）のときだけ。
//  読み込みが終わっても書かない。何度描き直しても、印が同じなら読み直さない（tried で覚える）。
//  注意：この版より前のアプリは印を書かない。前の版の端末で終わった試合のイベントを直したときは、
//  その試合を画面で開くと（①になり）最新になる。
const KINDS = {
  ops: { coll: 'ops', rev: 'revOps', cache: null },
  ev: { coll: 'events', rev: 'revEv', cache: null },
};
let matchesSync = false; // 試合の一覧の最後の知らせが、サーバーで確かめたもので、まだ送っていない書き込みもないか
const liveRe = /^#\/m\/([^/?]+)/;
// 純粋な判断（test/readplan.test.mjs で確かめる）
// 聞き続けるか：試合中か、その試合の画面を開いているか
export function wantLiveFor(m, matchId, hash) {
  if (m && m.status === 'playing') return true;
  const x = liveRe.exec(hash || ''); return !!x && x[1] === matchId;
}
// 1回だけ読む試合を、今読むか。c＝今の写し { ready, rev, tried, loading }、cur＝試合の文書の今の印
// 'keep'＝今の写しのまま／'load'＝読む／'wait'＝読み込み中か、この印ではもう読んだ（オフラインで確かめられなかった）
export function snapPlan(c, cur) {
  if (c.loading) return 'wait';
  if (c.ready && c.rev === cur) return 'keep';
  if (c.tried === cur) return 'wait';
  return 'load';
}
// 端末の保存から読んだ結果を使ってよいか（メモ mk = { rev, n }、size＝端末の保存にあった件数）
export const cacheUsable = (mk, cur, size) => !!mk && mk.rev === cur && size >= mk.n && size > 0;
// 印の値（なければ ''＝まだ一度も書いていない試合）
export const revOf = (m, field) => (m && m[field] != null ? String(m[field]) : '');
// メモ（端末に保存）
const RC = 'fpt.rc';
let rcMem = null;
const rcAll = () => { if (rcMem) return rcMem; try { rcMem = JSON.parse(localStorage.getItem(RC) || '{}') || {}; } catch { rcMem = {}; } return rcMem; };
const rcKey = (teamId, matchId, kind) => `${teamId}/${matchId}/${kind}`;
function rcGet(teamId, matchId, kind) { const v = rcAll()[rcKey(teamId, matchId, kind)]; return v ? { rev: v[0], n: v[1] } : null; }
function rcSet(teamId, matchId, kind, rev, n) {
  const all = rcAll(), k = rcKey(teamId, matchId, kind), v = all[k];
  if (v && v[0] === rev && v[1] === n) return;
  all[k] = [rev, n];
  try { localStorage.setItem(RC, JSON.stringify(all)); } catch {}
}
// 同じ中身なら前の配列をそのまま使う（分析の計算の使い回しが効くように）
function sameList(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i].id !== b[i].id || JSON.stringify(a[i]) !== JSON.stringify(b[i])) return false;
  return true;
}
const wantLive = (matchId) => wantLiveFor(matchById(matchId), matchId, typeof location !== 'undefined' ? location.hash : '');
// 聞き続けている写しに、印のメモを残す（サーバーで確かめた最新で、まだ送っていない書き込みがないときだけ）
function noteLive(kind, matchId, c) {
  if (!c.unsub || !c.srvOk || !matchesSync || c.team !== S.teamId) return;
  const m = matchById(matchId); if (!m) return;
  rcSet(c.team, matchId, kind, revOf(m, KINDS[kind].rev), c.list.length);
}
function noteLiveAll() {
  for (const [kind, K] of Object.entries(KINDS)) for (const [id, c] of Object.entries(K.cache)) noteLive(kind, id, c);
}
// 聞き続ける必要がなくなった試合は、聞くのをやめる（読んだ中身はそのまま使う）
function sweepLive() {
  for (const [kind, K] of Object.entries(KINDS)) for (const [id, c] of Object.entries(K.cache)) {
    if (!c.unsub || wantLive(id)) continue;
    noteLive(kind, id, c);
    c.unsub(); c.unsub = null;
    delete pend[(kind === 'ops' ? 'ops_' : 'ev_') + id];
    // 最後に受け取ったのがサーバーで確かめたものなら、その時の印の写しとして使い続ける。そうでなければ次に読み直す
    const mk = rcGet(c.team, id, kind);
    c.rev = mk && c.srvOk && mk.n === c.list.length ? mk.rev : undefined; c.tried = undefined;
  }
}
if (typeof addEventListener === 'function') {
  addEventListener('hashchange', () => { if (F) { sweepLive(); } });
  // つながったら、オフラインで確かめられなかった写しを読み直す
  addEventListener('online', () => {
    let any = false;
    for (const K of Object.values(KINDS)) for (const c of Object.values(K.cache)) if (!c.unsub && c.tried !== undefined && c.rev !== c.tried) { c.tried = undefined; any = true; }
    if (any) emit();
  });
}
// ops・イベントの写しを返す（なければ作る）。画面からは描くたびに呼ばれる
function ensure(kind, matchId, onSnap) {
  const K = KINDS[kind];
  const c = K.cache[matchId];
  if (wantLive(matchId)) { if (!c.unsub) listen(kind, matchId, c, onSnap); return c; }
  if (c.unsub) return c; // 一覧の知らせで外す（sweepLive）まではそのまま
  const m = matchById(matchId);
  if (!m) return c; // 試合の一覧がまだ：届いたら描き直すのでそのとき読む
  const cur = revOf(m, K.rev);
  if (snapPlan(c, cur) === 'load') loadSnap(kind, matchId, c, cur);
  return c;
}
function listen(kind, matchId, c, onSnap) {
  const K = KINDS[kind]; const { onSnapshot, collection } = F.fsM;
  c.team = S.teamId; c.srvOk = false;
  c.unsub = onSnapshot(collection(F.db, 'teams', c.team, 'matches', matchId, K.coll), { includeMetadataChanges: true }, (snap) => {
    if (!c.unsub) return; // やめたあとに届いた知らせ
    c.srvOk = !snap.metadata.fromCache && !snap.metadata.hasPendingWrites;
    onSnap(snap);
    noteLive(kind, matchId, c);
  }, onErr);
}
async function loadSnap(kind, matchId, c, cur) {
  const K = KINDS[kind]; const { getDocs, getDocsFromCache, collection } = F.fsM;
  const team = S.teamId;
  c.loading = true; c.tried = cur; c.team = team;
  const ref = collection(F.db, 'teams', team, 'matches', matchId, K.coll);
  let snap = null, ok = false, srv = false;
  try {
    const mk = rcGet(team, matchId, kind);
    if (mk && mk.rev === cur && getDocsFromCache) {
      try { const s = await getDocsFromCache(ref); if (cacheUsable(mk, cur, s.docs.length)) { snap = s; ok = true; } } catch {}
    }
    if (!snap) {
      try { snap = await getDocs(ref); srv = ok = !snap.metadata.fromCache; } catch (e) { try { if (getDocsFromCache) snap = await getDocsFromCache(ref); } catch {} }
    }
  } finally { c.loading = false; }
  if (c.unsub || S.teamId !== team) return; // そのあいだに聞き始めた（その知らせが新しい）・チームを変えた
  if (snap) {
    const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    if (!(c.ready && sameList(c.list, list))) c.list = list;
    c.ready = true; c.pending = !!snap.metadata.hasPendingWrites;
  }
  if (ok) { c.rev = cur; c.fromCache = !srv; if (srv) { c.srvAt = Date.now(); rcSet(team, matchId, kind, cur, snap.docs.length); } }
  else { c.rev = undefined; c.fromCache = true; } // オフラインなど：見せるが、つながったら読み直す
  emitSoon();
}
// この端末で ops・イベントを書いたら、試合の文書の印を書きかえる（同じ一瞬の書き込みは試合ごとに1回）。
// 書き込みの順番どおりにサーバーに届くので、ほかの端末で印が変わって見えたときは、記録も届いている。
const revQ = new Map(); // `${team}/${match}` → Set(印の項目)
let revSeq = 0;
function bumpRev(teamId, matchId, fields) {
  if (!teamId || !matchId) return;
  if (!revQ.size) queueMicrotask(flushRev);
  const k = teamId + '/' + matchId; const set = revQ.get(k) || new Set(); fields.forEach((f) => set.add(f)); revQ.set(k, set);
}
function flushRev() {
  const { setDoc, doc } = F.fsM;
  for (const [k, set] of revQ) {
    const [t, m] = k.split('/');
    const tok = `${deviceId()}.${Date.now().toString(36)}.${(++revSeq).toString(36)}`;
    setDoc(doc(F.db, 'teams', t, 'matches', m), Object.fromEntries([...set].map((f) => [f, tok])), { merge: true }).catch(onErr);
  }
  revQ.clear();
}
// バックアップから戻したあと（backup.js）：その試合の記録が変わったので、ほかの端末にも読み直してもらう
export function markMatchChanged(teamId, matchId) { bumpRev(teamId, matchId, ['revOps', 'revEv']); }

// ---------- MATCH PLAY operations (teams/{t}/matches/{m}/ops/{id}) ----------
// Append-only: an op is never changed or deleted (undo and reset are new ops). See engine.js.
const opsCache = (KINDS.ops.cache = {}); // matchId -> { list, unsub, pending, fromCache, srvAt, checkAt, cacheAt, rev, tried, loading, team, srvOk }
// srvAt = サーバーから最新を受け取った（fromCache:false）最後の時刻。checkAt = つなぎ直しを始めた時刻（確認中の表示用）
// 聞き続けるか1回だけ読むかは ensure が決める（上）
export function watchOps(matchId, keep) {
  const c = opsCache[matchId] || (opsCache[matchId] = { list: keep?.list || [], unsub: null, ready: !!keep?.ready, pending: false, fromCache: true, srvAt: keep?.srvAt || 0, checkAt: Date.now(), cacheAt: Date.now() });
  return ensure('ops', matchId, (snap) => {
    track('ops_' + matchId, snap);
    c.list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    c.ready = true; c.pending = snap.metadata.hasPendingWrites;
    if (snap.metadata.fromCache) { if (!c.fromCache) c.cacheAt = Date.now(); c.fromCache = true; }
    else { c.fromCache = false; c.srvAt = Date.now(); c.checkAt = 0; }
    emitSoon();
  });
}
// 同期（閲覧専用の画面用）：通信をつなぎ直して、この試合の記録を取り直す。記録は一切書かない。
// 表示中の数字は消さずに残し、サーバーから最新が届いたら置きかわる。
let resyncing = null;
export function resyncOps(matchId) {
  const old = opsCache[matchId];
  if (old) { old.unsub && old.unsub(); delete opsCache[matchId]; }
  const c = watchOps(matchId, old);
  emit();
  if (!resyncing) {
    const { disableNetwork, enableNetwork } = F.fsM;
    resyncing = Promise.resolve()
      .then(() => disableNetwork && disableNetwork(F.db)).then(() => enableNetwork && enableNetwork(F.db))
      .catch(() => {}).finally(() => { resyncing = null; });
  }
  setTimeout(emit, 10500); // 10秒たっても届かなければ「つながっていません」に切りかえるため描き直す
  return c;
}
let opSeq = (() => { try { return +localStorage.getItem('fpt.opSeq') || 0; } catch { return 0; } })();
export function addOp(matchId, op) {
  const id = newId();
  const rec = { ...op, t: op.t ?? Date.now(), n: ++opSeq, dev: deviceId() };
  try { localStorage.setItem('fpt.opSeq', String(opSeq)); } catch {}
  const c = watchOps(matchId);
  c.list = [...c.list, { id, ...rec }]; // show immediately (the snapshot confirms it a moment later)
  const { setDoc, doc } = F.fsM;
  setDoc(doc(F.db, 'teams', S.teamId, 'matches', matchId, 'ops', id), rec).catch(onErr);
  bumpRev(S.teamId, matchId, ['revOps']);
  emit();
  return { id, ...rec };
}
export function deviceId() {
  try {
    let id = localStorage.getItem('fpt.deviceId');
    if (!id) { id = Math.random().toString(36).slice(2, 10) + Date.now().toString(36); localStorage.setItem('fpt.deviceId', id); }
    return id;
  } catch { return 'unknown'; }
}

// ---------- 記録の修正の履歴（teams/{t}/matches/{m}/fixlog/{id}、spec 8章「履歴」） ----------
const logCache = {};
export function watchFixLog(matchId) {
  if (logCache[matchId]) return logCache[matchId];
  const c = (logCache[matchId] = { list: [], ready: false });
  const { onSnapshot, collection } = F.fsM;
  onSnapshot(collection(F.db, 'teams', S.teamId, 'matches', matchId, 'fixlog'), {}, (snap) => {
    c.list = snap.docs.map((d) => ({ id: d.id, ...d.data() })); c.ready = true; emitSoon();
  }, onErr);
  return c;
}
// 履歴の1行を書き換える（保存した直しを戻したときの印など）
export function updFixLog(matchId, id, data) {
  const { setDoc, doc } = F.fsM;
  const c = watchFixLog(matchId); c.list = c.list.map((x) => (x.id === id ? { ...x, ...data } : x));
  setDoc(doc(F.db, 'teams', S.teamId, 'matches', matchId, 'fixlog', id), data, { merge: true }).catch(onErr);
  emit();
}
export function addFixLog(matchId, rec) {
  const id = newId();
  const { setDoc, doc } = F.fsM;
  const data = { ...rec, t: Date.now(), dev: deviceId() };
  const c = watchFixLog(matchId); c.list = [...c.list, { id, ...data }];
  setDoc(doc(F.db, 'teams', S.teamId, 'matches', matchId, 'fixlog', id), data).catch(onErr);
  emit();
}

// ---------- イベント（teams/{t}/matches/{m}/events/{id}、spec 6章・13章） ----------
// 1件ずつの文書。直すときは上書き、消すときは deleted:true（ほかの端末にも消したことが届く）。
const evCache = (KINDS.ev.cache = {});
const todoSent = {}; // 同じ数を何度も書かない
export function watchEvents(matchId) {
  const c = evCache[matchId] || (evCache[matchId] = { list: [], ready: false, unsub: null });
  return ensure('ev', matchId, (snap) => {
    track('ev_' + matchId, snap);
    c.list = snap.docs.map((d) => ({ id: d.id, ...d.data() })); c.ready = true;
    // 試合の状態「未入力あり n」：未入力の項目か要確認が残っているイベントの数を試合に書いておく（一覧で使う）
    // （聞き続けている試合＝画面に開いている試合・試合中の試合だけ。1回だけ読む試合では書かない）
    if (!snap.metadata.fromCache || snap.metadata.hasPendingWrites) {
      const gn = (id) => opts('goalTypes', true).find((o) => o.id === id)?.name || '';
      const n = todoCount(c.list, gn); const m = matchById(matchId);
      if (m && (m.evTodo ?? 0) !== n && todoSent[matchId] !== n) { todoSent[matchId] = n; put(teamPath('matches', matchId), { evTodo: n }); }
    }
    emitSoon();
  });
}
export function saveEvent(matchId, ev) {
  const id = ev.id || newId();
  const data = { ...ev, id, src: ev.src || 'app', dev: deviceId(), t: Date.now() };
  for (const k of Object.keys(data)) if (data[k] === undefined) delete data[k];
  const c = watchEvents(matchId);
  c.list = [...c.list.filter((x) => x.id !== id), data]; // すぐ画面に出す
  const { setDoc, doc } = F.fsM;
  setDoc(doc(F.db, 'teams', S.teamId, 'matches', matchId, 'events', id), data).catch(onErr);
  bumpRev(S.teamId, matchId, ['revEv']);
  emit();
  return data;
}
// 一部の項目だけを書き足す（⚠要確認とその理由、「このままにする」など）。文書のほかの項目・入れた端末（dev）は変えない
export function patchEvent(matchId, id, data) {
  const c = watchEvents(matchId);
  c.list = c.list.map((x) => (x.id === id ? { ...x, ...data } : x));
  const { setDoc, doc } = F.fsM;
  setDoc(doc(F.db, 'teams', S.teamId, 'matches', matchId, 'events', id), data, { merge: true }).catch(onErr);
  bumpRev(S.teamId, matchId, ['revEv']);
  emit();
}
export function deleteEvent(matchId, id) {
  const c = watchEvents(matchId); const ev = c.list.find((x) => x.id === id); if (!ev) return;
  saveEvent(matchId, { ...ev, deleted: true });
}
