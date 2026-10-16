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
// 被ファール（相手選手へのカード）：相手の選手は記録しないので「イエロー2枚目（退場）」をボタンで選ぶ
export const CARDS_OPP = [['none', 'カードなし'], ['yellow', 'イエロー'], ['y2', 'イエロー2枚目（退場）'], ['red', 'レッド']];
export const CARD_LABEL = { none: 'カードなし', yellow: 'イエロー', y2: 'イエロー2枚目（退場）', red: 'レッド' };
// カードを数える形にする。自チームのファールは、同じ選手の2枚目のイエローを自動で「y2」にする（2026-10-16 決定）
// 返す：Map(ev.id → 'yellow'|'y2'|'red')（カードなしは入れない）
export function cardsOf(events, periodOrder = []) {
  const po = (k) => periodOrder.indexOf(k);
  const list = events.filter((e) => !e.deleted && (e.kind === 'foul' || e.kind === 'fouled') && e.card && e.card !== 'none')
    .sort((a, b) => po(a.period) - po(b.period) || a.at - b.at || (a.seq || 0) - (b.seq || 0));
  const out = new Map(); const yel = new Map();
  for (const e of list) {
    let c = e.card;
    if (e.kind === 'foul' && c === 'yellow' && e.pid && e.pid !== UNKNOWN) {
      const n = (yel.get(e.pid) || 0) + 1; yel.set(e.pid, n);
      if (n >= 2) c = 'y2';
    }
    out.set(e.id, c);
  }
  return out;
}
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

// 入力の3段階（2026-10-16 決定）：基本＝試合の概略に必要（空きは「未入力」）／詳細＝資料を充実させる（空きは「詳細 n」）／任意＝今は資料に使わない
// 空いている数を段階ごとに返す。goalName(id) は得点の種類の名前を返す
export function missingLv(ev, goalName = (x) => x) {
  const k = ev.kind; const e = (v) => (v == null || v === '' ? 1 : 0);
  let b = 0, d = 0;
  if (isShot(k)) {
    if (KIND[k].team === 'own') d += e(ev.pid);
    b += e(ev.result); d += e(ev.cls);
    if (!isSZ(k)) d += e(ev.n); // SZ内の人数は任意
  } else if (k === 'z4' || k === 'sz') {
    d += e(ev.method);
    if (ev.method === 'pass') d += e(ev.pid) + e(ev.pid2);
    else if (ev.method) d += e(ev.pid);
    if (k === 'z4') d += e(ev.cls);
  } else if (k === 'oz4') d += e(ev.cls);
  else if (k === 'goal') {
    b += e(ev.pid);
    if (ev.pid !== OPP_OG) {
      d += e(ev.assist) + e(ev.gtype) + e(ev.sz);
      if (ev.sz === 'out') d += e(ev.n);
    }
  } else if (k === 'conc') {
    d += e(ev.gtype);
    if (isOG(goalName(ev.gtype))) d += e(ev.og);
    else { d += e(ev.sz); if (ev.sz === 'out') d += e(ev.n); }
  } else if (isFsp(k)) d += e(ev.fsp);
  else if (k === 'rec' || k === 'lost') d += e(ev.pid);
  else if (k === 'foul') { d += e(ev.pid); b += e(ev.card); }
  else if (k === 'fouled') b += e(ev.card); // 受けた選手は任意
  return { basic: b, detail: d };
}
// 「未入力」＝基本の空きの数（試合の状態「未入力あり」に使う）
export const missing = (ev, goalName) => missingLv(ev, goalName).basic;

