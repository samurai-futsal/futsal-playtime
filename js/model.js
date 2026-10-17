// Match model for the review / analysis screens (spec 7章・8章).
// Built from the MATCH PLAY replay. Every number on the review is computed from this, so the
// review, analysis and reports always agree (spec 7章「どちらも同じ記録から同じ計算」).
import { PERIODS, perLen, nowElapsed, effectiveOps } from './engine.js';

const isGK = (cfg, pid) => cfg.members?.[pid]?.pos === 'GK';
export const SET_MIN = 3000; // ms
const R = (ms) => Math.round(ms / 1000) * 1000;

// Periods shown in the match: 前半・後半, plus 延長 when the match has (or used) extra time.
function shownPeriods(st) {
  const cfg = st.cfg;
  return PERIODS.filter((p) => !p.extra || cfg.times?.extra || st.extraDecided === true || st.periods[p.key].status !== 'none');
}

export function matchModel(st, now = Date.now(), fix = null) {
  const cfg = st.cfg;
  const live = st.periods[st.current]?.status === 'live';
  const at = live ? nowElapsed(st, now) : null;
  const periods = shownPeriods(st).map((p) => {
    const ps = st.periods[p.key];
    const elapsed = R(live && p.key === st.current ? at : ps.status === 'none' ? 0 : ps.elapsed);
    return { key: p.key, label: p.label, extra: p.extra, len: perLen(st, p.key), status: ps.status, elapsed };
  });
  // close the ongoing appearances at "now" (出場中の選手は、今の時点までの時間を反映する)
  // 表示はすべて秒単位。区切りの時刻を秒に丸めてから計算するので、帯・表・合計の数字が必ず一致する
  const stints = st.stints
    .map((s) => ({ ...s, open: s.to == null, from: R(s.from), to: R(s.to ?? (live && s.period === st.current ? at : s.from)) }))
    .filter((s) => s.to > s.from && periods.some((p) => p.key === s.period));
  // 時計が止まっている間だけの出場（プレーイングタイムで0:00）。時間・回数には入れず、タイムラインに印で出す
  const zero = st.stints
    .filter((s) => s.to != null && R(s.to) === R(s.from) && periods.some((p) => p.key === s.period))
    .map((s) => ({ ...s, from: R(s.from), to: R(s.to) }));
  const empties = st.empties.map((e) => ({ ...e, from: R(e.from), to: R(e.to ?? (live && e.period === st.current ? at : e.from)) }));
  const M = { cfg, periods, stints, zero, empties, pp: st.pp, timeouts: st.timeouts, ejections: st.ejections, current: st.current, live, matchOver: st.matchOver, askExtra: st.askExtra, fixed: [] };
  // 相手の5x4を記録したか（時計を戻して長さが0になった時間帯も、記録したものとして数える）
  M.oppPPRecorded = [...st.pp, ...(st.ppDropped || [])].some((x) => x.team === 'opp');
  // 記録の修正（spec 8章）で保存したピリオドは、MATCH PLAYの記録の代わりに修正後の記録を使う
  for (const p of periods) {
    const fp = fix?.periods?.[p.key];
    if (!fp || p.status !== 'done') continue;
    // 修正したあとでMATCH PLAYの記録が変わった（リセット・やり直しなど）ピリオドは、修正を使わずに知らせる
    if (st.sig && fp.basis != null && !basisOk(st.sig, p.key, fp.basis)) { M.stale = (M.stale || []).concat(p.key); continue; }
    (M.fixP || (M.fixP = {}))[p.key] = fp;
    const d = fixData(fp, p.key);
    p.elapsed = R(fp.elapsed);
    M.stints = M.stints.filter((x) => x.period !== p.key).concat(d.stints);
    M.zero = M.zero.filter((x) => x.period !== p.key).concat(d.zero);
    M.empties = M.empties.filter((x) => x.period !== p.key).concat(d.empties);
    M.pp = M.pp.filter((x) => x.period !== p.key).concat(d.pp);
    M.ejections = M.ejections.filter((x) => x.period !== p.key).concat(d.ejections);
    M.fixed.push(p.key);
  }
  return M;
}

