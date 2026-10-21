// 分析画面（spec 9章「集計画面の構成」）。⑤-1：試合の選び方・出場時間・スタッツ。
// マッチレビューと同じ記録から同じ計算で作るので、数字は必ず一致する。
// 画面全体はスクロールせず、選手の表の中だけをスクロールする（条件を切り替えて見比べる画面のため）。
import { S, watchOps, watchEvents, opts, teamSettings, playerById, activityById, matchStatus } from './store.js';
import { periodLabel } from './engine.js';
import { modelOf, playerTable, entryOrder } from './model.js';
import { teamStats, playerDetail, addInto, blankDetail, FSP_KEYS, ZONE_KEYS, ppWindows, windowsOf, clipModel, winTest, ppTime, setSplit, asOfLabel } from './teamstats.js';
import { missing, pitchAt, isFsp, OPP_OG, isOG } from './events.js';
import { shotsOf, CLS_KEYS } from './teamstats.js';
import { paceSection, goalMarks, PACE_ROWS, teamSection, bandTip } from './review58.js';
import { timelineHTML, declutterTimeline, printReviews } from './review.js';
import { esc, fmtShort, openModal, closeModal, toast } from './ui.js';
import { render } from './views.js';
import { printStats } from './stats.js';
import { downloadDatasheet } from './dsview.js';
import { printReport, printTime } from './report.js';
import { bindRowHl } from './rowtip.js';
import { REGIONS, regionOf, opponents, regionModal, isNational } from './mpick.js';
import { flag } from './flags.js';
import { bigBtn, bindBig, fitBox } from './bigview.js';

const mmss = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const PCOL = { '1H': '#1F5FBF', '2H': '#8FB3EC', E1: '#0E8A6E', E2: '#86D3BE' };
const MCOL = ['#1F5FBF', '#E0832B', '#2E8B57', '#8A5AC8', '#C8312B', '#0E8A9E', '#B5600F', '#5F6B80'];
const TABS = [['time', '出場時間'], ['stats', 'スタッツ'], ['set', 'セット'], ['pp', 'パワープレー'], ['type', '局面別'], ['pace', 'マッチ・ペース'], ['bym', '試合ごと'], ['byo', '相手ごと']]; // 試合ごと・相手ごとは2026-10-22 追加（何試合かを並べて見るものなので右に）
// 2026-10-16：この2つだけ。2026-10-17（決8）：「5×4/4×5を除く」→「数的同数だけ」（5×4・4×5と、両チームの退場の時間帯を除く）
const PPM = [['all', 'すべて'], ['ex', '数的同数だけ', '5×4・4×5と、両チームの退場（3×4・4×3）の時間帯を除く']];
const SUBS = [['sum', 'まとめ'], ['shot', 'シュート'], ['goal', '得失点'], ['ent', 'Z4・SZ進入'], ['rl', 'リカバリー・ロスト'], ['foul', 'ファール・カード'], ['fsp', 'FINISH SET PLAY']];
const A = { scope: 'match', matchId: null, picked: null, f: { act: '', type: '', cat: '', from: '', to: '', opp: '', rg: '' }, agg: 'sum', per: 'all', pp: 'all', tab: 'stats', tview: 'list', msub: 'time', tmet: 'shot', osub: 'rg', bin: 60000, rows: ['shot', 'ent', 'fsp'], sub: 'sum', sort: { col: '', dir: 'desc' } };
try { Object.assign(A, JSON.parse(localStorage.getItem('fpt.analysis') || '{}'), { sort: { col: '', dir: 'desc' } }); } catch {}
if (A.tmet === 'z4' || A.tmet === 'sz') A.tmet = 'ent'; // 2026-10-22：Z4進入とSZ進入は1つのボタンで、グラフを横に並べる
let fromHash = null;
let paceSel = null;
const anHl = new Set(); // 表の強調している行（開いている間だけ）
if (!['all', 'ex'].includes(A.pp)) A.pp = 'all';
const keep = () => { try { const { scope, matchId, picked, f, agg, per, pp, tab, sub, tview, msub, tmet, osub, bin, rows } = A; localStorage.setItem('fpt.analysis', JSON.stringify({ scope, matchId, picked, f, agg, per, pp, tab, sub, tview, msub, tmet, osub, bin, rows })); } catch {} };

// 分析できる試合（試合中・終わった試合）
const candidates = () => S.matches.filter((m) => !m.deleted && (m.status === 'playing' || m.status === 'done'))
  .sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.kickoff || '').localeCompare(a.kickoff || ''));
function filtered() {
  const f = A.f;
  return candidates().filter((m) => {
    const a = activityById(m.activityId);
    return (!f.act || m.activityId === f.act) && (!f.type || a?.type === f.type) && (!f.cat || m.category === f.cat)
      && (!f.from || (m.date || '') >= f.from) && (!f.to || (m.date || '') <= f.to)
      // 相手・相手の地域（2026-10-22）：同じ相手との対戦の傾向、大陸ごとの傾向を見る
      && (!f.opp || m.opponent === f.opp) && (!f.rg || !isNational() || regionOf(m.opponent) === f.rg);
  });
}
// 複数の試合（全試合・選んだ試合）は、試合中の試合を入れない（未7、2026-10-17 決定）。「この試合」は試合中でも見られる
let skippedLive = 0;
function selected() {
  skippedLive = 0;
  if (A.scope === 'match') { const m = candidates().find((x) => x.id === A.matchId) || candidates()[0]; if (m) A.matchId = m.id; return m ? [m] : []; }
  // 選んだ試合：チェックした試合そのまま（絞り込みの条件は、探すためだけに使う。条件を変えて足したものも残す。2026-10-22）
  const list = A.scope === 'pick' ? (() => { const set = new Set(A.picked || []); return candidates().filter((m) => set.has(m.id)); })() : filtered();
  const done = list.filter((m) => m.status !== 'playing'); skippedLive = list.length - done.length;
  return done;
}
export const liveSkipped = () => skippedLive;

// 1試合ぶんの計算（選んだピリオドの範囲）
// 試合が多いと、タブや切り替えを押すたび・記録が1件届くたびに全試合を計算し直すと遅い（50試合で数秒）。
// 記録（ops・イベントの一覧）・修正・得点の種類が同じで、選んだ範囲（前半/後半・時間帯）も同じなら、前の計算を使う。
// 試合中の試合は出場中の時間が進むので、毎回計算する（modelOf が毎回新しい M を返す）。
const memo = new Map(); // m.id → { M, evs, gts, vals: Map(範囲 → 計算) }
function oneMatch(m, per) {
  const opsC = watchOps(m.id); const evC = watchEvents(m.id);
  if (!opsC.ready && !opsC.list.length) return null;
  const cfg = { times: m.times || {}, members: m.members || {}, timesFixed: !!m.timesFixed, setplayAuto: teamSettings().setplayAuto || 60 };
  const { st, M } = modelOf(opsC.list, cfg, m.fix);
  const gts = S.global?.goalTypes;
  let c = memo.get(m.id);
  if (!c || c.M !== M || c.evs !== evC.list || c.gts !== gts) memo.set(m.id, (c = { M, evs: evC.list, gts, vals: new Map() }));
  const vk = `${per}|${A.pp}|${evC.ready}`;
  let v = c.vals.get(vk);
  if (!v) {
    v = calcOne(m, per, st, M, evC);
    if (c.vals.size >= 4) c.vals.delete(c.vals.keys().next().value);
    c.vals.set(vk, v);
  }
  return { ...v, m }; // 試合の情報（相手・日付など）はいつも今のものを使う
}
function calcOne(m, per, st, M, evC) {
  const keys = per === 'all' ? null : M.periods.some((p) => p.key === per && p.status !== 'none') ? [per] : [];
  const gn = (id) => opts('goalTypes', true).find((o) => o.id === id)?.name || '';
  const evs = evC.list.filter((e) => !e.deleted);
  // パワープレー（5×4）の時間帯で分ける：出場時間もイベントも、選んだ時間帯の中だけで数える
  const W = ppWindows(M, evs); const wins = windowsOf(M, W, A.pp); const win = winTest(wins, M);
  const Mw = clipModel(M, wins);
  const T = playerTable(Mw);
  if (wins) for (const r of Object.values(T)) { // 回数は、元の出場（1回の帯）で数える（区間で切れても1回）
    r.count = 0; for (const [k, c] of Object.entries(r.per)) { c.count = M.stints.filter((s) => s.pid === r.pid && s.period === k && (wins[k] || []).some(([x, y]) => Math.min(s.to, y) > Math.max(s.from, x))).length; r.count += c.count; }
  }
  const pids = Object.keys(m.members || {});
  const R = teamStats(M, evs, gn, keys, win);
  const D = playerDetail(M, evs, gn, pids, T, keys, win);
  for (const pid of pids) { const t = ppTime({ ...M, stints: M.stints.filter((s) => !keys || keys.includes(s.period)) }, W, pid); D[pid].pOwn = t.own; D[pid].pOpp = t.opp; }
  const len = Mw.periods.filter((p) => p.status !== 'none' && (!keys || keys.includes(p.key))).reduce((a, p) => a + p.elapsed, 0);
  const empty = Mw.empties.filter((e) => !keys || keys.includes(e.period)).reduce((a, e) => a + e.to - e.from, 0);
  const todo = evs.filter((e) => missing(e, gn) > 0 || e.check).length;
  // lazy：タブごとの1試合ぶんの計算の写し（セット・パワープレー）
  return { m, st, M, Mw, T, R, D, keys, len, empty, hasEv: evs.length > 0, todo, ready: evC.ready, hasOpp: W.hasOpp, evs, gn, W, win, wins, lazy: {} };
}

// 対戦成績（複数の試合を選んだとき。2026-10-22）：勝ち・引き分け・負けと、得点・失点（試合全体。PK戦は勝ち負けだけ）
// 1試合の勝ち・引き分け・負け（試合全体の得点・失点。PK戦は勝ち負けに入れる）
function resOf(x) {
  const ev = x.evs.filter((e) => !e.deleted); const a = ev.filter((e) => e.kind === 'goal').length, b = ev.filter((e) => e.kind === 'conc').length; const pk = x.m.pk;
  const pkd = pk && pk.own != null && pk.opp != null && pk.own !== pk.opp;
  const r = a > b ? 'w' : a < b ? 'l' : pkd ? (pk.own > pk.opp ? 'w' : 'l') : 'd';
  return { r, gf: a, ga: b, pk: a === b && pkd ? `PK ${pk.own}−${pk.opp}` : '' };
}
function recLine(ok) {
  if (ok.length < 2) return '';
  let w = 0, d = 0, l = 0, gf = 0, ga = 0;
  for (const x of ok) { const o = resOf(x); gf += o.gf; ga += o.ga; if (o.r === 'w') w++; else if (o.r === 'l') l++; else d++; }
  return `<div class="anrec"><b>対戦成績</b><span>${ok.length}試合</span><span class="w">${w}勝</span><span>${d}分</span><span class="l">${l}敗</span><span>得点 <b>${gf}</b> − 失点 <b>${ga}</b></span><small>PK戦の勝ち負けは勝ち・負けに入れる。得点・失点は試合全体</small></div>`;
}

// 選手の記録（precord.js）用：試合ごとの計算（試合全体・パワープレーも含めたすべての時間）。読み込み中の試合があれば loading
export function matchCalcs(ms) {
  const save = A.pp; A.pp = 'all';
  try { const res = ms.map((m) => oneMatch(m, 'all')); return { list: res.filter(Boolean), loading: res.some((x) => !x) }; } finally { A.pp = save; }
}

// 選んだ試合の計算と、選手ごと・チームの合計（画面とマッチレポートで使う）
export function buildCtx(ms) {
  const per = A.per;
  const res = ms.map((m) => oneMatch(m, per));
  const loading = res.some((x) => !x);
  const ok = res.filter(Boolean);
  // 選手ごと・チームの合計
  const P = {}; const team = { games: ok.length, len: 0, empty: 0, A: null, B: null, score: { own: 0, opp: 0 }, rec: 0, lost: 0, timeouts: { own: 0, opp: 0 }, ejOwn: 0, ejOpp: 0 };
  const no = {}, pos = {};
  for (const x of ok) {
    team.len += x.len; team.empty += x.empty;
    team.A = addInto(team.A || {}, x.R.A); team.B = addInto(team.B || {}, x.R.B);
    team.score.own += x.R.rangeScore.own; team.score.opp += x.R.rangeScore.opp;
    team.rec += x.R.rec; team.lost += x.R.lost; team.timeouts.own += x.R.timeouts.own; team.timeouts.opp += x.R.timeouts.opp; team.ejOwn += x.R.ejOwn; team.ejOpp += x.R.ejOpp;
    for (const [pid, d] of Object.entries(x.D)) {
      P[pid] = addInto(P[pid] || blankDetail(), d);
      no[pid] = x.m.members[pid]?.no ?? no[pid]; pos[pid] = x.m.members[pid]?.pos || pos[pid];
      // 試合ごとの出場時間（棒の積み上げ用）
      (P[pid].byMatch = P[pid].byMatch || {})[x.m.id] = d.time;
      (P[pid].byMatchN = P[pid].byMatchN || {})[x.m.id] = d.count;
      for (const p of x.M.periods) { const c = x.T[pid]?.per?.[p.key]; if (!c || (x.keys && !x.keys.includes(p.key))) continue; const q = (P[pid].per = P[pid].per || {}); q[p.key] = q[p.key] || { time: 0, count: 0 }; q[p.key].time += c.time; q[p.key].count += c.count; }
    }
  }
  const hasEv = ok.some((x) => x.hasEv);
  const pids = Object.keys(P).sort((a, b) => (pos[a] === 'GK') - (pos[b] === 'GK') || (parseInt(no[a], 10) || 999) - (parseInt(no[b], 10) || 999));
  const ctx = { ok, P, team, no, pos, pids, hasEv, ms };
  return { ctx, loading };
}

export function vAnalysis(r, mFrom = null) {
  // 試合ページから開いたときは「この試合」で始める（開いたあとは自由に切り替えられる）
  if (mFrom && fromHash !== location.hash) { A.scope = 'match'; A.matchId = mFrom.id; keep(); }
  fromHash = mFrom ? location.hash : null;
  // まだ始まっていない試合（MATCH PLAYの記録なし）から開いたとき：「この試合」はその試合のまま、ほかの試合の数字は出さない（AN-01）
  const pre = A.scope === 'match' && mFrom && A.matchId === mFrom.id && !candidates().some((x) => x.id === mFrom.id);
  if (pre) skippedLive = 0;
  const ms = pre ? [] : selected();
  const { ctx, loading } = buildCtx(ms);
  const { ok } = ctx;

  // ---------- 上：対象・切り替え ----------
  const cand = pre ? [mFrom, ...candidates()] : candidates();
  const seg = (key, list) => `<span class="anseg">${list.map(([v, l, t]) => `<button class="${A[key] === v ? 'on' : ''}" data-set="${key}" data-v="${v}"${t ? ` title="${t}"` : ''}>${l}</button>`).join('')}</span>`;
  const one = A.scope === 'match' ? `<select id="anMatch" class="ansel" data-fresh="1">${cand.map((m) => `<option value="${m.id}" ${m.id === A.matchId ? 'selected' : ''}>${fmtShort(m.date)} vs ${esc(m.opponent)}</option>`).join('')}</select>` : '';
  const fl = A.scope === 'pick' ? '' : [A.f.opp, A.f.rg && isNational() && `${A.f.rg}の相手`].filter(Boolean).join('・');
  const multi = A.scope !== 'match' ? `<button class="btn sm" id="anPick">${A.scope === 'pick' ? '試合を選ぶ' : '絞り込み'}${fl ? `：${esc(fl)}` : ''}（${ms.length}試合）</button>` : '';
  const todoN = ok.filter((x) => x.todo).length; const noOpp = ok.filter((x) => !x.hasOpp).length;
  const head = `<div class="anhead">
    <div class="anrow"><b class="antt">分析</b>${seg('scope', [['match', 'この試合'], ['all', '全試合'], ['pick', '選んだ試合']])}${one}${multi}
      ${A.scope === 'match' ? '' : seg('agg', [['sum', '合計'], ['avg', '1試合平均']])}${seg('per', [['all', '全体'], ['1H', '前半'], ['2H', '後半']])}
      <span class="anpp" title="数的同数だけ＝5×4・4×5と、両チームの退場（3×4・4×3）の時間帯を除く">時間帯${seg('pp', PPM)}</span>
      ${A.pp !== 'all' && noOpp ? `<span class="antodo" title="相手の5×4はMATCH PLAYのパワープレー（相手）か記録の修正で入れたときだけ分けられます">相手の5×4（こちらの4×5）の記録なし ${noOpp}試合</span>` : ''}
      ${todoN ? `<span class="antodo" title="未入力の項目か要確認が残っている試合">未入力あり ${todoN}試合</span>` : ''}${skippedLive ? `<span class="anlive" title="試合が終わると含めます。試合中の試合は「この試合」で見られます">試合中の ${skippedLive}試合は含めていません</span>` : ''}${loading ? '<span class="mu">読み込み中…</span>' : ''}<span class="sp"></span>${pre ? '' : '<span class="anexp">書き出し<button class="btn sm" id="anExpStats">マッチスタッツ（PDF）</button><button class="btn sm" id="anExpRv">マッチレビュー（PDF）</button><button class="btn sm" id="anExpRep">マッチレポート（PDF）</button><button class="btn sm" id="anExpDs">データシート（Excel）</button></span>'}${pre ? '' : bigBtn()}</div>
    ${recLine(ok)}
    <div class="antabs">${TABS.map(([v, l]) => `<button class="${A.tab === v ? 'on' : ''} " data-tab="${v}">${l}</button>`).join('')}</div></div>`;

  let body;
  if (pre) body = `<div class="card empty">この試合はまだ記録がありません。MATCH PLAYで試合を始めると、ここに出ます<div class="mt"><a class="btn" href="#/m/${mFrom.id}">‹ 試合ページ</a></div></div>`;
  else if (!ms.length) body = skippedLive ? `<div class="card empty">対象の試合は試合中の ${skippedLive}試合だけです。試合が終わると含めます（試合中の試合は「この試合」で見られます）</div>` : '<div class="card empty">対象の試合がありません（試合が始まると分析できます）</div>';
  else if (A.tab === 'time') body = timeTab(ctx);
  else if (A.tab === 'bym') body = byMatchTab(ctx);
  else if (A.tab === 'byo') body = byOppTab(ctx);
  else if (A.tab === 'stats') body = statsTab(ctx);
  else if (A.tab === 'set') body = setTab(ctx);
  else if (A.tab === 'pp') body = ppTab(ctx);
  else if (A.tab === 'type') body = typeTab(ctx);
  else body = paceTab(ctx);
  return { active: 'analysis', html: `<div class="anw">${head}<div class="anbody">${body}</div></div>`, bind: bindAnalysis };
}