// ---------- ピッチの5人 ----------
const isGK = (cfg, pid) => cfg.members?.[pid]?.pos === 'GK';
// side: 'before' = 交代の直前の5人、'after' = 直後の5人（同じ秒に交代があるときだけ違う）
// 同じ秒に入れ替えと戻しがある（時計が止まっている間に守備セットだけ入れ替えた）ときの「交代後」は、
// 最初の交代のあとの5人（0:00の出場の選手を含む）とする。
export function pitchAt(M, period, at, side = 'before') {
  const ss = M.stints.filter((s) => s.period === period);
  const useAfter = side === 'after' || at === 0;
  let on = ss.filter((s) => (useAfter ? s.from <= at && at < s.to : s.from < at && at <= s.to));
  const zs = useAfter && at > 0 ? (M.zero || []).filter((z) => z.period === period && z.from === at) : [];
  if (zs.length) {
    const firstZ = new Map(); for (const z of zs) if (z.seat != null && !firstZ.has(z.seat)) firstZ.set(z.seat, z);
    on = [...on.filter((s) => !firstZ.has(s.seat)), ...firstZ.values()];
  }
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
  if (ev.card && ev.card !== 'none') parts.push(CARD_LABEL[ev.card] || ev.card);
  if ((k === 'foul' || k === 'fouled') && ev.card === 'none') parts.push('カードなし');
  return parts.join('・');
}

// ---------- セットごとのイベント（マッチレビュー 4-2） ----------
// sets = setTable(M) の結果（並び・出場時間はそのまま使う）。Mp = プレーイングタイムの試合の形（ピッチの5人を決める）。
// 得点はシュートに、失点は被シュートに数える（OGは数えない）。返す：{ cols, rows:[{key,pids,time,c[]}], special, other, total }
export const SET_COLS = [['shot', 'シュート'], ['oshot', '被シュート'], ['z4', 'Z4進入'], ['oz4', '被Z4進入'], ['sz', 'SZ進入'], ['osz', '被SZ進入'], ['fspat', 'FSP AT'], ['fspdf', 'FSP DF']];
export function setEventTable(Mp, sets, events, goalName = (x) => x) {
  const col = (e) => {
    const k = e.kind;
    if (k === 'shot' || k === 'szshot') return 0;
    if (k === 'goal') return e.pid === OPP_OG ? -1 : 0;
    if (k === 'oshot' || k === 'oszshot') return 1;
    if (k === 'conc') return isOG(goalName(e.gtype)) ? -1 : 1;
    const i = ['z4', 'oz4', 'sz', 'osz', 'fspat', 'fspdf'].indexOf(k);
    return i < 0 ? -1 : i + 2;
  };
  const zero = () => SET_COLS.map(() => 0);
  const rows = sets.map((s) => ({ key: s.key, pids: s.pids, time: s.time, c: zero() }));
  const special = zero(), other = zero(), total = zero();
  for (const e of events) {
    if (e.deleted) continue;
    const ci = col(e); if (ci < 0) continue;
    const side = e.side || (isFsp(e.kind) ? 'after' : 'before');
    const on = pitchAt(Mp, e.period, e.at, side);
    const gks = on.filter((p) => isGK(Mp.cfg, p)), fps = on.filter((p) => !isGK(Mp.cfg, p));
    const key = gks.length === 1 && fps.length === 4 ? fps.slice().sort().join('|') : null;
    const r = key ? rows.find((x) => x.key === key) : null;
    (r ? r.c : key ? other : special)[ci]++; total[ci]++;
  }
  return { cols: SET_COLS, rows, special, other, total };
}

// ---------- 要確認の付け直し・未入力の数（2026-10-16 決定） ----------
// 今の記録（記録の修正を反映した出場）で、すべてのイベントの⚠を判定し直す。変わるものだけ返す
export function recheckAll(M, events) {
  const out = [];
  for (const e of events) {
    if (e.deleted) continue;
    const c = needsCheck(M, e);
    if (!!e.check !== c) out.push({ ev: e, check: c });
  }
  return out;
}
// 未入力の項目があるか、要確認が残っているイベントか（試合の状態「未入力あり」・未入力だけの一覧）
export const isTodo = (ev, goalName) => !ev.deleted && (missing(ev, goalName) > 0 || !!ev.check);
export const todoCount = (events, goalName) => events.filter((e) => isTodo(e, goalName)).length;