// ---------- ランニングタイム表示（spec 7章） ----------
// 同じ記録を「実際に流れた時間」で数え直す。ピリオドの始まり＝キックオフ、終わり＝時計が0:00になった時刻（最後に止まった時刻）。
// 交代の時刻＝OUTを押した時刻（プレーイングタイムと同じ決め方）。時計が止まっている間もピッチにいた選手の時間に入る。
// 記録の修正を使うピリオドは、修正前と同じ区切りなら実際の時刻を、変わった区切りは時計の動きから時刻を求める。
// 記録の修正を使うピリオドのランニングタイム。場所ごとに、修正の区切りを元の記録の区切りと対応させる：
// 区切りの数が同じなら順番で対応させ、元の実際の時刻を、時計で動かした分だけずらす（例：5秒早めた交代は5秒早く）。
// 数が違う（交代を足した・消した）ときは、同じ時計の時刻の区切りを使い、なければ時計の動きから時刻を求める。
function runningFixed(st, key, fp, c) {
  const stints = [], empties = [];
  const walk = seatWalk(fp);
  // 1回目：元の記録と対応する区切りの実際の時刻を決める。
  //  元の時刻を時計で動かした分だけずらし、それが時計の記録と合えばその時刻（OUTを押すのが遅れた・早かった）。
  //  合わなければ、交代は押した実際の時刻のまま正しいとみなし、時計の記録の方を直す（2026-10-16 決定）。
  const plan = walk.map(({ seat, segs }) => {
    const fb = segs.slice(1).map((g) => g.from);
    const bounds = (withSq) => [...st.stints, ...(withSq ? st.squeezed || [] : []), ...st.empties]
      .filter((x) => x.period === key && x.seat === seat && x.wf != null)
      .sort((a, b) => a.wf - b.wf || a.from - b.from).slice(1).map((x) => ({ c: R(x.from), w: x.wf }));
    // 時計を戻して消えた出場も含めて数が合えばそれを、合わなければ含めずに対応させる
    let ob = bounds(true); if (ob.length !== fb.length) ob = bounds(false);
    const used = new Set();
    const W = fb.map((cl, i) => {
      if (ob.length === fb.length) {
        const w1 = ob[i].w + (cl - ob[i].c);
        if (cl === ob[i].c || Math.abs(c.elOf(w1) - cl) <= 1000) return { w: w1, cl, anchor: true };
        return { w: ob[i].w, w1, cl, anchor: true, kept: true };
      }
      const j = ob.findIndex((o, oi) => !used.has(oi) && o.c === cl);
      if (j >= 0) { used.add(j); return { w: ob[j].w, cl, anchor: true }; }
      return { w: null, cl }; // 足した交代：押した時刻がないので、時計の記録から求める
    });
    return { seat, segs, W };
  });
  const anchorsOf = () => plan.flatMap((x) => x.W.filter((b) => b.anchor && b.w != null && b.w >= c.K && b.w <= c.E));
  let clock = correctClock(c.runs, anchorsOf(), c.K, c.E, fp.elapsed);
  // 時計を直しても合わない（実際の時間より長く時計が動くことになる）ときは、今までどおり交代の実際の時刻の方をずらす
  if (clock.errors.length) {
    for (const x of plan) for (const b of x.W) if (b.kept) { b.w = b.w1; b.kept = false; }
    clock = correctClock(c.runs, anchorsOf(), c.K, c.E, fp.elapsed);
  }
  const wallOf = clock.changed ? (el) => wallOfRuns(clock.runs, el, c.K, c.E) : c.wallOf;
  // 2回目：足した交代の時刻を（直した）時計から求め、場所ごとに帯を作る
  for (const { seat, segs, W } of plan) {
    const ws = [];
    W.forEach((b, i) => ws.push(Math.min(c.E, Math.max(c.K, i ? ws[i - 1] : c.K, b.w ?? wallOf(b.cl)))));
    segs.forEach((g, i) => {
      const wf = i ? ws[i - 1] : c.K, wt = i < ws.length ? ws[i] : c.E;
      const x = { period: key, seat, from: c.rel(wf), to: c.rel(wt) };
      if (g.pid) stints.push({ ...x, pid: g.pid });
      else if (g.startEv) empties.push({ ...x, pid: g.ejected });
    });
  }
  return { stints, empties, clock, wallOf };
}