// ---------- 試合ごと（2026-10-22）：選手×試合の出場時間、チームの試合ごとの推移 ----------
const byDate = (ok) => [...ok].sort((a, b) => (a.m.date || '').localeCompare(b.m.date || '') || (a.m.kickoff || '').localeCompare(b.m.kickoff || ''));
const dayN = (d) => (d ? Math.round(Date.parse(d + 'T00:00:00Z') / 86400000) : null);
const subBtns = (key, list) => `<div class="ansubs">${list.map(([v, l]) => `<button class="${A[key] === v ? 'on' : ''}" data-aset="${key}" data-v="${v}">${l}</button>`).join('')}</div>`;
const condTxt = () => [A.per !== 'all' ? periodLabel(A.per) + 'だけ' : '', A.pp !== 'all' ? '数的同数だけ' : ''].filter(Boolean).join('・');
const need2 = (what) => `<div class="card empty">${what}は、2試合以上を見るときに出ます。上の「全試合」か「選んだ試合」に切り替えてください</div>`;
const resMark = (o) => `<b class="anres ${o.r}">${o.r === 'w' ? '勝' : o.r === 'l' ? '負' : '分'}</b>${o.pk ? `<small>${o.pk}</small>` : ''}`;
function mHead(x, prev) {
  let gap = '';
  if (prev) { const a = dayN(prev.m.date), b = dayN(x.m.date); if (a != null && b != null) gap = b === a ? '同じ日' : b - a === 1 ? '連日' : `中${b - a - 1}日`; }
  return `<small>${fmtShort(x.m.date)}</small><br>vs ${flag(x.m.opponent)}${esc(x.m.opponent || '')}${gap ? `<br><small class="angap">${gap}</small>` : ''}`;
}
function byMatchTab(ctx) {
  if (ctx.ok.length < 2) return need2('試合ごとの表');
  return teamTrend(ctx); // 選手×試合の出場時間は「出場時間」タブへ（2026-10-22）
}
export function playerByMatch(ctx) {
  const xs = byDate(ctx.ok); const { P } = ctx;
  const cell = (x, pid) => (x.m.members?.[pid] ? (x.D[pid]?.time || 0) : null);
  const tot = (pid) => xs.reduce((s, x) => s + (cell(x, pid) || 0), 0);
  const gp = (pid) => xs.filter((x) => (cell(x, pid) || 0) > 0).length;
  const key = A.sort.col; const val = (pid) => (key === 'tot' ? tot(pid) : key === 'gp' ? gp(pid) : key === 'avg' ? (gp(pid) ? tot(pid) / gp(pid) : -1) : key.startsWith('m:') ? cell(xs.find((x) => x.m.id === key.slice(2)), pid) ?? -1 : 0);
  let list = ctx.pids.slice();
  if (key) list.sort((a, b) => (val(b) - val(a)) * (A.sort.dir === 'asc' ? -1 : 1));
  list = [...list.filter((p) => ctx.pos[p] !== 'GK'), ...list.filter((p) => ctx.pos[p] === 'GK')];
  const mx = Math.max(1, ...xs.map((x) => x.len));
  const ic = (k) => `<i>${A.sort.col === k ? (A.sort.dir === 'asc' ? '▲' : '▼') : A.print ? '' : '⇅'}</i>`;
  const th = xs.map((x, i) => `<th class="srt ${key === 'm:' + x.m.id ? 'on' : ''}" data-sort="m:${x.m.id}">${mHead(x, xs[i - 1])}${ic('m:' + x.m.id)}</th>`).join('');
  const rows = list.map((pid) => {
    const tds = xs.map((x) => { const v = cell(x, pid); if (v == null) return '<td class="anoff">—</td>'; if (!v) return '<td class="anzero">0:00</td>';
      const a = Math.min(1, v / mx); return `<td style="background:rgba(31,95,191,${(0.06 + a * 0.42).toFixed(2)})${a > 0.62 ? ';color:#fff' : ''}"><b>${mmss(v)}</b></td>`; }).join('');
    const g = gp(pid), t = tot(pid);
    return `<tr class="${t ? '' : 'zero'}"><td class="apl"><span class="pnm">${badge(ctx, pid)}<span>${name(pid)}</span></span></td>${tds}<td class="sum"><b>${mmss(t)}</b></td><td>${g}</td><td>${g ? mmss(t / g) : '—'}</td></tr>`;
  }).join('');
  const foot = `<tr class="tot"><td class="apl">試合の時間</td>${xs.map((x) => `<td>${mmss(x.len)}</td>`).join('')}<td><b>${mmss(xs.reduce((s, x) => s + x.len, 0))}</b></td><td></td><td></td></tr>`;
  const c = condTxt();
  return `<div class="antbl"><table class="antb anauto anbym" data-nmx="1.33"><thead><tr><th class="srt apl ${key ? '' : 'on'}" data-sort="">選手<i>${A.print ? '' : key ? '⇅' : '背番号順'}</i></th>${th}<th class="srt ${key === 'tot' ? 'on' : ''}" data-sort="tot">合計${ic('tot')}</th><th class="srt ${key === 'gp' ? 'on' : ''}" data-sort="gp">出場<br>試合数${ic('gp')}</th><th class="srt ${key === 'avg' ? 'on' : ''}" data-sort="avg">出場した試合の<br>平均${ic('avg')}</th></tr></thead><tbody>${rows}</tbody><tfoot>${foot}</tfoot></table></div>
    <p class="anhint">試合は日付の古い順。${c ? c + 'の時間。' : ''}色が濃いほど、その試合で長く出た（試合の時間に対して）。「—」＝その試合のメンバー外、薄い「0:00」＝メンバーだが出ていない。連日＝前の日にも試合、中n日＝前の試合との間に空いた日数。出場した試合の平均＝合計÷出場試合数。${A.print ? 'GKは一番下。' : '見出しを押すと並べ替え、GKはいつも一番下。'}</p>`;
}
const TMET = [['goal', '得点・失点', (a, b, x) => [x.R.rangeScore.own, x.R.rangeScore.opp]], ['shot', 'シュート', (a, b) => [a.shots, b.shots]], ['in', '枠内', (a, b) => [a.in, b.in]], ['ent', 'Z4・SZ進入', (a, b) => [a.z4, b.z4]],
  ['fsp', 'FINISH SET PLAY', (a, b) => [a.fsp, b.fsp]], ['rl', 'リカバリー・ロスト', (a, b, x) => [x.R.rec, x.R.lost]], ['foul', 'ファール', (a, b) => [a.foul, b.foul]]];
// 試合ごとの棒グラフ（2026-10-22：線から棒へ。試合ごとに、自チーム＝青と相手＝赤を並べる）
// FINISH SET PLAY の種類（積み上げの順。下から）。FK は PK・第2PK を含む
const FSPK = [['CK', 0], ['CK-KI', 1], ['KI', 2], ['FK', 3]];
const FSPC = { w: ['#0E3A8A', '#2F6FD0', '#6E9EE3', '#AFC9F0', '#E3EAF5'], o: ['#8E1B16', '#C8312B', '#E3766B', '#F2B0A8', '#F7E1DE'] };
function fspParts(s) { const t = s.fspT || [0, 0, 0, 0]; return [...t, Math.max(0, (s.fsp || 0) - t.reduce((a, b) => a + b, 0))]; }
function trendSvg(xs, met) {
  if (met === 'fsp') return fspSvg(xs);
  // Z4進入とSZ進入：2つのグラフを横に並べる。目盛りをそろえて、高さで見比べられるように（2026-10-22）
  if (met === 'ent') {
    const z4 = xs.map((x) => [x.R.A.z4, x.R.B.z4]), sz = xs.map((x) => [x.R.A.szE, x.R.B.szE]);
    const top = Math.max(1, ...z4.flat(), ...sz.flat());
    return `<div class="antr2">${barsSvg(xs, z4, 'Z4進入', top)}${barsSvg(xs, sz, 'SZ進入', top)}</div><p class="anhint antr2h">2つのグラフは目盛りをそろえています（高さでZ4進入とSZ進入を見比べられます）</p>`;
  }
  const [, label, f] = TMET.find((t) => t[0] === met) || TMET[1];
  return barsSvg(xs, xs.map((x) => f(x.R.A, x.R.B, x)), label, 0, met === 'rl');
}
function barsSvg(xs, vals, label, maxV = 0, rl = false) {
  const n = xs.length; const L = 46, R = 16, T = 22, B = 46; const slot = Math.max(70, Math.min(150, 940 / n)); const W = L + R + slot * n, H = 260;
  const max = Math.max(1, maxV, ...vals.flat()); const step = max <= 5 ? 1 : max <= 12 ? 2 : max <= 30 ? 5 : max <= 60 ? 10 : 20; const top = Math.ceil(max / step) * step;
  const Y = (v) => T + (H - T - B) * (1 - v / top);
  let g = ''; for (let v = 0; v <= top; v += step) g += `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="#E3E8F0"/><text x="${L - 8}" y="${Y(v) + 4}" text-anchor="end" font-size="12" fill="#7A8699">${v}</text>`;
  const bw = Math.min(34, slot * 0.32);
  const bars = vals.map((v, i) => { const cx = L + slot * (i + 0.5);
    return [[0, '#1F5FBF', cx - bw - 1], [1, '#C8312B', cx + 1]].map(([k, col, x]) => `<rect x="${x}" y="${Y(v[k])}" width="${bw}" height="${Math.max(0, Y(0) - Y(v[k]))}" rx="3" fill="${col}"/><text x="${x + bw / 2}" y="${Y(v[k]) - 5}" text-anchor="middle" font-size="13" font-weight="700" fill="${col}">${v[k]}</text>`).join('')
      + `<text x="${cx}" y="${H - B + 18}" text-anchor="middle" font-size="12" fill="#3A4558">${fmtShort(xs[i].m.date)}</text><text x="${cx}" y="${H - B + 34}" text-anchor="middle" font-size="12" fill="#3A4558">vs ${esc((xs[i].m.opponent || '').slice(0, Math.max(4, Math.floor(slot / 13))))}</text>`; }).join('');
  const own = esc(S.team?.name || '自チーム');
  return `<div class="antrend"><div class="anlg"><span><i style="background:#1F5FBF"></i>${rl ? 'リカバリー' : own}</span><span><i style="background:#C8312B"></i>${rl ? 'ロスト' : '相手'}</span><b>${label}</b></div><svg viewBox="0 0 ${W} ${H}" class="antrsvg" style="max-width:${Math.max(560, W)}px">${g}${bars}</svg></div>`;
}
// FINISH SET PLAY：試合ごとに、自チーム（青）と相手（赤）の棒を種類で積み上げ、それぞれの数を入れる（2026-10-22）
function fspSvg(xs) {
  const vals = xs.map((x) => [fspParts(x.R.A), fspParts(x.R.B)]);
  const n = xs.length; const L = 46, R = 16, T = 24, B = 46; const slot = Math.max(110, Math.min(170, 940 / n)); const W = L + R + slot * n, H = 330;
  const max = Math.max(1, ...vals.flatMap((v) => v.map((p) => p.reduce((a, b) => a + b, 0)))); const step = max <= 5 ? 1 : max <= 12 ? 2 : max <= 30 ? 5 : max <= 60 ? 10 : 20; const top = Math.ceil(max / step) * step;
  const Y = (v) => T + (H - T - B) * (1 - v / top);
  let g = ''; for (let v = 0; v <= top; v += step) g += `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="#E3E8F0"/><text x="${L - 8}" y="${Y(v) + 4}" text-anchor="end" font-size="12" fill="#7A8699">${v}</text>`;
  const bw = Math.min(40, slot * 0.3);
  const bar = (parts, x, side) => {
    let acc = 0, out = ''; const cols = FSPC[side]; const tot = parts.reduce((a, b) => a + b, 0);
    parts.forEach((c, k) => { if (!c) return; const y0 = Y(acc), y1 = Y(acc + c); acc += c; const h = y0 - y1;
      out += `<rect x="${x}" y="${y1}" width="${bw}" height="${h}" fill="${cols[k]}" stroke="#fff" stroke-width="1"/>`;
      const fg = k < 2 ? '#fff' : '#1A2340';
      if (h >= 13) out += `<text x="${x + bw / 2}" y="${(y0 + y1) / 2 + 4.5}" text-anchor="middle" font-size="12" font-weight="700" fill="${fg}">${c}</text>`;
      else out += `<text x="${side === 'w' ? x - 4 : x + bw + 4}" y="${(y0 + y1) / 2 + 4}" text-anchor="${side === 'w' ? 'end' : 'start'}" font-size="11" font-weight="700" fill="${cols[Math.min(k, 1)]}">${c}</text>`; });
    return out + `<text x="${x + bw / 2}" y="${Y(tot) - 6}" text-anchor="middle" font-size="14" font-weight="800" fill="${side === 'w' ? '#1F5FBF' : '#C8312B'}">${tot}</text>`;
  };
  const bars = vals.map((v, i) => { const cx = L + slot * (i + 0.5);
    return bar(v[0], cx - bw - 2, 'w') + bar(v[1], cx + 2, 'o')
      + `<text x="${cx}" y="${H - B + 18}" text-anchor="middle" font-size="12" fill="#3A4558">${fmtShort(xs[i].m.date)}</text><text x="${cx}" y="${H - B + 34}" text-anchor="middle" font-size="12" fill="#3A4558">vs ${esc((xs[i].m.opponent || '').slice(0, Math.max(4, Math.floor(slot / 13))))}</text>`; }).join('');
  const own = esc(S.team?.name || '自チーム');
  const hasMiss = vals.some((v) => v[0][4] || v[1][4]);
  const kinds = [...FSPK.map(([l]) => (l === 'FK' ? 'FK（PK・第2PKを含む）' : l)), ...(hasMiss ? ['種類なし'] : [])];
  const lg = kinds.map((l, k) => `<span class="fspk"><i style="background:${FSPC.w[k]}"></i><i style="background:${FSPC.o[k]}"></i>${l}</span>`).join('');
  return `<div class="antrend"><div class="anlg"><span><i style="background:#1F5FBF"></i>${own}（左）</span><span><i style="background:#C8312B"></i>相手（右）</span><b>FINISH SET PLAY</b></div><div class="anlg fsplg">${lg}<small>下から積み上げ。棒の中の数＝その種類の数、棒の上＝合計</small></div><svg viewBox="0 0 ${W} ${H}" class="antrsvg" style="max-width:${Math.max(600, W)}px">${g}${bars}</svg></div>`;
}
function teamTrend(ctx) {
  const xs = byDate(ctx.ok); const n = xs.length;
  const met = A.print ? '' : `<div class="ansubs"><span class="anlab">棒グラフ</span>${TMET.map(([k, l]) => `<button class="${A.tmet === k ? 'on' : ''}" data-aset="tmet" data-v="${k}">${l}</button>`).join('')}</div>`;
  const pair = (a, b, sa, sb) => `<td class="w">${a}${sa != null ? `<small>（${sa}）</small>` : ''}</td><td class="o">${b}${sb != null ? `<small>（${sb}）</small>` : ''}</td>`;
  const rows = xs.map((x) => { const a = x.R.A, b = x.R.B, o = resOf(x); const sc = x.R.rangeScore;
    return `<tr><td class="apl">${fmtShort(x.m.date)}</td><td class="apl">vs ${flag(x.m.opponent)}${esc(x.m.opponent || '')}</td><td>${resMark(o)}</td><td><b>${sc.own}−${sc.opp}</b></td>${pair(a.shots, b.shots, a.sz, b.sz)}${pair(a.in, b.in)}${pair(a.z4, b.z4)}${pair(a.szE, b.szE)}${pair(a.fsp, b.fsp)}<td>${x.R.rec}</td><td>${x.R.lost}</td>${pair(a.foul, b.foul)}</tr>`; }).join('');
  const T = ctx.team, a = T.A || {}, b = T.B || {}; const av = (v) => (n ? (v / n).toFixed(1) : '—');
  const tl = (lab, f) => `<tr class="tot"><td class="apl" colspan="3">${lab}</td><td><b>${f(T.score.own)}−${f(T.score.opp)}</b></td>${pair(f(a.shots), f(b.shots), f(a.sz), f(b.sz))}${pair(f(a.in), f(b.in))}${pair(f(a.z4), f(b.z4))}${pair(f(a.szE), f(b.szE))}${pair(f(a.fsp), f(b.fsp))}<td>${f(T.rec)}</td><td>${f(T.lost)}</td>${pair(f(a.foul), f(b.foul))}</tr>`;
  const c = condTxt();
  return `${met}<div class="antime">${trendSvg(xs, A.tmet)}<div class="antbl"><table class="antb anauto antrt"><thead><tr><th class="apl">日付</th><th class="apl">相手</th><th>結果</th><th>スコア${c ? `<br><small>${c}</small>` : ''}</th><th class="w">シュート<br><small>（SZ内）</small></th><th class="o">被シュート<br><small>（SZ内）</small></th><th class="w">枠内</th><th class="o">被枠内</th><th class="w">Z4<br>進入</th><th class="o">被Z4<br>進入</th><th class="w">SZ<br>進入</th><th class="o">被SZ<br>進入</th><th class="w">FSP<br>AT</th><th class="o">FSP<br>DF</th><th>リカバ<br>リー</th><th>ロスト</th><th class="w">ファール</th><th class="o">被ファール</th></tr></thead><tbody>${rows}</tbody><tfoot>${tl('合計', String)}${tl('1試合平均', av)}</tfoot></table></div>
    <p class="anhint">試合は日付の古い順。結果は試合全体（PK戦は勝ち・負けに入れる）。${c ? `スコアとほかの数は${c}。` : ''}シュートは得点を含む（OGは除く）。FSP＝FINISH SET PLAY。</p></div>`;
}
// ---------- 相手ごと（2026-10-22）：相手の地域ごと・相手チームごとの成績 ----------
function byOppTab(ctx) {
  const nat = isNational(); const mode = nat && A.osub !== 'opp' ? 'rg' : 'opp';
  return (A.print || !nat ? '' : subBtns('osub', [['rg', '相手の地域ごと'], ['opp', '相手チームごと']])) + oppTable(ctx, mode);
}
export function oppTable(ctx, mode) {
  const groups = new Map();
  for (const x of byDate(ctx.ok)) { const k = mode === 'rg' ? (regionOf(x.m.opponent) || '地域が未設定') : (x.m.opponent || '（名前なし）'); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(x); }
  let keys = [...groups.keys()];
  keys = mode === 'rg' ? REGIONS.filter((r) => groups.has(r)).concat(keys.filter((k) => !REGIONS.includes(k))) : keys.sort((p, q) => groups.get(q).length - groups.get(p).length || p.localeCompare(q, 'ja'));
  const row = (lab, list, sub, cls = '') => {
    let w = 0, d = 0, l = 0, gf = 0, ga = 0, sh = 0, osh = 0, en = 0, oen = 0, sgf = 0, sga = 0;
    for (const x of list) { const o = resOf(x); gf += o.gf; ga += o.ga; o.r === 'w' ? w++ : o.r === 'l' ? l++ : d++; const a = x.R.A, b = x.R.B; sh += a.shots; osh += b.shots; en += a.z4 + a.szE; oen += b.z4 + b.szE; sgf += x.R.rangeScore.own; sga += x.R.rangeScore.opp; }
    const n = list.length; const av = (v) => (v / n).toFixed(1);
    return `<tr class="${cls}"><td class="apl"><b>${lab}</b>${sub ? `<small class="anopps">${sub}</small>` : ''}</td><td><b>${n}</b></td><td class="w">${w}</td><td>${d}</td><td class="o">${l}</td><td><b>${gf}−${ga}</b></td><td class="w">${av(sgf)}</td><td class="o">${av(sga)}</td><td class="w">${av(sh)}</td><td class="o">${av(osh)}</td><td class="w">${av(en)}</td><td class="o">${av(oen)}</td></tr>`;
  };
  const oppsOf = (list) => { const m = new Map(); list.forEach((x) => m.set(x.m.opponent, (m.get(x.m.opponent) || 0) + 1)); return [...m].map(([nm, k]) => flag(nm) + esc(nm) + (k > 1 ? `×${k}` : '')).join('・'); };
  const body = keys.map((k) => row(mode === 'rg' ? esc(k) : flag(k) + esc(k), groups.get(k), mode === 'rg' ? oppsOf(groups.get(k)) : '')).join('');
  const c = condTxt();
  return `<div class="antbl"><table class="antb anauto anopp"><thead><tr class="grp"><th></th><th colspan="5" class="g">対戦成績（試合全体）</th><th colspan="6" class="g">1試合平均${c ? `（${c}）` : ''}</th></tr><tr><th class="apl">${mode === 'rg' ? '相手の地域' : '相手チーム'}</th><th>試合</th><th class="w">勝</th><th>分</th><th class="o">負</th><th>得点−失点</th><th class="w">得点</th><th class="o">失点</th><th class="w">シュート</th><th class="o">被シュート</th><th class="w">Z4・SZ<br>進入</th><th class="o">被Z4・SZ<br>進入</th></tr></thead><tbody>${body}</tbody><tfoot>${row('合計', ctx.ok, '', 'tot')}</tfoot></table></div>
    <p class="anhint">${mode === 'rg' ? '地域は相手の名前から自動で決めたもの（試合の選び方の画面の「地域を直す」で直せます）。地域の下は、その地域の相手と試合数。' : ''}勝・分・負と得点−失点は試合全体（PK戦は勝ち・負けに入れる）。1試合平均は、上の切り替え（前半・後半・数的同数だけ）に合わせた数。シュートは得点を含む（OGは除く）。進入＝Z4進入とSZ進入の合計。</p>`;
}

