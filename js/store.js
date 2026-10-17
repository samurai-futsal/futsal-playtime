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

// ---------- MATCH PLAY operations (teams/{t}/matches/{m}/ops/{id}) ----------
// Append-only: an op is never changed or deleted (undo and reset are new ops). See engine.js.
const opsCache = {}; // matchId -> { list, unsub, pending, fromCache, srvAt, checkAt, cacheAt }
// srvAt = サーバーから最新を受け取った（fromCache:false）最後の時刻。checkAt = つなぎ直しを始めた時刻（確認中の表示用）
export function watchOps(matchId, keep) {
  if (opsCache[matchId]) return opsCache[matchId];
  const c = (opsCache[matchId] = { list: keep?.list || [], unsub: null, ready: !!keep?.ready, pending: false, fromCache: true, srvAt: keep?.srvAt || 0, checkAt: Date.now(), cacheAt: Date.now() });
  const { onSnapshot, collection } = F.fsM;
  c.unsub = onSnapshot(collection(F.db, 'teams', S.teamId, 'matches', matchId, 'ops'), { includeMetadataChanges: true }, (snap) => {
    track('ops_' + matchId, snap);
    c.list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    c.ready = true; c.pending = snap.metadata.hasPendingWrites;
    if (snap.metadata.fromCache) { if (!c.fromCache) c.cacheAt = Date.now(); c.fromCache = true; }
    else { c.fromCache = false; c.srvAt = Date.now(); c.checkAt = 0; }
    emitSoon();
  }, onErr);
  return c;
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
const evCache = {};
const todoSent = {}; // 同じ数を何度も書かない
export function watchEvents(matchId) {
  if (evCache[matchId]) return evCache[matchId];
  const c = (evCache[matchId] = { list: [], ready: false });
  const { onSnapshot, collection } = F.fsM;
  onSnapshot(collection(F.db, 'teams', S.teamId, 'matches', matchId, 'events'), { includeMetadataChanges: true }, (snap) => {
    track('ev_' + matchId, snap);
    c.list = snap.docs.map((d) => ({ id: d.id, ...d.data() })); c.ready = true;
    // 試合の状態「未入力あり n」：未入力の項目か要確認が残っているイベントの数を試合に書いておく（一覧で使う）
    if (!snap.metadata.fromCache || snap.metadata.hasPendingWrites) {
      const gn = (id) => opts('goalTypes', true).find((o) => o.id === id)?.name || '';
      const n = todoCount(c.list, gn); const m = matchById(matchId);
      if (m && (m.evTodo ?? 0) !== n && todoSent[matchId] !== n) { todoSent[matchId] = n; put(teamPath('matches', matchId), { evTodo: n }); }
    }
    emitSoon();
  }, onErr);
  return c;
}
export function saveEvent(matchId, ev) {
  const id = ev.id || newId();
  const data = { ...ev, id, src: ev.src || 'app', dev: deviceId(), t: Date.now() };
  for (const k of Object.keys(data)) if (data[k] === undefined) delete data[k];
  const c = watchEvents(matchId);
  c.list = [...c.list.filter((x) => x.id !== id), data]; // すぐ画面に出す
  const { setDoc, doc } = F.fsM;
  setDoc(doc(F.db, 'teams', S.teamId, 'matches', matchId, 'events', id), data).catch(onErr);
  emit();
  return data;
}
// 一部の項目だけを書き足す（⚠要確認とその理由、「このままにする」など）。文書のほかの項目・入れた端末（dev）は変えない
export function patchEvent(matchId, id, data) {
  const c = watchEvents(matchId);
  c.list = c.list.map((x) => (x.id === id ? { ...x, ...data } : x));
  const { setDoc, doc } = F.fsM;
  setDoc(doc(F.db, 'teams', S.teamId, 'matches', matchId, 'events', id), data, { merge: true }).catch(onErr);
  emit();
}
export function deleteEvent(matchId, id) {
  const c = watchEvents(matchId); const ev = c.list.find((x) => x.id === id); if (!ev) return;
  saveEvent(matchId, { ...ev, deleted: true });
}