// ---------- 時計の記録（時計が動いていた区間）----------
// runs：[{t0, t1}]（実際の時刻）。el＝その時刻までに時計が動いた合計
function elOfRuns(runs, w) { let el = 0; for (const r of runs) { if (w <= r.t0) break; el += Math.min(w, r.t1) - r.t0; } return el; }
function wallOfRuns(runs, el, K, E) {
  let acc = 0;
  for (const r of runs) { const d = r.t1 - r.t0; if (el <= acc + d && (el > acc || (el === acc && acc === 0))) return r.t0 + (el - acc); acc += d; }
  return el <= 0 ? K : E;
}
// 交代の区切り（実際の時刻・その時の時計）に合うように時計の記録を直す。
// 2つの区切りの間で時計が動いた合計を、区切りの時計の差に合わせる：多ければ後ろから削り、少なければ止まっていた間（一番長いところの真ん中）に足す。
// 区切りの間に交代はないので、足す・削る位置で誰の時間も変わらない。実際の時間より長く時計が動くことになる区切りは直さずに知らせる。
export function correctClock(runs0, anchors, K, E, len) {
  const runs = runs0.map((r) => ({ t0: r.t0, t1: r.t1 ?? E })).filter((r) => r.t1 > r.t0);
  const pts = [{ w: K, cl: 0 }, ...anchors.map((a) => ({ w: a.w, cl: a.cl })).sort((a, b) => a.w - b.w || a.cl - b.cl), { w: E, cl: len }];
  const out = [], errors = [];
  let changed = false;
  for (let i = 0; i + 1 < pts.length; i++) {
    const A = pts[i], B = pts[i + 1];
    let segs = runs.map((r) => ({ t0: Math.max(r.t0, A.w), t1: Math.min(r.t1, B.w) })).filter((r) => r.t1 > r.t0);
    const have = segs.reduce((s, r) => s + r.t1 - r.t0, 0), need = B.cl - A.cl;
    const diff = need - have;
    if (Math.abs(diff) > 1000) {
      if (need < 0 || need > B.w - A.w + 500) errors.push({ w0: A.w, w1: B.w, need, room: B.w - A.w });
      else {
        changed = true;
        if (diff < 0) { // 多い分を後ろから削る
          let cut = -diff;
          for (let j = segs.length - 1; j >= 0 && cut > 0; j--) { const d = segs[j].t1 - segs[j].t0; const c = Math.min(d, cut); segs[j] = { t0: segs[j].t0, t1: segs[j].t1 - c }; cut -= c; }
          segs = segs.filter((r) => r.t1 > r.t0);
        } else { // 足りない分を、止まっていた間の長いところの真ん中に足す
          let add = diff;
          const gaps = []; let x = A.w;
          for (const r of segs) { if (r.t0 > x) gaps.push({ t0: x, t1: r.t0 }); x = Math.max(x, r.t1); }
          if (B.w > x) gaps.push({ t0: x, t1: B.w });
          gaps.sort((a, b) => (b.t1 - b.t0) - (a.t1 - a.t0));
          for (const g of gaps) { if (add <= 0) break; const d = Math.min(add, g.t1 - g.t0); const m = g.t0 + (g.t1 - g.t0 - d) / 2; segs.push({ t0: Math.round(m), t1: Math.round(m) + d }); add -= d; }
          segs.sort((a, b) => a.t0 - b.t0);
        }
      }
    }
    out.push(...segs);
  }
  // つながっている区間はまとめる
  const merged = [];
  for (const r of out.sort((a, b) => a.t0 - b.t0)) { const l = merged[merged.length - 1]; if (l && r.t0 <= l.t1) l.t1 = Math.max(l.t1, r.t1); else merged.push({ ...r }); }
  // 何を直したか（実際の時刻と、その時の時計）
  const diffList = (a, b) => { // a にあって b にない区間
    const res = [];
    for (const r of a) { let parts = [{ ...r }]; for (const q of b) parts = parts.flatMap((p) => (q.t1 <= p.t0 || q.t0 >= p.t1 ? [p] : [{ t0: p.t0, t1: q.t0 }, { t0: q.t1, t1: p.t1 }].filter((z) => z.t1 - z.t0 >= 500))); res.push(...parts); }
    return res;
  };
  const added = changed ? diffList(merged, runs).map((r) => ({ ...r, el0: elOfRuns(merged, r.t0), el1: elOfRuns(merged, r.t1) })) : [];
  const removed = changed ? diffList(runs, merged).map((r) => ({ ...r, el0: elOfRuns(runs, r.t0), el1: elOfRuns(runs, r.t1) })) : [];
  return { runs: changed ? merged : runs, changed: changed && (added.length + removed.length > 0), added, removed, errors };
}