// ---------- 数字の見せ方 ----------
const ref = () => (teamSettings().refMin || 120) * 1000;
function cellFns(ctx) {
  const avg = A.agg === 'avg' && A.scope !== 'match';
  const n = (v, games) => { if (!avg) return String(v); const g = games || 0; return g ? (v / g).toFixed(1) : '—'; };
  // 2026-10-22：1分あたり → 40分あたり（1試合フルに出たときのペース。小数より差が分かりやすい）
  const pm = (v, time) => (time > 0 ? (v / (time / 2400000)).toFixed(1) : '—');
  return { avg, n, pm };
}
const badge = (ctx, pid) => `<span class="no ${ctx.pos[pid] === 'GK' ? 'gk' : 'fp'}">${esc(ctx.no[pid] ?? '')}</span>`;
// 過去所属（移籍・退団）の選手には小さな印を付ける（spec 13章「集計では『過去所属』と印を付ける」）
const lastN = (pid) => esc(playerById(pid)?.last || '');
const name = (pid) => lastN(pid) + (playerById(pid)?.status === 'former' ? '<span class="anpast">過去所属</span>' : '');

// 列の定義で表を作る：cols=[{k, h, v(d,pid)→数値, f(数値,d)→表示, tot(team)→表示, grp}]
function table(ctx, cols, { note = '' } = {}) {
  const { P, pids } = ctx;
  const sortCol = cols.find((c) => c.k === A.sort.col);
  let list = pids.slice();
  if (sortCol) list.sort((a, b) => ((sortCol.v(P[b], b) ?? -1) - (sortCol.v(P[a], a) ?? -1)) * (A.sort.dir === 'asc' ? -1 : 1));
  // GKはいつも一番下（FPを見ることを優先）
  list = [...list.filter((p) => ctx.pos[p] !== 'GK'), ...list.filter((p) => ctx.pos[p] === 'GK')];
  const groups = []; for (const c of cols) { const g = c.grp || ''; if (groups.length && groups[groups.length - 1].g === g) groups[groups.length - 1].n++; else groups.push({ g, n: 1 }); }
  const hasGrp = groups.some((g) => g.g);
  const th = cols.map((c) => `<th class="srt ${A.sort.col === c.k ? 'on' : ''} ${c.cls || ''}" data-sort="${c.k}">${c.h}<i>${A.sort.col === c.k ? (A.sort.dir === 'asc' ? '▲' : '▼') : A.print ? '' : '⇅'}</i></th>`).join('');
  const rows = list.map((pid) => {
    const d = P[pid]; const low = d.time < ref();
    return `<tr class="${d.time ? '' : 'zero'} ${low && d.time ? 'low' : ''}"><td class="apl"><span class="pnm">${badge(ctx, pid)}<span>${name(pid)}</span></span></td>${cols.map((c) => `<td class="${c.cls || ''} ${c.pm && low ? 'ref' : ''}">${c.f(c.v(d, pid), d)}</td>`).join('')}</tr>`;
  }).join('');
  const tot = `<tr class="tot"><td class="apl">チーム合計</td>${cols.map((c) => `<td class="${c.cls || ''}">${c.tot ? c.tot(ctx.team) : ''}</td>`).join('')}</tr>`;
  const nmw = Math.max(2, ...list.map((pid) => (playerById(pid)?.last || '').length + (playerById(pid)?.status === 'former' ? 3 : 0)));
  return `<div class="antbl"><table class="antb anauto" data-nmx="1.33" style="--nmw:${nmw}"><thead>${hasGrp ? `<tr class="grp"><th></th>${groups.map((g) => `<th colspan="${g.n}" class="${g.g ? 'g' : ''}">${g.g}</th>`).join('')}</tr>` : ''}<tr><th class="srt apl ${A.sort.col ? '' : 'on'}" data-sort="">選手<i>${A.print ? '' : A.sort.col ? '⇅' : '背番号順'}</i></th>${th}</tr></thead><tbody>${rows}</tbody><tfoot>${tot}</tfoot></table></div>
    <p class="anhint">${note}${note ? '　' : ''}薄い数字＝出場時間が${mmss(ref())}未満で参考値。${A.print ? 'GKは一番下。' : '見出しを押すと並べ替え（多い順 → 少ない順）、GKはいつも一番下。'}</p>`;
}

