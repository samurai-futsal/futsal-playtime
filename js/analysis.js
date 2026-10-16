// 分析画面（spec 9章「集計画面の構成」）。⑤-1：試合の選び方・出場時間・スタッツ。
// マッチレビューと同じ記録から同じ計算で作るので、数字は必ず一致する。
// 画面全体はスクロールせず、選手の表の中だけをスクロールする（条件を切り替えて見比べる画面のため）。
import { S, watchOps, watchEvents, opts, teamSettings, playerById, activityById, matchStatus } from './store.js';
import { replay, periodLabel } from './engine.js';
import { matchModel, playerTable, periodSig } from './model.js';
import { teamStats, playerDetail, addInto, blankDetail, FSP_KEYS, ZONE_KEYS, ppWindows, windowsOf, clipModel, winTest, ppTime } from './teamstats.js';
import { missing } from './events.js';
import { esc, fmtShort, openModal, closeModal } from './ui.js';
import { render } from './views.js';

const mmss = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const PCOL = { '1H': '#1F5FBF', '2H': '#8FB3EC', E1: '#0E8A6E', E2: '#86D3BE' };
const MCOL = ['#1F5FBF', '#E0832B', '#2E8B57', '#8A5AC8', '#C8312B', '#0E8A9E', '#B5600F', '#5F6B80'];
const TABS = [['time', '出場時間'], ['stats', 'スタッツ'], ['set', 'セット'], ['pp', 'パワープレー'], ['type', '種類別'], ['pace', 'マッチ・ペース']];
const PPM = [['all', 'すべて'], ['ex', '5×4/4×5を除く']]; // 2026-10-16：この2つだけ
const SUBS = [['sum', 'まとめ'], ['shot', 'シュート'], ['goal', '得失点'], ['ent', 'Z4・SZ進入'], ['rl', 'リカバリー・ロスト'], ['foul', 'ファール・カード'], ['fsp', 'FINISH SET PLAY']];
const A = { scope: 'match', matchId: null, picked: null, f: { act: '', type: '', cat: '', from: '', to: '' }, agg: 'sum', per: 'all', pp: 'all', tab: 'stats', sub: 'sum', sort: { col: '', dir: 'desc' } };
try { Object.assign(A, JSON.parse(localStorage.getItem('fpt.analysis') || '{}'), { sort: { col: '', dir: 'desc' } }); } catch {}
let fromHash = null;
if (!['all', 'ex'].includes(A.pp)) A.pp = 'all';
const keep = () => { try { const { scope, matchId, picked, f, agg, per, pp, tab, sub } = A; localStorage.setItem('fpt.analysis', JSON.stringify({ scope, matchId, picked, f, agg, per, pp, tab, sub })); } catch {} };

// 分析できる試合（試合中・終わった試合）
const candidates = () => S.matches.filter((m) => !m.deleted && (m.status === 'playing' || m.status === 'done'))
  .sort((a, b) => (b.date || '').localeCompare(a.date || '') || (b.kickoff || '').localeCompare(a.kickoff || ''));
function filtered() {
  const f = A.f;
  return candidates().filter((m) => {
    const a = activityById(m.activityId);
    return (!f.act || m.activityId === f.act) && (!f.type || a?.type === f.type) && (!f.cat || m.category === f.cat)
      && (!f.from || (m.date || '') >= f.from) && (!f.to || (m.date || '') <= f.to);
  });
}
function selected() {
  if (A.scope === 'match') { const m = candidates().find((x) => x.id === A.matchId) || candidates()[0]; if (m) A.matchId = m.id; return m ? [m] : []; }
  if (A.scope === 'pick') { const set = new Set(A.picked || []); return filtered().filter((m) => set.has(m.id)); }
  return filtered();
}