export function toRunning(M, st, now = Date.now()) {
  const out = { ...M, running: true, periods: [], stints: [], zero: [], empties: [], pp: [], ejections: [], timeouts: [], clock: {} };
  const conv = {};
  for (const p of M.periods) {
    const ps = st.periods[p.key];
    if (p.status === 'none' || ps.kickT == null) { out.periods.push({ ...p }); continue; }
    const len = perLen(st, p.key);
    const runs = ps.runs || [];
    const lastR = runs[runs.length - 1];
    let E;
    if (p.status === 'done') E = ps.endT;
    else if (ps.runningSince != null) E = Math.min(now, ps.runningSince + Math.max(0, len - ps.elapsed));
    else if (ps.elapsed < len) E = now; // 時計が止まっている間も、実際の時間は進む
    else E = lastR?.t1 ?? now;
    const K = ps.kickT, run = Math.max(0, E - K);
    // 時計の時間（プレーイングタイム）→ 実際の時刻。止まった瞬間と動き出した瞬間が同じ時計の時間なら、止まった時刻を使う
    const wallOf = (el) => {
      let hit = null;
      for (const r of runs) { const e1 = r.el1 ?? (r.el0 + Math.max(0, E - r.t0)); if (r.el0 < el && el <= e1) hit = r.t0 + (el - r.el0); }
      if (hit == null) for (const r of runs) if (r.el0 === el) { hit = r.t0; break; }
      if (hit == null) hit = el <= 0 ? K : E;
      return hit;
    };
    const fixed = M.fixed.includes(p.key);
    const rel = (w) => R(Math.max(0, Math.min(run, w - K)));
    const cruns = runs.map((r) => ({ t0: r.t0, t1: r.t1 ?? E }));
    const elOf = (w) => elOfRuns(cruns, w);
    conv[p.key] = { rel, wallOf, elOf, runs: cruns, fixed, E, K };
    out.periods.push({ ...p, elapsed: R(run), len: p.status === 'done' ? R(run) : Math.max(R(run), len), playing: p.elapsed });
  }
  const C = (k) => conv[k];
  const span = (x, wf, wt) => { const c = C(x.period); if (!c) return null; return { ...x, from: c.rel(wf), to: c.rel(wt) }; };
  // 修正していないピリオドは、MATCH PLAYの記録そのもの（時計が止まっている間だけの出場も含む）から数える
  const endOf = (x, c, w) => (w != null ? w : st.periods[x.period].status !== 'done' && !c.fixed ? c.E : c.wallOf(x.to));
  const own = (list) => list.filter((x) => C(x.period) && !C(x.period).fixed);
  for (const s of own([...st.stints, ...(st.squeezed || [])])) {
    const c = C(s.period);
    const r = span(s, s.wf, endOf(s, c, s.wt));
    if (r && r.to > r.from) out.stints.push({ ...r, open: s.wt == null && st.periods[s.period].status !== 'done' });
  }
  for (const e of own(st.empties)) {
    const c = C(e.period);
    const r = span(e, e.wf, endOf(e, c, e.wt));
    if (r && r.to > r.from) out.empties.push(r);
  }
  // 記録の修正を使うピリオド：場所（5つのキュー）ごとに、区切りの実際の時刻を元の記録から引き継ぐ
  for (const [k, c] of Object.entries(conv)) {
    if (!c.fixed || !M.fixP?.[k]) continue;
    const { stints, empties, clock, wallOf } = runningFixed(st, k, M.fixP[k], c);
    out.stints.push(...stints.filter((x) => x.to > x.from)); out.empties.push(...empties.filter((x) => x.to > x.from));
    c.wallOf = wallOf; out.clock[k] = clock; // 交代の修正に合わせて直した時計の記録（パワープレー・退場・タイムアウトの時刻もこれで求める）
  }
  const src = (list, ownList) => [...own(ownList), ...list.filter((x) => C(x.period)?.fixed)];
  for (const x of src(M.pp, st.pp)) {
    const c = C(x.period);
    const r = c.fixed ? span(x, c.wallOf(x.from), c.wallOf(x.to)) : span(x, x.wf ?? c.wallOf(x.from), endOf(x, c, x.wt));
    if (r && r.to > r.from) out.pp.push(r);
  }
  for (const x of M.ejections) { const c = C(x.period); if (c) out.ejections.push({ ...x, at: c.rel(!c.fixed && x.t != null ? x.t : c.wallOf(x.at)) }); }
  for (const x of M.timeouts || []) { const c = C(x.period); if (c) out.timeouts.push({ ...x, at: c.rel(x.t ?? c.wallOf(x.at)) }); }
  // イベント（得点・失点など）の時刻（時計の経過）→ キックオフからの実際の時間
  out.relOf = (k, at) => { const c = C(k); return c ? c.rel(c.wallOf(at)) : at; };
  // 逆向き：キックオフからの実際の時間（ms）→ 試合の時計の経過。時計が止まっている間は止まった時計の値（Sportscode の取り込みで使う）
  out.elOfRel = (k, rel) => {
    const c = C(k); if (!c) return rel; const w = c.K + rel;
    if (out.clock[k]?.runs) return elOfRuns(out.clock[k].runs, w);
    let el = 0;
    for (const r of st.periods[k].runs || []) {
      const t1 = r.t1 ?? c.E; const e1 = r.el1 ?? (r.el0 + Math.max(0, t1 - r.t0));
      if (w < r.t0) break;
      el = w >= t1 ? e1 : r.el0 + (w - r.t0);
    }
    return el;
  };
  return out;
}