// ---------- 出場時間 ----------
function timeTab(ctx) {
  const { P, pids, ok, team } = ctx; const { avg } = cellFns(ctx);
  const multi = ok.length > 1;
  const periods = [...new Map(ok.flatMap((x) => x.M.periods.filter((p) => p.status !== 'none' && (!x.keys || x.keys.includes(p.key)))).map((p) => [p.key, p])).values()];
  const fp = pids.filter((p) => ctx.pos[p] !== 'GK');
  const val = (pid) => (avg && P[pid].games ? P[pid].time / P[pid].games : P[pid].time);
  const sortC = A.sort.col === 'total' || !A.sort.col ? 'total' : null;
  const fpS = fp.slice().sort((a, b) => val(b) - val(a));
  const max = Math.max(60000, ...fpS.map(val));
  const W = 1000, H = 190, L = 50, cw = (W - L - 10) / Math.max(1, fpS.length), bw = Math.min(42, cw * 0.62);
  const step = max > 600000 ? 300000 : max > 240000 ? 120000 : 60000;
  let sv = `<svg class="anbar" viewBox="0 0 ${W} ${H + 58}">`;
  for (let v = 0; v <= max; v += step) { const y = 18 + H - H * v / max; sv += `<line x1="${L}" x2="${W}" y1="${y}" y2="${y}" stroke="${v ? '#E1E6EF' : '#18233A'}"/><text x="${L - 6}" y="${y + 4}" font-size="11" text-anchor="end" fill="#8A94A6">${mmss(v)}</text>`; }
  fpS.forEach((pid, i) => {
    const x = L + 6 + i * cw + (cw - bw) / 2; let y = 18 + H;
    const parts = multi ? ok.map((o, j) => [MCOL[j % MCOL.length], (P[pid].byMatch?.[o.m.id] || 0) / (avg && P[pid].games ? P[pid].games : 1)])
      : periods.map((p) => [PCOL[p.key], P[pid].per?.[p.key]?.time || 0]);
    // 棒にカーソルを合わせる（iPadは触れる）と内訳：複数の試合は試合ごと（色つき）、1試合は前半・後半（2026-10-18）
    const tip = multi ? ok.map((o, j) => { const v = P[pid].byMatch?.[o.m.id] || 0; return v ? `<div><i style="background:${MCOL[j % MCOL.length]}"></i>${fmtShort(o.m.date)} vs ${esc(o.m.opponent)}　<b>${mmss(v)}</b></div>` : ''; }).join('') || '出場なし'
      : periods.map((p) => `${p.label} ${mmss(P[pid].per?.[p.key]?.time || 0)}`).join('・');
    sv += `<g class="rbar" data-bt="${esc(tip)}" data-html="${multi ? 1 : ''}"><rect x="${L + 6 + i * cw}" y="0" width="${cw}" height="${H + 58}" fill="transparent"/><g data-anchor="1">`;
    for (const [c, t] of parts) { if (!t) continue; const h = H * t / max; y -= h; sv += `<rect x="${x}" y="${y}" width="${bw}" height="${h}" fill="${c}"/>`; }
    sv += `<rect x="${x}" y="${y - 22}" width="${bw}" height="22" fill="transparent"/></g></g>`;
    sv += `<text x="${x + bw / 2}" y="${y - 5}" font-size="13" font-weight="800" fill="#0B2D6B" text-anchor="middle" stroke="#fff" stroke-width="4" paint-order="stroke">${mmss(val(pid))}</text>`;
    sv += `<text x="${x + bw / 2}" y="${18 + H + 17}" font-size="13" font-weight="800" fill="#1F5FBF" text-anchor="middle">${esc(ctx.no[pid] ?? '')}</text><text x="${x + bw / 2}" y="${18 + H + 33}" font-size="11.5" fill="#5F6B80" text-anchor="middle">${lastN(pid)}${playerById(pid)?.status === 'former' ? '（過去所属）' : ''}</text>`;
  });
  sv += '</svg>';
  const lg = multi ? ok.map((o, j) => `<span class="lg"><i style="background:${MCOL[j % MCOL.length]}"></i>${fmtShort(o.m.date)} vs ${esc(o.m.opponent)}</span>`).join('') : periods.map((p) => `<span class="lg"><i style="background:${PCOL[p.key]}"></i>${p.label}</span>`).join('');
  const t = (ms, d) => (avg && d.games ? mmss(ms / d.games) : mmss(ms));
  // 列：選手のすぐ右に 合計（時間・回数・出場率）と出場試合数。そのあとに、1試合なら前半・後半…、複数の試合なら試合ごと（2026-10-18）
  const cnt = (v, d) => (avg && d.games ? (v / d.games).toFixed(1) : v);
  const mlab = (o, j) => `<i class="mdot" style="background:${MCOL[j % MCOL.length]}"></i>${fmtShort(o.m.date)} vs ${esc(o.m.opponent)}`;
  const pct = (v, len) => Math.round(v / len * 100) + '%';
  const perLen = {}; for (const o of ok) for (const p of o.Mw.periods) if (p.status !== 'none' && (!o.keys || o.keys.includes(p.key))) perLen[p.key] = (perLen[p.key] || 0) + p.elapsed;
  const cols = [
    { k: 'total', grp: '合計', h: '時間', v: (d) => d.time, f: (v, d) => `<b>${t(v, d)}</b>`, tot: (tm) => `<b>${mmss(tm.len)}</b>`, cls: 'sum' },
    { k: 'count', grp: '合計', h: '回数', v: (d) => d.count, f: cnt, cls: 'sum' },
    { k: 'rate', grp: '合計', h: '出場率', v: (d) => d.time, f: (v) => (team.len ? pct(v, team.len) : '—'), cls: 'sum' },
    ...(multi || A.scope !== 'match' ? [{ k: 'games', cls: 'gs', h: '出場<br>試合数', v: (d) => d.games, f: (v) => v, tot: (tm) => tm.games }] : []),
    // 2026-10-19：試合ごと・ピリオドごとにも出場率（その試合・そのピリオドの試合時間に対して。パワープレーを除くときは除いた時間に対して）
    ...(multi ? ok.flatMap((o, j) => [{ k: 'mt' + o.m.id, grp: mlab(o, j), h: '時間', cls: 'gs', v: (d) => d.byMatch?.[o.m.id] || 0, f: (v) => (v ? mmss(v) : '<span class="z">—</span>'), tot: () => mmss(o.len) },
      { k: 'mn' + o.m.id, grp: mlab(o, j), h: '回数', v: (d) => d.byMatchN?.[o.m.id] || 0, f: (v, d) => (d.byMatch?.[o.m.id] ? v : '<span class="z">—</span>') },
      { k: 'mr' + o.m.id, grp: mlab(o, j), h: '出場率', v: (d) => d.byMatch?.[o.m.id] || 0, f: (v) => (v && o.len ? pct(v, o.len) : '<span class="z">—</span>') }])
      : periods.flatMap((p) => [{ k: 't' + p.key, grp: p.label, h: '時間', cls: 'gs', v: (d) => d.per?.[p.key]?.time || 0, f: (v, d) => t(v, d) },
        { k: 'n' + p.key, grp: p.label, h: '回数', v: (d) => d.per?.[p.key]?.count || 0, f: cnt },
        { k: 'r' + p.key, grp: p.label, h: '出場率', v: (d) => d.per?.[p.key]?.time || 0, f: (v) => (perLen[p.key] ? pct(v, perLen[p.key]) : '—') }])),
  ];
  const sum = pids.reduce((a, p) => a + P[p].time, 0);
  const expect = team.len * 5 - team.empty;
  const chk = `<span class="${Math.abs(sum - expect) < 1000 * ok.length * 5 ? 'anok' : 'anng'}">全員の合計 ${mmss(sum)} ＝ 試合時間 ${mmss(team.len)} × 5人${team.empty ? ` − 退場による空席 ${mmss(team.empty)}` : ''}${Math.abs(sum - expect) < 1000 * ok.length * 5 ? ' ✓' : `（${mmss(expect)} と合いません）`}</span>`;
  // 2026-10-19：チェックでパワープレー（5×4・4×5と退場の時間帯）を除く。上の「時間帯：数的同数だけ」と同じ切り替え
  const nopp = `<label class="annopp" title="5×4・4×5と、両チームの退場（3×4・4×3）の時間帯を除いて、グラフ・各試合・合計・出場率を出します"><input type="checkbox" id="anNoPP"${A.pp === 'ex' ? ' checked' : ''}>パワープレーの時間を除く</label>`;
  const pmv = A.tview === 'pm' && multi; // 選手×試合（2試合以上。2026-10-22 試合ごとタブから移す）
  const tv = `<div class="ansubs"><button class="${A.tview !== 'tl' && !pmv ? 'on' : ''}" data-tview="list">一覧</button>${multi ? `<button class="${pmv ? 'on' : ''}" data-tview="pm">選手×試合</button>` : ''}<button class="${A.tview === 'tl' ? 'on' : ''}" data-tview="tl">タイムライン</button>${A.tview === 'tl' || pmv ? '' : nopp + '<span class="sp"></span><button class="btn sm" id="anTimePdf" title="いま出ているグラフと表を、A4横の1ページのPDFにします">PDF（1ページ）</button>'}</div>`;
  if (A.tview === 'tl' && !A.print) return tv + tlView(ctx);
  if (pmv && !A.print) return tv + playerByMatch(ctx);
  return `${A.print ? '' : tv}<div class="antime"><div class="anchart"><div class="anlg">${lg}<span class="sp"></span>${chk}</div>${sv}</div>${table(ctx, cols, { note: `グラフはFPだけ（${avg ? '1試合平均、' : ''}${multi ? '試合ごとに積み上げ' + (A.print ? '' : '。棒に触れると試合ごとの時間') : 'ピリオドを積み上げ' + (A.print ? '' : '。棒に触れると前半・後半の時間')}）。出場率は${A.per === 'all' ? '' : periodLabel(A.per) + 'の'}試合時間${A.pp === 'ex' ? '（パワープレーの時間を除いた' + mmss(team.len) + '）' : '（' + mmss(team.len) + '）'}に対して。試合ごと・ピリオドごとの出場率は、その試合・そのピリオドの時間に対して${A.print ? '' : '。「タイムライン」は1試合を選んだときに見られます'}` })}</div>`;
}

// ---------- チームの数字（スタッツのシュート・Z4・SZ進入・FINISH SET PLAY、2026-10-19） ----------
const LCLS = ['定位置', 'セットプレー', 'トランジション', 'GK活用', '特殊局面'];
// 数える範囲（前半・後半、パワープレーを除く）のイベント
const evIn = (x) => x.evs.filter((e) => (!x.keys || x.keys.includes(e.period)) && (!x.win || x.win(e)));
// 時間帯の名前（選んだ試合で区切りが同じときだけ）
const bandLabels = (ctx) => { const L = ctx.ok[0]?.R.bands || []; return L.length && ctx.ok.every((x) => x.R.bands.join('|') === L.join('|')) ? L : null; };
// 自チーム vs 相手の比べる表。rows：[項目, 自チーム, 相手, { pct, sub }]。数字は合計か1試合平均（g）
function cmpTable(title, rows, g, { note = '' } = {}) {
  const max = Math.max(1, ...rows.filter((r) => !r[3]?.pct).flatMap((r) => [r[1] || 0, r[2] || 0]));
  const v = (x, r) => (x == null ? '<span class="z">—</span>' : r[3]?.pct ? x : g(x));
  const bar = (x, r, c) => `<td class="cbar ${c}">${x == null || r[3]?.pct ? '' : `<i style="width:${Math.round((x || 0) / max * 100)}%"></i>`}</td>`;
  return `<div class="ancmpw"><h4>${title}</h4><table class="ancmp"><thead><tr><th></th><th class="w">自チーム</th><th></th><th class="o">相手</th><th></th></tr></thead><tbody>${rows.map((r) => `<tr class="${r[3]?.cls || ''}">${bar(r[1], r, 'l')}<td class="cv w">${v(r[1], r)}</td><td class="cl">${r[0]}</td><td class="cv o">${v(r[2], r)}</td>${bar(r[2], r, 'r')}</tr>`).join('')}</tbody></table>${note ? `<p class="anhint">${note}</p>` : ''}</div>`;
}
// 時間帯ごと（自チーム・相手の2行）
function bandRows(title, labels, a, b, g) {
  if (!labels || !a || !b) return '';
  const sum = (x) => x.reduce((s, y) => s + y, 0);
  return `<div class="ancmpw"><h4>${title}</h4><table class="antb anband"><colgroup><col class="c1"></colgroup><thead><tr><th class="apl"></th>${labels.map((l) => `<th>${l.replace('~', '〜')}${/:/.test(l) ? '' : '分'}</th>`).join('')}<th>合計</th></tr></thead><tbody>
    <tr><td class="apl w">自チーム</td>${a.map((x) => `<td class="w">${g(x)}</td>`).join('')}<td class="w"><b>${g(sum(a))}</b></td></tr>
    <tr><td class="apl o">相手</td>${b.map((x) => `<td class="o">${g(x)}</td>`).join('')}<td class="o"><b>${g(sum(b))}</b></td></tr></tbody></table></div>`;
}
const pctS = (a, b) => (b ? Math.round(a / b * 100) + '%' : '—');
// シュート：チーム全体
function teamShot(ctx, g) {
  const a = ctx.team.A, b = ctx.team.B;
  const cls = { own: LCLS.map(() => [0, 0]), opp: LCLS.map(() => [0, 0]) };
  for (const x of ctx.ok) { const ev = evIn(x); for (const [k, own] of [['own', true], ['opp', false]]) for (const sh of shotsOf(ev, x.gn, own)) { const i = CLS_KEYS.indexOf(sh.cls); if (i >= 0) { cls[k][i][0]++; if (sh.goal) cls[k][i][1]++; } } }
  return `<div class="anteamv">${cmpTable('シュート', [['シュート', a.shots, b.shots], ['SZ内', a.sz, b.sz], ['SZ外・ゾーン内に人有', a.with, b.with], ['SZ外・ゾーン内に人無', a.without, b.without],
    ['枠内', a.in, b.in], ['枠外', a.out, b.out], ['ブロック', a.block, b.block], ['得点', a.goals, b.goals], ['決定率', pctS(a.goals, a.shots), pctS(b.goals, b.shots), { pct: true }]], g, { note: '得点はOGを除く。決定率＝得点÷シュート' })}
    ${cmpTable('局面ごとのシュート', LCLS.map((l, i) => [l, cls.own[i][0], cls.opp[i][0]]), g)}
    ${bandRows('時間帯ごとのシュート', bandLabels(ctx), a.shotBand, b.shotBand, g)}</div>`;
}
// Z4・SZ進入：チーム全体
function teamEnt(ctx, g) {
  const a = ctx.team.A, b = ctx.team.B;
  const how = { z4: { dribble: 0, pass: 0, rebound: 0, no: 0 }, sz: { dribble: 0, pass: 0, rebound: 0, no: 0 } };
  for (const x of ctx.ok) for (const e of evIn(x)) if (e.kind === 'z4' || e.kind === 'sz') how[e.kind][how[e.kind][e.method] != null && e.method !== 'no' ? e.method : 'no']++;
  const hm = [['ドリブル', 'dribble'], ['パス', 'pass'], ['リバウンド', 'rebound'], ['未入力', 'no']];
  const howT = `<div class="ancmpw"><h4>進入の方法（自チーム）</h4><table class="antb anband"><colgroup><col class="c1"></colgroup><thead><tr><th class="apl"></th>${hm.map(([l]) => `<th>${l}</th>`).join('')}<th>合計</th></tr></thead><tbody>
    ${[['Z4進入', 'z4'], ['SZ進入', 'sz']].map(([l, k]) => `<tr><td class="apl w">${l}</td>${hm.map(([, m]) => `<td>${g(how[k][m])}</td>`).join('')}<td><b>${g(hm.reduce((s, [, m]) => s + how[k][m], 0))}</b></td></tr>`).join('')}</tbody></table></div>`;
  return `<div class="anteamv">${cmpTable('Z4・SZ進入', [['Z4進入', a.z4, b.z4], ['SZ進入', a.szE, b.szE], ['合計', a.z4 + a.szE, b.z4 + b.szE, { cls: 'tot' }]], g)}
    ${howT}${cmpTable('局面ごとのZ4進入', LCLS.map((l, i) => [l, a.zcls?.[i] || 0, b.zcls?.[i] || 0]), g)}
    ${bandRows('時間帯ごとのZ4進入', bandLabels(ctx), a.z4Band, b.z4Band, g)}</div>`;
}
// FINISH SET PLAY：チームだけ（自チームのAT vs 相手のAT＝こちらのDF）
function teamFsp(ctx, g) {
  const L = ['CK', 'CK-KI', 'KI', 'FK', 'PK', '第2PK'];
  const T = { at: FSP_KEYS.map(() => 0), df: FSP_KEYS.map(() => 0) }, miss = { at: 0, df: 0 };
  const set = { own: [0, 0], opp: [0, 0] };
  const per = [];
  for (const x of ctx.ok) {
    const ev = evIn(x); const c = { at: 0, df: 0 };
    for (const e of ev) if (e.kind === 'fspat' || e.kind === 'fspdf') { const k = e.kind === 'fspat' ? 'at' : 'df'; const i = FSP_KEYS.indexOf(e.fsp); if (i >= 0) T[k][i]++; else miss[k]++; c[k]++; }
    for (const [k, own] of [['own', true], ['opp', false]]) for (const sh of shotsOf(ev, x.gn, own)) if (sh.cls === 'set') { set[k][0]++; if (sh.goal) set[k][1]++; }
    per.push([x, c]);
  }
  const sum = (k) => T[k].reduce((a, b) => a + b, 0) + miss[k];
  const rows = [...L.map((l, i) => [l, T.at[i], T.df[i]]), ...(miss.at || miss.df ? [['種類が未入力', miss.at, miss.df]] : []), ['合計', sum('at'), sum('df'), { cls: 'tot' }]];
  const res = cmpTable('セットプレーの局面のシュートと得点', [['シュート', set.own[0], set.opp[0]], ['得点', set.own[1], set.opp[1]], ['決定率', pctS(set.own[1], set.own[0]), pctS(set.opp[1], set.opp[0]), { pct: true }],
    ['1本あたりのシュート', sum('at') ? (set.own[0] / sum('at')).toFixed(2) : '—', sum('df') ? (set.opp[0] / sum('df')).toFixed(2) : '—', { pct: true }]], g, { note: '局面が「セットプレー」のシュート・得点（得点・失点の種類から分類したものを含む）' });
  const perT = per.length > 1 ? `<div class="ancmpw"><h4>試合ごと</h4><table class="antb anband"><colgroup><col style="width:60%"></colgroup><thead><tr><th class="apl">試合</th><th class="w">自チーム</th><th class="o">相手</th></tr></thead><tbody>${per.map(([x, c]) => `<tr><td class="apl">${fmtShort(x.m.date)} vs ${esc(x.m.opponent || '')}</td><td class="w">${c.at}</td><td class="o">${c.df}</td></tr>`).join('')}</tbody></table></div>` : '';
  return `<div class="anteamv">${cmpTable('FINISH SET PLAY の種類', rows, g, { note: '自チーム＝自チームのセットプレー（AT）、相手＝相手のセットプレー（こちらのDF）' })}${res}
    ${bandRows('時間帯ごとの FINISH SET PLAY', bandLabels(ctx), ctx.team.A.fspBand, ctx.team.B.fspBand, g)}${perT}</div>`;
}

