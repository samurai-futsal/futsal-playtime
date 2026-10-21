// 試合ごとの評価（10点満点）と、良い点・気になる点のコメント（2026-10-22）
// ルールで記録から計算する（AIが書くのではない）。同じ記録なら、いつも同じ結果。理由（もとの数字）を一緒に出す。
// 6.0＝その試合の平均的な出来。項目ごとに足し引きし、1.0〜10.0 に収める。
import { playerTable, setTable } from './model.js';
import { playerDetail, shotsOf, teamStats, bandsOf, bandIndex, CLS_KEYS } from './teamstats.js';
import { pitchAt, isOGType } from './events.js';

const r1 = (v) => Math.round(v * 10) / 10;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const sg = (v) => `${v > 0 ? '+' : v < 0 ? '−' : '±'}${Math.abs(v).toFixed(1)}`;
const mmss = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const pc = (a, b) => (b ? Math.round(a / b * 100) : 0);
const bl = (l) => `${l.replace('~', '〜')}${/:/.test(l) ? '' : '分'}`; // 時間帯の名前（0〜10分）
export const MIN_PLAYER = 180000; // 3分未満は評価しない
export const MIN_SET = 60000; // セットは1分未満は評価しない

// シュート関与率のチームとの差（ポイント）→ 点。1ポイント＝0.1点、±1.5まで。本数が5本未満は半分
function sharePart(sf, sa, teamShare, label = 'シュート関与率') {
  const n = sf + sa; if (!n) return null;
  const rel = Math.round((sf / n - teamShare) * 100);
  let d = clamp(rel * 0.1, -1.5, 1.5); if (n < 5) d /= 2;
  return { d, t: `${label} ${pc(sf, n)}%（チーム全体 ${Math.round(teamShare * 100)}%、${rel > 0 ? '+' : ''}${rel}）${n < 5 ? '・本数が少ないので半分' : ''}` };
}
function finish(base, parts) {
  const ps = parts.filter((p) => p && Math.abs(p.d) >= 0.05);
  const score = r1(clamp(base + ps.reduce((a, p) => a + p.d, 0), 1, 10));
  return { score, reasons: ps.sort((a, b) => Math.abs(b.d) - Math.abs(a.d)).map((p) => ({ d: r1(p.d), text: p.t, label: sg(r1(p.d)) })) };
}

