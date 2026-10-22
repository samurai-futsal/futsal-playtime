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
  // 相手の退場（こちらが4×3の時間帯。2026-10-17 決定）。at＝退場の時刻、endPeriod・endAt＝数的優位の終わり
  oej: { label: '相手の退場', team: 'opp', sub: true },
};
export const RESULTS = [['in', '枠内'], ['out', '枠外'], ['block', 'ブロック'], ['post', 'ポスト']];
export const CLS = [['pos', '定位置'], ['set', 'セットプレー'], ['trans', 'トランジション'], ['gk', 'GK活用'], ['special', '特殊局面']];
// 画面の名前は FINISH SET PLAY・得点の種類と同じ短い名前（長い名前はマッチスタッツのシートだけ）
export const SETP = [['CK', 'CK'], ['CK-KI', 'CK-KI'], ['KI', 'KI'], ['FK', 'FK'], ['PK', 'PK'], ['2PK', '第2PK']];
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
      if (n === 2) c = 'y2'; // 3枚目からは退場に数えない（cardIssues で要確認にする）
    }
    out.set(e.id, c);
  }
  return out;
}
// カードの記録のおかしなところ：同じ選手の3枚目のイエロー（2枚目で退場しているはず）。返す：Map(ev.id → 理由)
export function cardIssues(events, periodOrder = []) {
  const po = (k) => periodOrder.indexOf(k);
  const list = events.filter((e) => !e.deleted && e.kind === 'foul' && e.card === 'yellow' && e.pid && e.pid !== UNKNOWN)
    .sort((a, b) => po(a.period) - po(b.period) || a.at - b.at || (a.seq || 0) - (b.seq || 0));
  const out = new Map(); const yel = new Map();
  for (const e of list) { const n = (yel.get(e.pid) || 0) + 1; yel.set(e.pid, n); if (n >= 3) out.set(e.id, `同じ選手の${n}枚目のイエローです（2枚目で退場しています）`); }
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

// ---------- 得点・失点の種類（選択肢）を名前に頼らずに見分ける ----------
// 初めから入っている種類は id が 'o11_OG' のように「o番号_もとの名前」になっている（store.js の optList）。
// 設定で名前を変えても id は変わらないので、id の「もとの名前」を使う。あとから足した種類（'o' + 時刻）や古い記録は名前で見る。
export function goalTypeKey(id, name = '') {
  const m = /^o\d+_(.+)$/.exec(String(id ?? ''));
  return m ? m[1] : (name || '');
}
// gn：id → いまの名前（あとから足した種類のため。なくてもよい）
export const isOGType = (id, gn = null) => !!id && goalTypeKey(id, gn ? gn(id) : '') === 'OG';
export const clsOfGoalTypeId = (id, gn = null) => (id ? clsOfGoalType(goalTypeKey(id, gn ? gn(id) : '')) : null);
// 選択肢の一覧（[{id,name}]）から、もとの名前（なければいまの名前）が key の種類の id
export function goalTypeIdOf(list, key) {
  return (list || []).find((o) => goalTypeKey(o.id, o.name) === key)?.id || (list || []).find((o) => o.name === key)?.id || null;
}

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
    if (ev.pid !== OPP_OG) { // 相手OGは種類（OG）だけ。SZ・人数は記録しない（2026-10-17 決定）
      d += e(ev.assist) + e(ev.gtype) + e(ev.sz);
      if (ev.sz === 'out') d += e(ev.n);
    }
  } else if (k === 'conc') {
    d += e(ev.gtype);
    if (isOGType(ev.gtype, goalName)) d += e(ev.og);
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

// ---------- 自チームの特殊局面（GKをFPと入れ替えていた区間） ----------
// 2026-10-17 決定（A）：GKをフィールドの選手と入れ替えたときだけ特殊局面。GKの退場（空席）や、GKなしで始めたピリオドは特殊局面にしない。
// GKがピッチにいない続きの区間ごとに、その始まりで「GKが出て、同じ場所に同じ時刻にFPが入った」ものだけを返す。
// 返す：{ [periodKey]: [[from, to], ...] }（ms・経過）
export function gkOutWindows(M) {
  const out = {};
  for (const p of M.periods || []) {
    const ss = (M.stints || []).filter((x) => x.period === p.key);
    const end = Math.max(p.elapsed || 0, ...ss.map((x) => x.to));
    const cuts = [...new Set([0, end, ...ss.flatMap((x) => [x.from, x.to])])].filter((c) => c >= 0 && c <= end).sort((a, b) => a - b);
    const res = []; let run = null;
    for (let i = 0; i + 1 < cuts.length; i++) {
      const a = cuts[i], b = cuts[i + 1];
      const on = ss.filter((x) => x.from <= a && x.to >= b);
      const noGK = on.length > 0 && !on.some((x) => isGK(M.cfg, x.pid));
      if (!noGK) { run = null; continue; }
      if (run) { run.to = b; continue; }
      // 区間の始まり：その時刻にGKが出て、同じ場所にFPが入ったか
      const gkOut = ss.filter((x) => x.to === a && isGK(M.cfg, x.pid));
      const swapped = a > 0 && gkOut.some((g) => ss.some((x) => x.seat === g.seat && x.from === a && !isGK(M.cfg, x.pid)));
      run = { from: a, to: b, swapped };
      if (swapped) res.push(run);
    }
    out[p.key] = res.map((r) => [r.from, r.to]);
  }
  return out;
}
// その時刻（交代と同じ秒は side に従う）が GK をFPと入れ替えていた区間か
export function inGkOut(M, period, at, side = 'before', W = null) {
  const iv = (W || gkOutWindows(M))[period] || [];
  const after = side === 'after' || at === 0;
  return iv.some(([a, b]) => (after ? a <= at && at < b : a < at && at <= b));
}

// ---------- 分類の初めの選択（spec 6章・13章） ----------
// 自チームのGKをFPと入れ替えていた区間、相手の5x4の時間帯 → 特殊局面。前後5秒以内に同じ側のFINISH SET PLAY → セットプレー
export function autoCls(M, events, ev) {
  if (!hasCls(ev.kind)) return null;
  const on = pitchAt(M, ev.period, ev.at, ev.side);
  const gkOn = on.some((pid) => isGK(M.cfg, pid));
  const p = M.periods.find((x) => x.key === ev.period);
  const opp5 = (M.pp || []).some((x) => x.period === ev.period && x.team === 'opp' && x.from <= ev.at && ev.at < (x.to ?? p?.elapsed ?? Infinity));
  if ((on.length && !gkOn && inGkOut(M, ev.period, ev.at, ev.side)) || opp5) return 'special';
  const want = KIND[ev.kind].team === 'own' ? 'fspat' : 'fspdf';
  if (events.some((x) => !x.deleted && x.id !== ev.id && x.kind === want && x.period === ev.period && Math.abs(x.at - ev.at) <= 5000)) return 'set';
  return null;
}

// 記録上その時刻にピッチにいない選手を選んだか（要確認）
export const PLAYER_KEYS = ['pid', 'pid2', 'assist', 'og'];
export function needsCheck(M, ev) {
  if (ev.kind === 'oej') return false;
  const on = new Set(pitchAt(M, ev.period, ev.at, ev.side));
  const picked = PLAYER_KEYS.map((k) => ev[k]).filter((x) => x && x !== UNKNOWN && x !== OPP_OG && x !== NO_ASSIST);
  return picked.some((pid) => !on.has(pid));
}
export const CHECK_PITCH = '記録上この時刻にピッチにいない選手を選んでいます';
// 要確認（⚠）とその理由。理由：ピッチにいない選手・同じ選手の3枚目のイエロー・取り込みで分からなかったこと（impWhy）
// 「このままにする」（checkOk）を押したイベントは要確認にしない（未4・2026-10-17）。cards＝cardIssues の結果（なければここで数える）
export function checkOf(M, ev, cards = null, events = null) {
  if (ev.deleted || ev.checkOk) return { check: false, why: '' };
  const why = [];
  if (needsCheck(M, ev)) why.push(CHECK_PITCH);
  const c = (cards || cardIssues(events || [ev], (M.periods || []).map((p) => p.key))).get(ev.id);
  if (c) why.push(c);
  if (ev.impWhy) why.push(ev.impWhy);
  return { check: why.length > 0, why: why.join('／') };
}

export const liveEvents = (list) => list.filter((e) => !e.deleted);
export function sortEvents(list, periodOrder) {
  const po = (k) => periodOrder.indexOf(k);
  return list.slice().sort((a, b) => po(a.period) - po(b.period) || a.at - b.at || (a.seq || 0) - (b.seq || 0));
}

// 一覧の1行の説明
// fmtAt(period, at)：時刻の書き方（相手の退場の終わり。なければ経過の分:秒）
export function summary(ev, nm, goalName = (x) => x, fmtAt = null) {
  const P = (pid) => (pid === UNKNOWN ? '不明' : pid === OPP_OG ? '相手OG' : pid ? nm(pid) : null);
  const parts = [];
  const k = ev.kind;
  if (k === 'oej') {
    const f = fmtAt || ((p, at) => `${Math.floor(at / 60000)}:${String(Math.floor(at / 1000) % 60).padStart(2, '0')}`);
    return ev.endPeriod != null && ev.endAt != null ? `4×3 〜 ${f(ev.endPeriod, ev.endAt)}まで` : '4×3（終わり未入力）';
  }
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
  if (ev.loc && areaOf(ev.loc)) parts.push(areaOf(ev.loc).area); else if (ev.zone) parts.push(ev.zone);
  if (ev.card && ev.card !== 'none') parts.push(CARD_LABEL[ev.card] || ev.card);
  if ((k === 'foul' || k === 'fouled') && ev.card === 'none') parts.push('カードなし');
  return parts.join('・');
}

// ---------- セットごとのイベント（マッチレビュー 4-2） ----------
// sets = setTable(M) の結果（並び・出場時間はそのまま使う）。Mp = プレーイングタイムの試合の形（ピッチの5人を決める）。
// 得点はシュートに、失点は被シュートに数える（OGは数えない）。返す：{ cols, rows:[{key,pids,time,c[]}], special, other, total }
export const SET_COLS = [['shot', 'シュート'], ['oshot', '被シュート'], ['z4', 'Z4進入'], ['oz4', '被Z4進入'], ['sz', 'SZ進入'], ['osz', '被SZ進入'], ['fspat', 'FINISH SET PLAY AT'], ['fspdf', 'FINISH SET PLAY DF']];
export function setEventTable(Mp, sets, events, goalName = (x) => x) {
  const col = (e) => {
    const k = e.kind;
    if (k === 'shot' || k === 'szshot') return 0;
    if (k === 'goal') return e.pid === OPP_OG ? -1 : 0;
    if (k === 'oshot' || k === 'oszshot') return 1;
    if (k === 'conc') return isOGType(e.gtype, goalName) ? -1 : 1;
    const i = ['z4', 'oz4', 'sz', 'osz', 'fspat', 'fspdf'].indexOf(k);
    return i < 0 ? -1 : i + 2;
  };
  const zero = () => SET_COLS.map(() => 0);
  const rows = sets.map((s) => ({ key: s.key, pids: s.pids, time: s.time, c: zero() }));
  const special = zero(), other = zero(), total = zero();
  const gw = gkOutWindows(Mp);
  for (const e of events) {
    if (e.deleted) continue;
    const ci = col(e); if (ci < 0) continue;
    const side = e.side || (isFsp(e.kind) ? 'after' : 'before');
    const on = pitchAt(Mp, e.period, e.at, side);
    const gks = on.filter((p) => isGK(Mp.cfg, p)), fps = on.filter((p) => !isGK(Mp.cfg, p));
    const key = gks.length === 1 && fps.length === 4 ? fps.slice().sort().join('|') : null;
    const r = key ? rows.find((x) => x.key === key) : null;
    // 特殊局面の行は、GKをFPと入れ替えていた区間だけ（GKの退場・GKなしで始めた区間は「そのほか」。2026-10-17 決定）
    const sp = !key && gks.length === 0 && inGkOut(Mp, e.period, e.at, side, gw);
    (r ? r.c : sp ? special : other)[ci]++; total[ci]++;
  }
  return { cols: SET_COLS, rows, special, other, total };
}

// ---------- 要確認の付け直し・未入力の数（2026-10-16 決定） ----------
// 今の記録（記録の修正を反映した出場）で、すべてのイベントの⚠を判定し直す。変わるもの（⚠か理由）だけ返す：[{ev, check, why}]
export function recheckAll(M, events) {
  const out = [];
  const cards = cardIssues(events, (M.periods || []).map((p) => p.key));
  for (const e of events) {
    if (e.deleted) continue;
    const { check, why } = checkOf(M, e, cards);
    if (!!e.check !== check || (e.checkWhy || '') !== why) out.push({ ev: e, check, why });
  }
  return out;
}
// ピッチの5人が決まる記録の「しるし」（出場の区切り）。これが変わったら⚠を付け直す（記4：MATCH PLAYの取り消し・リセット・あとからの交代、修正が古くなったときなど）
// 試合中の出場中の区切りは「出場中」とだけ見る（毎秒変わらないように）
export function pitchSig(M) {
  const row = (s) => `${s.period}|${s.pid}|${s.seat ?? ''}|${s.from}|${s.open ? 'open' : s.to}`;
  const txt = [...(M.stints || []).map(row), '#', ...(M.zero || []).map(row)].sort().join(';');
  let h = 5381; for (let i = 0; i < txt.length; i++) h = ((h * 33) ^ txt.charCodeAt(i)) >>> 0;
  return `${(M.stints || []).length}:${h.toString(36)}`;
}

// ---------- 場所（コートの図。2026-10-22） ----------
// loc = { x, y }（メートル。40m×20m のコートとして記録）。x：自陣のゴールライン 0 → 相手のゴールライン 40（自チームはいつも右へ攻める）。
// y：+10 が上（攻める向きの左＝L）〜 −10 が下（R）。
// エリア（相手のゴール前＝ZONE 4）：
//  SZ（スコアゾーン）＝第2PKの点（ゴールラインから10m）から左右5mの2点と、ペナルティーラインとゴールラインの交点（中心から左右7.5m）を結んだ台形。
//    ゴールラインから5mで分け、ゴール側が XP、手前が X。
//  デッドゾーン＝コーナーから、ゴールに向かって5mの点と、ハーフラインに向かって10mの点を結んだ三角形（上 DL・下 DR）。SZと重なるところはSZ。
//  4L・4R＝ZONE 4 のそのほか。ZONE 1〜3 は中央の10mを C、その外を L（上）・R（下）。
// 自陣のゴール前（ZONE 1）は画面では 1L・1C・1R のまま。中では同じ形で「被X・被XP・被DL・被DR・被4L・被4R」として持つ（相手のSZ・Z4でのプレー）。
export const PITCH = { L: 40, W: 20 };
function goalArea(d, y) { // d＝そのゴールラインからの距離（0〜10）
  const w = 7.5 - d * 0.25; // SZの半分の幅（ゴールライン 7.5m → 10mの所で 5m）
  if (Math.abs(y) <= w) return d <= 5 ? 'XP' : 'X';
  if (Math.abs(y) >= 5 + d * 0.5) return y > 0 ? 'DL' : 'DR'; // (ゴールライン,5m)〜(10m,タッチライン) の線より外
  return y > 0 ? '4L' : '4R';
}
// 返す：{ zone:'Z1'..'Z4', area:画面の名前, sz:相手のSZの中, osz:自陣のSZの中（相手のシュート）, oarea:自陣のゴール前の中の名前（被X など）}
export function areaOf(loc) {
  if (!loc || !Number.isFinite(+loc.x) || !Number.isFinite(+loc.y)) return null;
  const x = Math.max(0, Math.min(PITCH.L, +loc.x)), y = Math.max(-10, Math.min(10, +loc.y));
  const z = x < 10 ? 1 : x < 20 ? 2 : x < 30 ? 3 : 4;
  const lcr = y > 5 ? 'L' : y < -5 ? 'R' : 'C';
  const a4 = z === 4 ? goalArea(PITCH.L - x, y) : null;
  const a1 = z === 1 ? goalArea(x, y) : null;
  return { zone: 'Z' + z, area: z === 4 ? a4 : `${z}${lcr}`, sz: a4 === 'X' || a4 === 'XP', osz: a1 === 'X' || a1 === 'XP', oarea: a1 ? '被' + a1 : null };
}
export const areaLabel = (loc) => { const a = areaOf(loc); return a ? a.area : ''; };
const okLoc = (v) => v && typeof v === 'object' && Number.isFinite(+v.x) && Number.isFinite(+v.y) && +v.x >= 0 && +v.x <= PITCH.L && Math.abs(+v.y) <= 10;

// ---------- イベントの種類ごとに持てる項目（記3：種類を変えたときは、新しい種類の項目だけを残す） ----------
export const EV_FIELDS = ['pid', 'pid2', 'assist', 'method', 'result', 'n', 'cls', 'sp', 'gtype', 'sz', 'zone', 'card', 'fsp', 'og', 'endPeriod', 'endAt', 'loc'];
const FIELDS_OF = {
  shot: ['pid', 'result', 'n', 'cls', 'sp', 'loc'], szshot: ['pid', 'result', 'n', 'cls', 'sp', 'loc'],
  oshot: ['result', 'n', 'cls', 'sp', 'loc'], oszshot: ['result', 'n', 'cls', 'sp', 'loc'],
  z4: ['method', 'pid', 'pid2', 'cls', 'sp'], sz: ['method', 'pid', 'pid2'], oz4: ['cls', 'sp'], osz: [],
  goal: ['pid', 'assist', 'gtype', 'sz', 'n', 'loc'], conc: ['gtype', 'og', 'sz', 'n', 'loc'],
  fspat: ['fsp'], fspdf: ['fsp'], rec: ['pid', 'zone', 'loc'], lost: ['pid', 'zone', 'loc'],
  foul: ['pid', 'card', 'loc'], fouled: ['pid', 'card', 'loc'], oej: ['endPeriod', 'endAt'],
};
const okVal = { result: RESULTS, cls: CLS, sp: SETP, fsp: FSP, method: METHODS, zone: ZONES };
// 項目を新しい種類に合うものだけにしたイベントを返す（イベントのほかの印 id・時刻・src・imp・hist などはそのまま）
export function cleanFields(ev, goalName = null) {
  const k = ev.kind; const keep = new Set(FIELDS_OF[k] || []);
  const out = { ...ev };
  for (const f of EV_FIELDS) {
    const v = out[f];
    if (!keep.has(f) || v == null || v === '') { delete out[f]; continue; }
    if (okVal[f] && !okVal[f].some(([x]) => x === v)) delete out[f];
  }
  if (out.loc != null) { if (okLoc(out.loc)) out.loc = { x: Math.round(+out.loc.x * 10) / 10, y: Math.round(+out.loc.y * 10) / 10 }; else delete out.loc; }
  if (out.card != null && !(k === 'fouled' ? CARDS_OPP : CARDS).some(([x]) => x === out.card)) delete out.card;
  if ((k === 'foul' || k === 'fouled') && out.card == null) out.card = 'none';
  if (out.n != null && !(Number.isInteger(+out.n) && +out.n >= 0 && +out.n <= 5)) delete out.n;
  if (out.n != null) out.n = +out.n;
  if (out.method !== 'pass') delete out.pid2;
  if (out.cls !== 'set') delete out.sp;
  if (out.sz != null && out.sz !== 'in' && out.sz !== 'out') delete out.sz;
  if (k === 'goal') {
    if (out.pid === OPP_OG) { delete out.sz; delete out.n; out.assist = NO_ASSIST; }
    else if (isOGType(out.gtype, goalName)) delete out.gtype;
    if (out.assist && out.assist === out.pid && out.assist !== NO_ASSIST) delete out.assist;
  }
  if (k === 'conc') { if (isOGType(out.gtype, goalName)) { delete out.sz; delete out.n; } else delete out.og; }
  if ((k === 'goal' || k === 'conc') && out.sz == null) delete out.n;
  if (out.n === 0 && (isSZ(k) || out.sz === 'in')) delete out.n; // SZ内は打った選手を1人目に数えるので0人はない
  return out;
}

// ---------- 相手の退場（こちらが4×3。決8・2026-10-17） ----------
const pEnd = (p) => (p.status === 'done' ? p.elapsed : p.len);
const periodsOf = (M) => (M.periods || []).filter((p, i, a) => p.status !== 'none' || !M.matchOver || i === 0);
// 初めの終わり：プレーイングタイムで2:00後（次のピリオドにまたがることもある。試合の終わりまで）。その前にこちらが得点したら、その得点の時刻
export function oejDefaultEnd(M, events, period, at) {
  const ps = periodsOf(M); let i = ps.findIndex((p) => p.key === period);
  if (i < 0) return { endPeriod: period, endAt: at };
  const goals = (events || []).filter((e) => !e.deleted && e.kind === 'goal');
  let left = 120000, cur = at;
  for (;;) {
    const p = ps[i]; const end = pEnd(p); const stop = Math.min(end, cur + left);
    const g = goals.filter((e) => e.period === p.key && (p.key === period ? e.at > at : e.at >= cur) && e.at <= stop).sort((a, b) => a.at - b.at)[0];
    if (g) return { endPeriod: p.key, endAt: g.at };
    if (cur + left <= end) return { endPeriod: p.key, endAt: cur + left };
    if (i + 1 >= ps.length) return { endPeriod: p.key, endAt: end };
    left -= end - cur; i++; cur = 0;
  }
}
// 相手の退場の時間帯（分析用）：{ [periodKey]: [[fromMs, toMs], ...] }。終わりがないものは初めの終わりを使う
export function oppEjWindows(events, M) {
  const ps = M.periods || []; const out = Object.fromEntries(ps.map((p) => [p.key, []]));
  const idx = (k) => ps.findIndex((p) => p.key === k);
  for (const e of events || []) {
    if (e.deleted || e.kind !== 'oej') continue;
    const d = e.endPeriod != null && e.endAt != null ? { endPeriod: e.endPeriod, endAt: e.endAt } : oejDefaultEnd(M, events, e.period, e.at);
    const a = idx(e.period), b = idx(d.endPeriod); if (a < 0 || b < a) continue;
    for (let i = a; i <= b; i++) {
      const p = ps[i]; const from = i === a ? e.at : 0; const to = i === b ? d.endAt : pEnd(p);
      if (to > from) out[p.key].push([from, to]);
    }
  }
  for (const k of Object.keys(out)) {
    const s = out[k].sort((x, y) => x[0] - y[0]); const m = [];
    for (const iv of s) { const l = m[m.length - 1]; if (l && iv[0] <= l[1]) l[1] = Math.max(l[1], iv[1]); else m.push([...iv]); }
    out[k] = m;
  }
  return out;
}
// 未入力の項目があるか、要確認が残っているイベントか（試合の状態「未入力あり」・未入力だけの一覧）
export const isTodo = (ev, goalName) => !ev.deleted && (missing(ev, goalName) > 0 || !!ev.check);
export const todoCount = (events, goalName) => events.filter((e) => isTodo(e, goalName)).length;