// 1試合ぶんの計算（選んだピリオドの範囲）
function oneMatch(m, per) {
  const opsC = watchOps(m.id); const evC = watchEvents(m.id);
  if (!opsC.ready && !opsC.list.length) return null;
  const cfg = { times: m.times || {}, members: m.members || {}, setplayAuto: teamSettings().setplayAuto || 60 };
  const st = replay(opsC.list, cfg); st.sig = periodSig(opsC.list);
  const M = matchModel(st, Date.now(), m.fix);
  const keys = per === 'all' ? null : M.periods.some((p) => p.key === per && p.status !== 'none') ? [per] : [];
  const gn = (id) => opts('goalTypes', true).find((o) => o.id === id)?.name || '';
  const evs = evC.list.filter((e) => !e.deleted);
  // パワープレー（5×4）の時間帯で分ける：出場時間もイベントも、選んだ時間帯の中だけで数える
  const W = ppWindows(M); const wins = windowsOf(M, W, A.pp); const win = winTest(wins);
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
  return { m, M, T, R, D, keys, len, empty, hasEv: evs.length > 0, todo, ready: evC.ready, hasOpp: W.hasOpp };
}

export function vAnalysis(r, mFrom = null) {
  // 試合ページから開いたときは「この試合」で始める（開いたあとは自由に切り替えられる）
  if (mFrom && fromHash !== location.hash) { A.scope = 'match'; A.matchId = mFrom.id; keep(); }
  fromHash = mFrom ? location.hash : null;
  const ms = selected();
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
      for (const p of x.M.periods) { const c = x.T[pid]?.per?.[p.key]; if (!c || (x.keys && !x.keys.includes(p.key))) continue; const q = (P[pid].per = P[pid].per || {}); q[p.key] = q[p.key] || { time: 0, count: 0 }; q[p.key].time += c.time; q[p.key].count += c.count; }
    }
  }
  const hasEv = ok.some((x) => x.hasEv);
  const pids = Object.keys(P).sort((a, b) => (pos[a] === 'GK') - (pos[b] === 'GK') || (parseInt(no[a], 10) || 999) - (parseInt(no[b], 10) || 999));
  const ctx = { ok, P, team, no, pos, pids, hasEv, ms };

  // ---------- 上：対象・切り替え ----------
  const cand = candidates();
  const seg = (key, list) => `<span class="anseg">${list.map(([v, l]) => `<button class="${A[key] === v ? 'on' : ''}" data-set="${key}" data-v="${v}">${l}</button>`).join('')}</span>`;
  const one = A.scope === 'match' ? `<select id="anMatch" class="ansel">${cand.map((m) => `<option value="${m.id}" ${m.id === A.matchId ? 'selected' : ''}>${fmtShort(m.date)} vs ${esc(m.opponent)}</option>`).join('')}</select>` : '';
  const multi = A.scope !== 'match' ? `<button class="btn sm" id="anPick">${A.scope === 'pick' ? '試合を選ぶ' : '絞り込み'}（${ms.length}試合）</button>` : '';
  const todoN = ok.filter((x) => x.todo).length; const noOpp = ok.filter((x) => !x.hasOpp).length;
  const head = `<div class="anhead">
    <div class="anrow"><b class="antt">分析</b>${seg('scope', [['match', 'この試合'], ['all', '全試合'], ['pick', '選んだ試合']])}${one}${multi}
      ${A.scope === 'match' ? '' : seg('agg', [['sum', '合計'], ['avg', '1試合平均']])}${seg('per', [['all', '全体'], ['1H', '前半'], ['2H', '後半']])}
      <span class="anpp">パワープレー${seg('pp', PPM)}</span>
      ${A.pp !== 'all' && noOpp ? `<span class="antodo" title="相手の5×4はMATCH PLAYのパワープレー（相手）か記録の修正で入れたときだけ分けられます">相手の5×4（こちらの4×5）の記録なし ${noOpp}試合</span>` : ''}
      ${todoN ? `<span class="antodo" title="未入力の項目か要確認が残っている試合">未入力あり ${todoN}試合</span>` : ''}${loading ? '<span class="mu">読み込み中…</span>' : ''}</div>
    <div class="antabs">${TABS.map(([v, l]) => `<button class="${A.tab === v ? 'on' : ''} ${['set', 'pp', 'type', 'pace'].includes(v) ? 'later' : ''}" data-tab="${v}">${l}</button>`).join('')}</div></div>`;

  let body;
  if (!ms.length) body = '<div class="card empty">対象の試合がありません（試合が始まると分析できます）</div>';
  else if (A.tab === 'time') body = timeTab(ctx);
  else if (A.tab === 'stats') body = statsTab(ctx);
  else body = `<div class="card empty"><b>${TABS.find((t) => t[0] === A.tab)[1]}</b><p>このタブは次の段階（⑤-2）で入ります。</p></div>`;
  return { active: 'analysis', html: `<div class="anw">${head}<div class="anbody">${body}</div></div>`, bind: bindAnalysis };
}