// playing time actually played so far (出場率の分母)
export function playedTime(M) {
  return M.periods.reduce((s, p) => s + (p.status === 'none' ? 0 : p.elapsed), 0);
}

// 1. 出場時間：選手ごと・ピリオドごとの時間と回数
export function playerTable(M) {
  const rows = {};
  for (const pid of Object.keys(M.cfg.members || {})) rows[pid] = { pid, per: {}, total: 0, count: 0 };
  for (const s of M.stints) {
    const r = rows[s.pid] || (rows[s.pid] = { pid: s.pid, per: {}, total: 0, count: 0 });
    const p = r.per[s.period] || (r.per[s.period] = { time: 0, count: 0 });
    p.time += s.to - s.from; p.count += 1; r.total += s.to - s.from; r.count += 1;
  }
  return rows;
}

// 3. セットの出場時間：GKが1人・FPが4人そろっている区間だけ（特殊局面と空席の区間は除く）
export function setTable(M) {
  const cfg = M.cfg; const sets = new Map();
  for (const p of M.periods) {
    const ss = M.stints.filter((s) => s.period === p.key);
    const cuts = [...new Set(ss.flatMap((s) => [s.from, s.to]))].sort((a, b) => a - b);
    let prevKey = null;
    for (let i = 0; i + 1 < cuts.length; i++) {
      const a = cuts[i], b = cuts[i + 1];
      if (b - a < SET_MIN) continue; // 交代の瞬間にできる3秒未満の組み合わせは数えない（前後が同じセットなら1回のまま）
      const on = ss.filter((s) => s.from <= a && s.to >= b).map((s) => s.pid);
      const gks = on.filter((pid) => isGK(cfg, pid)); const fps = on.filter((pid) => !isGK(cfg, pid));
      const key = gks.length === 1 && fps.length === 4 ? fps.slice().sort().join('|') : null;
      if (key) {
        const r = sets.get(key) || { key, pids: fps.slice().sort(), time: 0, count: 0, spans: [] };
        r.time += b - a; if (key !== prevKey) r.count += 1;
        r.spans.push({ period: p.key, from: a, to: b });
        sets.set(key, r);
      }
      prevKey = key;
    }
  }
  return [...sets.values()].sort((x, y) => y.time - x.time);
}

// total of all players' time must equal 5 × playing time − empty-seat time (spec 10章)
export function checkTotal(M) {
  const players = M.stints.reduce((s, x) => s + (x.to - x.from), 0);
  const empty = M.empties.reduce((s, x) => s + Math.max(0, (x.to ?? x.from) - x.from), 0);
  return { players, expected: 5 * playedTime(M) - empty };
}

