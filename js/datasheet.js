// データシート（Excel）⑥-3（spec 9章「書き出し」）。画面を作らない純粋な処理で、シートの中身を組み立てる。
// イベント一覧は1行1件。試合情報・選手スタッツ・1分ごとはイベント一覧から数式（COUNTIFS）で集計するので、行を直すと計算し直される。
// 出場時間・出場記録・セットはアプリで集計した値。複数の試合を選んだときは「試合」の列で全試合を1つのシートにまとめる。
import { KIND, RESULTS, CLS, SETP, FSP, METHODS, CARD_LABEL, OPP_OG, UNKNOWN, NO_ASSIST, isOG, isOGType, oejDefaultEnd, isSZ, pitchAt, missingLv, cardsOf, sortEvents } from './events.js';
import { playerTable } from './model.js';
import { ppWindows, windowsOf, winTest, setSplit } from './teamstats.js';
import { S as ST, colName } from './xlsx.js';

const lab = (list, v) => (list.find((x) => x[0] === v) || [])[1] || '';
const day = (ms) => Math.round(ms / 1000) / 86400; // Excel の時間（日の割合）。表示は [m]:ss
// 試合通算の分（終わりを含む）：0:00〜1:00＝1分、9:01〜10:00＝10分
export const minuteOf = (cum) => Math.max(1, Math.ceil(cum / 60000));
const H = (t) => ({ v: t, s: 'head' });
const EVS = "'イベント一覧'";
// イベント一覧の列（数式で使うので順番を固定）
const EC = ['試合', '日付', 'ピリオド', '経過', '残り', '試合通算', '通算の分', 'イベント', 'チーム', '選手', '2人目（アシスト・受け手）', '方法', '結果', '得点の種類', '分類', 'セットプレーの種類', 'FINISH SET PLAYの種類', 'SZ内／SZ外', 'ゾーン内の人数', 'ゾーン', 'カード', 'ピッチ1', 'ピッチ2', 'ピッチ3', 'ピッチ4', 'ピッチ5', 'GKがいない区間', '5x4の時間帯', '退場の時間帯', '未入力（基本）', '詳細の空き', '要確認', '入力元', 'シュート', '枠内', '得点・失点'];
const COL = Object.fromEntries(EC.map((n, i) => [n, colName(i)]));

// 試合の名前（「試合」の列。数式で使うので、試合ごとに必ず違う名前にする）：同じ日・同じ相手があればキックオフの時刻を足し、それでも同じなら番号
export function matchTitles(list) {
  const base = (m) => `${m.date || ''} vs ${m.opponent || ''}`;
  const withKo = (m) => `${m.date || ''}${m.kickoff ? ' ' + m.kickoff : ''} vs ${m.opponent || ''}`;
  const cnt = (f) => list.reduce((o, m) => ((o[f(m)] = (o[f(m)] || 0) + 1), o), {});
  const c0 = cnt(base); const t1 = (m) => (c0[base(m)] > 1 ? withKo(m) : base(m));
  const c1 = cnt(t1); const seen = {}; const out = new Map();
  for (const m of list) { const t = t1(m); if (c1[t] > 1) { seen[t] = (seen[t] || 0) + 1; out.set(m, `${t}（${seen[t]}）`); } else out.set(m, t); }
  return out;
}
// 選手の名前（シートの中で選手を見分ける名前。数式はこの名前で数えるので、選手ごとに必ず違う名前にする）：
// 名前がない選手は「背番号 n」、同じ名前の選手がいれば「（背番号 n）」を足し、それでも同じなら番号
export function playerLabels(pids, players, noOf) {
  const P = (pid) => players.find((p) => p.id === pid);
  const full = (pid) => { const p = P(pid); return p ? `${p.last || ''} ${p.first || ''}`.trim() : ''; };
  const b0 = (pid) => full(pid) || (noOf(pid) != null && noOf(pid) !== '' ? `背番号 ${noOf(pid)}` : '名前なし');
  const cnt = (f) => pids.reduce((o, p) => ((o[f(p)] = (o[f(p)] || 0) + 1), o), {});
  const c0 = cnt(b0); const b1 = (pid) => (c0[b0(pid)] > 1 && full(pid) && noOf(pid) != null && noOf(pid) !== '' ? `${b0(pid)}（背番号 ${noOf(pid)}）` : b0(pid));
  const c1 = cnt(b1); const seen = {}; const out = new Map();
  for (const pid of pids) { const t = b1(pid); if (c1[t] > 1) { seen[t] = (seen[t] || 0) + 1; out.set(pid, `${t}（${seen[t]}）`); } else out.set(pid, t); }
  return out;
}

