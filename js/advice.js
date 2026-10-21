// 良い点・気になる点のコメント（2026-10-22）。マッチレビューとマッチスタッツの「コメントを出す」ボタンから。
// 決めたルールで記録の事実から出す（AIが書くのではない）。同じ記録なら、いつも同じ結果。もとの数字と「次への一言」を一緒に出す。
// （選手・セットの10点評価は、見た人に偏った見方が生まれるおそれがあるので入れないことにした。2026-10-22）
import { setTable, modelOf } from './model.js';
import { shotsOf, bandsOf, bandIndex } from './teamstats.js';
import { S, watchOps, watchEvents, opts, teamSettings, playerById } from './store.js';
import { esc, openModal, closeModal } from './ui.js';

const mmss = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const pc = (a, b) => (b ? Math.round(a / b * 100) : 0);
const bl = (l) => `${l.replace('~', '〜')}${/:/.test(l) ? '' : '分'}`; // 時間帯の名前（0〜10分）
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
    if (share >= 0.55) add(good, 5 + (share - 0.55) * 20, 'シュートで相手を上回った', `シュート ${own.length} − 被シュート ${opp.length}`, 'この流れ（ボールを持つ時間・前への圧力）を続ける');
    if (share <= 0.42) add(bad, 5 + (0.42 - share) * 20, 'シュートで相手に上回られている', `シュート ${own.length} − 被シュート ${opp.length}`, '相手の攻撃の起点（どこから運ばれているか）を確認し、守備の位置を見直す');
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
      add(bad, 4 + (s0 - s2) * 10, '出てから2分を過ぎると押し込まれている', `出てから1分以内：シュート ${B[0].f} − 被 ${B[0].a}（${mmss(B[0].t)}）／2分以降：シュート ${B[1].f} − 被 ${B[1].a}（${mmss(B[1].t)}）`, '交代を早めに（90秒前後を目安に）');
  }
  // 5. セット
  {
    const ownS = own, oppS = opp;
    // 範囲（前半だけなど）の中の時間だけで数える
    const sets = setTable(M).map((st0) => { const spans = st0.spans.filter((sp) => !keys || keys.includes(sp.period)); return { ...st0, spans, time: spans.reduce((t, sp) => t + sp.to - sp.from, 0) }; })
      .filter((st) => st.time >= 120000).map((st) => {
        const inS = (e) => st.spans.some((sp) => sp.period === e.period && sp.from < e.at && e.at <= sp.to);
        return { st, f: ownS.filter((s) => inS(s.e)).length, a: oppS.filter((s) => inS(s.e)).length };
      }).filter((x) => x.f + x.a >= 4);
    const nm = (st) => st.pids.map((p) => (nameOf ? nameOf(p) : members?.[p]?.no ?? '')).join('・');
    const by = (x) => x.f / (x.f + x.a);
    sets.sort((a, b) => by(b) - by(a));
    if (sets.length && by(sets[0]) >= 0.6) add(good, 3 + by(sets[0]) * 3, `セット（${nm(sets[0].st)}）が良い`, `シュート ${sets[0].f} − 被 ${sets[0].a}（${mmss(sets[0].st.time)}）`, 'このセットの時間を増やす');
    const w = sets[sets.length - 1];
    if (sets.length >= 2 && by(w) <= 0.35) add(bad, 3 + (0.35 - by(w)) * 10, `セット（${nm(w.st)}）が苦しい`, `シュート ${w.f} − 被 ${w.a}（${mmss(w.st.time)}）`, '組み合わせを変えるか、このセットの時間を短く');
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
  const top = (arr) => arr.sort((a, b) => b.w - a.w).slice(0, 3);
  return { good: top(good), bad: top(bad), n: { own: own.length, opp: opp.length } };
}

// ---------- 画面：コメントを出す ----------
// 範囲：試合全体（その時点まで）／前半／後半。試合中（ハーフタイムなど）は、その時点までの記録で出す
let scope = 'all';
export function openComments(m) {
  scope = 'all';
  const draw = () => {
    const opsC = watchOps(m.id), evC = watchEvents(m.id);
    if (!opsC.ready && !opsC.list.length) return '<h2>良い点・気になる点</h2><p class="mu">記録を読み込んでいます。少し待ってから「最新の記録で出し直す」を押してください。</p>';
    const cfg = { times: m.times || {}, members: m.members || {}, timesFixed: !!m.timesFixed, setplayAuto: teamSettings().setplayAuto || 60 };
    const { M } = modelOf(opsC.list, cfg, m.fix);
    const gn = (id) => opts('goalTypes', true).find((o) => o.id === id)?.name || '';
    const played = M.periods.filter((p) => p.status !== 'none');
    const keys = scope === 'all' ? null : [scope];
    const c = matchComments(M, evC.list, gn, m.members || {}, keys, (pid) => playerById(pid)?.last || '');
    const now = new Date(); const at = `${now.getHours()}:${String(now.getMinutes()).padStart(2, '0')}`;
    const where = m.status === 'done' ? '試合終了' : played.length ? `${played[played.length - 1].label}${played[played.length - 1].status === 'done' ? '終了' : 'の途中'}` : '試合前';
    const seg = played.length > 1 ? `<div class="seg cmseg">${[['all', '試合全体'], ...played.map((p) => [p.key, p.label])].map(([k, l]) => `<a class="${scope === k ? 'on' : ''}" data-cs="${k}">${l}</a>`).join('')}</div>` : '';
    const card = (x, g) => `<li class="cm ${g ? 'g' : 'b'}"><b>${g ? '◎' : '△'} ${esc(x.title)}</b><span class="cmf">${esc(x.fact)}</span><span class="cmh">→ ${esc(x.hint)}</span></li>`;
    const none = '<li class="mu">この範囲では、目立った傾向はありません</li>';
    return `<h2>良い点・気になる点 <small class="mu">vs ${esc(m.opponent || '')}</small></h2>
      <p class="mu">${where}・${at} の記録から、決めたルールで事実を拾っています（シュート ${c.n.own} − 被シュート ${c.n.opp}）。記録が増えたら「最新の記録で出し直す」を押してください。</p>${seg}
      <div class="cmw"><div><h3 class="cmg">良い点</h3><ul>${c.good.map((x) => card(x, true)).join('') || none}</ul></div>
      <div><h3 class="cmb">気になる点</h3><ul>${c.bad.map((x) => card(x, false)).join('') || none}</ul></div></div>
      ${c.n.own + c.n.opp < 6 ? '<p class="mu">まだ記録が少ないので、傾向ははっきりしません。</p>' : ''}
      <div class="mfoot"><button class="btn" data-c>閉じる</button><button class="btn pri" data-r>最新の記録で出し直す</button></div>`;
  };
  const md = openModal(draw(), { wide: true });
  const bind = () => {
    const box = md.querySelector('.modal');
    box.querySelector('[data-c]').onclick = closeModal;
    box.querySelector('[data-r]').onclick = () => { box.innerHTML = draw(); bind(); };
    box.querySelectorAll('[data-cs]').forEach((a) => { a.onclick = () => { scope = a.dataset.cs; box.innerHTML = draw(); bind(); }; });
  };
  bind();
}