// ---------- 記録の修正（spec 8章）：ピリオドごとの「場所（5つのキュー）」の記録 ----------
// fp = { elapsed, lineup:[pid×5], ev:[{id, kind:'sub'|'eject'|'fill', seat, at, in?, pid?, reason?}], pp:[{id,team,from,to}], startEmpty?:{seat: pid} }
// startEmpty：前のピリオドの退場で、空席のまま始まった場所（その場所のスタメンは null。決6）
// 交代は「その場所に入った選手」だけを持つ。OUTした選手は、その直前にその場所にいた選手（並びから決まる）。
let idn = 0;
const nid = () => 'e' + Date.now().toString(36) + (idn++).toString(36);

export function replayToFix(st, key) {
  const p = st.periods[key];
  const fp = { elapsed: R(p.elapsed), lineup: [null, null, null, null, null], ev: [], pp: [] };
  for (let seat = 0; seat < 5; seat++) {
    const items = [
      ...st.stints.filter((x) => x.period === key && x.seat === seat).map((x) => ({ k: 's', pid: x.pid, rf: x.from, rt: x.to ?? p.elapsed, wf: x.wf })),
      ...st.empties.filter((x) => x.period === key && x.seat === seat).map((x) => ({ k: 'e', pid: x.pid, rf: x.from, rt: x.to ?? p.elapsed, wf: x.wf })),
    ].sort((a, b) => a.rf - b.rf || (a.wf ?? 0) - (b.wf ?? 0) || a.rt - b.rt || (a.k === b.k ? 0 : a.k === 'e' ? 1 : -1)) // 並べるのは秒に丸める前の時刻、同じなら記録した順
      .map((x) => ({ ...x, from: R(x.rf), to: R(x.rt) }));
    let prev = null;
    for (const it of items) {
      if (!prev) { if (it.k === 's') fp.lineup[seat] = it.pid; else (fp.startEmpty || (fp.startEmpty = {}))[seat] = it.pid; }
      else if (it.k === 's' && prev.k === 's') fp.ev.push({ id: nid(), kind: 'sub', seat, at: it.from, in: it.pid });
      else if (it.k === 'e') fp.ev.push({ id: nid(), kind: 'eject', seat, at: it.from, reason: st.ejections.find((x) => x.period === key && x.pid === it.pid)?.reason || null });
      else if (it.k === 's' && prev.k === 'e') fp.ev.push({ id: nid(), kind: 'fill', seat, at: it.from, in: it.pid });
      prev = it;
    }
  }
  fp.pp = st.pp.filter((x) => x.period === key).map((x) => ({ id: nid(), team: x.team, from: R(x.from), to: R(x.to ?? p.elapsed) })).filter((x) => x.to > x.from);
  fp.ev.sort((a, b) => a.at - b.at || a.seat - b.seat);
  return fp;
}

// 場所ごとに並べ直したもの：[{seat, segs:[{pid|null(空席), from, to, startEv, endEv}]}]
export function seatWalk(fp) {
  const out = [];
  for (let seat = 0; seat < 5; seat++) {
    const evs = fp.ev.filter((e) => e.seat === seat).sort((a, b) => a.at - b.at); // 同じ時刻は記録の順のまま（並べ替えは安定）
    const ce = !fp.lineup[seat] && fp.startEmpty?.[seat]; // 空席のまま始まった場所
    const segs = []; let cur = ce ? { pid: null, from: 0, startEv: 'carry', ejected: ce } : { pid: fp.lineup[seat] || null, from: 0, startEv: null };
    for (const e of evs) {
      segs.push({ ...cur, to: e.at, endEv: e.id });
      if (e.kind === 'eject') cur = { pid: null, from: e.at, startEv: e.id, ejected: segs[segs.length - 1].pid };
      else cur = { pid: e.in, from: e.at, startEv: e.id };
    }
    segs.push({ ...cur, to: fp.elapsed, endEv: null });
    out.push({ seat, segs });
  }
  return out;
}