// ---------- スタッツ ----------
const VS = '<i class="anvs">vs</i>';
function statsTab(ctx) {
  const { team, hasEv } = ctx; const { n, pm, avg } = cellFns(ctx);
  const subs = `<div class="ansubs">${SUBS.map(([v, l]) => `<button class="${A.sub === v ? 'on' : ''}" data-sub="${v}">${l}</button>`).join('')}</div>`;
  if (!hasEv) return `${subs}<div class="card empty">選んだ試合にはイベントが入力されていません。イベントを入力すると、ここに選手ごとのスタッツが出ます。</div>`;
  const g = (v) => (avg ? (v / Math.max(1, team.games)).toFixed(1) : v);
  const tA = team.A, tB = team.B;
  const bar = `<div class="anteam">${[
    // 自チームと相手は「vs」で並べる（リカバリー／ロストはどちらも自チームの数なので「/」のまま。2026-10-19）
    ['得点−失点', `${g(team.score.own)}${VS}${g(team.score.opp)}`], ['シュート', `${g(tA.shots)}<small>（SZ内 ${g(tA.sz)}）</small>${VS}${g(tB.shots)}`], ['Z4・SZ進入', `${g(tA.z4 + tA.szE)}${VS}${g(tB.z4 + tB.szE)}`],
    ['リカバリー／ロスト', `${g(team.rec)} / ${g(team.lost)}`], ['FINISH SET PLAY', `${g(tA.fsp)}${VS}${g(tB.fsp)}`], ['ファール', `${g(tA.foul)}${VS}${g(tB.foul)}`]].map(([l, v]) => `<span><em>${l}</em><b>${v}</b></span>`).join('')}<span class="mu">自チーム vs 相手${avg ? '（1試合平均）' : ''}</span></div>`;
  const N = (k, h, v, extra = {}) => ({ k, h, v, f: (x, d) => n(x, d.games), ...extra });
  const tm = (f) => (t) => g(f(t));
  const games = { k: 'games', cls: 'gs', h: '出場<br>試合数', v: (d) => d.games, f: (v) => v, tot: (t) => t.games };
  const time = { k: 'time', h: '出場時間', v: (d) => d.time, f: (v, d) => mmss(avg && d.games ? v / d.games : v), tot: (t) => mmss(avg ? t.len / Math.max(1, t.games) : t.len) };
  const base = A.scope === 'match' ? [time] : [games, time];
  let cols, note = '';
  const ent = (d) => d.on.z4 + d.on.sz, oent = (d) => d.on.oz4 + d.on.osz;
  switch (A.sub) {
    case 'sum': cols = [...base,
      N('shots', 'シュート<br><small>（SZ内）</small>', (d) => d.shots, { f: (x, d) => `${n(x, d.games)}<small>（${n(d.sz, d.games)}）</small>`, tot: (t) => `${g(t.A.shots)}<small>（${g(t.A.sz)}）</small>` }),
      N('son', 'シュート<br>関与', (d) => d.on.shot, { cls: 'w', tot: tm((t) => t.A.shots) }), N('oson', '被シュート<br>関与', (d) => d.on.oshot, { cls: 'o', tot: tm((t) => t.B.shots) }),
      N('goals', '得点', (d) => d.goals, { tot: (t) => g(t.score.own) }), N('assists', 'アシスト', (d) => d.assists), N('ez4', 'Z4進入', (d) => d.ent.z4.inv, { tot: tm((t) => t.A.z4) }), N('esz', 'SZ進入', (d) => d.ent.sz.inv, { tot: tm((t) => t.A.szE) }),
      N('rec', 'リカバリー', (d) => d.rec, { tot: tm((t) => t.rec) }), N('lost', 'ロスト', (d) => d.lost, { tot: tm((t) => t.lost) }),
      N('pmv', '得失点±', (d) => d.on.gf - d.on.ga, { f: (x, d) => { const v = avg && d.games ? (x / d.games).toFixed(1) : x; return `<b>${x > 0 ? '+' : ''}${v}</b>`; }, tot: (t) => `${t.score.own - t.score.opp > 0 ? '+' : ''}${g(t.score.own - t.score.opp)}` })];
      note = 'シュート・得点・Z4進入・SZ進入などは本人のプレー（進入はパスの出し手と受け手の両方に +1）。〇〇関与（本数）と得失点±は、その選手がピッチにいる間のチームの数。'; break;
    case 'shot': cols = [...base,
      N('shots', '合計', (d) => d.shots, { grp: '本人のシュート', tot: tm((t) => t.A.shots) }), N('sz', 'SZ内', (d) => d.sz, { grp: '本人のシュート', tot: tm((t) => t.A.sz) }),
      N('in', '枠内', (d) => d.in, { grp: '本人のシュート', tot: tm((t) => t.A.in) }), N('out', '枠外', (d) => d.out, { grp: '本人のシュート', tot: tm((t) => t.A.out) }), N('block', 'ブロック', (d) => d.block, { grp: '本人のシュート', tot: tm((t) => t.A.block) }),
      { k: 'rate', grp: '本人のシュート', h: '決定率', v: (d) => (d.shots ? d.goals / d.shots : -1), f: (x, d) => (d.shots ? Math.round(d.goals / d.shots * 100) + '%' : '—'), tot: (t) => (t.A.shots ? Math.round(t.A.goals / t.A.shots * 100) + '%' : '—') },
      N('os', 'シュート<br>関与', (d) => d.on.shot, { grp: '出場中', tot: tm((t) => t.A.shots) }),
      N('oo', '被シュート<br>関与', (d) => d.on.oshot, { grp: '出場中', tot: tm((t) => t.B.shots) }),
      N('od', '差', (d) => d.on.shot - d.on.oshot, { grp: '出場中', tot: tm((t) => t.A.shots - t.B.shots) })];
      note = 'シュートは得点を含む（OGは除く）。決定率＝得点÷シュート。'; break;
    case 'goal': cols = [...base, N('goals', '得点', (d) => d.goals, { grp: '本人', tot: tm((t) => t.score.own) }), N('assists', 'アシスト', (d) => d.assists, { grp: '本人' }),
      N('gf', '得点<br>関与', (d) => d.on.gf, { grp: '出場中', tot: tm((t) => t.score.own) }), N('ga', '失点<br>関与', (d) => d.on.ga, { grp: '出場中', tot: tm((t) => t.score.opp) }),
      N('pmv', '±', (d) => d.on.gf - d.on.ga, { grp: '出場中', f: (x, d) => `<b>${x > 0 ? '+' : ''}${n(x, d.games)}</b>`, tot: tm((t) => t.score.own - t.score.opp) })];
      note = '関与＝その選手がピッチにいる間の数。得点関与・失点関与は、相手OG・自チームOGを含む。'; break;
    case 'ent': {
      // 本人の数（直接）＝Z4進入・SZ進入、ピッチにいた間の数（間接）＝〇〇関与（2026-10-19）
      const E = (gk, gl, h) => [N(gk + 'dr', 'ドリブル', (d) => d.ent[gk].dr, { grp: gl }), N(gk + 'pf', 'パス<br>出し手', (d) => d.ent[gk].pf, { grp: gl }), N(gk + 'pt', 'パス<br>受け手', (d) => d.ent[gk].pt, { grp: gl }), N(gk + 'rb', 'リバウンド', (d) => d.ent[gk].rb, { grp: gl }), N(gk + 'iv', h, (d) => d.ent[gk].inv, { grp: gl, cls: 'sum', tot: tm((t) => (gk === 'z4' ? t.A.z4 : t.A.szE)) })];
      const O = (k, h, f, tf, c) => [N(k, h, f, { grp: '出場中（関与）', cls: c, tot: tm(tf) })]; // ／40分はやめた（2026-10-22）
      cols = [...base, ...E('z4', 'Z4進入（本人）', 'Z4進入'), ...E('sz', 'SZ進入（本人）', 'SZ進入'),
        ...O('oz', 'Z4進入<br>関与', (d) => d.on.z4, (t) => t.A.z4, 'w'), ...O('os', 'SZ進入<br>関与', (d) => d.on.sz, (t) => t.A.szE, 'w'),
        ...O('ooz', '被Z4進入<br>関与', (d) => d.on.oz4, (t) => t.B.z4, 'o'), ...O('oos', '被SZ進入<br>関与', (d) => d.on.osz, (t) => t.B.szE, 'o')];
      note = 'Z4進入・SZ進入（本人）＝その選手が進入に関わった回数（ドリブル・パスの出し手と受け手・リバウンド。パスは2人とも +1 なので、選手の合計はチーム合計（進入の本数）より多くなります）。〇〇関与＝その選手がピッチにいる間のチームの進入（被〇〇関与は相手の進入）。'; break;
    }
    case 'rl': cols = [...base, N('rec', 'リカバリー', (d) => d.rec, { grp: '本人', tot: tm((t) => t.rec) }), N('lost', 'ロスト', (d) => d.lost, { grp: '本人', tot: tm((t) => t.lost) }), N('rld', '差', (d) => d.rec - d.lost, { grp: '本人', tot: tm((t) => t.rec - t.lost) }),
      N('orec', 'リカバリー<br>関与', (d) => d.on.rec, { grp: '出場中', tot: tm((t) => t.rec) }),
      N('olost', 'ロスト<br>関与', (d) => d.on.lost, { grp: '出場中', tot: tm((t) => t.lost) }),
      N('orld', '差', (d) => d.on.rec - d.on.lost, { grp: '出場中', tot: tm((t) => t.rec - t.lost) }),
      ...ZONE_KEYS.map((z, i) => N('rz' + z, z, (d) => d.recZ[i], { grp: 'リカバリーの場所（本人）' })), ...ZONE_KEYS.map((z, i) => N('lz' + z, z, (d) => d.lostZ[i], { grp: 'ロストの場所（本人）' }))];
      note = '場所はゾーンが入力されたものだけ。'; break;
    case 'foul': cols = [...base, N('foul', 'ファール', (d) => d.foul, { grp: '本人', tot: tm((t) => t.A.foul) }), N('fouled', '受けた<br>ファール', (d) => d.fouled, { grp: '本人', tot: tm((t) => t.B.foul) }),
      N('of', 'ファール<br>関与', (d) => d.on.foul, { grp: '出場中', tot: tm((t) => t.A.foul) }), N('oof', '被ファール<br>関与', (d) => d.on.ofoul, { grp: '出場中', tot: tm((t) => t.B.foul) }), N('ofd', '差', (d) => d.on.foul - d.on.ofoul, { grp: '出場中', tot: tm((t) => t.A.foul - t.B.foul) }),
      N('cy', 'イエロー', (d) => d.cY, { grp: 'カード（本人）', tot: tm((t) => t.A.cards.yellow) }), N('cr', 'レッド', (d) => d.cR, { grp: 'カード（本人）', tot: tm((t) => t.A.cards.red) })];
      note = `関与＝その選手がピッチにいる間の数。被ファール＝相手のファール。相手へのカード：イエロー ${g(tB.cards.yellow)}・レッド ${g(tB.cards.red)}（2枚目のイエローはイエローとレッドの両方に数える）。`; break;
    case 'fsp': return `${A.print ? '' : subs}<div class="antime">${bar}<h3 class="anh3">チーム（自チーム vs 相手${avg ? '・1試合平均' : ''}）</h3>${teamFsp(ctx, g)}</div>`;
    default: cols = base;
  }
  // シュート・Z4・SZ進入は、まずチーム全体、その下に選手ごと（2026-10-19）
  const tv = A.sub === 'shot' ? teamShot(ctx, g) : A.sub === 'ent' ? teamEnt(ctx, g) : '';
  if (tv) return `${A.print ? '' : subs}<div class="antime">${bar}<h3 class="anh3">チーム（自チーム vs 相手${avg ? '・1試合平均' : ''}）</h3>${tv}<h3 class="anh3">選手ごと</h3>${table(ctx, cols, { note })}</div>`;
  return `${A.print ? '' : subs}${bar}${table(ctx, cols, { note })}`;
}