// 1試合の評価。M＝試合の形（プレーイングタイム）、evs＝イベント、gn＝得点の種類の名前、members＝試合メンバー
export function rateMatch(M, evs, gn, members) {
  const ev = evs.filter((e) => !e.deleted);
  const isGK = (pid) => members?.[pid]?.pos === 'GK';
  const R = teamStats(M, ev, gn);
  const teamShare = R.A.shots + R.B.shots ? R.A.shots / (R.A.shots + R.B.shots) : 0.5;
  const T = playerTable(M);
  const pids = Object.keys(members || {});
  const D = playerDetail(M, ev, gn, pids, T);
  const onAt = (e) => pitchAt(M, e.period, e.at, e.side || 'before');
  const oppSh = shotsOf(ev, gn, false);
  const players = pids.map((pid) => {
    const d = D[pid]; const t = d?.time || 0;
    if (t < MIN_PLAYER) return { pid, time: t, gk: isGK(pid), none: t ? '出場が3分未満' : '出場なし' };
    const parts = [];
    const pmv = d.on.gf - d.on.ga;
    if (isGK(pid)) {
      // GK：セーブ率（枠内の被シュートが3本以上のとき）、失点、得失点±、カード
      let ot = 0, ga = 0; for (const s of oppSh) { if (!onAt(s.e).includes(pid)) continue; if (s.result === 'in') ot++; if (s.goal) ga++; }
      if (ot >= 3) { const sv = (ot - ga) / ot; parts.push({ d: clamp((sv - 0.7) * 5, -1.5, 1.5), t: `セーブ率 ${Math.round(sv * 100)}%（セーブ ${ot - ga} ÷ 被枠内 ${ot}。70%を基準）` }); }
      if (ga) parts.push({ d: clamp(-0.3 * ga, -1.5, 0), t: `失点 ${ga}（OGを除く）` });
      else if (ot) parts.push({ d: 0.3, t: '無失点' });
      if (pmv) parts.push({ d: clamp(pmv * 0.25, -0.5, 0.5), t: `得失点± ${pmv > 0 ? '+' : ''}${pmv}` });
    } else {
      parts.push(sharePart(d.on.shot, d.on.oshot, teamShare));
      if (d.goals) parts.push({ d: Math.min(2, d.goals * 0.8), t: `得点 ${d.goals}` });
      if (d.assists) parts.push({ d: Math.min(1.5, d.assists * 0.5), t: `アシスト ${d.assists}` });
      if (d.in) parts.push({ d: Math.min(0.5, d.in * 0.1), t: `枠内シュート ${d.in}（シュート ${d.shots}）` });
      const ent = d.ent.z4.inv + d.ent.sz.inv; if (ent) parts.push({ d: Math.min(0.5, ent * 0.1), t: `Z4・SZ進入 ${ent}` });
      const rl = d.rec - d.lost; if (rl) parts.push({ d: clamp(rl * 0.1, -0.5, 0.5), t: `リカバリー ${d.rec} − ロスト ${d.lost}` });
      if (pmv) parts.push({ d: clamp(pmv * 0.25, -0.5, 0.5), t: `得失点± ${pmv > 0 ? '+' : ''}${pmv}（得点関与 ${d.on.gf}・失点関与 ${d.on.ga}）` });
    }
    if (d.cY) parts.push({ d: -0.5 * d.cY, t: `イエロー ${d.cY}` });
    if (d.cR) parts.push({ d: -1.5 * d.cR, t: `レッド ${d.cR}` });
    return { pid, time: t, gk: isGK(pid), ...finish(6, parts) };
  });

  // セット（GK1人・FP4人がそろった時間）
  const ownSh = shotsOf(ev, gn, true);
  const sets = setTable(M).filter((st) => st.time >= MIN_SET).map((st) => {
    const inS = (e) => st.spans.some((sp) => sp.period === e.period && sp.from < e.at && e.at <= sp.to);
    const sf = ownSh.filter((s) => inS(s.e)).length, sa = oppSh.filter((s) => inS(s.e)).length;
    const ef = ev.filter((e) => (e.kind === 'z4' || e.kind === 'sz') && inS(e)).length, ea = ev.filter((e) => (e.kind === 'oz4' || e.kind === 'osz') && inS(e)).length;
    const gf = ev.filter((e) => e.kind === 'goal' && inS(e)).length, ga = ev.filter((e) => e.kind === 'conc' && inS(e)).length;
    const parts = [sharePart(sf, sa, teamShare)];
    if (ef || ea) parts.push({ d: clamp((ef - ea) * 0.1, -0.5, 0.5), t: `Z4・SZ進入 ${ef} − 被 ${ea}` });
    if (gf) parts.push({ d: Math.min(1.5, gf * 0.5), t: `得点 ${gf}` });
    if (ga) parts.push({ d: Math.max(-1.5, -ga * 0.5), t: `失点 ${ga}` });
    return { key: st.key, pids: st.pids, time: st.time, count: st.count, sf, sa, ...finish(6, parts) };
  });
  return { players, sets, teamShare };
}

