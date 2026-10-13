// Match model for the review / analysis screens (spec 7章・8章).
// Built from the MATCH PLAY replay. Every number on the review is computed from this, so the
// review, analysis and reports always agree (spec 7章「どちらも同じ記録から同じ計算」).
import { PERIODS, periodLen, nowElapsed } from './engine.js';

const isGK = (cfg, pid) => cfg.members?.[pid]?.pos === 'GK';
export const SET_MIN = 3000; // ms
const R = (ms) => Math.round(ms / 1000) * 1000;

// Periods shown in the match: 前半・後半, plus 延長 when the match has (or used) extra time.
function shownPeriods(st) {
  const cfg = st.cfg;
  return PERIODS.filter((p) => !p.extra || cfg.times?.extra || st.extraDecided === true || st.periods[p.key].status !== 'none');
}

export function matchModel(st, now = Date.now()) {
  const cfg = st.cfg;
  const live = st.periods[st.current]?.status === 'live';
  const at = live ? nowElapsed(st, now) : null;
  const periods = shownPeriods(st).map((p) => {
    const ps = st.periods[p.key];
    const elapsed = R(live && p.key === st.current ? at : ps.status === 'none' ? 0 : ps.elapsed);
    return { key: p.key, label: p.label, extra: p.extra, len: periodLen(cfg, p.key), status: ps.status, elapsed };
  });
  // close the ongoing appearances at "now" (出場中の選手は、今の時点までの時間を反映する)
  // 表示はすべて秒単位。区切りの時刻を秒に丸めてから計算するので、帯・表・合計の数字が必ず一致する
  const stints = st.stints
    .map((s) => ({ ...s, from: R(s.from), to: R(s.to ?? (live && s.period === st.current ? at : s.from)) }))
    .filter((s) => s.to > s.from && periods.some((p) => p.key === s.period));
  const empties = st.empties.map((e) => ({ ...e, from: R(e.from), to: R(e.to ?? (live && e.period === st.current ? at : e.from)) }));
  return { cfg, periods, stints, empties, pp: st.pp, timeouts: st.timeouts, ejections: st.ejections, current: st.current, live, matchOver: st.matchOver, askExtra: st.askExtra };
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