// ---------- 数字の見せ方 ----------
const ref = () => (teamSettings().refMin || 120) * 1000;
function cellFns(ctx) {
  const avg = A.agg === 'avg' && A.scope !== 'match';
  const n = (v, games) => { if (!avg) return String(v); const g = games || 0; return g ? (v / g).toFixed(1) : '—'; };
  const pm = (v, time) => (time > 0 ? (v / (time / 60000)).toFixed(2) : '—');
  return { avg, n, pm };
}
const badge = (ctx, pid) => `<span class="no ${ctx.pos[pid] === 'GK' ? 'gk' : 'fp'}">${esc(ctx.no[pid] ?? '')}</span>`;
const name = (pid) => esc(playerById(pid)?.last || '');

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
  const th = cols.map((c) => `<th class="srt ${A.sort.col === c.k ? 'on' : ''} ${c.cls || ''}" data-sort="${c.k}">${c.h}<i>${A.sort.col === c.k ? (A.sort.dir === 'asc' ? '▲' : '▼') : ''}</i></th>`).join('');
  const rows = list.map((pid) => {
    const d = P[pid]; const low = d.time < ref();
    return `<tr class="${d.time ? '' : 'zero'} ${low && d.time ? 'low' : ''}"><td class="apl">${badge(ctx, pid)} ${name(pid)}</td>${cols.map((c) => `<td class="${c.cls || ''} ${c.pm && low ? 'ref' : ''}">${c.f(c.v(d, pid), d)}</td>`).join('')}</tr>`;
  }).join('');
  const tot = `<tr class="tot"><td class="apl">チーム合計</td>${cols.map((c) => `<td class="${c.cls || ''}">${c.tot ? c.tot(ctx.team) : ''}</td>`).join('')}</tr>`;
  return `<div class="antbl"><table class="antb"><thead>${hasGrp ? `<tr class="grp"><th></th>${groups.map((g) => `<th colspan="${g.n}" class="${g.g ? 'g' : ''}">${g.g}</th>`).join('')}</tr>` : ''}<tr><th class="srt apl ${A.sort.col ? '' : 'on'}" data-sort="">選手</th>${th}</tr></thead><tbody>${rows}</tbody><tfoot>${tot}</tfoot></table></div>
    <p class="anhint">${note}${note ? '　' : ''}薄い数字＝出場時間が${mmss(ref())}未満で、1分あたりは参考値。見出しを押すと並べ替え（多い順 → 少ない順）、GKはいつも一番下。</p>`;
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
    for (const [c, t] of parts) { if (!t) continue; const h = H * t / max; y -= h; sv += `<rect x="${x}" y="${y}" width="${bw}" height="${h}" fill="${c}"/>`; }
    sv += `<text x="${x + bw / 2}" y="${y - 5}" font-size="13" font-weight="800" fill="#0B2D6B" text-anchor="middle">${mmss(val(pid))}</text>`;
    sv += `<text x="${x + bw / 2}" y="${18 + H + 17}" font-size="13" font-weight="800" fill="#1F5FBF" text-anchor="middle">${esc(ctx.no[pid] ?? '')}</text><text x="${x + bw / 2}" y="${18 + H + 33}" font-size="11.5" fill="#5F6B80" text-anchor="middle">${name(pid)}</text>`;
  });
  sv += '</svg>';
  const lg = multi ? ok.map((o, j) => `<span class="lg"><i style="background:${MCOL[j % MCOL.length]}"></i>${fmtShort(o.m.date)} vs ${esc(o.m.opponent)}</span>`).join('') : periods.map((p) => `<span class="lg"><i style="background:${PCOL[p.key]}"></i>${p.label}</span>`).join('');
  const t = (ms, d) => (avg && d.games ? mmss(ms / d.games) : mmss(ms));
  const cols = [
    ...(multi || A.scope !== 'match' ? [{ k: 'games', h: '出場<br>試合数', v: (d) => d.games, f: (v) => v, tot: (tm) => tm.games }] : []),
    ...periods.flatMap((p) => [{ k: 't' + p.key, grp: p.label, h: '時間', v: (d) => d.per?.[p.key]?.time || 0, f: (v, d) => t(v, d) },
      { k: 'n' + p.key, grp: p.label, h: '回数', v: (d) => d.per?.[p.key]?.count || 0, f: (v, d) => (avg && d.games ? (v / d.games).toFixed(1) : v) }]),
    { k: 'total', grp: '合計', h: '時間', v: (d) => d.time, f: (v, d) => `<b>${t(v, d)}</b>`, tot: (tm) => `<b>${mmss(tm.len)}</b>` },
    { k: 'count', grp: '合計', h: '回数', v: (d) => d.count, f: (v, d) => (avg && d.games ? (v / d.games).toFixed(1) : v) },
    { k: 'rate', grp: '合計', h: '出場率', v: (d) => d.time, f: (v) => (team.len ? Math.round(v / team.len * 100) + '%' : '—') },
    ...(A.pp === 'all' ? [{ k: 'pown', grp: 'うちパワープレー', h: '5×4<br><small>攻撃</small>', v: (d) => d.pOwn, f: (v, d) => (v ? t(v, d) : '<span class="z">—</span>') }, { k: 'popp', grp: 'うちパワープレー', h: '4×5<br><small>守備</small>', v: (d) => d.pOpp, f: (v, d) => (v ? t(v, d) : '<span class="z">—</span>') }] : []),
  ];
  const sum = pids.reduce((a, p) => a + P[p].time, 0);
  const expect = team.len * 5 - team.empty;
  const chk = `<span class="${Math.abs(sum - expect) < 1000 * ok.length * 5 ? 'anok' : 'anng'}">全員の合計 ${mmss(sum)} ＝ 試合時間 ${mmss(team.len)} × 5人${team.empty ? ` − 退場による空席 ${mmss(team.empty)}` : ''}${Math.abs(sum - expect) < 1000 * ok.length * 5 ? ' ✓' : `（${mmss(expect)} と合いません）`}</span>`;
  return `<div class="antime"><div class="anchart"><div class="anlg">${lg}<span class="sp"></span>${chk}</div>${sv}</div>${table(ctx, cols, { note: `グラフはFPだけ（${avg ? '1試合平均、' : ''}${multi ? '試合ごとに積み上げ' : 'ピリオドを積み上げ'}）。出場率は${A.per === 'all' ? '' : periodLabel(A.per) + 'の'}試合時間（${mmss(team.len)}）に対して。タイムラインは⑤-2で入ります` })}</div>`;
}

