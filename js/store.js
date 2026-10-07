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

export const DEFAULT_OPTIONS = {
  activityTypes: ['合宿', '大会', 'リーグ戦の節', '遠征', '練習試合'],
  matchCategories: ['予選リーグ', '決勝トーナメント', '順位決定戦'],
  goalTypes: ['定位置', 'トランジション', 'CK', 'CK-KI', 'KI', 'FK', 'GK活用', 'パワープレー', 'パワープレー返し', 'PK', '第2PK', 'OG'],
};
export const DEFAULT_TEAM_SETTINGS = { colorOrange: 120, colorRed: 180, setplayAuto: 60, refMin: 120 };
export const DEFAULT_TIMES = { half: 20, extra: false, extraHalf: 5 };

let F = null; // { fsM, db }
const listeners = new Set();
export const S = {
  ready: { global: false, teams: false, team: false },
  global: null,          // { activityTypes:[{id,name,hidden}], ... }
  teams: [],             // all teams (not deleted)
  teamId: null,
  team: null,
  players: [], activities: [], matches: [],
  pending: false,        // any local write not yet confirmed by the server
  fromCache: true,
};
const pend = {};
let unsubTeam = [];

export function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
let queued = false;
function emit() {
  if (queued) return; queued = true;
  queueMicrotask(() => { queued = false; listeners.forEach((f) => f()); });
}
function track(key, snap) {
  pend[key] = snap.metadata.hasPendingWrites;
  S.pending = Object.values(pend).some(Boolean);
  S.fromCache = snap.metadata.fromCache;
}

const optList = (names) => names.map((n, i) => ({ id: 'o' + i + '_' + n, name: n, hidden: false }));

export function initStore(fsM, db) {
  F = { fsM, db };
  const { onSnapshot, doc, collection } = fsM;
  onSnapshot(doc(db, 'config', 'global'), { includeMetadataChanges: true }, (snap) => {
    track('global', snap);
    const v = snap.exists() ? snap.data() : {};
    const g = {};
    for (const k of Object.keys(DEFAULT_OPTIONS)) g[k] = Array.isArray(v[k]) && v[k].length ? v[k] : optList(DEFAULT_OPTIONS[k]);
    S.global = g; S.ready.global = true; emit();
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

export let lastError = null;
function onErr(e) { lastError = e; console.error(e); emit(); }

export function selectTeam(teamId) {
  if (S.teamId === teamId && unsubTeam.length) return;
  unsubTeam.forEach((u) => u()); unsubTeam = [];
  S.teamId = teamId; S.players = []; S.activities = []; S.matches = [];
  S.team = S.teams.find((t) => t.id === teamId) || null;
  S.ready.team = false;
  try { teamId ? localStorage.setItem('fpt.team', teamId) : localStorage.removeItem('fpt.team'); } catch {}
  if (!teamId) { emit(); return; }
  const { onSnapshot, collection } = F.fsM;
  let got = 0;
  for (const [key, field] of [['players', 'players'], ['activities', 'activities'], ['matches', 'matches']]) {
    unsubTeam.push(onSnapshot(collection(F.db, 'teams', teamId, key), { includeMetadataChanges: true }, (snap) => {
      track(key, snap);
      S[field] = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((x) => !x.deleted);
      if (++got >= 3) S.ready.team = true;
      emit();
    }, onErr));
  }
  emit();
}

export function newId(coll = 'x') { return F.fsM.doc(F.fsM.collection(F.db, coll)).id; }

// Write with merge. Not awaited by callers: offline writes resolve only once they reach the server.
export function put(path, data) {
  const { setDoc, doc, serverTimestamp } = F.fsM;
  const ref = doc(F.db, ...path);
  setDoc(ref, { ...data, updatedAt: serverTimestamp() }, { merge: true }).catch(onErr);
}
export const del = () => F.fsM.deleteField();
export const now = () => F.fsM.serverTimestamp();

// ---------- helpers on top of the state ----------
export const teamPath = (...rest) => ['teams', S.teamId, ...rest];
export const teamSettings = () => ({ ...DEFAULT_TEAM_SETTINGS, ...(S.team?.settings || {}) });
export const opts = (k, includeHidden = false) => (S.global?.[k] || []).filter((o) => includeHidden || !o.hidden);
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
  if (m.status === 'done') return m.incomplete ? '未入力あり' : '記録完了';
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
const opsCache = {}; // matchId -> { list, unsub, pending }
export function watchOps(matchId) {
  if (opsCache[matchId]) return opsCache[matchId];
  const c = (opsCache[matchId] = { list: [], unsub: null, ready: false, pending: false });
  const { onSnapshot, collection } = F.fsM;
  c.unsub = onSnapshot(collection(F.db, 'teams', S.teamId, 'matches', matchId, 'ops'), { includeMetadataChanges: true }, (snap) => {
    track('ops_' + matchId, snap);
    c.list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    c.ready = true; c.pending = snap.metadata.hasPendingWrites;
    emit();
  }, onErr);
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