// ---------- 操作 ----------
function bindAnalysis(root) {
  const bar = document.querySelector('.bar'); if (bar) document.documentElement.style.setProperty('--barh', bar.offsetHeight + 'px');
  { const pt = document.querySelector('body > .ptip'); if (pt) pt.style.display = 'none'; }
  // 表の行を押すと強調（2026-10-19）
  bindRowHl(root, '.anbody table.antb', anHl, `${A.tab}:${A.tab === 'stats' ? A.sub : ''}`);
  sizeAn(root);
  { const ch = root.querySelector('.anchart'); const sv = ch?.querySelector('svg.anbar'); if (sv) bandTip(ch, sv, '.rbar', (g) => (g.dataset.html ? { html: g.dataset.bt } : g.dataset.bt)); }
  // 拡大表示：表やグラフを、上の切り替えの下に残った画面いっぱいの大きさに（2026-10-18）
  bindBig(root, (r) => { const b = r.querySelector('.anbody'); const hd = r.querySelector('.anhead'); if (!b) return; fitBox(b, r.querySelector('.anw').clientWidth, window.innerHeight - (hd?.offsetHeight || 0) - 20, { maxZ: 1.6 }); });
  // 表が横に入りきらないとき、右端をぼかして「まだ右にある」と分かるようにする（右端まで動かしたら消す）
  declutterTimeline(root);
  root.querySelectorAll('.antbl').forEach((el) => {
    const upd = () => el.classList.toggle('more', el.scrollLeft + el.clientWidth < el.scrollWidth - 2);
    upd(); el.addEventListener('scroll', upd, { passive: true });
  });
  root.querySelectorAll('[data-set]').forEach((b) => b.onclick = () => { A[b.dataset.set] = b.dataset.v; if (b.dataset.set === 'scope' && b.dataset.v === 'pick' && !A.picked) A.picked = filtered().map((m) => m.id); keep(); render(); });
  root.querySelectorAll('[data-tab]').forEach((b) => b.onclick = () => { A.tab = b.dataset.tab; A.sort = { col: '', dir: 'desc' }; keep(); render(); });
  root.querySelectorAll('[data-sub]').forEach((b) => b.onclick = () => { A.sub = b.dataset.sub; A.sort = { col: '', dir: 'desc' }; keep(); render(); });
  root.querySelectorAll('[data-sort]').forEach((th) => th.onclick = () => {
    const c = th.dataset.sort;
    A.sort = !c ? { col: '', dir: 'desc' } : A.sort.col !== c ? { col: c, dir: 'desc' } : A.sort.dir === 'desc' ? { col: c, dir: 'asc' } : { col: '', dir: 'desc' };
    render();
  });
  const sel = root.querySelector('#anMatch'); if (sel) sel.onchange = () => { A.matchId = sel.value; keep(); render(); };
  const pk = root.querySelector('#anPick'); if (pk) pk.onclick = pickModal;
  const ds = root.querySelector('#anExpDs'); if (ds) ds.onclick = () => { const ms = selected(); if (ms.length) downloadDatasheet(ms); };
  const rp = root.querySelector('#anExpRep'); if (rp) rp.onclick = () => { const ms = selected(); if (ms.length) printReport(ms, A.scope === 'match' ? 'sum' : A.agg); };
  const ex = root.querySelector('#anExpStats'); if (ex) ex.onclick = () => { const ms = selected(); if (ms.length) printStats(ms); };
  const rv = root.querySelector('#anExpRv'); if (rv) rv.onclick = () => { const ms = selected(); if (ms.length) printReviews(ms); };
  const tp = root.querySelector('#anTimePdf'); if (tp) tp.onclick = () => { const ms = selected(); if (ms.length) printTime(ms); };
  const np = root.querySelector('#anNoPP'); if (np) np.onchange = () => { A.pp = np.checked ? 'ex' : 'all'; keep(); render(); };
  root.querySelectorAll('[data-aset]').forEach((b) => b.onclick = () => { A[b.dataset.aset] = b.dataset.v; A.sort = { col: '', dir: 'desc' }; keep(); render(); });
  root.querySelectorAll('[data-tview]').forEach((b) => b.onclick = () => { A.tview = b.dataset.tview; keep(); render(); });
  root.querySelectorAll('[data-bin-set]').forEach((b) => b.onclick = () => { A.bin = +b.dataset.binSet; keep(); render(); });
  root.querySelectorAll('[data-prow-set]').forEach((b) => b.onclick = () => { const k = b.dataset.prowSet; const r = new Set(A.rows); r.has(k) ? r.delete(k) : r.add(k); A.rows = Object.keys(PACE_ROWS).filter((x) => r.has(x)); keep(); render(); });
  root.querySelectorAll('[data-tl]').forEach((r) => r.onclick = () => r.classList.toggle('hl'));
  // マッチ・ペース：棒（区切り）をタップ → その時間帯にピッチにいた選手を強調。選手名をタップ → その選手が出ていた区切りを強調
  const svg = root.querySelector('svg.pace');
  if (svg) svg.addEventListener('click', (e) => {
    const bin = e.target.closest('.pbin'), nmEl = e.target.closest('[data-pname]');
    const info = root.querySelector('#paceInfo');
    svg.querySelectorAll('.on').forEach((x) => x.classList.remove('on'));
    if (bin) { const on = new Set(bin.dataset.on.split(',')); bin.classList.add('on'); svg.querySelectorAll('[data-prow]').forEach((g) => g.classList.toggle('on', on.has(g.dataset.prow))); if (info) info.textContent = `${bin.dataset.bin} にピッチにいた選手を黄色にしています（もう一度押すと戻ります）`; if (paceSel === bin.dataset.bin) { svg.querySelectorAll('.on').forEach((x) => x.classList.remove('on')); paceSel = null; if (info) info.textContent = ''; } else paceSel = bin.dataset.bin; }
    else if (nmEl) { const pid = nmEl.dataset.pname; if (paceSel === pid) { paceSel = null; if (info) info.textContent = ''; return; } paceSel = pid; svg.querySelector(`[data-prow="${pid}"]`)?.classList.add('on'); svg.querySelectorAll('.pbin').forEach((b) => b.classList.toggle('on', b.dataset.on.split(',').includes(pid))); if (info) info.textContent = `${playerById(pid)?.last || ''} がピッチにいた区切りを黄色にしています（もう一度押すと戻ります）`; }
  });
}
function pickModal() {
  // 2026-10-22：条件で絞り込むだけ（全試合）か、チェックで選ぶ（選んだ試合）。チェックは条件を変えても残り、足し合わせられる
  const f = A.f; const acts = S.activities.filter((a) => !a.deleted).sort((a, b) => (b.start || '').localeCompare(a.start || ''));
  const o = (list, v) => `<option value="">すべて</option>${list.map(([k, l]) => `<option value="${esc(k)}" ${k === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}`;
  // 2つの選び方：
  //  ・条件だけ（チェックを触っていない）→ 条件に合う試合すべて＝「全試合」（絞り込み）
  //  ・チェックで選ぶ → チェックした試合＝「選んだ試合」。条件は探すためだけで、条件を変えても、前にチェックした試合は残る
  let manual = A.scope === 'pick';
  const chk = new Set(manual ? (A.picked || []) : []);
  const nat = isNational();
  const isOn = (id) => (manual ? chk.has(id) : true);
  const toManual = () => { if (!manual) { manual = true; filtered().forEach((m) => chk.add(m.id)); } };
  const draw = (md) => {
    const list = filtered();
    md.querySelector('#pkList').innerHTML = list.map((m) => `<label class="pkrow"><input type="checkbox" data-pk="${m.id}" ${isOn(m.id) ? 'checked' : ''}><span class="d">${fmtShort(m.date)}</span><span class="nm"><b>vs ${flag(m.opponent)}${esc(m.opponent)}</b><small>${esc(activityById(m.activityId)?.name || '')}${m.category ? '・' + esc(m.category) : ''}</small></span><em>${esc(matchStatus(m))}</em></label>`).join('') || '<p class="mu">条件に合う試合はありません</p>';
    const c = md.querySelector('#pkCnt');
    if (c) c.innerHTML = manual ? `チェックした試合 <b>${candidates().filter((m) => chk.has(m.id)).length}</b>試合（この一覧の外も含む）` : `条件に合う <b>${list.length}</b>試合すべて`;
    const sel = md.querySelector('#pkSel');
    if (sel) sel.innerHTML = manual && chk.size ? candidates().filter((m) => chk.has(m.id)).map((m) => `<span class="pkchip">${fmtShort(m.date)} vs ${esc(m.opponent)}<button data-unpk="${m.id}" title="外す">×</button></span>`).join('') : '';
  };
  const md = openModal(`<h2>試合を絞り込む・選ぶ</h2>
    <div class="pkf"><label>活動<select data-f="act">${o(acts.map((a) => [a.id, `${a.name}（${fmtShort(a.start)}）`]), f.act)}</select></label>
      <label>活動の種類<select data-f="type">${o(opts('activityTypes', true).map((x) => [x.name, x.name]), f.type)}</select></label>
      <label>試合の区分<select data-f="cat">${o(opts('matchCategories', true).map((x) => [x.name, x.name]), f.cat)}</select></label>
      <label>期間<span class="pkd"><input type="date" data-f="from" value="${f.from}">〜<input type="date" data-f="to" value="${f.to}"></span></label>
      <label>相手チーム名<select data-f="opp">${o(opponents().map(([n, k]) => [n, `${n}（${k}試合）`]), f.opp)}</select></label>
      ${nat ? `<label>相手の地域<span class="pkd"><select data-f="rg">${o(REGIONS.map((r) => [r, r]), f.rg)}</select><button class="btn sm" id="pkRg" type="button">地域を直す</button></span></label>` : ''}</div>
    <p class="mu pkhow">条件で絞り込むだけなら、そのまま「これで見る」。決まった試合だけ見たいときはチェックを付けてください（条件を変えながら、何試合でも足せます）。</p>
    <div class="row pkbar"><button class="btn sm" id="pkAll">この一覧をすべて選ぶ</button><button class="btn sm" id="pkNone">この一覧をすべて外す</button><span class="mu" id="pkCnt"></span></div>
    <div id="pkSel" class="pksel"></div>
    <div id="pkList" class="pklist"></div><div class="row end"><button class="btn" id="pkX">やめる</button><button class="btn pri" id="pkOk">これで見る</button></div>`, { wide: true });
  draw(md);
  md.addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.f) { A.f[t.dataset.f] = t.value; draw(md); }
    if (t.dataset.pk) { toManual(); t.checked ? chk.add(t.dataset.pk) : chk.delete(t.dataset.pk); draw(md); }
  });
  md.addEventListener('click', (e) => { const u = e.target.closest('[data-unpk]'); if (u) { e.preventDefault(); chk.delete(u.dataset.unpk); draw(md); } });
  md.querySelector('#pkAll').onclick = () => { toManual(); filtered().forEach((m) => chk.add(m.id)); draw(md); };
  md.querySelector('#pkNone').onclick = () => { toManual(); filtered().forEach((m) => chk.delete(m.id)); draw(md); };
  const rg = md.querySelector('#pkRg'); if (rg) rg.onclick = () => { keep(); regionModal(pickModal); };
  md.querySelector('#pkX').onclick = closeModal;
  md.querySelector('#pkOk').onclick = () => {
    if (!manual) { if (!filtered().length) return toast('条件に合う試合がありません'); A.scope = 'all'; }
    else { const sel = candidates().filter((m) => chk.has(m.id)).map((m) => m.id); if (!sel.length) return toast('試合を1つ以上選んでください'); A.scope = 'pick'; A.picked = sel; }
    keep(); closeModal(); render();
  };
}

// ---------- 1試合だけの表示の共通 ----------
const onlyOne = (ctx, what) => (ctx.ok.length === 1 ? null : `<div class="card empty"><b>${what}は1試合を選んだときだけ表示します</b><p>上で「この試合」を選んでください。</p></div>`);
const memOf = (x) => (pid) => x.m.members?.[pid] || {};
function oneCtx(x) {
  const mem = memOf(x); const last = (pid) => playerById(pid)?.last || '';
  const badgeF = (pid) => `<span class="no ${mem(pid).pos === 'GK' ? 'gk' : 'fp'}">${esc(mem(pid).no ?? '')}</span>`;
  const gkLast = (list) => [...list.filter((p) => mem(p).pos !== 'GK'), ...list.filter((p) => mem(p).pos === 'GK')];
  const R = teamStats(x.M, x.evs, x.gn);
  return { M0: x.M, order: entryOrder(x.M), byNo: Object.keys(x.m.members || {}), mem, last, badge: badgeF, gkLast, evs: x.evs, goalName: x.gn, R, T0: playerTable(x.M), own: S.team?.name || '自チーム', opp: x.m.opponent || '相手', pk: x.m.pk || null };
}

// ---------- 出場時間：タイムライン ----------
function tlView(ctx) {
  const no1 = onlyOne(ctx, 'タイムライン'); if (no1) return no1;
  const x = ctx.ok[0]; const c = oneCtx(x);
  const marks = x.hasEv ? goalMarks(c.R, c) : [];
  const { tlHead, tlRows } = timelineHTML({ M: x.M, order: c.order, mem: c.mem, last: c.last, badge: c.badge, gkLast: c.gkLast, T: c.T0, marks, runMode: false, compact: false, hl: null, showExtra: !!x.m.times?.extra });
  return `<div class="antbl antl"><div class="rvtl">${tlHead}${tlRows}</div></div><p class="anhint">並び＝先発のFP（背番号順）、そのあとは初めてピッチに入った順、GKは一番下。帯の中の数字＝その出場の時間、右端＝合計。緑＝得点・赤＝失点。行を押すと黄色く強調。パワープレーと前半／後半の切り替えに関係なく、試合全体を出します</p>`;
}

// ---------- セット ----------
function setTab(ctx) {
  const rows = new Map();
  const blank = () => ({ time: 0, count: 0, sh: 0, osh: 0, gf: 0, ga: 0, en: 0, oen: 0, exp: 0, games: new Set() });
  // 下の行：5×4・4×5と退場の時間帯／GKがそろっていない区間／3秒未満の組み合わせ（時間も出して、全部足すと試合全体になる）
  const ppRow = blank(), special = blank(), other = blank(), total = blank();
  for (const x of ctx.ok) {
    // セットの時間と回数は、数的同数の時間帯だけで数える（5×4・4×5と、両チームの退場の時間帯を除く。2026-10-16・17 決定）
    // 1試合ぶん（セットの時間と、イベントごとの行）は試合の計算と一緒に取っておく
    const { sp, items } = x.lazy.set || (x.lazy.set = (() => {
      const sp = setSplit(x.M, x.W, x.keys); const items = [];
      const ev = x.evs.filter((e) => !x.keys || x.keys.includes(e.period));
      const own = new Set(shotsOf(ev, x.gn, true).map((s) => s.e)), opp = new Set(shotsOf(ev, x.gn, false).map((s) => s.e));
      for (const e of ev) {
        const f = own.has(e) ? 'sh' : opp.has(e) ? 'osh' : (e.kind === 'z4' || e.kind === 'sz') ? 'en' : (e.kind === 'oz4' || e.kind === 'osz') ? 'oen' : null;
        const g = e.kind === 'goal' ? 'gf' : e.kind === 'conc' ? 'ga' : null;
        if (!f && !g) continue;
        items.push([f, g, sp.classify(e)]);
      }
      return { sp, items };
    })());
    ppRow.time += sp.time.ex; special.time += sp.time.special; other.time += sp.time.other; total.time += sp.time.played;
    for (const st of sp.sets) { const r = rows.get(st.key) || rows.set(st.key, { ...blank(), pids: st.pids }).get(st.key); r.time += st.time; r.count += st.count; r.games.add(x.m.id); }
    for (const [f, g, c] of items) {
      const r = c === 'ex' ? ppRow : c === 'special' ? special : c === 'other' ? other : rows.get(c);
      for (const q of [r, total]) { if (f) q[f]++; if (g) q[g]++; }
    }
  }
  // 出場時間が短いセット（設定画面の基準、初めは1分未満）は表に出さず、下の行にまとめる
  const setMin = (teamSettings().setMin ?? 60) * 1000;
  let short = null, shortN = 0;
  for (const [k, r] of [...rows.entries()]) if (r.time < setMin) { short = short || blank(); shortN++; for (const f of ['time', 'count', 'sh', 'osh', 'gf', 'ga', 'en', 'oen', 'exp']) short[f] += r[f]; rows.delete(k); }
  const list = [...rows.values()].sort((a, b) => b.time - a.time);
  const sgn = (v) => (v > 0 ? '+' + v : String(v));
  const sorters = { time: (r) => r.time, sh: (r) => r.sh, osh: (r) => r.osh, gf: (r) => r.gf, ga: (r) => r.ga, en: (r) => r.en, oen: (r) => r.oen, dsh: (r) => (r.time ? (r.sh - r.osh) / r.time : -1e9), den: (r) => (r.time ? (r.en - r.oen) / r.time : -1e9), pm: (r) => r.gf - r.ga };
  if (A.sort.col && sorters[A.sort.col]) list.sort((a, b) => (sorters[A.sort.col](b) - sorters[A.sort.col](a)) * (A.sort.dir === 'asc' ? -1 : 1));
  const nm = (pid) => { const no = ctx.no[pid]; return `<span class="sp"><span class="no fp">${esc(no ?? '')}</span><small>${name(pid)}</small></span>`; };
  const fpSort = (pids) => pids.slice().sort((a, b) => (parseInt(ctx.no[a], 10) || 999) - (parseInt(ctx.no[b], 10) || 999));
  const ref = (teamSettings().refMin || 120) * 1000;
  const row = (r, i, label, cls = 'ex') => `<tr class="${label ? cls : ''} ${!label && r.time < ref ? 'low' : ''}"><td>${label ? '' : (i + 1) + '位'}</td><td class="setn">${label || `<span class="spw">${fpSort(r.pids).map(nm).join('')}</span>`}</td>
    <td>${mmss(r.time)}</td><td>${label && !r.count ? '—' : r.count}</td>${ctx.ok.length > 1 ? `<td>${label ? '—' : r.games.size}</td>` : ''}
    <td class="w">${r.sh}</td><td class="o">${r.osh}</td><td class="w">${r.gf}</td><td class="o">${r.ga}</td><td><b>${sgn(r.gf - r.ga)}</b></td><td class="w">${r.en}</td><td class="o">${r.oen}</td></tr>`;
  // 並べ替えられる見出しには ⇅（並べ替え中は ▼ 多い順・▲ 少ない順）。2026-10-22
  const th = (k, h, cls = '') => `<th class="srt ${A.sort.col === k ? 'on' : ''} ${cls}" data-sort="${k}">${h}<i>${A.sort.col === k ? (A.sort.dir === 'asc' ? '▲' : '▼') : A.print ? '' : '⇅'}</i></th>`;
  const head = `<tr><th>順位</th><th>FP4人のセット</th>${th('time', '出場時間')}<th>回数</th>${ctx.ok.length > 1 ? '<th>試合数</th>' : ''}${th('sh', 'シュート', 'w')}${th('osh', '被シュート', 'o')}${th('gf', '得点', 'w')}${th('ga', '失点', 'o')}${th('pm', '±')}${th('en', 'Z4・SZ<br>進入', 'w')}${th('oen', '被Z4・SZ<br>進入', 'o')}</tr>`;
  const has = (r) => r.time > 0 || r.sh || r.osh || r.gf || r.ga || r.en || r.oen;
  // 組が多いとき（シーズン全体など）：画面は上から50組と「もっと見る」、複数試合のマッチレポートは上から30組と
  // 「そのほかのセット」の行（時間・数を足すので、合計は変わらない）。2026-10-17 決11・12
  const sig = `${ctx.ok.map((x) => x.m.id).join(',')}|${A.per}|${A.pp}`;
  const cap = A.print ? (ctx.ok.length > 1 ? 30 : Infinity) : A.setMore === sig ? Infinity : 50;
  const shown = list.slice(0, cap), rest = list.slice(cap);
  let restRow = null;
  if (A.print && rest.length) { restRow = blank(); for (const r of rest) for (const f of ['time', 'count', 'sh', 'osh', 'gf', 'ga', 'en', 'oen', 'exp']) restRow[f] += r[f]; }
  const more = !A.print && rest.length ? `<tr class="anmore"><td colspan="${ctx.ok.length > 1 ? 12 : 11}"><button class="btn sm" data-set="setMore" data-v="${esc(sig)}">もっと見る（残り ${rest.length}組）</button></td></tr>` : '';
  const body = shown.map((r, i) => row(r, i)).join('') + more + (restRow ? row(restRow, 0, `そのほかのセット（${rest.length}組）`) : '') + (short ? row(short, 0, `出場時間が${mmss(setMin)}未満のセット（${shortN}組）`) : '') + (has(ppRow) ? row(ppRow, 0, '5×4・4×5と退場の時間帯') : '') + (has(special) ? row(special, 0, 'GK1人・FP4人がそろっていない区間') : '') + (has(other) ? row(other, 0, '交代の瞬間の3秒未満の組み合わせ') : '')
    + (list.length || short ? row(total, 0, '合計', 'tot') : '');
  return `<div class="antbl"><table class="antb anset anauto" style="--nmw:${Math.max(2, ...list.flatMap((r) => r.pids.map((p) => (playerById(p)?.last || '').length + (playerById(p)?.status === 'former' ? 3 : 0))))}"><thead>${head}</thead><tbody>${body || '<tr><td colspan="12" class="mu">GKが1人・FPが4人そろった時間がありません</td></tr>'}</tbody></table></div>
    <p class="anhint">${restRow ? `出場時間の長い30組を出し、ほかの${rest.length}組は「そのほかのセット」の行にまとめています。` : ''}FP4人の組み合わせごと（出場時間の長い順。見出しで並べ替え）。シュートは得点を含む（OGは除く）。進入＝Z4進入とSZ進入の合計。セットは数的同数の時間帯だけで数えます。出場時間が${mmss(setMin)}未満のセット（設定画面で変えられます）、パワープレー（5×4・4×5）と両チームの退場の時間帯、GK1人・FP4人がそろっていない区間、交代の瞬間の3秒未満の組み合わせは表に出さず、下の行にまとめます（全部足すと合計の行になります）。薄い数字＝出場時間が${mmss(ref)}未満で参考値</p>`;
}

// ---------- パワープレー ----------
// 時間帯は重ならないように分ける（退場を先に、次に自チームの5×4、相手の5×4）。数的同数＋5×4＋4×5＋退場（3×4）＋退場（4×3）＝合計
const PPK = [['own', '自チームの5×4', '（攻撃・GKを入れ替え）', '5×4'], ['opp', '相手の5×4', '（こちらは4×5・守備）', '4×5'], ['ejown', '自チームの退場', '（3×4）', '退場<br><small>3×4</small>'], ['ejopp', '相手の退場', '（4×3）', '退場<br><small>4×3</small>']];
function ppTab(ctx) {
  const occ = []; const split = {};
  for (const x of ctx.ok) {
    // 1試合ぶん（時間帯ごとの一覧と数字）は試合の計算と一緒に取っておく
    const one = x.lazy.pp || (x.lazy.pp = (() => {
      const inK = (k) => !x.keys || x.keys.includes(k);
      const occ1 = [], split1 = {};
      for (const [team] of PPK) for (const [k, iv] of Object.entries(windowsOf(x.M, x.W, team))) {
        if (!inK(k)) continue;
        const pl = x.M.periods.find((p) => p.key === k);
        for (const [a, b] of iv) {
          const test = winTest({ [k]: [[a, b]] }, x.M); const ev = x.evs.filter((e) => e.period === k && test(e));
          occ1.push({ team, label: pl?.label || k, a, b, sh: shotsOf(ev, x.gn, true).length, osh: shotsOf(ev, x.gn, false).length, gf: ev.filter((e) => e.kind === 'goal').length, ga: ev.filter((e) => e.kind === 'conc').length });
        }
      }
      for (const mode of ['ex', ...PPK.map(([k]) => k), 'all']) {
        const wins = windowsOf(x.M, x.W, mode);
        const R = teamStats(x.M, x.evs, x.gn, x.keys, winTest(wins, x.M));
        const Mk = clipModel(x.M, wins);
        const len = Mk.periods.filter((p) => p.status !== 'none' && (!x.keys || x.keys.includes(p.key))).reduce((t, p) => t + p.elapsed, 0);
        split1[mode] = { len, gf: R.rangeScore.own, ga: R.rangeScore.opp, A: R.A, B: R.B, rec: R.rec, lost: R.lost };
      }
      return { occ: occ1, split: split1 };
    })());
    for (const o of one.occ) occ.push({ m: x.m, ...o });
    for (const [mode, v] of Object.entries(one.split)) split[mode] = addInto(split[mode] || {}, v);
  }
  const sum = (team) => { const l = occ.filter((o) => o.team === team); return { n: l.length, t: l.reduce((s, o) => s + o.b - o.a, 0), sh: l.reduce((s, o) => s + o.sh, 0), osh: l.reduce((s, o) => s + o.osh, 0), gf: l.reduce((s, o) => s + o.gf, 0), ga: l.reduce((s, o) => s + o.ga, 0) }; };
  const noOpp = ctx.ok.filter((x) => !x.hasOpp).length;
  const topRow = ([team, label, sub]) => {
    const o = sum(team);
    const n = team === 'opp' && noOpp === ctx.ok.length ? '<span class="z">記録なし</span>' : o.n;
    return `<tr><td class="apl"><b>${label}</b>${sub}</td><td>${n}</td><td>${mmss(o.t)}</td><td class="w">${o.sh}</td><td class="o">${o.osh}</td><td class="w">${o.gf}${team === 'opp' && o.gf ? '<small>（PP返し）</small>' : ''}</td><td class="o">${o.ga}${team === 'own' && o.ga ? '<small>（PP返し）</small>' : ''}</td></tr>`;
  };
  const top = `<table class="antb anpp1"><thead><tr><th></th><th>回数</th><th>時間</th><th>シュート</th><th>被シュート</th><th>得点</th><th>失点</th></tr></thead><tbody>${PPK.map(topRow).join('')}</tbody></table>`;
  const S2 = split;
  const metrics = [['時間', (o) => mmss(o.len)], ['得点', (o) => o.gf], ['失点', (o) => o.ga], ['シュート', (o) => o.A.shots], ['被シュート', (o) => o.B.shots], ['枠内', (o) => o.A.in], ['被枠内', (o) => o.B.in],
    ['Z4・SZ進入', (o) => o.A.z4 + o.A.szE], ['被Z4・SZ進入', (o) => o.B.z4 + o.B.szE], ['FINISH SET PLAY AT', (o) => o.A.fsp], ['FINISH SET PLAY DF', (o) => o.B.fsp], ['リカバリー', (o) => o.rec], ['ロスト', (o) => o.lost], ['ファール', (o) => o.A.foul], ['被ファール', (o) => o.B.foul]];
  const cols = [['ex', '数的同数'], ...PPK.map(([k, , , h]) => [k, h]), ['all', '合計']];
  const mid = `<table class="antb anpp2"><thead><tr><th class="apl">チームの数字</th>${cols.map(([k, h]) => `<th class="${k === 'all' ? 'antot' : ''}">${h}</th>`).join('')}</tr></thead><tbody>${metrics.map(([l, f]) => `<tr><td class="apl">${l}</td>${cols.map(([k]) => `<td class="${k === 'all' ? 'antot' : ''}">${S2[k] ? f(S2[k]) : '—'}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  const who = Object.fromEntries(PPK.map(([k, l, sub]) => [k, l + sub]));
  const list = occ.sort((a, b) => (a.m.date || '').localeCompare(b.m.date || '') || a.label.localeCompare(b.label) || a.a - b.a).map((o) => `<tr><td>${fmtShort(o.m.date)} vs ${esc(o.m.opponent)}</td><td>${o.label} ${mmss(o.a)}〜${mmss(o.b)}</td><td>${mmss(o.b - o.a)}</td><td class="${o.team === 'own' || o.team === 'ejopp' ? 'w' : 'o'}">${who[o.team]}</td><td class="w">${o.sh}</td><td class="o">${o.osh}</td><td class="w">${o.gf}</td><td class="o">${o.ga}</td></tr>`).join('');
  const bottom = `<table class="antb"><thead><tr><th>試合</th><th>時間帯（経過時間）</th><th>長さ</th><th>どちら</th><th>シュート</th><th>被シュート</th><th>得点</th><th>失点</th></tr></thead><tbody>${list || '<tr><td colspan="8" class="mu">パワープレー・退場の時間帯はありません</td></tr>'}</tbody></table>`;
  return `<div class="antbl anscroll"><h3 class="anh3">回数と時間</h3>${top}<h3 class="anh3">数的同数・5×4・4×5・退場の時間帯で分けたチームの数字</h3>${mid}<h3 class="anh3">1回ごとの一覧</h3>${bottom}</div>
    <p class="anhint">自チームの5×4＝パワープレー（自チーム）の記録と、GKをFPと入れ替えてGKがピッチにいない区間（退場でGKがいない区間は入れない）。相手の5×4＝MATCH PLAY・記録の修正で入れたパワープレー（相手）${noOpp ? `。相手の5×4の記録がない試合：${noOpp}試合` : ''}。自チームの退場（3×4）＝MATCH PLAYの退場で空席の区間、相手の退場（4×3）＝相手の退場の記録。時間帯が重なるときは、退場 → 自チームの5×4 → 相手の5×4 の順に1つだけに数えます（数的同数＋5×4＋4×5＋退場＝合計）。「PP返し」＝5×4の間に相手に決められた得点（守備側から見ると得点）。上の「時間帯」の切り替えに関係なく、全部を出します</p>`;
}

// ---------- 局面別（2026-10-19：種類別 → 局面別。得点・失点の局面を円グラフでも） ----------
function typeTab(ctx) {
  const gf = new Map(), ga = new Map(); let gfN = 0, gaN = 0, gfMiss = 0, gaMiss = 0;
  // 得点・失点の局面（円グラフ）：5つの局面＋OG＋局面が分からない（種類が未入力など）
  const pc = { own: [0, 0, 0, 0, 0, 0, 0], opp: [0, 0, 0, 0, 0, 0, 0] };
  const tCls = new Map(); // 種類の名前 → 局面
  const cls = { own: CLS_KEYS.map(() => ({ sh: 0, g: 0 })), opp: CLS_KEYS.map(() => ({ sh: 0, g: 0 })), z4: CLS_KEYS.map(() => 0), oz4: CLS_KEYS.map(() => 0) };
  const miss = { own: 0, opp: 0, z4: 0, oz4: 0 };
  for (const x of ctx.ok) {
    const ev = x.evs.filter((e) => (!x.keys || x.keys.includes(e.period)) && (!x.win || x.win(e)));
    for (const e of ev) {
      if (e.kind === 'goal') { gfN++; const n = e.pid === OPP_OG ? '相手OG' : e.gtype ? x.gn(e.gtype) : null; if (n) gf.set(n, (gf.get(n) || 0) + 1); else gfMiss++; }
      if (e.kind === 'conc') { gaN++; const n = e.gtype ? x.gn(e.gtype) : null; if (n) ga.set(n, (ga.get(n) || 0) + 1); else gaMiss++; }
      if (e.kind === 'z4' || e.kind === 'oz4') { const i = CLS_KEYS.indexOf(e.cls); if (i >= 0) cls[e.kind][i]++; else miss[e.kind]++; }
    }
    for (const [side, own] of [['own', true], ['opp', false]]) for (const s of shotsOf(ev, x.gn, own)) {
      const i = CLS_KEYS.indexOf(s.cls); if (i >= 0) { cls[side][i].sh++; if (s.goal) cls[side][i].g++; } else miss[side]++;
      if (s.goal) { pc[side][i >= 0 ? i : 6]++; if (s.e.gtype && i >= 0) tCls.set(x.gn(s.e.gtype), LCLS[i]); }
    }
    pc.own[5] += ev.filter((e) => e.kind === 'goal' && e.pid === OPP_OG).length;
    pc.opp[5] += ev.filter((e) => e.kind === 'conc').length - shotsOf(ev, x.gn, false).filter((s) => s.goal).length;
  }
  const order = opts('goalTypes', true).map((o) => o.name);
  const typeRows = (map, total) => [...map.entries()].sort((a, b) => b[1] - a[1] || order.indexOf(a[0]) - order.indexOf(b[0])).map(([n, v]) => `<tr><td class="apl">${esc(n)}</td><td class="mu">${esc(tCls.get(n) || (/OG/.test(n) ? 'OG' : '—'))}</td><td>${v}</td><td>${total ? Math.round(v / total * 100) : 0}%</td><td class="xbar"><i style="width:${total ? Math.round(v / total * 160) : 0}px"></i></td></tr>`).join('');
  const T1 = (title, map, total, missN, c) => `<div class="antype"><h3 class="anh3">${title}<small>合計 ${total}${missN ? `・種類が未入力 ${missN}` : ''}</small></h3><table class="antb ${c}"><thead><tr><th class="apl">種類</th><th>局面</th><th>数</th><th>割合</th><th></th></tr></thead><tbody>${typeRows(map, total) || '<tr><td colspan="5" class="mu">ありません</td></tr>'}</tbody></table></div>`;
  const PL = [...LCLS, 'OG', '局面が分からない'];
  const pie = (title, arr, cls) => { const tot = arr.reduce((a, b) => a + b, 0); return `<div class="anpie ${cls}"><h3 class="anh3">${title}<small>合計 ${tot}</small></h3>${tot ? `<div class="anpiew">${pieSvg(arr)}<table class="anpiel"><tbody>${arr.map((v, i) => (v ? `<tr><td><i style="background:${PIEC[i]}"></i>${PL[i]}</td><td><b>${v}</b></td><td>${Math.round(v / tot * 100)}%</td></tr>` : '')).join('')}</tbody></table></div>` : '<p class="mu">ありません</p>'}</div>`; };
  const pies = `<div class="antypes">${pie('得点の局面', pc.own, 'w')}${pie('失点の局面', pc.opp, 'o')}</div>`;
  const L = ['定位置', 'セットプレー', 'トランジション', 'GK活用', '特殊局面'];
  const clsT = `<table class="antb"><thead><tr><th class="apl">局面</th><th class="w">シュート</th><th class="w">得点</th><th class="w">決定率</th><th class="o">被シュート</th><th class="o">失点</th><th class="w">Z4進入</th><th class="o">被Z4進入</th></tr></thead><tbody>
    ${L.map((l, i) => `<tr><td class="apl">${l}</td><td class="w">${cls.own[i].sh}</td><td class="w">${cls.own[i].g}</td><td class="w">${cls.own[i].sh ? Math.round(cls.own[i].g / cls.own[i].sh * 100) + '%' : '—'}</td><td class="o">${cls.opp[i].sh}</td><td class="o">${cls.opp[i].g}</td><td class="w">${cls.z4[i]}</td><td class="o">${cls.oz4[i]}</td></tr>`).join('')}
    <tr class="ex"><td class="apl">局面が未入力</td><td class="w">${miss.own}</td><td></td><td></td><td class="o">${miss.opp}</td><td></td><td class="w">${miss.z4}</td><td class="o">${miss.oz4}</td></tr></tbody></table>`;
  return `<div class="antbl anscroll">${pies}<div class="antypes">${T1('得点の種類', gf, gfN, gfMiss, 'w')}${T1('失点の種類', ga, gaN, gaMiss, 'o')}</div><h3 class="anh3">局面ごとのシュート・決定率・Z4進入</h3>${clsT}</div>
    <p class="anhint">得点・失点の局面は、得点・失点の種類から決まります（OGは「OG」。種類が未入力などで局面が分からないものは「局面が分からない」）。得点・失点もシュートに数えます（OGはシュートに数えない）。決定率＝得点÷シュート。割合は、その種類の数÷合計</p>`;
}

// 円グラフ（12時から時計回り）
export const PIEC = ['#1F5FBF', '#E0832B', '#2E8B57', '#8A5AC8', '#C8312B', '#8C96A8', '#D5DAE3'];
export function pieSvg(arr) {
  const tot = arr.reduce((a, b) => a + b, 0); const R = 80, C = 90; let a0 = -Math.PI / 2; let out = '';
  const nz = arr.filter((v) => v).length;
  arr.forEach((v, i) => {
    if (!v) return;
    if (nz === 1) { out += `<circle cx="${C}" cy="${C}" r="${R}" fill="${PIEC[i]}"/><text x="${C}" y="${C + 6}" text-anchor="middle" font-size="17" font-weight="800" fill="${i === 6 ? '#3A4558' : '#fff'}">${v}</text>`; return; }
    const a1 = a0 + v / tot * Math.PI * 2; const big = a1 - a0 > Math.PI ? 1 : 0;
    out += `<path d="M${C},${C} L${(C + R * Math.cos(a0)).toFixed(2)},${(C + R * Math.sin(a0)).toFixed(2)} A${R},${R} 0 ${big} 1 ${(C + R * Math.cos(a1)).toFixed(2)},${(C + R * Math.sin(a1)).toFixed(2)} Z" fill="${PIEC[i]}" stroke="#fff" stroke-width="2"/>`;
    const am = (a0 + a1) / 2; if (v / tot >= 0.08) out += `<text x="${(C + R * 0.62 * Math.cos(am)).toFixed(1)}" y="${(C + R * 0.62 * Math.sin(am) + 5).toFixed(1)}" text-anchor="middle" font-size="15" font-weight="800" fill="${i === 6 ? '#3A4558' : '#fff'}">${v}</text>`;
    a0 = a1;
  });
  return `<svg class="anpies" viewBox="0 0 180 180" width="180" height="180">${out}</svg>`;
}

// ---------- マッチ・ペース ----------
function paceTab(ctx) {
  const no1 = onlyOne(ctx, 'マッチ・ペース'); if (no1) return no1;
  const x = ctx.ok[0]; const c = oneCtx(x);
  const ctl = `<div class="ansubs"><span class="anlab">区切り</span><button class="${A.bin === 30000 ? 'on' : ''}" data-bin-set="30000">30秒</button><button class="${A.bin !== 30000 ? 'on' : ''}" data-bin-set="60000">1分</button>
    <span class="anlab" style="margin-left:14px">表示する行</span>${Object.entries(PACE_ROWS).map(([k, r]) => `<button class="${A.rows.includes(k) ? 'on' : ''}" data-prow-set="${k}">${r[0]}</button>`).join('')}<span id="paceInfo" class="anpinfo"></span></div>`;
  if (!x.hasEv) return `${ctl}<div class="antbl anscroll">${paceSection(c, { bin: A.bin, rows: [], svgOnly: true, tap: true })}</div><p class="anhint">イベントが入力されていないので、下段のグラフはありません</p>`;
  return `${ctl}<div class="antbl anscroll">${paceSection(c, { bin: A.bin, rows: A.rows, svgOnly: true, tap: true })}</div>
    <p class="anhint">棒の区切りを押すと、その時間帯にピッチにいた選手を黄色にします。選手の名前を押すと、その選手が出ていた区切りを黄色にします。時間はプレーイングタイム（ピリオドごとの経過時間）。パワープレーと前半／後半の切り替えに関係なく、試合全体を出します</p>`;
}

// ---------- マッチレポート（PDF、⑥-4）：分析画面と同じ計算・同じ表を、A4横のページに並べる ----------
// ms：試合の配列。agg：複数試合の合計ページを「合計」「1試合平均」のどちらで出すか。
// perMatch：複数試合のとき、試合ごとのページも入れるか（false＝まとめのページだけ。2026-10-17 決11）
// 返り値：ページの配列 [{ title, who, html }]（読み込み中なら null）
export function reportPages(ms, agg = 'sum', { perMatch = true } = {}) {
  const save = { ...A, sort: { ...A.sort }, rows: [...A.rows] };
  try {
    Object.assign(A, { per: 'all', pp: 'all', agg, sort: { col: '', dir: 'desc' }, tview: 'list', print: true, scope: ms.length > 1 ? 'all' : 'match' });
    const all = buildCtx(ms); if (all.loading) return null;
    const pages = [];
    const multi = ms.length > 1;
    const vs = (m) => `${fmtShort(m.date)} vs ${esc(m.opponent || '')}`;
    if (multi) {
      const who = `${ms.length}試合の${agg === 'avg' ? '1試合平均' : '合計'}`;
      pages.push({ title: '試合ごとの結果と合計・1試合平均', who: `${ms.length}試合`, html: summaryPage(all.ctx, perMatch) });
      pages.push({ title: '選手×試合の出場時間', who: `${ms.length}試合`, html: playerByMatch(all.ctx) });
      { const mode = isNational() ? 'rg' : 'opp'; const ks = new Set(ms.map((m) => (mode === 'rg' ? regionOf(m.opponent) : m.opponent))); if (ks.size > 1) pages.push({ title: mode === 'rg' ? '相手の地域ごとの成績' : '相手チームごとの成績', who: `${ms.length}試合`, html: oppTable(all.ctx, mode) }); }
      pushCommon(pages, all.ctx, who);
      if (!perMatch) return pages;
    }
    for (const m of ms) {
      A.scope = 'match'; A.agg = 'sum';
      const one = buildCtx([m]); const x = one.ctx.ok[0]; const c = oneCtx(x);
      const who = vs(m) + `<small>${esc(asOfX(x))}</small>`;
      pages.push({ title: '試合情報・スコア・チームスタッツ', who, html: `<div class="rpinfo">${infoLine(x)}</div><div class="rp1">${teamSection(c, { plain: true })}${x.hasEv ? bandTable(c) : ''}</div>` });
      pages.push({ title: '出場時間と出場回数', who, html: timeTab(one.ctx) });
      pages.push({ title: '出場タイムライン', who, html: tlView(one.ctx) });
      pages.push({ title: 'マッチ・ペース', who, html: `<div class="antbl anscroll">${paceSection(c, { bin: 60000, rows: x.hasEv ? ['shot', 'ent', 'fsp', 'rl'] : [], svgOnly: true, tw: 1100, rowH: 19, gh: 98 })}</div><p class="anhint">1分ごと。時間はプレーイングタイム（ピリオドごとの経過時間）。緑の線＝得点、赤の線＝失点</p>` });
      pushCommon(pages, one.ctx, vs(m));
    }
    return pages;
  } finally { Object.assign(A, save); delete A.print; }
}
// 出場時間の一覧（グラフと表）だけを1ページに（2026-10-19）。いまの画面の切り替え（対象・合計/平均・前半/後半・パワープレーを除く・並べ替え）のまま
export function timePage(ms) {
  const save = { ...A, sort: { ...A.sort }, rows: [...A.rows] };
  try {
    Object.assign(A, { tview: 'list', print: true });
    const { ctx, loading } = buildCtx(ms); if (loading) return null;
    const multi = ms.length > 1;
    const who = multi ? `${ms.length}試合の${A.agg === 'avg' ? '1試合平均' : '合計'}` : `${fmtShort(ms[0].date)} vs ${esc(ms[0].opponent || '')}`;
    const cond = [A.per !== 'all' ? periodLabel(A.per) + 'だけ' : '', A.pp === 'ex' ? 'パワープレーの時間を除く' : ''].filter(Boolean).join('・');
    return { title: `出場時間と出場回数${cond ? `（${cond}）` : ''}`, who, html: timeTab(ctx) };
  } finally { Object.assign(A, save); delete A.print; }
}
// 合計のページにも、試合ごとのページにも入るもの
function pushCommon(pages, ctx, who) {
  const add = (title, html) => pages.push({ title, who, html });
  if (ctx.ok.length > 1) add('出場時間と出場回数', timeTab(ctx));
  if (!ctx.hasEv) { add('スタッツ', '<div class="card empty">イベントが入力されていないので、スタッツ・セット・パワープレー・局面別などのページはありません。</div>'); return; }
  const sub = (k) => { A.sub = k; return statsTab(ctx); };
  add('スタッツ（まとめ）', sub('sum'));
  add('セットの集計', setTab(ctx));
  add('パワープレー', ppTab(ctx));
  add('局面別（得点・失点の種類と局面、局面ごとのシュート）', typeTab(ctx));
  add('進入（Z4・SZ進入の方法、パスの出し手・受け手）', sub('ent'));
  add('リカバリーとロスト（ゾーン別）', sub('rl'));
  add('FINISH SET PLAY（チーム）', sub('fsp'));
  add('ファールとカード', sub('foul'));
}
// どこまでの記録か（マッチスタッツ・マッチレビューと同じ）
const asOfX = (x) => asOfLabel(x.M);
function infoLine(x) {
  const m = x.m; const act = activityById(m.activityId);
  return [fmtShort(m.date) + (m.kickoff ? ` ${esc(m.kickoff)}キックオフ` : ''), esc(act?.name || ''), esc(m.category || ''), esc(m.venue || '')].filter(Boolean).map((t) => `<span>${t}</span>`).join('');
}
// 複数試合：試合ごとの結果一覧と、チームの合計・1試合平均
function summaryPage(ctx, perMatch = true) {
  const { ok } = ctx; const n = ok.length;
  const own = esc(S.team?.name || '自チーム');
  const rows = ok.map((x) => {
    const R = x.R, a = R.A, b = R.B; const sc = R.rangeScore;
    const per = x.M.periods.filter((p) => p.status !== 'none').map((p) => `${R.score.own[p.key]}−${R.score.opp[p.key]}`).join(' / ');
    const res = sc.own > sc.opp ? '<b class="w">勝</b>' : sc.own < sc.opp ? '<b class="o">負</b>' : '<b>分</b>';
    return `<tr><td class="apl">${fmtShort(x.m.date)}</td><td class="apl">vs ${flag(x.m.opponent)}${esc(x.m.opponent || '')}</td><td class="apl"><small>${esc(activityById(x.m.activityId)?.name || '')}</small></td><td>${res}</td><td><b>${sc.own}−${sc.opp}</b><small>（${per}）</small></td>
      <td class="w">${a.shots}<small>（${a.sz}）</small></td><td class="o">${b.shots}<small>（${b.sz}）</small></td><td class="w">${a.z4 + a.szE}</td><td class="o">${b.z4 + b.szE}</td><td class="w">${a.fsp}</td><td class="o">${b.fsp}</td><td>${R.rec}</td><td>${R.lost}</td><td class="w">${a.foul}</td><td class="o">${b.foul}</td>${x.todo ? '<td class="o"><small>未入力あり</small></td>' : '<td></td>'}</tr>`;
  }).join('');
  const T = ctx.team, a = T.A || {}, b = T.B || {};
  const w = ok.filter((x) => x.R.rangeScore.own > x.R.rangeScore.opp).length, l = ok.filter((x) => x.R.rangeScore.own < x.R.rangeScore.opp).length;
  const av = (v) => (n ? (v / n).toFixed(1) : '—');
  const tot = (f, avg) => (avg ? av : String)(f);
  const line = (label, avg) => `<tr class="tot"><td class="apl" colspan="3">${label}</td><td>${avg ? '' : `${w}勝${l}敗${n - w - l}分`}</td><td><b>${tot(T.score.own, avg)}−${tot(T.score.opp, avg)}</b></td>
    <td class="w">${tot(a.shots, avg)}<small>（${tot(a.sz, avg)}）</small></td><td class="o">${tot(b.shots, avg)}<small>（${tot(b.sz, avg)}）</small></td><td class="w">${tot(a.z4 + a.szE, avg)}</td><td class="o">${tot(b.z4 + b.szE, avg)}</td><td class="w">${tot(a.fsp, avg)}</td><td class="o">${tot(b.fsp, avg)}</td><td>${tot(T.rec, avg)}</td><td>${tot(T.lost, avg)}</td><td class="w">${tot(a.foul, avg)}</td><td class="o">${tot(b.foul, avg)}</td><td></td></tr>`;
  const list = `<table class="antb rpsum"><thead><tr><th class="apl">日付</th><th class="apl">相手</th><th class="apl">活動</th><th>結果</th><th>スコア<small>（ピリオドごと）</small></th><th class="w">シュート<small>（SZ内）</small></th><th class="o">被シュート<small>（SZ内）</small></th><th class="w">Z4・SZ<br>進入</th><th class="o">被Z4・SZ<br>進入</th><th class="w">FSP<br>AT</th><th class="o">FSP<br>DF</th><th>リカバ<br>リー</th><th>ロスト</th><th class="w">ファール</th><th class="o">被ファール</th><th></th></tr></thead><tbody>${rows}</tbody><tfoot>${line('合計', false)}${line('1試合平均', true)}</tfoot></table>`;
  // チームの比較（合計と1試合平均）。SZ内シュート・FINISH SET PLAY・カードの内訳は数字の下に
  const fspSub = (s) => `CK ${s.fspT[0]}・CK-KI ${s.fspT[1]}・KI ${s.fspT[2]}・FK ${s.fspT[3]}`;
  const cardSub = (s) => `イエロー${s.cards.yellow}・レッド${s.cards.red}`;
  const cmp = (label, x, y, sub) => `<tr><td class="cl">${label}</td><td class="cv w">${x}${sub ? `<small>${sub[0]}</small>` : ''}</td><td class="cv w">${av(x)}</td><td class="cv o">${y}${sub ? `<small>${sub[1]}</small>` : ''}</td><td class="cv o">${av(y)}</td></tr>`;
  const cm = `<table class="rpcmp"><thead><tr><th></th><th class="w">${own}<br><small>合計</small></th><th class="w"><small>1試合平均</small></th><th class="o">相手<br><small>合計</small></th><th class="o"><small>1試合平均</small></th></tr></thead><tbody>
    ${cmp('得点', T.score.own, T.score.opp)}${cmp('シュート', a.shots, b.shots, [`SZ内 ${a.sz}`, `SZ内 ${b.sz}`])}${cmp('枠内', a.in, b.in)}${cmp('Z4進入', a.z4, b.z4)}${cmp('SZ進入', a.szE, b.szE)}${cmp('FINISH SET PLAY', a.fsp, b.fsp, [fspSub(a), fspSub(b)])}${cmp('ファール', a.foul, b.foul)}${cmp('カード', a.cards.yellow + a.cards.red, b.cards.yellow + b.cards.red, [cardSub(a), cardSub(b)])}${cmp('タイムアウト', T.timeouts.own, T.timeouts.opp)}
    <tr><td class="cl">リカバリー／ロスト</td><td class="cv" colspan="2">${T.rec} / ${T.lost}<small>1試合平均 ${av(T.rec)} / ${av(T.lost)}</small></td><td colspan="2"></td></tr></tbody></table>`;
  // 得点者・アシスト（選手ごとの合計）
  const sc = ctx.pids.filter((p) => ctx.P[p].goals || ctx.P[p].assists).sort((x, y) => ctx.P[y].goals - ctx.P[x].goals || ctx.P[y].assists - ctx.P[x].assists);
  const scT = `<table class="antb rpsc"><thead><tr><th class="apl">選手</th><th>得点</th><th>アシスト</th><th>出場試合数</th></tr></thead><tbody>${sc.map((p) => `<tr><td class="apl">${badge(ctx, p)} ${name(p)}</td><td><b>${ctx.P[p].goals}</b></td><td>${ctx.P[p].assists}</td><td>${ctx.P[p].games}</td></tr>`).join('') || '<tr><td colspan="4" class="mu">得点・アシストはまだありません</td></tr>'}</tbody></table>`;
  return `<h3 class="anh3">試合ごとの結果</h3>${list}<div class="rpsum2"><div><h3 class="anh3">チームの合計と1試合平均</h3>${cm}</div><div><h3 class="anh3">得点者・アシスト（${n}試合の合計）</h3>${scT}</div></div><p class="anhint">${skippedLive ? `試合中の ${skippedLive}試合は含めていません。` : ''}シュートは得点を含む（OGは除く）。相手のファール・カード＝自チームの被ファールで記録したもの。このあとに${n}試合の合計のページ${perMatch ? '、そのあとに試合ごとのページ' : ''}が続きます</p>`;
}
// 時間帯ごとの数（マッチスタッツの下段と同じ区切り：前半・後半をそれぞれ半分に、延長は延長前半・延長後半。名前は試合の長さから）
function bandTable(c) {
  const { R, own, opp } = c; const { A: a, B: b } = R;
  const L = R.bands.map((l) => `${l.replace('~', '〜')}${/:/.test(l) ? '' : '分'}`);
  const row = (lab, x, y) => `<tr><td class="apl">${lab}</td>${x.map((v, i) => `<td class="w">${v}</td><td class="o">${y[i]}</td>`).join('')}<td class="w"><b>${x.reduce((s, v) => s + v, 0)}</b></td><td class="o"><b>${y.reduce((s, v) => s + v, 0)}</b></td></tr>`;
  return `<div class="rpband"><h3 class="anh3">時間帯ごとの数<small>試合の時計（プレーイングタイム）。左＝${esc(own)}、右＝${esc(opp)}</small></h3><table class="antb"><thead><tr><th class="apl"></th>${L.map((l) => `<th colspan="2">${l}</th>`).join('')}<th colspan="2">合計</th></tr></thead><tbody>
    ${row('シュート', a.shotBand, b.shotBand)}${row('Z4進入', a.z4Band, b.z4Band)}${row('FINISH SET PLAY', a.fspBand, b.fspBand)}</tbody></table></div>`;
}

// 表の列幅（2026-10-18。マッチレビューと同じ考え方）：列ごとに中身（その時の一番長い数字・名前）と見出しの文字を測り、
// その比で表の幅を分ける。選手の列は測った幅の1.33倍。列が多くて画面に入らないときは、表を横に動かして見る（最小の幅を守る）
export function sizeAn(root) {
  const rng = document.createRange();
  const tw = (el) => { rng.selectNodeContents(el); return rng.getBoundingClientRect().width; };
  for (const t of root.querySelectorAll('table.antb.anauto')) {
    const hr = t.tHead?.rows; if (!hr?.length) continue; const head = hr[hr.length - 1]; const n = head.cells.length;
    t.classList.add('anmeasure'); t.querySelector('colgroup')?.remove();
    const w = Array(n).fill(0);
    const rows = [...(t.tBodies[0]?.rows || []), ...(t.tFoot?.rows || [])];
    for (const r of rows) { if (r.cells.length !== n) continue; [...r.cells].forEach((c, i) => { w[i] = Math.max(w[i], tw(c)); }); }
    [...head.cells].forEach((c, i) => {
      const k = c.cloneNode(true); k.querySelectorAll('i').forEach((x) => x.remove());
      const lines = k.innerHTML.split(/<br\s*\/?>/i).map((h) => { const sp = document.createElement('span'); sp.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap'; sp.innerHTML = h; c.appendChild(sp); const v = sp.getBoundingClientRect().width; sp.remove(); return v; });
      w[i] = Math.max(w[i], ...lines);
    });
    t.classList.remove('anmeasure');
    if (t.dataset.nmx) w[0] *= +t.dataset.nmx;
    const ws = w.map((x) => Math.max(20, x) + 18); const sum = ws.reduce((a, b) => a + b, 0);
    const cg = document.createElement('colgroup'); cg.innerHTML = ws.map((x) => `<col style="width:${(x / sum * 100).toFixed(2)}%">`).join(''); t.prepend(cg);
    t.style.minWidth = Math.round(sum) + 'px';
  }
}
