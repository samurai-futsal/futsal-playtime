// Events (spec 6章・13章). Pure helpers shared by the input screen, the review and the tests.
// An event = { id, period, at (ms elapsed, whole seconds), kind, seq, side, ...fields, check?, src, deleted? }
// Only time + event are needed to record. Fields marked req (● 資料に出る) count as 未入力 while empty.

export const MAIN_OWN = ['shot', 'szshot', 'z4', 'sz', 'goal', 'fspat'];
export const MAIN_OPP = ['oshot', 'oszshot', 'oz4', 'osz', 'conc', 'fspdf'];
export const SUBS = ['rec', 'lost', 'foul', 'fouled'];
export const KIND = {
  shot: { label: 'シュート', team: 'own' }, szshot: { label: 'SZ内シュート', team: 'own' },
  z4: { label: 'Z4進入', team: 'own' }, sz: { label: 'SZ進入', team: 'own' },
  goal: { label: '得点', team: 'own' }, fspat: { label: 'FINISH SET PLAY AT', short: 'FINISH SET PLAY<br>AT', team: 'own' },
  oshot: { label: '被シュート', team: 'opp' }, oszshot: { label: '被SZ内シュート', team: 'opp' },
  oz4: { label: '被Z4進入', team: 'opp' }, osz: { label: '被SZ進入', team: 'opp' },
  conc: { label: '失点', team: 'opp' }, fspdf: { label: 'FINISH SET PLAY DF', short: 'FINISH SET PLAY<br>DF', team: 'opp' },
  rec: { label: 'ボールリカバリー', team: 'own', sub: true }, lost: { label: 'ボールロスト', team: 'own', sub: true },
  foul: { label: 'ファール', team: 'own', sub: true }, fouled: { label: '被ファール', team: 'own', sub: true },
};
export const RESULTS = [['in', '枠内'], ['out', '枠外'], ['block', 'ブロック'], ['post', 'ポスト']];
export const CLS = [['pos', '定位置'], ['set', 'セットプレー'], ['trans', 'トランジション'], ['gk', 'GK活用'], ['special', '特殊局面']];
export const SETP = [['CK', 'CK'], ['CK-KI', 'CK-KICK IN'], ['KI', 'KICK IN'], ['FK', 'FK'], ['PK', 'PK（6m）'], ['2PK', '第2PK（10m）']];
export const FSP = [['CK', 'CK'], ['CK-KI', 'CK-KI'], ['KI', 'KI'], ['FK', 'FK'], ['PK', 'PK'], ['2PK', '第2PK']];
export const METHODS = [['dribble', 'ドリブル'], ['pass', 'パス'], ['rebound', 'リバウンド']];
export const ZONES = [['Z4', '相手陣'], ['Z3', '相手陣'], ['Z2', '自陣'], ['Z1', '自陣']];
export const CARDS = [['none', 'カードなし'], ['yellow', 'イエロー'], ['red', 'レッド']];
export const UNKNOWN = '?';      // 不明（確認したが分からない＝入力済み）
export const OPP_OG = 'oppOG';   // 得点者「相手OG」
export const NO_ASSIST = 'none';
const lab = (list, v) => (list.find((x) => x[0] === v) || [])[1];
export const isShot = (k) => ['shot', 'szshot', 'oshot', 'oszshot'].includes(k);
export const isSZ = (k) => k === 'szshot' || k === 'oszshot';
export const isFsp = (k) => k === 'fspat' || k === 'fspdf';
export const hasCls = (k) => isShot(k) || k === 'z4' || k === 'oz4';
export const isOG = (name) => name === 'OG';

// 得点・失点の種類（名前）から分類を決める（spec 6章「攻撃の分類」）
export function clsOfGoalType(name) {
  if (['CK', 'CK-KI', 'KI', 'FK', 'PK', '第2PK'].includes(name)) return 'set';
  if (name === 'パワープレー' || name === 'パワープレー返し') return 'special';
  if (name === '定位置') return 'pos';
  if (name === 'トランジション') return 'trans';
  if (name === 'GK活用') return 'gk';
  return null;
}

// 空いている「●（資料に出る）」の数。goalName(id) は得点の種類の名前を返す
export function missing(ev, goalName = (x) => x) {
  const k = ev.kind; const e = (v) => (v == null || v === '' ? 1 : 0);
  let n = 0;
  if (isShot(k)) {
    if (KIND[k].team === 'own') n += e(ev.pid);
    n += e(ev.result) + e(ev.cls);
    if (!isSZ(k)) n += e(ev.n); // SZ内の人数は任意
  } else if (k === 'z4' || k === 'oz4') n += e(ev.cls);
  else if (k === 'goal') {
    n += e(ev.pid);
    if (ev.pid !== OPP_OG) {
      n += e(ev.assist) + e(ev.gtype) + e(ev.sz);
      if (ev.sz === 'out') n += e(ev.n);
    }
  } else if (k === 'conc') {
    n += e(ev.gtype);
    if (!isOG(goalName(ev.gtype))) { n += e(ev.sz); if (ev.sz === 'out') n += e(ev.n); }
  } else if (isFsp(k)) n += e(ev.fsp);
  else if (k === 'rec' || k === 'lost') n += e(ev.pid);
  else if (k === 'foul' || k === 'fouled') n += e(ev.pid) + e(ev.card);
  return n;
}