export function fixData(fp, key) {
  const stints = [], empties = [], ejections = [], zero = [];
  for (const { seat, segs } of seatWalk(fp)) {
    for (const g of segs) {
      if (g.to <= g.from && g.pid) { if (g.to === g.from && g.startEv) zero.push({ period: key, pid: g.pid, seat, from: g.from, to: g.to }); continue; }
      if (g.pid) stints.push({ period: key, pid: g.pid, seat, from: g.from, to: g.to });
      else if (g.startEv) empties.push({ period: key, seat, pid: g.ejected, from: g.from, to: g.to });
    }
  }
  for (const e of fp.ev.filter((x) => x.kind === 'eject')) {
    const w = seatWalk(fp)[e.seat].segs.find((g) => g.endEv === e.id);
    ejections.push({ period: key, pid: w?.pid, at: e.at, reason: e.reason || null });
  }
  return { stints, empties, ejections, zero, pp: (fp.pp || []).map((x) => ({ period: key, team: x.team, from: x.from, to: x.to })) };
}

// 矛盾のチェック（保存できない問題）
// banned：前のピリオドで退場した選手（このピリオドには出られない）
export function checkFix(fp, cfg, label = '', banned = new Set()) {
  const errs = [];
  const fmt = (ms) => { const r = Math.max(0, Math.round((fp.elapsed - ms) / 1000)); return `${Math.floor(r / 60)}:${String(r % 60).padStart(2, '0')}`; };
  const name = (pid) => `${cfg.members?.[pid]?.no ?? '?'}番`;
  fp.lineup.forEach((pid, i) => { if (!pid && !fp.startEmpty?.[i]) errs.push(`${label}スタメンの${i + 1}つ目の場所が空いています`); });
  for (const e of fp.ev) if (e.at < 0 || e.at > fp.elapsed) errs.push(`${label}${fmt(e.at)} の記録がピリオドの外にあります`);
  const W = seatWalk(fp);
  for (const { segs } of W) for (const g of segs) if (g.to < g.from) errs.push(`${label}時刻の順番が逆になっている交代があります（残り${fmt(g.from)}）`);
  // 同じ選手が同じ時間に2か所にいないか
  const all = W.flatMap((w) => w.segs.filter((g) => g.pid && g.to > g.from).map((g) => ({ ...g, seat: w.seat })));
  const seen = new Set();
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
    const a = all[i], b = all[j];
    if (a.pid === b.pid && a.from < b.to && b.from < a.to) {
      const k = a.pid + Math.max(a.from, b.from);
      if (!seen.has(k)) { seen.add(k); errs.push(`${label}${name(a.pid)} が残り${fmt(Math.max(a.from, b.from))}に2つの場所に入っています`); }
    }
  }
  // ピッチに出られるGKは1人まで
  for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) {
    const a = all[i], b = all[j];
    if (a.pid !== b.pid && isGK(cfg, a.pid) && isGK(cfg, b.pid) && a.from < b.to && b.from < a.to) {
      const k = 'gk' + Math.max(a.from, b.from);
      if (!seen.has(k)) { seen.add(k); errs.push(`${label}GKが2人出ています（${name(a.pid)}と${name(b.pid)}、残り${fmt(Math.max(a.from, b.from))}〜${fmt(Math.min(a.to, b.to))}）`); }
    }
  }
  // 退場した選手は、そのあと出られない
  for (const e of fp.ev.filter((x) => x.kind === 'eject')) {
    const who = W[e.seat].segs.find((g) => g.endEv === e.id)?.pid;
    if (who && all.some((g) => g.pid === who && g.from > e.at)) errs.push(`${label}${name(who)} が残り${fmt(e.at)}に退場したあとに出場しています`);
  }
  for (const pid of new Set(all.filter((g) => banned.has(g.pid)).map((g) => g.pid))) errs.push(`${label}${name(pid)} は前のピリオドで退場しているため出場できません`);
  for (const x of fp.pp || []) if (!(x.to > x.from)) errs.push(`${label}5×4の時間帯の終わりが始まりより前です`);
  return errs;
}
export const newEvId = nid;