// ---------- スタッツ ----------
function statsTab(ctx) {
  const { team, hasEv } = ctx; const { n, pm, avg } = cellFns(ctx);
  const subs = `<div class="ansubs">${SUBS.map(([v, l]) => `<button class="${A.sub === v ? 'on' : ''}" data-sub="${v}">${l}</button>`).join('')}</div>`;
  if (!hasEv) return `${subs}<div class="card empty">選んだ試合にはイベントが入力されていません。イベントを入力すると、ここに選手ごとのスタッツが出ます。</div>`;
  const g = (v) => (avg ? (v / Math.max(1, team.games)).toFixed(1) : v);
  const tA = team.A, tB = team.B;
  const bar = `<div class="anteam">${[
    ['得点−失点', `${g(team.score.own)}−${g(team.score.opp)}`], ['シュート', `${g(tA.shots)}<small>（SZ内 ${g(tA.sz)}）</small> / ${g(tB.shots)}`], ['Z4・SZ進入', `${g(tA.z4 + tA.szE)} / ${g(tB.z4 + tB.szE)}`],
    ['リカバリー／ロスト', `${g(team.rec)} / ${g(team.lost)}`], ['FINISH SET PLAY', `${g(tA.fsp)} / ${g(tB.fsp)}`], ['ファール', `${g(tA.foul)} / ${g(tB.foul)}`]].map(([l, v]) => `<span><em>${l}</em><b>${v}</b></span>`).join('')}<span class="mu">自チーム / 相手${avg ? '（1試合平均）' : ''}</span></div>`;
  const N = (k, h, v, extra = {}) => ({ k, h, v, f: (x, d) => n(x, d.games), ...extra });
  const PM = (k, h, v) => ({ k, h, v: (d) => (d.time ? v(d) / (d.time / 60000) : -1), f: (x, d) => pm(v(d), d.time), pm: true, cls: 'pmc' });
  const tm = (f) => (t) => g(f(t));
  const tmPm = (f) => (t) => (t.len ? (f(t) / (t.len / 60000)).toFixed(2) : '—');
  const games = { k: 'games', h: '出場<br>試合数', v: (d) => d.games, f: (v) => v, tot: (t) => t.games };
  const time = { k: 'time', h: '出場時間', v: (d) => d.time, f: (v, d) => mmss(avg && d.games ? v / d.games : v), tot: (t) => mmss(avg ? t.len / Math.max(1, t.games) : t.len) };
  const base = A.scope === 'match' ? [time] : [games, time];
  let cols, note = '';
  const ent = (d) => d.on.z4 + d.on.sz, oent = (d) => d.on.oz4 + d.on.osz;
  switch (A.sub) {
    case 'sum': cols = [...base,
      N('shots', 'シュート<br><small>（SZ内）</small>', (d) => d.shots, { f: (x, d) => `${n(x, d.games)}<small>（${n(d.sz, d.games)}）</small>`, tot: (t) => `${g(t.A.shots)}<small>（${g(t.A.sz)}）</small>` }),
      N('goals', '得点', (d) => d.goals, { tot: (t) => g(t.score.own) }), N('assists', 'アシスト', (d) => d.assists), N('inv', '進入関与', (d) => d.inv),
      N('pf', 'パス<br>出し手', (d) => d.passFrom), N('pt', 'パス<br>受け手', (d) => d.passTo), N('rec', 'リカバリー', (d) => d.rec, { tot: tm((t) => t.rec) }), N('lost', 'ロスト', (d) => d.lost, { tot: tm((t) => t.lost) }),
      { ...PM('spm', 'シュート<br>／分', (d) => d.on.shot), tot: tmPm((t) => t.A.shots) }, { ...PM('ospm', '被シュート<br>／分', (d) => d.on.oshot), tot: tmPm((t) => t.B.shots) },
      { ...PM('epm', 'Z4・SZ進入<br>／分', ent), tot: tmPm((t) => t.A.z4 + t.A.szE) }, { ...PM('oepm', '被Z4・SZ<br>進入／分', oent), tot: tmPm((t) => t.B.z4 + t.B.szE) },
      N('pmv', '得失点±', (d) => d.on.gf - d.on.ga, { f: (x, d) => { const v = avg && d.games ? (x / d.games).toFixed(1) : x; return `<b>${x > 0 ? '+' : ''}${v}</b>`; }, tot: (t) => `${t.score.own - t.score.opp > 0 ? '+' : ''}${g(t.score.own - t.score.opp)}` })];
      note = 'シュート・得点などは本人のプレー。／分 と得失点±は、その選手がピッチにいる間のチームの数（1分あたり＝合計の本数÷合計の出場時間）。'; break;
    case 'shot': cols = [...base,
      N('shots', '合計', (d) => d.shots, { grp: '本人のシュート', tot: tm((t) => t.A.shots) }), N('sz', 'SZ内', (d) => d.sz, { grp: '本人のシュート', tot: tm((t) => t.A.sz) }),
      N('in', '枠内', (d) => d.in, { grp: '本人のシュート', tot: tm((t) => t.A.in) }), N('out', '枠外', (d) => d.out, { grp: '本人のシュート', tot: tm((t) => t.A.out) }), N('block', 'ブロック', (d) => d.block, { grp: '本人のシュート', tot: tm((t) => t.A.block) }),
      { k: 'rate', grp: '本人のシュート', h: '決定率', v: (d) => (d.shots ? d.goals / d.shots : -1), f: (x, d) => (d.shots ? Math.round(d.goals / d.shots * 100) + '%' : '—'), tot: (t) => (t.A.shots ? Math.round(t.A.goals / t.A.shots * 100) + '%' : '—') },
      N('os', 'シュート', (d) => d.on.shot, { grp: '出場中', tot: tm((t) => t.A.shots) }), { ...PM('osm', '／分', (d) => d.on.shot), grp: '出場中', tot: tmPm((t) => t.A.shots) },
      N('oo', '被シュート', (d) => d.on.oshot, { grp: '出場中', tot: tm((t) => t.B.shots) }), { ...PM('oom', '／分', (d) => d.on.oshot), grp: '出場中', tot: tmPm((t) => t.B.shots) },
      N('od', '差', (d) => d.on.shot - d.on.oshot, { grp: '出場中', tot: tm((t) => t.A.shots - t.B.shots) })];
      note = 'シュートは得点を含む（OGは除く）。決定率＝得点÷シュート。'; break;
    case 'goal': cols = [...base, N('goals', '得点', (d) => d.goals, { grp: '本人', tot: tm((t) => t.score.own) }), N('assists', 'アシスト', (d) => d.assists, { grp: '本人' }),
      N('gf', '得点', (d) => d.on.gf, { grp: '出場中', tot: tm((t) => t.score.own) }), N('ga', '失点', (d) => d.on.ga, { grp: '出場中', tot: tm((t) => t.score.opp) }),
      N('pmv', '±', (d) => d.on.gf - d.on.ga, { grp: '出場中', f: (x, d) => `<b>${x > 0 ? '+' : ''}${n(x, d.games)}</b>`, tot: tm((t) => t.score.own - t.score.opp) }),
      { ...PM('pmm', '±／分', (d) => d.on.gf - d.on.ga), grp: '出場中', tot: tmPm((t) => t.score.own - t.score.opp) }];
      note = '出場中の得点・失点は、相手OG・自チームOGを含む。'; break;
    case 'ent': {
      const E = (gk, gl) => [N(gk + 'dr', 'ドリブル', (d) => d.ent[gk].dr, { grp: gl }), N(gk + 'pf', 'パス<br>出し手', (d) => d.ent[gk].pf, { grp: gl }), N(gk + 'pt', 'パス<br>受け手', (d) => d.ent[gk].pt, { grp: gl }), N(gk + 'rb', 'リバウンド', (d) => d.ent[gk].rb, { grp: gl }), N(gk + 'iv', '関与', (d) => d.ent[gk].inv, { grp: gl, tot: tm((t) => (gk === 'z4' ? t.A.z4 : t.A.szE)) })];
      cols = [...base, ...E('z4', 'Z4進入（本人）'), ...E('sz', 'SZ進入（本人）'), N('inv', '進入関与<br>合計', (d) => d.inv),
        N('oe', '進入', ent, { grp: '出場中', tot: tm((t) => t.A.z4 + t.A.szE) }), { ...PM('oem', '／分', ent), grp: '出場中', tot: tmPm((t) => t.A.z4 + t.A.szE) },
        N('ooe', '被進入', oent, { grp: '出場中', tot: tm((t) => t.B.z4 + t.B.szE) }), { ...PM('ooem', '／分', oent), grp: '出場中', tot: tmPm((t) => t.B.z4 + t.B.szE) },
        N('ed', '差', (d) => ent(d) - oent(d), { grp: '出場中', tot: tm((t) => t.A.z4 + t.A.szE - t.B.z4 - t.B.szE) })];
      note = '関与＝その進入に選手（パスは出し手と受け手）として付いている回数。チーム合計の「関与」は進入の本数。出場中の進入＝Z4進入とSZ進入の合計。'; break;
    }
    case 'rl': cols = [...base, N('rec', 'リカバリー', (d) => d.rec, { grp: '本人', tot: tm((t) => t.rec) }), N('lost', 'ロスト', (d) => d.lost, { grp: '本人', tot: tm((t) => t.lost) }), N('rld', '差', (d) => d.rec - d.lost, { grp: '本人', tot: tm((t) => t.rec - t.lost) }),
      N('orec', 'リカバリー', (d) => d.on.rec, { grp: '出場中', tot: tm((t) => t.rec) }), { ...PM('orecm', '／分', (d) => d.on.rec), grp: '出場中', tot: tmPm((t) => t.rec) },
      N('olost', 'ロスト', (d) => d.on.lost, { grp: '出場中', tot: tm((t) => t.lost) }), { ...PM('olostm', '／分', (d) => d.on.lost), grp: '出場中', tot: tmPm((t) => t.lost) },
      N('orld', '差', (d) => d.on.rec - d.on.lost, { grp: '出場中', tot: tm((t) => t.rec - t.lost) }),
      ...ZONE_KEYS.map((z, i) => N('rz' + z, z, (d) => d.recZ[i], { grp: 'リカバリーの場所（本人）' })), ...ZONE_KEYS.map((z, i) => N('lz' + z, z, (d) => d.lostZ[i], { grp: 'ロストの場所（本人）' }))];
      note = '場所はゾーンが入力されたものだけ。'; break;
    case 'foul': cols = [...base, N('foul', 'ファール', (d) => d.foul, { grp: '本人', tot: tm((t) => t.A.foul) }), N('fouled', '受けた<br>ファール', (d) => d.fouled, { grp: '本人', tot: tm((t) => t.B.foul) }),
      N('of', '自チーム', (d) => d.on.foul, { grp: '出場中のファール', tot: tm((t) => t.A.foul) }), N('oof', '相手', (d) => d.on.ofoul, { grp: '出場中のファール', tot: tm((t) => t.B.foul) }), N('ofd', '差', (d) => d.on.foul - d.on.ofoul, { grp: '出場中のファール', tot: tm((t) => t.A.foul - t.B.foul) }),
      N('cy', 'イエロー', (d) => d.cY, { grp: 'カード（本人）', tot: tm((t) => t.A.cards.yellow) }), N('cy2', '2枚目', (d) => d.cY2, { grp: 'カード（本人）', tot: tm((t) => t.A.cards.y2) }), N('cr', 'レッド', (d) => d.cR, { grp: 'カード（本人）', tot: tm((t) => t.A.cards.red) })];
      note = `相手のファール＝自チームの被ファール。相手へのカード：イエロー ${g(tB.cards.yellow)}・2枚目 ${g(tB.cards.y2)}・レッド ${g(tB.cards.red)}。`; break;
    case 'fsp': { const L = ['CK', 'CK-KI', 'KI', 'FK', 'PK', '第2PK'];
      cols = [...base, N('at', '合計', (d) => d.on.at.reduce((a, b) => a + b, 0), { grp: '出場中の AT（自チーム）', tot: tm((t) => t.A.fsp) }), ...FSP_KEYS.map((k, i) => N('at' + k, L[i], (d) => d.on.at[i], { grp: '出場中の AT（自チーム）' })),
        N('df', '合計', (d) => d.on.df.reduce((a, b) => a + b, 0), { grp: '出場中の DF（相手）', tot: tm((t) => t.B.fsp) }), ...FSP_KEYS.map((k, i) => N('df' + k, L[i], (d) => d.on.df[i], { grp: '出場中の DF（相手）' }))];
      note = 'FINISH SET PLAY はその瞬間（交代と同じ秒なら交代後）にピッチにいた選手に数える。'; break; }
    default: cols = base;
  }
  return `${subs}${bar}${table(ctx, cols, { note })}`;
}

