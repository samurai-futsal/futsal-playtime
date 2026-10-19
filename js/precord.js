// 選手の記録（2026-10-19）：選手ページ（・活動の招集メンバー・試合のメンバー）から開く、1人の選手のページ。
// ① 見出しと絞り込み ② 通算のまとめ ④ 試合ごとの記録 ⑤ 招集歴（③グラフ・⑥一緒にプレーした選手・⑦傾向は次の回）
import { S, playerById, activityById } from './store.js';
import { matchCalcs, pieSvg, PIEC } from './analysis.js';
import { pitchAt, isOGType } from './events.js';
import { shotsOf, CLS_KEYS } from './teamstats.js';
import { setTable } from './model.js';
import { esc, fmtDate, fmtShort } from './ui.js';
import { render } from './views.js';

const mmss = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const sg = (v) => `${v > 0 ? '+' : ''}${v}`;
const pct = (a, b) => (b ? Math.round(a / b * 100) + '%' : '—');
// 対象の絞り込み（2026-10-19）：活動と、その中の試合をチェックで選ぶ。外したものだけ覚える（新しい試合は初めから入る）
// X[pid] = { a: [外した活動], m: [外した試合] }
let X = {};
try { X = JSON.parse(localStorage.getItem('fpt.precordX') || '{}') || {}; } catch {}
const keepX = () => { try { localStorage.setItem('fpt.precordX', JSON.stringify(X)); } catch {} };
const exOf = (pid) => { const e = X[pid] || {}; return { a: new Set(e.a || []), m: new Set(e.m || []) }; };
const setEx = (pid, ex) => { X[pid] = { a: [...ex.a], m: [...ex.m] }; keepX(); };
let pickOpen = false;

// 1試合ぶんの、その選手の数字
function oneRow(x, pid) {
  const d = x.D[pid]; const M = x.M;
  const first = M.periods.find((p) => p.status !== 'none')?.key;
  const mine = M.stints.filter((s) => s.pid === pid);
  const start = mine.some((s) => s.period === first && s.from === 0);
  // 休憩：同じピリオドの中で、下がってから次に出るまで（ハーフタイムは入れない）
  const rests = [];
  for (const p of M.periods) { const ss = mine.filter((s) => s.period === p.key).sort((a, b) => a.from - b.from); for (let i = 1; i < ss.length; i++) rests.push(ss[i].from - ss[i - 1].to); }
  const own = x.R.rangeScore.own, opp = x.R.rangeScore.opp;
  const pk = x.m.pk; const res = own > opp ? '勝' : own < opp ? '負' : pk && pk.own != null && pk.opp != null && pk.own !== pk.opp ? (pk.own > pk.opp ? 'PK勝' : 'PK負') : '分';
  // GK：ピッチにいる間の相手のシュート（2026-10-19）。枠内＝結果が枠内（失点を含む）、セーブ＝枠内−失点（OGは別）
  const g = { f: 0, sz: 0, ot: 0, ga: 0, og: 0, cls: [0, 0, 0, 0, 0, 0, 0], gcls: [0, 0, 0, 0, 0, 0, 0] };
  if (d && playerById(pid)?.pos === 'GK') {
    const evs = x.evs.filter((e) => !e.deleted);
    const on = (e) => pitchAt(M, e.period, e.at, e.side || 'before').includes(pid);
    for (const sh of shotsOf(evs, x.gn, false)) { if (!on(sh.e)) continue; g.f++; if (sh.sz === true) g.sz++; if (sh.result === 'in') g.ot++; const i = CLS_KEYS.indexOf(sh.cls); g.cls[i >= 0 ? i : 6]++; if (sh.goal) { g.ga++; g.gcls[i >= 0 ? i : 6]++; } }
    g.og = evs.filter((e) => e.kind === 'conc' && isOGType(e.gtype, x.gn) && on(e)).length;
  }
  return { x, m: x.m, d, len: x.len, start, rests, own, opp, res, pk, g };
}