// ---------- ピッチの5人 ----------
const isGK = (cfg, pid) => cfg.members?.[pid]?.pos === 'GK';
// side: 'before' = 交代の直前の5人、'after' = 直後の5人（同じ秒に交代があるときだけ違う）
export function pitchAt(M, period, at, side = 'before') {
  const ss = M.stints.filter((s) => s.period === period);
  const useAfter = side === 'after' || at === 0;
  const on = ss.filter((s) => (useAfter ? s.from <= at && at < s.to : s.from < at && at <= s.to));
  // ピリオドの終わり（または記録の先）：最後に出ていた5人
  const res = on.length ? on : ss.filter((s) => s.to === Math.max(...ss.map((x) => x.to)));
  const uniq = [...new Map(res.map((s) => [s.pid, s])).values()];
  return uniq.map((s) => s.pid).sort((a, b) => (isGK(M.cfg, b) - isGK(M.cfg, a)) || ((parseInt(M.cfg.members?.[a]?.no, 10) || 999) - (parseInt(M.cfg.members?.[b]?.no, 10) || 999)));
}
// その秒に交代（出場の区切り）があるか
export function subAtSecond(M, period, at) {
  const p = M.periods.find((x) => x.key === period);
  return M.stints.some((s) => s.period === period && ((s.from === at && at > 0) || (s.to === at && at < (p?.elapsed ?? Infinity))));
}

// ---------- 分類の初めの選択（spec 6章・13章） ----------
// 自チームのGKがいない区間、相手の5x4の時間帯 → 特殊局面。前後5秒以内に同じ側のFINISH SET PLAY → セットプレー
export function autoCls(M, events, ev) {
  if (!hasCls(ev.kind)) return null;
  const on = pitchAt(M, ev.period, ev.at, ev.side);
  const gkOn = on.some((pid) => isGK(M.cfg, pid));
  const p = M.periods.find((x) => x.key === ev.period);
  const opp5 = (M.pp || []).some((x) => x.period === ev.period && x.team === 'opp' && x.from <= ev.at && ev.at < (x.to ?? p?.elapsed ?? Infinity));
  if ((on.length && !gkOn) || opp5) return 'special';
  const want = KIND[ev.kind].team === 'own' ? 'fspat' : 'fspdf';
  if (events.some((x) => !x.deleted && x.id !== ev.id && x.kind === want && x.period === ev.period && Math.abs(x.at - ev.at) <= 5000)) return 'set';
  return null;
}

// 記録上その時刻にピッチにいない選手を選んだか（要確認）
export function needsCheck(M, ev) {
  const on = new Set(pitchAt(M, ev.period, ev.at, ev.side));
  const picked = [ev.pid, ev.pid2, ev.assist, ev.og].filter((x) => x && x !== UNKNOWN && x !== OPP_OG && x !== NO_ASSIST);
  return picked.some((pid) => !on.has(pid));
}

export const liveEvents = (list) => list.filter((e) => !e.deleted);
export function sortEvents(list, periodOrder) {
  const po = (k) => periodOrder.indexOf(k);
  return list.slice().sort((a, b) => po(a.period) - po(b.period) || a.at - b.at || (a.seq || 0) - (b.seq || 0));
}

// 一覧の1行の説明
export function summary(ev, nm, goalName = (x) => x) {
  const P = (pid) => (pid === UNKNOWN ? '不明' : pid === OPP_OG ? '相手OG' : pid ? nm(pid) : null);
  const parts = [];
  const k = ev.kind;
  if (k === 'z4' || k === 'sz') {
    if (ev.method === 'pass') parts.push(`パス ${P(ev.pid) || '?'} → ${P(ev.pid2) || '?'}`);
    else if (ev.method) parts.push(`${lab(METHODS, ev.method)} ${P(ev.pid) || ''}`.trim());
  } else if (k === 'goal') {
    if (ev.pid) parts.push(P(ev.pid) + (ev.assist && ev.assist !== NO_ASSIST ? `（A ${P(ev.assist)}）` : ev.assist === NO_ASSIST ? '（Aなし）' : ''));
  } else if (ev.pid) parts.push(P(ev.pid));
  if (ev.result) parts.push(lab(RESULTS, ev.result));
  if (ev.gtype) parts.push(goalName(ev.gtype));
  if (k === 'conc' && ev.og) parts.push(`OG ${P(ev.og)}`);
  if (ev.sz) parts.push(ev.sz === 'in' ? 'SZ内' : 'SZ外');
  if (ev.n != null && ev.n !== '') parts.push(`${ev.n}人`);
  if (ev.cls) parts.push(lab(CLS, ev.cls) + (ev.sp ? `（${lab(SETP, ev.sp)}）` : ''));
  if (ev.fsp) parts.push(lab(FSP, ev.fsp));
  if (ev.zone) parts.push(ev.zone);
  if (ev.card && ev.card !== 'none') parts.push(lab(CARDS, ev.card));
  if ((k === 'foul' || k === 'fouled') && ev.card === 'none') parts.push('カードなし');
  return parts.join('・');
}