// ---------- 操作 ----------
function bindAnalysis(root) {
  const bar = document.querySelector('.bar'); if (bar) document.documentElement.style.setProperty('--barh', bar.offsetHeight + 'px');
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
}
function pickModal() {
  const f = A.f; const acts = S.activities.filter((a) => !a.deleted);
  const o = (list, v) => `<option value="">すべて</option>${list.map(([k, l]) => `<option value="${esc(k)}" ${k === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}`;
  const draw = (md) => {
    const list = filtered(); const set = new Set(A.picked || []);
    md.querySelector('#pkList').innerHTML = list.map((m) => `<label class="pkrow">${A.scope === 'pick' ? `<input type="checkbox" data-pk="${m.id}" ${set.has(m.id) ? 'checked' : ''}>` : ''}<span>${fmtShort(m.date)}</span><b>vs ${esc(m.opponent)}</b><small>${esc(activityById(m.activityId)?.name || '')}${m.category ? '・' + esc(m.category) : ''}</small><em>${esc(matchStatus(m))}</em></label>`).join('') || '<p class="mu">条件に合う試合はありません</p>';
  };
  const md = openModal(`<h2>${A.scope === 'pick' ? '試合を選ぶ' : '試合を絞り込む'}</h2>
    <div class="pkf"><label>活動<select data-f="act">${o(acts.map((a) => [a.id, a.name]), f.act)}</select></label>
      <label>活動の種類<select data-f="type">${o(opts('activityTypes', true).map((x) => [x.name, x.name]), f.type)}</select></label>
      <label>試合の区分<select data-f="cat">${o(opts('matchCategories', true).map((x) => [x.name, x.name]), f.cat)}</select></label>
      <label>期間<span class="pkd"><input type="date" data-f="from" value="${f.from}">〜<input type="date" data-f="to" value="${f.to}"></span></label></div>
    ${A.scope === 'pick' ? '<div class="row"><button class="btn sm" id="pkAll">すべて選ぶ</button><button class="btn sm" id="pkNone">すべて外す</button></div>' : ''}
    <div id="pkList" class="pklist"></div><div class="row end"><button class="btn pri" id="pkOk">これで見る</button></div>`, { wide: true });
  draw(md);
  md.addEventListener('change', (e) => {
    const t = e.target;
    if (t.dataset.f) { A.f[t.dataset.f] = t.value; draw(md); }
    if (t.dataset.pk) { const s = new Set(A.picked || []); t.checked ? s.add(t.dataset.pk) : s.delete(t.dataset.pk); A.picked = [...s]; }
  });
  const all = md.querySelector('#pkAll'); if (all) all.onclick = () => { A.picked = [...new Set([...(A.picked || []), ...filtered().map((m) => m.id)])]; draw(md); };
  const none = md.querySelector('#pkNone'); if (none) none.onclick = () => { const ids = new Set(filtered().map((m) => m.id)); A.picked = (A.picked || []).filter((x) => !ids.has(x)); draw(md); };
  md.querySelector('#pkOk').onclick = () => { keep(); closeModal(); render(); };
}