export function vPlayerRecord(r) {
  const pid = r.id; const p = playerById(pid);
  if (!p) return { active: 'players', html: '<div class="card empty">選手が見つかりません。<div class="mt"><a class="btn" href="#/players">‹ 選手</a></div></div>' };
  const gk = p.pos === 'GK';
  const ex = exOf(pid);
  const byDate = (a, b) => (a.date || '').localeCompare(b.date || '') || (a.kickoff || '').localeCompare(b.kickoff || '');
  const allActs = S.activities.filter((a) => !a.deleted && a.members?.[pid]).sort((a, b) => (b.start || '').localeCompare(a.start || ''));
  const allMs = S.matches.filter((m) => !m.deleted && m.members?.[pid] && m.status === 'done').sort(byDate);
  const msOf = (aid) => allMs.filter((m) => m.activityId === aid);
  const acts = allActs.filter((a) => !ex.a.has(a.id));
  const ms = allMs.filter((m) => !ex.a.has(m.activityId) && !ex.m.has(m.id));
  const live = S.matches.filter((m) => !m.deleted && m.members?.[pid] && m.status === 'playing').length;
  const { list, loading } = matchCalcs(ms);
  const rows = list.map((x) => oneRow(x, pid)).filter((r0) => r0.d);
  const played = rows.filter((r0) => r0.d.time > 0);

  // ---------- ① 見出しと対象（活動と試合をチェック） ----------
  const allOn = acts.length === allActs.length && ms.length === allMs.length;
  const actRow = (a) => {
    const mm = msOf(a.id); const on = !ex.a.has(a.id); const nOn = on ? mm.filter((m) => !ex.m.has(m.id)).length : 0;
    const part = on && mm.length && nOn < mm.length;
    return `<div class="pkact"><label class="pka"><input type="checkbox" data-pa="${a.id}" ${on ? 'checked' : ''} ${part ? 'data-part="1"' : ''}><b>${esc(a.name || '')}</b><small>${fmtDate(a.start, false)}${a.end && a.end !== a.start ? `〜${fmtShort(a.end)}` : ''}${a.type ? '・' + esc(a.type) : ''}</small><em>${mm.length ? `${nOn} / ${mm.length}試合` : '試合なし'}</em></label>
      ${mm.length ? `<div class="pkms">${mm.map((m) => `<label class="pkm ${on ? '' : 'off'}"><input type="checkbox" data-pm="${m.id}" ${on && !ex.m.has(m.id) ? 'checked' : ''} ${on ? '' : 'disabled'}>${fmtShort(m.date)} vs ${esc(m.opponent || '')}${m.category ? `<small>${esc(m.category)}</small>` : ''}</label>`).join('')}</div>` : ''}</div>`;
  };
  const head = `<div class="crumb"><a class="btn sm mpback" href="#/players">‹ 選手</a></div>
    <div class="prhead"><h1>${esc(`${p.last || ''} ${p.first || ''}`.trim())}<small>${esc(p.kana || '')}</small></h1><span class="pos ${gk ? 'gk' : 'fp'}">${gk ? 'GK' : 'FP'}</span>${p.status === 'former' ? '<span class="prformer">過去所属</span>' : ''}</div>
    <details class="prpick" ${pickOpen ? 'open' : ''}><summary><span class="prpt">対象</span><b>${allOn ? 'すべての活動・試合' : `${acts.length}活動・${ms.length}試合を選択中`}</b><small>（招集 ${allActs.length}活動・終わった試合 ${allMs.length}試合のうち）</small><span class="prpbtn">活動と試合を選ぶ</span></summary>
      <div class="prpbody"><div class="row"><button class="btn sm" id="prAll">すべて選ぶ</button><button class="btn sm" id="prNone">すべて外す</button></div>
      ${allActs.length ? allActs.map(actRow).join('') : '<p class="mu">招集された活動はありません</p>'}</div></details>`;

  // ---------- ② 通算のまとめ（大事なものほど大きく。2026-10-19） ----------
  const sum = (f) => rows.reduce((a, r0) => a + f(r0), 0);
  const T = sum((r0) => r0.d.time), N = sum((r0) => r0.d.count), L = sum((r0) => r0.len);
  const rests = rows.flatMap((r0) => r0.rests);
  const D = (f) => sum((r0) => f(r0.d));
  const shots = D((d) => d.shots), inn = D((d) => d.in);
  const rate = L ? T / L : 0;
  // 出場：大きく出場時間と出場率（棒）、下に小さく回数など
  const heroTime = `<div class="prhero"><div class="prh1"><em>出場時間</em><b>${mmss(T)}</b><small>${played.length ? `1試合平均 ${mmss(T / played.length)}` : '出場なし'}</small></div>
    <div class="prh1"><em>出場率</em><b>${L ? Math.round(rate * 100) + '<i>%</i>' : '—'}</b><span class="prbar"><i style="width:${Math.round(rate * 100)}%"></i></span><small>メンバーに入った試合の時間に対して</small></div>
    <ul class="prmini"><li><em>招集</em><b>${acts.length}</b>活動</li><li><em>試合メンバー</em><b>${rows.length}</b>試合<small>（先発 ${rows.filter((r0) => r0.start).length}）</small></li><li><em>出場</em><b>${played.length}</b>試合</li>
      <li><em>1回の出場</em><b>${N ? mmss(T / N) : '—'}</b><small>（${N}回）</small></li><li><em>休憩</em><b>${rests.length ? mmss(rests.reduce((a, b) => a + b, 0) / rests.length) : '—'}</b><small>（同じピリオド内）</small></li></ul></div>`;
  // 結果：得点・アシスト（GKは失点関与・被シュート関与）
  const big = (l, v, sub = '', c = '') => `<div class="prbig ${c}"><em>${l}</em><b>${v}</b>${sub ? `<small>${sub}</small>` : ''}</div>`;
  const res = gk ? [big('失点関与', D((d) => d.on.ga), `${played.length ? (D((d) => d.on.ga) / Math.max(1, T / 2400000)).toFixed(1) + '／40分' : ''}`, 'o'), big('被シュート関与', D((d) => d.on.oshot), '', 'o')]
    : [big('得点', D((d) => d.goals), '', D((d) => d.goals) ? 'g' : ''), big('アシスト', D((d) => d.assists), '', D((d) => d.assists) ? 'g' : '')];
  // 評価の指標：差（プラスは緑・マイナスは赤、真ん中から左右に伸びる棒）
  const difs = [['シュート関与の差', D((d) => d.on.shot - d.on.oshot), `関与 ${D((d) => d.on.shot)} − 被 ${D((d) => d.on.oshot)}`],
    ['進入関与の差', D((d) => d.on.z4 + d.on.sz - d.on.oz4 - d.on.osz), `関与 ${D((d) => d.on.z4 + d.on.sz)} − 被 ${D((d) => d.on.oz4 + d.on.osz)}`],
    ['得失点±', D((d) => d.on.gf - d.on.ga), `得点関与 ${D((d) => d.on.gf)} − 失点関与 ${D((d) => d.on.ga)}`],
    ['リカバリー−ロスト', D((d) => d.rec - d.lost), `リカバリー ${D((d) => d.rec)} − ロスト ${D((d) => d.lost)}`]];
  const dm = Math.max(1, ...difs.map((x) => Math.abs(x[1])));
  const difH = `<div class="prdif"><h3>評価の指標<small>差＝自チーム − 相手（リカバリー−ロストは本人）</small></h3>${difs.map(([l, v, sub]) => `<div class="prdr"><em>${l}</em><span class="prdb"><i class="${v >= 0 ? 'p' : 'm'}" style="width:${Math.round(Math.abs(v) / dm * 50)}%"></i></span><b class="${v > 0 ? 'p' : v < 0 ? 'm' : ''}">${sg(v)}</b><small>${sub}</small></div>`).join('')}</div>`;
  // 本人のプレー：小さな一覧
  const plays = [['シュート', `${shots}`, `枠内 ${inn}（${pct(inn, shots)}）・SZ内 ${D((d) => d.sz)}`], ['Z4進入', D((d) => d.ent.z4.inv), ''], ['SZ進入', D((d) => d.ent.sz.inv), ''],
    ['リカバリー', D((d) => d.rec), ''], ['ロスト', D((d) => d.lost), ''], ['ファール', D((d) => d.foul), ''], ['カード', `${D((d) => d.cY)}・${D((d) => d.cR)}`, 'イエロー・レッド'], ...(gk ? [['得点・アシスト', `${D((d) => d.goals)}・${D((d) => d.assists)}`, '']] : [])];
  const playH = `<div class="prply"><h3>本人のプレー</h3><table>${plays.map(([l, v, sub]) => `<tr><th>${l}</th><td><b>${v}</b>${sub ? `<small>${sub}</small>` : ''}</td></tr>`).join('')}</table></div>`;
  const sumH = `<h2 class="h">通算のまとめ<small>${rows.length}試合${loading ? '（読み込み中…）' : ''}</small></h2>
    ${heroTime}<div class="prgrid"><div class="prres2">${res.join('')}</div>${difH}${playH}</div>`;

  // ---------- ④ 試合ごとの記録 ----------
  const resC = (r0) => (/勝/.test(r0.res) ? 'w' : /負/.test(r0.res) ? 'l' : 'd');
  const z = (v) => (v ? v : '<span class="z">0</span>');
  const trs = rows.slice().reverse().map((r0) => { const d = r0.d; const a = activityById(r0.m.activityId);
    return `<tr data-go="#/m/${r0.m.id}/review" class="${d.time ? '' : 'zero'}"><td class="pd">${fmtDate(r0.m.date, false)}</td><td class="po">vs ${esc(r0.m.opponent || '')}<small>${esc(a?.name || '')}${r0.m.category ? '・' + esc(r0.m.category) : ''}</small></td>
      <td><span class="prres ${resC(r0)}">${r0.res}</span> ${r0.own}−${r0.opp}${r0.pk && r0.res.startsWith('PK') ? `<small>（PK ${r0.pk.own}−${r0.pk.opp}）</small>` : ''}</td><td>${r0.start ? '◯' : ''}</td>
      <td><b>${d.time ? mmss(d.time) : '<span class="z">0:00</span>'}</b></td><td>${d.time ? pct(d.time, r0.len) : '—'}</td><td>${z(d.count)}</td>
      ${gk ? `<td>${z(r0.g.f)}</td><td>${z(r0.g.ot)}</td><td>${z(r0.g.ot - r0.g.ga)}</td><td><b>${r0.g.ot ? pct(r0.g.ot - r0.g.ga, r0.g.ot) : '—'}</b></td><td>${z(r0.g.ga)}</td>` : `<td>${z(d.goals)}</td><td>${z(d.assists)}</td><td>${z(d.shots)}<small>（${d.in}）</small></td><td>${z(d.ent.z4.inv)}</td><td>${z(d.ent.sz.inv)}</td>`}
      <td class="df">${d.time ? sg(d.on.shot - d.on.oshot) : '—'}</td><td class="df">${d.time ? sg(d.on.gf - d.on.ga) : '—'}</td><td class="gt">›</td></tr>`; }).join('');
  const th = `<tr><th>日付</th><th>相手</th><th>結果</th><th>先発</th><th>出場時間</th><th>出場率</th><th>回数</th>${gk ? '<th>被シュート</th><th>被枠内</th><th>セーブ</th><th>セーブ率</th><th>失点</th>' : '<th>得点</th><th>アシスト</th><th>シュート<br><small>（枠内）</small></th><th>Z4進入</th><th>SZ進入</th>'}<th class="df">シュート<br>関与の差</th><th class="df">得失点±</th><th></th></tr>`;
  const matchH = `<h2 class="h">試合ごとの記録<small>新しい順。行を押すとその試合のマッチレビュー</small></h2>
    ${rows.length ? `<div class="card prtbw"><table class="prtb">${th}${trs}</table></div>` : '<div class="card empty">対象の試合はありません</div>'}
    ${live ? `<p class="mu">試合中の ${live}試合は、試合が終わると入ります</p>` : ''}`;

  // ---------- ⑤ 招集歴 ----------
  const byAct = new Map(); for (const r0 of rows) { const k = r0.m.activityId; const c = byAct.get(k) || { n: 0, p: 0, t: 0 }; c.n++; if (r0.d.time) c.p++; c.t += r0.d.time; byAct.set(k, c); }
  const actH = `<h2 class="h">招集歴<small>${acts.length}回</small></h2>${acts.length ? `<div class="card prtbw"><table class="prtb"><tr><th>期間</th><th>活動</th><th>種類</th><th>背番号</th><th>試合メンバー</th><th>出場</th><th>出場時間</th><th></th></tr>
    ${acts.map((a) => { const c = byAct.get(a.id) || { n: 0, p: 0, t: 0 }; const all = S.matches.filter((m) => !m.deleted && m.activityId === a.id && m.status === 'done').length;
      return `<tr data-go="#/a/${a.id}"><td class="pd">${fmtDate(a.start, false)}${a.end && a.end !== a.start ? `〜${fmtShort(a.end)}` : ''}</td><td class="po">${esc(a.name || '')}</td><td>${esc(a.type || '')}</td><td>${esc(a.members[pid]?.no ?? '—')}</td>
        <td>${c.n} / ${all}<small>試合</small></td><td>${c.p}<small>試合</small></td><td>${c.t ? mmss(c.t) : '<span class="z">0:00</span>'}</td><td class="gt">›</td></tr>`; }).join('')}</table></div>
    <p class="mu">試合メンバー＝メンバーに入った試合 / その活動の試合（終わった試合で数えます）</p>` : '<div class="card empty">招集された活動はありません</div>'}`;

  // ---------- ③ 出場時間の移り変わり（試合ごとの棒。得点・アシストの印）----------
  const gW = Math.max(640, rows.length * 56), gH = 220, pl = 46, pb = 54, pt = 30;
  const maxT = Math.max(60000, ...rows.map((r0) => r0.d.time)); const top = Math.ceil(maxT / 300000) * 300000;
  const bw = Math.min(80, (gW - pl - 10) / Math.max(1, rows.length)); // 試合が少ないときは棒を太くしすぎない
  let sv = `<svg class="prgraph" viewBox="0 0 ${gW} ${gH}" width="${gW}" height="${gH}">`;
  for (let t = 0; t <= top; t += 300000) { const y = pt + (gH - pt - pb) * (1 - t / top); sv += `<line x1="${pl}" x2="${gW - 6}" y1="${y}" y2="${y}" stroke="#E6EAF1"/><text x="${pl - 6}" y="${y + 4}" text-anchor="end" font-size="11" fill="#6B7486">${t / 60000}:00</text>`; }
  rows.forEach((r0, i) => {
    const d = r0.d; const x = pl + i * bw + bw * 0.18, w = bw * 0.64; const h = (gH - pt - pb) * (d.time / top); const y = gH - pb - h;
    const c = r0.start ? '#1F5FBF' : '#7FA6E0';
    sv += `<g><title>${fmtShort(r0.m.date)} vs ${esc(r0.m.opponent || '')}　${mmss(d.time)}（${pct(d.time, r0.len)}）${r0.start ? '・先発' : ''}</title><rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${w.toFixed(1)}" height="${Math.max(0, h).toFixed(1)}" rx="3" fill="${c}"/>`;
    if (d.time) sv += `<text x="${(x + w / 2).toFixed(1)}" y="${(y - 4).toFixed(1)}" text-anchor="middle" font-size="11" font-weight="700" fill="#0B2D6B">${mmss(d.time)}</text>`;
    const mk = [...Array(d.goals).fill('G'), ...Array(d.assists).fill('A')];
    mk.forEach((k, j) => { const cy = y - 20 - j * 15; sv += `<circle cx="${(x + w / 2).toFixed(1)}" cy="${cy.toFixed(1)}" r="7" fill="${k === 'G' ? '#1F9E5B' : '#E0832B'}"/><text x="${(x + w / 2).toFixed(1)}" y="${(cy + 4).toFixed(1)}" text-anchor="middle" font-size="9" font-weight="800" fill="#fff">${k}</text>`; });
    sv += `<text x="${(x + w / 2).toFixed(1)}" y="${gH - pb + 16}" text-anchor="middle" font-size="11" fill="#3A4558">${fmtShort(r0.m.date)}</text><text x="${(x + w / 2).toFixed(1)}" y="${gH - pb + 31}" text-anchor="middle" font-size="10" fill="#6B7486">${esc((r0.m.opponent || '').slice(0, 6))}</text></g>`;
  });
  sv += '</svg>';
  const graphH = rows.length ? `<h2 class="h">出場時間の移り変わり<small>古い順。濃い青＝先発。G＝得点、A＝アシスト</small></h2><div class="card prgw">${sv}</div>` : '';

  // ---------- ⑥ 一緒にプレーした選手・セット ----------
  const pair = new Map(); // 相手の選手 → { t, sf, sa, gf, ga }
  const P = (o) => pair.get(o) || (pair.set(o, { t: 0, sf: 0, sa: 0, gf: 0, ga: 0 }), pair.get(o));
  const sets = new Map();
  for (const r0 of rows) {
    const x = r0.x; const M = x.M;
    const mine = M.stints.filter((q) => q.pid === pid);
    for (const q of M.stints) { if (q.pid === pid) continue; for (const a of mine) { if (a.period !== q.period) continue; const ov = Math.min(a.to, q.to) - Math.max(a.from, q.from); if (ov > 0) P(q.pid).t += ov; } }
    const evs = x.evs.filter((e) => !e.deleted);
    const on = (e, side) => pitchAt(M, e.period, e.at, e.side || side);
    for (const sh of shotsOf(evs, x.gn, true)) { const o = on(sh.e, 'before'); if (o.includes(pid)) o.forEach((q) => q !== pid && P(q).sf++); }
    for (const sh of shotsOf(evs, x.gn, false)) { const o = on(sh.e, 'before'); if (o.includes(pid)) o.forEach((q) => q !== pid && P(q).sa++); }
    for (const e of evs) if (e.kind === 'goal' || e.kind === 'conc') { const o = on(e, 'before'); if (o.includes(pid)) o.forEach((q) => q !== pid && P(q)[e.kind === 'goal' ? 'gf' : 'ga']++); }
    if (!gk) for (const st of setTable(M)) {
      if (!st.pids.includes(pid)) continue;
      const inSpan = (e) => st.spans.some((sp) => sp.period === e.period && sp.from < e.at && e.at <= sp.to);
      const c = sets.get(st.key) || { pids: st.pids, time: 0, count: 0, sf: 0, sa: 0 };
      c.time += st.time; c.count += st.count;
      c.sf += shotsOf(evs, x.gn, true).filter((q) => inSpan(q.e)).length; c.sa += shotsOf(evs, x.gn, false).filter((q) => inSpan(q.e)).length;
      sets.set(st.key, c);
    }
  }
  const nm = (q) => { const pp = playerById(q); return pp ? `${pp.last || ''}` : '—'; };
  const pos = (q) => (playerById(q)?.pos === 'GK' ? 'gk' : 'fp');
  const prs = [...pair.entries()].filter(([q, v]) => v.t > 0 && playerById(q)?.pos !== 'GK').sort((a, b) => b[1].t - a[1].t).slice(0, 10);
  const pmax = Math.max(1, ...prs.map(([, v]) => v.t));
  const pairH = `<div class="prpair"><h3>一緒にピッチにいた時間<small>FPだけ、長い順に10人。差・±は2人が一緒にいた間の数</small></h3><table><tr><th>選手</th><th></th><th>時間</th><th>割合</th><th class="df">シュート<br>関与の差</th><th class="df">得失点±</th></tr>
    ${prs.map(([q, v]) => `<tr><td><span class="pos ${pos(q)}">${pos(q) === 'gk' ? 'GK' : 'FP'}</span> ${esc(nm(q))}</td><td class="pb"><i style="width:${Math.round(v.t / pmax * 100)}%"></i></td><td><b>${mmss(v.t)}</b></td><td>${pct(v.t, T)}</td><td class="df ${v.sf - v.sa > 0 ? 'p' : v.sf - v.sa < 0 ? 'm' : ''}">${sg(v.sf - v.sa)}</td><td class="df ${v.gf - v.ga > 0 ? 'p' : v.gf - v.ga < 0 ? 'm' : ''}">${sg(v.gf - v.ga)}</td></tr>`).join('') || '<tr><td colspan="6" class="mu">ありません</td></tr>'}</table></div>`;
  const st5 = [...sets.values()].sort((a, b) => b.time - a.time).slice(0, 5);
  const setH = gk ? '' : `<div class="prpair"><h3>この選手が入った4人のセット<small>長い順に5つ（GK1人・FP4人がそろった時間）</small></h3><table><tr><th>FP4人</th><th>時間</th><th>回数</th><th class="df">シュート<br>の差</th></tr>
    ${st5.map((c) => `<tr><td class="sn">${c.pids.map((q) => `<span class="${q === pid ? 'me' : ''}">${esc(nm(q))}</span>`).join('')}</td><td><b>${mmss(c.time)}</b></td><td>${c.count}</td><td class="df ${c.sf - c.sa > 0 ? 'p' : c.sf - c.sa < 0 ? 'm' : ''}">${sg(c.sf - c.sa)}</td></tr>`).join('') || '<tr><td colspan="4" class="mu">ありません</td></tr>'}</table></div>`;
  const G = rows.reduce((a, r0) => { for (const k of ['f', 'sz', 'ot', 'ga', 'og']) a[k] += r0.g[k]; r0.g.cls.forEach((v, i) => { a.cls[i] += v; }); r0.g.gcls.forEach((v, i) => { a.gcls[i] += v; }); return a; }, { f: 0, sz: 0, ot: 0, ga: 0, og: 0, cls: [0, 0, 0, 0, 0, 0, 0], gcls: [0, 0, 0, 0, 0, 0, 0] });
  const per40 = (v) => (T ? (v / (T / 2400000)).toFixed(1) : '—');
  const sav = G.ot - G.ga;
  const gkH = `<h2 class="h">GKのパフォーマンス<small>ピッチにいる間の相手のシュート</small></h2>
    <div class="prgkw"><div class="prgkhero"><em>セーブ率</em><b>${G.ot ? Math.round(sav / G.ot * 100) + '<i>%</i>' : '—'}</b><span class="prbar"><i style="width:${G.ot ? Math.round(sav / G.ot * 100) : 0}%"></i></span><small>セーブ ${sav} ÷ 被枠内シュート ${G.ot}</small></div>
    <div class="prgkt"><table>
      <tr><th>被シュート</th><td><b>${G.f}</b><small>SZ内 ${G.sz}・SZ外 ${G.f - G.sz}</small></td></tr>
      <tr><th>被枠内シュート</th><td><b>${G.ot}</b><small>被シュートの ${pct(G.ot, G.f)}</small></td></tr>
      <tr><th>セーブ</th><td><b>${sav}</b></td></tr>
      <tr><th>失点</th><td><b>${G.ga}</b><small>${G.og ? `ほかにOG ${G.og}` : 'OGは除く'}</small></td></tr>
      <tr><th>40分あたり</th><td><b>${per40(G.f)}</b><small>被シュート・失点 ${per40(G.ga)}</small></td></tr></table></div></div>
    <p class="mu">枠内＝結果が「枠内」の相手のシュート（失点を含む）。セーブ＝被枠内シュート − 失点。相手のシュートの結果が入っていないものは、枠内に数えません。</p>`;
  const withH = !rows.length ? '' : gk ? gkH : `<h2 class="h">一緒にプレーした選手</h2><div class="prgrid2">${pairH}${setH}</div>`;

  // ---------- ⑦ プレーの傾向 ----------
  const LCLS = ['定位置', 'セットプレー', 'トランジション', 'GK活用', '特殊局面'];
  const sc = [0, 0, 0, 0, 0, 0, 0], gc = [0, 0, 0, 0, 0, 0, 0];
  for (const r0 of rows) {
    const x = r0.x; const evs = x.evs.filter((e) => !e.deleted);
    for (const sh of shotsOf(evs, x.gn, true)) { if (sh.pid !== pid) continue; const i = CLS_KEYS.indexOf(sh.cls); sc[i >= 0 ? i : 6]++; if (sh.goal) gc[i >= 0 ? i : 6]++; }
  }
  const PL = [...LCLS, '', '局面が分からない'];
  const pie = (title, arr) => { const tot = arr.reduce((a, b) => a + b, 0); return `<div class="prpie"><h3>${title}<small>合計 ${tot}</small></h3>${tot ? `<div class="anpiew">${pieSvg(arr)}<table class="anpiel"><tbody>${arr.map((v, i) => (v ? `<tr><td><i style="background:${PIEC[i]}"></i>${PL[i]}</td><td><b>${v}</b></td><td>${Math.round(v / tot * 100)}%</td></tr>` : '')).join('')}</tbody></table></div>` : '<p class="mu">ありません</p>'}</div>`; };
  const trendH = rows.length ? `<h2 class="h">プレーの傾向</h2><div class="prgrid2 three">${gk ? pie('被シュートの局面', G.cls) + pie('失点の局面', G.gcls) : pie('シュートの局面<small>本人が打ったシュート（得点を含む）</small>', sc) + pie('得点の局面', gc)}</div>` : '';

  return {
    active: 'players',
    html: `<div class="prw">${head}${sumH}${gk ? withH : ""}${graphH}${matchH}${gk ? "" : withH}${trendH}${actH}</div>`, // GKはパフォーマンスをまとめのすぐ下に
    bind(root) {
      const dt = root.querySelector('details.prpick'); if (dt) dt.ontoggle = () => { pickOpen = dt.open; };
      root.querySelectorAll('[data-part]').forEach((c) => { c.indeterminate = true; });
      const upd = (f) => { const e = exOf(pid); f(e); setEx(pid, e); render(); };
      root.querySelectorAll('[data-pa]').forEach((c) => { c.onchange = () => upd((e) => { const id = c.dataset.pa; if (c.checked) { e.a.delete(id); msOf(id).forEach((m) => e.m.delete(m.id)); } else e.a.add(id); }); });
      root.querySelectorAll('[data-pm]').forEach((c) => { c.onchange = () => upd((e) => { c.checked ? e.m.delete(c.dataset.pm) : e.m.add(c.dataset.pm); }); });
      const al = root.querySelector('#prAll'); if (al) al.onclick = () => upd((e) => { e.a.clear(); e.m.clear(); });
      const nn = root.querySelector('#prNone'); if (nn) nn.onclick = () => upd((e) => { allActs.forEach((a) => e.a.add(a.id)); });
      root.querySelectorAll('tr[data-go]').forEach((tr) => { tr.onclick = () => { location.hash = tr.dataset.go; }; });
    },
  };
}