// 候補の選手が、ある場所の区間（startEv から始まる区間。null ならスタメン）に出られるか。
// f2 はその選手を入れたあとの記録。出られれば null、出られなければ理由の文を返す。
export function whyNot(f2, cfg, pid, seat, startEv, banned = new Set()) {
  const W = seatWalk(f2);
  const seg = startEv ? W[seat].segs.find((g) => g.startEv === startEv) : W[seat].segs[0];
  if (!seg || !pid) return null;
  const fmt = (ms) => { const r = Math.max(0, Math.round(((f2.len || f2.elapsed) - ms) / 1000)); return `${Math.floor(r / 60)}:${String(r % 60).padStart(2, '0')}`; };
  const name = (x) => `${cfg.members?.[x]?.no ?? '?'}番`;
  if (banned.has(pid)) return '前のピリオドで退場しています';
  const ej = f2.ev.filter((e) => e.kind === 'eject' && e.at <= seg.from && W[e.seat].segs.find((g) => g.endEv === e.id)?.pid === pid).sort((a, b) => a.at - b.at)[0];
  if (ej && seg.to > seg.from) return `残り${fmt(ej.at)}に退場しています`;
  if (!(seg.to > seg.from)) return null;
  const segs = W[seat].segs, si = segs.indexOf(seg);
  if (segs[si + 1]?.pid === pid) return 'この場所の次の交代で入る選手です';
  if (si > 0 && segs[si - 1].pid === pid) return 'この場所の前の交代で出た選手です';
  const others = W.flatMap((w) => w.segs.filter((g) => g.pid && g.to > g.from && !(w.seat === seat && g.from === seg.from)).map((g) => ({ ...g, seat: w.seat })));
  const same = others.find((g) => g.pid === pid && g.from < seg.to && seg.from < g.to);
  if (same) return `残り${fmt(same.from)}〜${fmt(same.to)}に場所${same.seat + 1}で出場しています`;
  if (isGK(cfg, pid)) {
    const gk = others.find((g) => g.pid !== pid && isGK(cfg, g.pid) && g.from < seg.to && seg.from < g.to);
    if (gk) return `GK（${name(gk.pid)}）が出ています（残り${fmt(Math.max(gk.from, seg.from))}〜${fmt(Math.min(gk.to, seg.to))}）`;
  }
  return null;
}

// MATCH PLAYの記録の「形」：ピリオドごとの有効な操作の数と最後の操作。修正はこれが同じときだけ使う
// ピリオドの記録の「しるし」。修正（記録の修正）は、保存したときのしるしと今のしるしが同じときだけ使う。
// 延長戦の質問の答え（extra）とピリオドの選択（select）は、そのピリオドの出場の記録ではないので数えない。
// alt＝0.5.8までの数え方（それで保存した修正も、そのまま使えるようにする）
const NOT_PERIOD = new Set(['extra', 'select']);
export function periodSig(ops) {
  const { list } = effectiveOps(ops); const sig = {}; const alt = {};
  for (const p of PERIODS) {
    const all = list.filter((o) => o.period === p.key); const l = all.filter((o) => !NOT_PERIOD.has(o.type));
    sig[p.key] = l.length ? `${l.length}:${l[l.length - 1].id}` : '0';
    alt[p.key] = all.length ? `${all.length}:${all[all.length - 1].id}` : '0';
  }
  Object.defineProperty(sig, 'alt', { value: alt, enumerable: false });
  return sig;
}
export const basisOk = (sig, key, basis) => basis === sig[key] || (sig.alt != null && basis === sig.alt[key]);

// ---------- タイムラインの並び（セットが分かる並び） ----------
// GK（先発のGK → 初めて入った順 → 出ていないGKは背番号順）、そのあとFPを
// 先発（背番号順）→ 初めてピッチに入った順（同じ時刻なら背番号の小さい順）→ 出ていない選手（背番号順）。
// 後半の先発で初めて出た選手は、後半の初めに入ったものとして数える。
export function entryOrder(M) {
  const cfg = M.cfg; const members = Object.keys(cfg.members || {});
  const noOf = (pid) => parseInt(cfg.members?.[pid]?.no, 10) || 999;
  const off = {}; let acc = 0; for (const p of M.periods) { off[p.key] = acc; acc += p.len; }
  const first = {};
  for (const s of [...M.stints, ...(M.zero || [])]) {
    if (off[s.period] == null) continue;
    const t = off[s.period] + s.from;
    if (first[s.pid] == null || t < first[s.pid]) first[s.pid] = t;
  }
  const by = (a, b) => (first[a] ?? Infinity) - (first[b] ?? Infinity) || noOf(a) - noOf(b);
  const gk = members.filter((p) => isGK(cfg, p)).sort(by);
  const fp = members.filter((p) => !isGK(cfg, p)).sort(by);
  return [...gk, ...fp];
}