// ---------- 良い点・気になる点（コメント）----------
// keys：数える範囲のピリオド（ハーフタイムなら前半だけ）。null＝試合全体。返り値：{ good:[], bad:[] }（それぞれ強い順に3つまで）
export function matchComments(M, evs, gn, members, keys = null, nameOf = null) {
  const inK = (e) => !keys || keys.includes(e.period);
  const ev = evs.filter((e) => !e.deleted && inK(e));
  const isGK = (pid) => members?.[pid]?.pos === 'GK';
  const own = shotsOf(ev, gn, true), opp = shotsOf(ev, gn, false);
  const good = [], bad = [];
  const add = (arr, w, title, fact, hint) => arr.push({ w, title, fact, hint });
  const share = own.length + opp.length ? own.length / (own.length + opp.length) : null;
  // 1. シュートの数
  if (share != null && own.length + opp.length >= 8) {
    if (share >= 0.55) add(good, 5 + (share - 0.55) * 20, 'シュートで相手を上回った', `シュート ${own.length} − 被シュート ${opp.length}（関与率 ${pc(own.length, own.length + opp.length)}%）`, 'この流れ（ボールを持つ時間・前への圧力）を続ける');
    if (share <= 0.42) add(bad, 5 + (0.42 - share) * 20, 'シュートで相手に上回られている', `シュート ${own.length} − 被シュート ${opp.length}（関与率 ${pc(own.length, own.length + opp.length)}%）`, '相手の攻撃の起点（どこから運ばれているか）を確認し、守備の位置を見直す');
  }
  // 2. シュートの質（SZ内・枠内）
  if (own.length >= 8) {
    const sz = own.filter((s) => s.sz === true).length, inn = own.filter((s) => s.result === 'in').length;
    if (sz / own.length >= 0.4) add(good, 3 + sz / own.length * 3, 'ゴールに近い位置から打てている', `シュート ${own.length}本のうちSZ内 ${sz}本（${pc(sz, own.length)}%）`, 'SZまで運ぶ形を続ける');
    if (sz / own.length < 0.2) add(bad, 3 + (0.2 - sz / own.length) * 10, '遠い位置からのシュートが多い', `シュート ${own.length}本のうちSZ内は ${sz}本（${pc(sz, own.length)}%）`, 'もう一つ運んで、SZ内でのシュートを増やす');
    if (inn / own.length <= 0.25) add(bad, 2.5, '枠内に飛ばせていない', `枠内 ${inn} / シュート ${own.length}（${pc(inn, own.length)}%）`, '打つ前の準備（体の向き・コース）を確認');
    if (inn / own.length >= 0.45) add(good, 2.5, '枠内シュートが多い', `枠内 ${inn} / シュート ${own.length}（${pc(inn, own.length)}%）`, 'このシュートの質を続ける');
  }
  // 3. 時間帯
  const BD = bandsOf(M); const used = BD.filter((b) => !keys || keys.includes(b.period));
  if (used.length >= 2) {
    const cnt = (arr) => used.map((b) => arr.filter((s) => BD[bandIndex(BD, M, s.e.period, s.e.at)] === b).length);
    const co = cnt(opp), cw = cnt(own);
    const mi = co.indexOf(Math.max(...co)); const rest = (co.reduce((a, b) => a + b, 0) - co[mi]) / (co.length - 1);
    if (co[mi] >= 4 && co[mi] >= rest * 1.6) add(bad, 3 + (co[mi] - rest) / 2, `${bl(used[mi].label)}の時間帯に被シュートが集中`, `この時間帯の被シュート ${co[mi]}本（ほかの時間帯は平均 ${rest.toFixed(1)}本）`, 'その時間帯に入る前の交代・守備の確認を早めに');
    const wi = cw.indexOf(Math.max(...cw)); const wr = (cw.reduce((a, b) => a + b, 0) - cw[wi]) / (cw.length - 1);
    if (cw[wi] >= 4 && cw[wi] >= wr * 1.6) add(good, 2 + (cw[wi] - wr) / 2, `${bl(used[wi].label)}の時間帯に攻撃が活発`, `この時間帯のシュート ${cw[wi]}本（ほかの時間帯は平均 ${wr.toFixed(1)}本）`, 'そのときの流れ（セット・やり方）を思い出して生かす');
  }
  // 4. 出てからの時間（FP4人の平均）：0〜60秒と120秒以降の関与率
  {
    const B = [{ t: 0, f: 0, a: 0 }, { t: 0, f: 0, a: 0 }];
    const elAt = (period, at) => { const ss = M.stints.filter((x) => x.period === period && !isGK(x.pid) && x.from < at && at <= x.to); return ss.length === 4 ? ss.reduce((a, x) => a + at - x.from, 0) / 4 : null; };
    const bi = (el) => (el < 60000 ? 0 : el >= 120000 ? 1 : -1);
    for (const p of M.periods) { if (p.status === 'none' || (keys && !keys.includes(p.key))) continue; for (let at = 1000; at <= p.elapsed; at += 1000) { const el = elAt(p.key, at); if (el == null) continue; const i = bi(el); if (i >= 0) B[i].t += 1000; } }
    for (const [arr, k] of [[own, 'f'], [opp, 'a']]) for (const s of arr) { const el = elAt(s.e.period, s.e.at); if (el == null) continue; const i = bi(el); if (i >= 0) B[i][k]++; }
    const s0 = B[0].f + B[0].a ? B[0].f / (B[0].f + B[0].a) : null, s2 = B[1].f + B[1].a ? B[1].f / (B[1].f + B[1].a) : null;
    if (s0 != null && s2 != null && B[1].t >= 180000 && B[1].f + B[1].a >= 4 && s0 - s2 >= 0.15)
      add(bad, 4 + (s0 - s2) * 10, '出てから2分を過ぎると押し込まれている', `関与率：出てから1分以内 ${Math.round(s0 * 100)}% → 2分以降 ${Math.round(s2 * 100)}%（2分以降の時間 ${mmss(B[1].t)}）`, '交代を早めに（90秒前後を目安に）');
  }
  // 5. セット
  {
    const ownS = own, oppS = opp;
    const sets = setTable(M).filter((st) => st.spans.some((sp) => !keys || keys.includes(sp.period)) && st.time >= 120000).map((st) => {
      const inS = (e) => st.spans.some((sp) => sp.period === e.period && sp.from < e.at && e.at <= sp.to);
      return { st, f: ownS.filter((s) => inS(s.e)).length, a: oppS.filter((s) => inS(s.e)).length };
    }).filter((x) => x.f + x.a >= 4);
    const nm = (st) => st.pids.map((p) => (nameOf ? nameOf(p) : members?.[p]?.no ?? '')).join('・');
    const by = (x) => x.f / (x.f + x.a);
    sets.sort((a, b) => by(b) - by(a));
    if (sets.length && by(sets[0]) >= 0.6) add(good, 3 + by(sets[0]) * 3, `セット（${nm(sets[0].st)}）が良い`, `シュート ${sets[0].f} − 被 ${sets[0].a}（関与率 ${pc(sets[0].f, sets[0].f + sets[0].a)}%、${mmss(sets[0].st.time)}）`, 'このセットの時間を増やす');
    const w = sets[sets.length - 1];
    if (sets.length >= 2 && by(w) <= 0.35) add(bad, 3 + (0.35 - by(w)) * 10, `セット（${nm(w.st)}）が苦しい`, `シュート ${w.f} − 被 ${w.a}（関与率 ${pc(w.f, w.f + w.a)}%、${mmss(w.st.time)}）`, '組み合わせを変えるか、このセットの時間を短く');
  }
  // 6. 進入からシュート
  {
    const ent = ev.filter((e) => e.kind === 'z4' || e.kind === 'sz').length;
    if (ent >= 8 && own.length / ent < 0.5) add(bad, 3, '進入してもシュートまで行けていない', `Z4・SZ進入 ${ent}回に対しシュート ${own.length}本`, '進入したあとの仕掛け（数的優位・最後のパス）を確認');
    if (ent >= 8 && own.length / ent >= 0.9) add(good, 2.5, '進入からシュートにつなげている', `Z4・SZ進入 ${ent}回でシュート ${own.length}本`, 'この形を続ける');
  }
  // 7. 相手のセットプレー・局面
  {
    const setOpp = opp.filter((s) => s.cls === 'set').length;
    if (opp.length >= 6 && setOpp / opp.length >= 0.35) add(bad, 3 + setOpp / opp.length * 3, '相手のセットプレーから多く打たれている', `被シュート ${opp.length}本のうちセットプレー ${setOpp}本（${pc(setOpp, opp.length)}%）`, 'セットプレーの守備（マーク・立ち位置）を確認');
    const tr = opp.filter((s) => s.cls === 'trans').length;
    if (opp.length >= 6 && tr / opp.length >= 0.35) add(bad, 3 + tr / opp.length * 3, '相手のトランジション（切り替え）から多く打たれている', `被シュート ${opp.length}本のうちトランジション ${tr}本（${pc(tr, opp.length)}%）`, '失ったあとの切り替えと、攻撃中の後ろの備えを確認');
    const setOwn = own.filter((s) => s.cls === 'set').length;
    if (own.length >= 6 && setOwn / own.length >= 0.35) add(good, 2.5, 'セットプレーからシュートを作れている', `シュート ${own.length}本のうちセットプレー ${setOwn}本`, 'セットプレーの形を続ける');
    const goalsC = opp.filter((s) => s.goal); const cl = {}; goalsC.forEach((s) => { const k = s.cls || 'none'; cl[k] = (cl[k] || 0) + 1; });
    const L = { pos: '定位置', set: 'セットプレー', trans: 'トランジション', gk: 'GK活用', special: '特殊局面' };
    for (const [k, n] of Object.entries(cl)) if (n >= 2 && L[k]) add(bad, 4 + n, `失点が「${L[k]}」に集中`, `失点 ${goalsC.length}のうち ${L[k]} ${n}`, `${L[k]}の守備を確認`);
  }
  // 8. ロストの場所、リカバリーとロスト
  {
    const lost = ev.filter((e) => e.kind === 'lost'), rec = ev.filter((e) => e.kind === 'rec');
    const lz = lost.filter((e) => e.zone === 'Z1' || e.zone === 'Z2').length, withZ = lost.filter((e) => e.zone).length;
    if (withZ >= 4 && lz / withZ >= 0.5) add(bad, 3 + lz / withZ * 2, '自陣でのロストが多い', `ゾーンが入ったロスト ${withZ}のうち自陣（Z1・Z2） ${lz}`, 'ビルドアップの立ち位置・逃げ道を確認');
    if (rec.length + lost.length >= 8) {
      const dlt = rec.length - lost.length;
      if (dlt >= 5) add(good, 2 + dlt / 3, 'ボールを奪う回数が多い', `リカバリー ${rec.length} − ロスト ${lost.length}`, '奪いに行く守備を続ける');
      if (dlt <= -5) add(bad, 2 + -dlt / 3, 'ボールを失う回数が多い', `リカバリー ${rec.length} − ロスト ${lost.length}`, 'ボールを持ったときの判断・サポートを確認');
    }
  }
  // 9. ファール（ピリオドごと。5つ目から第2PK）
  for (const p of M.periods) {
    if (keys && !keys.includes(p.key)) continue;
    const f = ev.filter((e) => e.kind === 'foul' && e.period === p.key).length;
    if (f >= 5) add(bad, 5, `${p.label}にファールが ${f}つ`, `${p.label}の自チームのファール ${f}（5つ目から相手に第2PK）`, '不用意なファールを減らす（特に終盤）');
    else if (f === 4) add(bad, 3, `${p.label}にファールが4つ`, `${p.label}の自チームのファール 4（あと1つで第2PKの状況）`, '同じピリオドの残りはファールに注意');
  }
  // 10. 自チームの5×4（パワープレー）で失点
  {
    const ppOwn = (M.pp || []).filter((x) => x.team === 'own' && (!keys || keys.includes(x.period)));
    const inPP = (e) => ppOwn.some((x) => x.period === e.period && x.from <= e.at && e.at <= (x.to ?? Infinity));
    const ga = ev.filter((e) => e.kind === 'conc' && inPP(e)).length, gf = ev.filter((e) => e.kind === 'goal' && inPP(e)).length;
    if (ga) add(bad, 4 + ga, '自チームの5×4で失点（PP返し）', `5×4の間の得点 ${gf}・失点 ${ga}`, '5×4のボールの失い方・GKへの戻りを確認');
    else if (gf) add(good, 3 + gf, '5×4で得点', `5×4の間の得点 ${gf}`, 'この5×4の形を続ける');
  }
  void isOGType; void CLS_KEYS;
  const top = (arr) => arr.sort((a, b) => b.w - a.w).slice(0, 3);
  return { good: top(good), bad: top(bad), n: { own: own.length, opp: opp.length } };
}