// ms = [{ m, M, st, evs, goalName, players, setMin }]（試合の古い順）。teamName：自チームの名前
const mmssR = (ms) => { const t = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
export function datasheetSheets(ms, teamName) {
  const multi = ms.length > 1;
  const titles = matchTitles(ms.map((x) => x.m));
  const title = (m) => titles.get(m);
  // 選手は id で見分ける（同じ名前の選手・名前のない選手がいても混ざらない）
  const allPids = [...new Set(ms.flatMap((x) => Object.keys(x.m.members || {})))];
  const lastNo = {}; for (const x of ms) for (const [pid, v] of Object.entries(x.m.members || {})) lastNo[pid] = v.no;
  const labels = playerLabels(allPids, ms[0]?.players || [], (pid) => lastNo[pid]);
  const fullName = (players, pid) => (pid ? labels.get(pid) || (() => { const p = players.find((q) => q.id === pid); return p ? `${p.last || ''} ${p.first || ''}`.trim() : ''; })() : '');
  // ---------- イベント一覧 ----------
  const evRows = [EC.map(H)];
  const allPlayers = new Map(); // 選手の id → { no, pos, games, name }
  for (const x of ms) {
    const { m, M, evs, goalName: gn, players } = x;
    const nm = (pid) => (pid === OPP_OG ? '相手OG' : pid === UNKNOWN ? '不明' : pid === NO_ASSIST ? 'なし' : pid ? fullName(players, pid) : '');
    const T = playerTable(M);
    for (const pid of Object.keys(m.members || {})) {
      const n = fullName(players, pid); if (!n) continue;
      const r = allPlayers.get(pid) || { no: m.members[pid].no, pos: m.members[pid].pos, games: 0, pid, name: n };
      r.no = m.members[pid].no; r.pos = m.members[pid].pos; if ((T[pid]?.total || 0) > 0) r.games++; allPlayers.set(pid, r);
    }
    const order = M.periods.map((p) => p.key);
    const offset = (k) => M.periods.slice(0, order.indexOf(k)).reduce((t, p) => t + p.len, 0);
    // 5x4・退場の時間帯（区間の境目とピリオドの終わりの瞬間は、分析・Sportscode と同じ決め方）
    const W = ppWindows(M, evs); const cards = cardsOf(evs, order);
    const inOwn = winTest(W.own, M), inOpp = winTest(W.opp, M), inEjO = winTest(W.ejOwn, M), inEjP = winTest(W.ejOpp, M);
    const isGK = (pid) => m.members?.[pid]?.pos === 'GK';
    // 相手の退場：5対4の終わり（ピリオドと残り時間）
    const oejEnd = (e) => { const d = e.endPeriod != null && e.endAt != null ? e : oejDefaultEnd(M, evs, e.period, e.at); const q = M.periods.find((x) => x.key === d.endPeriod); return q ? `5対4の終わり：${q.label} 残り${mmssR(q.len - d.endAt)}` : ''; };
    for (const e of sortEvents(evs.filter((v) => !v.deleted), order)) {
      const p = M.periods.find((q) => q.key === e.period); if (!p) continue;
      const k = e.kind; const own = KIND[k]?.team === 'own';
      const side = e.side || (k === 'fspat' || k === 'fspdf' ? 'after' : 'before');
      const on = pitchAt(M, e.period, e.at, side);
      const og = (k === 'goal' && e.pid === OPP_OG) || (k === 'conc' && isOGType(e.gtype, gn));
      const shot = (k === 'shot' || k === 'szshot' || (k === 'goal' && !og)) ? '自' : (k === 'oshot' || k === 'oszshot' || (k === 'conc' && !og)) ? '相' : '';
      const sz = isSZ(k) ? 'SZ内' : (k === 'shot' || k === 'oshot') ? 'SZ外' : e.sz === 'in' ? 'SZ内' : e.sz === 'out' ? 'SZ外' : '';
      const lv = missingLv(e, gn);
      const card = cards.get(e.id) || (e.card && e.card !== 'none' ? e.card : '');
      evRows.push([
        title(m), m.date || '', p.label, { v: day(e.at), s: 'time' }, { v: day(p.len - e.at), s: 'time' }, { v: day(offset(e.period) + e.at), s: 'time' }, minuteOf(offset(e.period) + e.at),
        KIND[k]?.label || k, own ? '自チーム' : '相手', nm(e.pid), nm(e.kind === 'goal' ? e.assist : e.pid2), lab(METHODS, e.method),
        (k === 'goal' || k === 'conc') ? (og ? 'オウンゴール' : 'ゴール') : k === 'oej' ? oejEnd(e) : lab(RESULTS, e.result), e.gtype ? gn(e.gtype) : '', lab(CLS, e.cls), lab(SETP, e.sp), lab(FSP, e.fsp), sz,
        e.n != null && e.n !== '' ? +e.n : '', e.zone || '', card ? CARD_LABEL[card] || card : (k === 'foul' || k === 'fouled' ? 'カードなし' : ''),
        ...[0, 1, 2, 3, 4].map((i) => (on[i] ? fullName(players, on[i]) : '')),
        on.length && !on.some(isGK) ? 'はい' : '', inOwn(e) ? '自チーム5x4' : inOpp(e) ? '相手5x4' : '',
        [inEjO(e) ? '自チームの退場（4対5）' : '', inEjP(e) ? '相手の退場（5対4）' : ''].filter(Boolean).join('・'),
        lv.basic || '', lv.detail || '', e.check ? '要確認' : '', e.src === 'sportscode' ? 'Sportscode' : 'アプリ',
        shot, shot && (k === 'goal' || k === 'conc' || e.result === 'in') ? 1 : '', k === 'goal' ? '得点' : k === 'conc' ? '失点' : '',
      ]);
    }
  }
  const events = { name: 'イベント一覧', rows: evRows, freeze: 1, filter: true, widths: [20, 11, 7, 7, 7, 8, 6, 16, 8, 14, 14, 8, 11, 12, 12, 12, 10, 8, 6, 6, 12, 14, 14, 14, 14, 14, 8, 11, 14, 7, 7, 7, 10, 6, 5, 7] };
  // 数式の範囲：イベント一覧の最後の行まで（行が多くても数えもれがないように）
  const lastRow = Math.max(2, evRows.length);
  const rng = (name) => `${EVS}!$${COL[name]}$2:$${COL[name]}$${lastRow}`;

  // ---------- 試合情報（試合ごとの列＋合計。数字はイベント一覧から数式で） ----------
  const cnt = (conds) => `COUNTIFS(${conds.map(([c, v]) => `${rng(c)},${v}`).join(',')})`;
  const q = (s) => `"${String(s).replace(/"/g, '""')}"`;
  const infoCols = ms.map((x) => title(x.m));
  const TL = (x) => q(title(x.m));
  const statRows = [
    ['得点', (t) => cnt([['試合', t], ['得点・失点', '"得点"']])], ['失点', (t) => cnt([['試合', t], ['得点・失点', '"失点"']])],
    ['シュート', (t) => cnt([['試合', t], ['シュート', '"自"']])], ['うちSZ内', (t) => cnt([['試合', t], ['シュート', '"自"'], ['SZ内／SZ外', '"SZ内"']])], ['枠内', (t) => cnt([['試合', t], ['シュート', '"自"'], ['枠内', '1']])],
    ['被シュート', (t) => cnt([['試合', t], ['シュート', '"相"']])], ['被枠内', (t) => cnt([['試合', t], ['シュート', '"相"'], ['枠内', '1']])],
    ['Z4進入', (t) => cnt([['試合', t], ['イベント', '"Z4進入"']])], ['SZ進入', (t) => cnt([['試合', t], ['イベント', '"SZ進入"']])],
    ['被Z4進入', (t) => cnt([['試合', t], ['イベント', '"被Z4進入"']])], ['被SZ進入', (t) => cnt([['試合', t], ['イベント', '"被SZ進入"']])],
    ['FINISH SET PLAY AT', (t) => cnt([['試合', t], ['イベント', '"FINISH SET PLAY AT"']])], ['FINISH SET PLAY DF', (t) => cnt([['試合', t], ['イベント', '"FINISH SET PLAY DF"']])],
    ['ボールリカバリー', (t) => cnt([['試合', t], ['イベント', '"ボールリカバリー"']])], ['ボールロスト', (t) => cnt([['試合', t], ['イベント', '"ボールロスト"']])],
    ['ファール', (t) => cnt([['試合', t], ['イベント', '"ファール"']])], ['被ファール（相手のファール）', (t) => cnt([['試合', t], ['イベント', '"被ファール"']])],
    ['イエロー（自チーム）', (t) => cnt([['試合', t], ['イベント', '"ファール"'], ['カード', '"イエロー"']])], ['イエロー2枚目（自チーム）', (t) => cnt([['試合', t], ['イベント', '"ファール"'], ['カード', '"イエロー2枚目（退場）"']])], ['レッド（自チーム）', (t) => cnt([['試合', t], ['イベント', '"ファール"'], ['カード', '"レッド"']])],
    ['未入力（基本）があるイベント', (t) => `COUNTIFS(${rng('試合')},${t},${rng('未入力（基本）')},">0")`], ['要確認', (t) => cnt([['試合', t], ['要確認', '"要確認"']])],
  ];
  const nCol = ms.length + (multi ? 1 : 0);
  const info = [
    [{ v: `${teamName} データシート`, s: 'title' }],
    [H('項目'), ...infoCols.map(H), ...(multi ? [H('合計')] : [])],
    [{ v: '日付', s: 'bold' }, ...ms.map((x) => x.m.date || '')], [{ v: '対戦相手', s: 'bold' }, ...ms.map((x) => x.m.opponent || '')],
    [{ v: '活動', s: 'bold' }, ...ms.map((x) => x.activity || '')], [{ v: '試合の区分', s: 'bold' }, ...ms.map((x) => x.m.category || '')],
    [{ v: '会場', s: 'bold' }, ...ms.map((x) => x.m.venue || '')], [{ v: 'キックオフ', s: 'bold' }, ...ms.map((x) => x.m.kickoff || '')],
    [{ v: '試合時間（プレーイングタイム）', s: 'bold' }, ...ms.map((x) => ({ v: day(x.M.periods.reduce((t, p) => t + (p.status === 'none' ? 0 : p.elapsed), 0)), s: 'time' })), ...(multi ? [{ f: `SUM(B9:${colName(ms.length)}9)`, s: 'timeb' }] : [])],
    [{ v: 'PK戦（自チーム−相手）', s: 'bold' }, ...ms.map((x) => (x.m.pk ? `${x.m.pk.own ?? 0}−${x.m.pk.opp ?? 0}` : ''))],
    [{ v: 'PK戦のキッカー（自チーム）', s: 'bold' }, ...ms.map((x) => (x.m.pk?.kicks || []).map((k, i) => `${i + 1}.${fullName(x.players || [], k.pid) || '—'} ${({ goal: '○', saved: '×(GK)', missed: '×(枠外)' })[k.res] || ''}`).join('　'))],
    [{ v: 'ポゼッション率（自チーム）', s: 'bold' }, ...ms.map((x) => (x.m.possession != null ? x.m.possession / 100 : '')).map((v) => (v === '' ? '' : { v, s: 'pct' }))],
    [],
    [H('チームの数字（イベント一覧から計算）'), ...infoCols.map(H), ...(multi ? [H('合計')] : [])],
  ];
  for (const [label, f] of statRows) {
    const r = info.length + 1;
    info.push([{ v: label, s: 'bold' }, ...ms.map((x) => ({ f: f(TL(x)) })), ...(multi ? [{ f: `SUM(B${r}:${colName(ms.length)}${r})`, s: 'bold' }] : [])]);
  }
  info.push([], [{ v: '数字はイベント一覧から数式で数えています。イベント一覧の行を直すと計算し直されます。シュートは得点を含みOGは除く、枠内は得点を含む。', s: 'note' }]);
  const infoSheet = { name: '試合情報', rows: info, widths: [30, ...ms.map(() => 22), ...(multi ? [12] : [])], freeze: 2, freezeCols: 1 };

  // ---------- 選手一覧 ----------
  const names = [...allPlayers.values()].map((r) => [r.name, r]).sort((a, b) => (a[1].pos === 'GK') - (b[1].pos === 'GK') || (parseInt(a[1].no, 10) || 999) - (parseInt(b[1].no, 10) || 999));
  const plist = { name: '選手一覧', rows: [[H('背番号'), H('名前'), H('ポジション'), H('出場試合数')], ...names.map(([n, r]) => [r.no != null ? (Number.isFinite(+r.no) ? +r.no : r.no) : '', n, r.pos === 'GK' ? 'GK' : 'FP', r.games])], widths: [8, 18, 10, 10], freeze: 1 };

  // ---------- 出場時間（アプリで集計した値） ----------
  const allP = [...new Map(ms.flatMap((x) => x.M.periods.filter((p) => p.status !== 'none' || !p.extra)).map((p) => [p.key, p])).values()];
  const tRows = [[H('試合'), H('背番号'), H('選手'), ...allP.flatMap((p) => [H(`${p.label} 時間`), H(`${p.label} 回数`)]), H('合計 時間'), H('合計 回数'), H('出場率')]];
  for (const x of ms) {
    const T = playerTable(x.M); const played = x.M.periods.reduce((t, p) => t + (p.status === 'none' ? 0 : p.elapsed), 0);
    const pids = Object.keys(x.m.members || {}).sort((a, b) => (x.m.members[a].pos === 'GK') - (x.m.members[b].pos === 'GK') || (parseInt(x.m.members[a].no, 10) || 999) - (parseInt(x.m.members[b].no, 10) || 999));
    for (const pid of pids) {
      const r = T[pid] || { per: {}, total: 0, count: 0 };
      tRows.push([title(x.m), Number.isFinite(+x.m.members[pid].no) ? +x.m.members[pid].no : x.m.members[pid].no, fullName(x.players, pid), ...allP.flatMap((p) => [{ v: day(r.per[p.key]?.time || 0), s: 'time' }, r.per[p.key]?.count || 0]), { v: day(r.total), s: 'time' }, r.count, { v: played ? r.total / played : 0, s: 'pct' }]);
    }
  }
  const timeSheet = { name: '出場時間', rows: tRows, freeze: 1, filter: true, widths: [20, 7, 16, ...allP.flatMap(() => [10, 8]), 10, 8, 8] };

  // ---------- 出場記録（1回ごとの出場） ----------
  const sRows = [[H('試合'), H('ピリオド'), H('背番号'), H('選手'), H('何回目'), H('入った（経過）'), H('出た（経過）'), H('時間')]];
  for (const x of ms) {
    const n = {};
    for (const s of x.M.stints.slice().sort((a, b) => x.M.periods.findIndex((p) => p.key === a.period) - x.M.periods.findIndex((p) => p.key === b.period) || a.from - b.from)) {
      n[s.pid] = (n[s.pid] || 0) + 1;
      sRows.push([title(x.m), x.M.periods.find((p) => p.key === s.period)?.label || s.period, Number.isFinite(+x.m.members?.[s.pid]?.no) ? +x.m.members[s.pid].no : '', fullName(x.players, s.pid), n[s.pid], { v: day(s.from), s: 'time' }, { v: day(s.to), s: 'time' }, { v: day(s.to - s.from), s: 'time' }]);
    }
  }
  const stintSheet = { name: '出場記録', rows: sRows, freeze: 1, filter: true, widths: [20, 8, 7, 16, 7, 10, 10, 9] };

  // ---------- セット（FP4人。アプリで集計した値） ----------
  // 数的同数の時間帯だけで数える（5×4・4×5と、両チームの退場の時間帯を除く）。マッチレビュー 4 と同じ決め方で、
  // 出場時間が短いセットと除いた時間は下の行にまとめる（全部足すと試合の時間）
  const setRows = [[H('試合'), H('順位'), H('FP4人のセット'), H('出場時間'), H('回数')]];
  for (const x of ms) {
    const sp = setSplit(x.M, ppWindows(x.M, x.evs)); const setMin = x.setMin ?? 60000;
    const long = sp.sets.filter((q) => q.time >= setMin), short = sp.sets.filter((q) => q.time < setMin);
    long.forEach((q, i) => setRows.push([title(x.m), i + 1, q.pids.map((pid) => `${x.m.members?.[pid]?.no ?? ''} ${fullName(x.players, pid)}`).join('・'), { v: day(q.time), s: 'time' }, q.count]));
    const ex = (label, t, n = '') => setRows.push([title(x.m), '', { v: label, s: 'note' }, { v: day(t), s: 'time' }, n]);
    if (short.length) ex(`出場時間が${Math.floor(setMin / 60000)}:${String(Math.round(setMin / 1000) % 60).padStart(2, '0')}未満のセット（${short.length}組）`, short.reduce((t, q) => t + q.time, 0), short.reduce((t, q) => t + q.count, 0));
    if (sp.time.ex) ex('5×4・4×5と退場の時間帯', sp.time.ex);
    if (sp.time.special) ex('GK1人・FP4人がそろっていない区間', sp.time.special);
    if (sp.time.other) ex('交代の瞬間の3秒未満の組み合わせ', sp.time.other);
    setRows.push([title(x.m), '', { v: '合計（試合の時間）', s: 'bold' }, { v: day(sp.time.played), s: 'timeb' }, '']);
  }
  const setSheet = { name: 'セット', rows: setRows, freeze: 1, filter: true, widths: [20, 6, 60, 10, 6] };

  // ---------- 選手スタッツ（イベント一覧から数式で） ----------
  const pitch = ['ピッチ1', 'ピッチ2', 'ピッチ3', 'ピッチ4', 'ピッチ5'];
  const onSum = (a, extra) => pitch.map((c) => cnt([[c, a], ...extra])).join('+');
  const spHead = ['背番号', '選手', '出場試合数', '出場時間', 'シュート', 'うちSZ内', 'シュート関与', '被シュート関与', '枠内', '得点', 'アシスト', '進入関与', 'パス出し手', 'パス受け手', 'リカバリー', 'ロスト', 'ファール', '受けたファール', '得失点±', 'シュート関与／分', '被シュート関与／分'];
  const pRows = [spHead.map(H)];
  const tsum = new Map(); for (const x of ms) { const T = playerTable(x.M); for (const pid of Object.keys(x.m.members || {})) tsum.set(pid, (tsum.get(pid) || 0) + (T[pid]?.total || 0)); }
  names.forEach(([n, r], i) => {
    const row = i + 2; const a = `$B${row}`;
    pRows.push([r.no != null && Number.isFinite(+r.no) ? +r.no : r.no || '', n, r.games, { v: day(tsum.get(r.pid) || 0), s: 'time' },
      { f: cnt([['選手', a], ['シュート', '"自"']]) }, { f: cnt([['選手', a], ['シュート', '"自"'], ['SZ内／SZ外', '"SZ内"']]) },
      { f: onSum(a, [['シュート', '"自"']]) }, { f: onSum(a, [['シュート', '"相"']]) },
      { f: cnt([['選手', a], ['シュート', '"自"'], ['枠内', '1']]) }, { f: cnt([['選手', a], ['得点・失点', '"得点"']]) },
      { f: cnt([['2人目（アシスト・受け手）', a], ['イベント', '"得点"']]) },
      { f: ['Z4進入', 'SZ進入'].flatMap((k) => [cnt([['選手', a], ['イベント', `"${k}"`]]), cnt([['2人目（アシスト・受け手）', a], ['イベント', `"${k}"`]])]).join('+') },
      { f: ['Z4進入', 'SZ進入'].map((k) => cnt([['選手', a], ['イベント', `"${k}"`], ['方法', '"パス"']])).join('+') },
      { f: ['Z4進入', 'SZ進入'].map((k) => cnt([['2人目（アシスト・受け手）', a], ['イベント', `"${k}"`], ['方法', '"パス"']])).join('+') },
      { f: cnt([['選手', a], ['イベント', '"ボールリカバリー"']]) }, { f: cnt([['選手', a], ['イベント', '"ボールロスト"']]) },
      { f: cnt([['選手', a], ['イベント', '"ファール"']]) }, { f: cnt([['選手', a], ['イベント', '"被ファール"']]) },
      { f: `${onSum(a, [['得点・失点', '"得点"']])}-(${onSum(a, [['得点・失点', '"失点"']])})` },
      { f: `IF($D${row}>0,G${row}/($D${row}*1440),"")`, s: 'dec2' }, { f: `IF($D${row}>0,H${row}/($D${row}*1440),"")`, s: 'dec2' }]);
  });
  const pr = pRows.length;
  if (pr > 1) pRows.push([{ v: '', s: 'bold' }, { v: 'チーム合計', s: 'bold' }, '', { f: `SUM(D2:D${pr})/5`, s: 'timeb' },
    { f: cnt([['シュート', '"自"']]), s: 'bold' }, { f: cnt([['シュート', '"自"'], ['SZ内／SZ外', '"SZ内"']]), s: 'bold' }, { f: cnt([['シュート', '"自"']]), s: 'bold' }, { f: cnt([['シュート', '"相"']]), s: 'bold' },
    { f: cnt([['シュート', '"自"'], ['枠内', '1']]), s: 'bold' }, { f: cnt([['得点・失点', '"得点"']]), s: 'bold' }, { f: `SUM(K2:K${pr})`, s: 'bold' }, '', '', '',
    { f: cnt([['イベント', '"ボールリカバリー"']]), s: 'bold' }, { f: cnt([['イベント', '"ボールロスト"']]), s: 'bold' }, { f: cnt([['イベント', '"ファール"']]), s: 'bold' }, { f: cnt([['イベント', '"被ファール"']]), s: 'bold' },
    { f: `${cnt([['得点・失点', '"得点"']])}-${cnt([['得点・失点', '"失点"']])}`, s: 'bold' }, '', '']);
  const playerSheet = { name: '選手スタッツ', rows: pRows, freeze: 1, freezeCols: 2, widths: [7, 16, 9, 9, ...spHead.slice(4).map(() => 10)] };

  // ---------- 1分ごと（試合通算の分。イベント一覧から数式で） ----------
  const maxMin = Math.max(40, ...ms.map((x) => Math.ceil(x.M.periods.filter((p) => p.status !== 'none').reduce((t, p) => t + p.len, 0) / 60000)));
  const mCols = [['シュート', [['シュート', '"自"']]], ['被シュート', [['シュート', '"相"']]], ['Z4進入', [['イベント', '"Z4進入"']]], ['被Z4進入', [['イベント', '"被Z4進入"']]], ['SZ進入', [['イベント', '"SZ進入"']]], ['被SZ進入', [['イベント', '"被SZ進入"']]],
    ['FSP AT', [['イベント', '"FINISH SET PLAY AT"']]], ['FSP DF', [['イベント', '"FINISH SET PLAY DF"']]], ['リカバリー', [['イベント', '"ボールリカバリー"']]], ['ロスト', [['イベント', '"ボールロスト"']]], ['得点', [['得点・失点', '"得点"']]], ['失点', [['得点・失点', '"失点"']]]];
  const minRows = [[H('分（試合通算）'), ...mCols.map(([h]) => H(h))]];
  for (let i = 1; i <= maxMin; i++) // 1分目＝0:00〜1:00、10分目＝9:01〜10:00（終わりを含む。マッチスタッツの時間帯と同じ）
     minRows.push([i, ...mCols.map(([, c]) => ({ f: cnt([['通算の分', `$A${i + 1}`], ...c]) }))]);
  minRows.push([{ v: '合計', s: 'bold' }, ...mCols.map((_, j) => ({ f: `SUM(${colName(j + 1)}2:${colName(j + 1)}${maxMin + 1})`, s: 'bold' }))]);
  const minSheet = { name: '1分ごと', rows: minRows, freeze: 1, widths: [12, ...mCols.map(() => 10)] };

  // ---------- はじめに ----------
  const intro = { name: 'はじめに', widths: [110], rows: [
    [{ v: `${teamName} データシート`, s: 'title' }],
    [{ v: `対象：${ms.map((x) => title(x.m)).join('、')}（${ms.length}試合）　書き出し：${new Date().toLocaleString('ja-JP')}`, s: 'note' }], [],
    [{ v: 'シート', s: 'sub' }],
    ['試合情報：試合ごとの情報と、チームの数字（得点・シュート・進入・FINISH SET PLAY・リカバリー・ロスト・ファール・カードなど）。数字はイベント一覧から数式で計算'],
    ['イベント一覧：1行1件。時刻（経過・残り・試合通算）、イベント、選手、結果や種類、ピッチにいた5人、GKがいない区間か、5x4の時間帯か、退場の時間帯か、未入力・要確認、入力元'],
    ['出場時間：選手ごと・ピリオドごとの出場時間と回数（アプリで集計した値。プレーイングタイム）'],
    ['出場記録：1回ごとの出場（入った・出た時刻と時間。アプリで集計した値）'],
    ['選手スタッツ：選手ごとのシュート・シュート関与・被シュート関与・得点・アシスト・進入関与・リカバリー・ロスト・ファール・得失点±など（イベント一覧から数式で計算）'],
    ['セット：FP4人の組み合わせごとの出場時間と回数（アプリで集計した値。5×4・4×5と退場の時間帯を除き、短いセットと除いた時間は下の行にまとめる）'],
    ['1分ごと：試合通算の1分ごとの回数（イベント一覧から数式で計算。10分＝9:01〜10:00）'],
    ['選手一覧：背番号・名前・ポジション・出場試合数'], [],
    [{ v: '読み方', s: 'sub' }],
    ['シュートは得点を含み、OGは除く。シュート関与・被シュート関与＝その選手がピッチにいる間の自チーム・相手のシュートの数。得失点±＝ピッチにいる間の得点−失点'],
    ['イベント一覧の行（選手・結果など）を直すと、試合情報・選手スタッツ・1分ごとの数字は計算し直されます。出場時間・出場記録・セットはアプリの値なので変わりません'],
    ['時間は「分:秒」で表示しています（Excel の時間の値なので、足し算ができます）'],
  ] };
  return [intro, infoSheet, events, timeSheet, stintSheet, playerSheet, setSheet, minSheet, plist];
}
