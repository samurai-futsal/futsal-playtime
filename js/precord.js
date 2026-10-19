// 選手の記録（2026-10-19）：選手ページ（・活動の招集メンバー・試合のメンバー）から開く、1人の選手のページ。
// ① 見出しと絞り込み ② 通算のまとめ ④ 試合ごとの記録 ⑤ 招集歴（③グラフ・⑥一緒にプレーした選手・⑦傾向は次の回）
import { S, playerById, activityById, opts } from './store.js';
import { matchCalcs } from './analysis.js';
import { esc, fmtDate, fmtShort } from './ui.js';
import { render } from './views.js';

const mmss = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const sg = (v) => `${v > 0 ? '+' : ''}${v}`;
const pct = (a, b) => (b ? Math.round(a / b * 100) + '%' : '—');
const F = { type: '', cat: '', from: '', to: '' };
try { Object.assign(F, JSON.parse(localStorage.getItem('fpt.precord') || '{}')); } catch {}
const keepF = () => { try { localStorage.setItem('fpt.precord', JSON.stringify(F)); } catch {} };

const actOk = (a) => (!F.type || a?.type === F.type) && (!F.from || (a?.end || a?.start || '') >= F.from) && (!F.to || (a?.start || '') <= F.to);
const matchOk = (m) => { const a = activityById(m.activityId); return (!F.type || a?.type === F.type) && (!F.cat || m.category === F.cat) && (!F.from || (m.date || '') >= F.from) && (!F.to || (m.date || '') <= F.to); };

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
  return { x, m: x.m, d, len: x.len, start, rests, own, opp, res, pk };
}

export function vPlayerRecord(r) {
  const pid = r.id; const p = playerById(pid);
  if (!p) return { active: 'players', html: '<div class="card empty">選手が見つかりません。<div class="mt"><a class="btn" href="#/players">‹ 選手</a></div></div>' };
  const gk = p.pos === 'GK';
  const ms = S.matches.filter((m) => !m.deleted && m.members?.[pid] && m.status === 'done' && matchOk(m)).sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.kickoff || '').localeCompare(b.kickoff || ''));
  const live = S.matches.filter((m) => !m.deleted && m.members?.[pid] && m.status === 'playing').length;
  const acts = S.activities.filter((a) => !a.deleted && a.members?.[pid] && actOk(a)).sort((a, b) => (b.start || '').localeCompare(a.start || ''));
  const { list, loading } = matchCalcs(ms);
  const rows = list.map((x) => oneRow(x, pid)).filter((r0) => r0.d);
  const played = rows.filter((r0) => r0.d.time > 0);

  // ---------- ① 見出しと絞り込み ----------
  const o = (lst, v) => `<option value="">すべて</option>${lst.map((n) => `<option ${n === v ? 'selected' : ''}>${esc(n)}</option>`).join('')}`;
  const lastM = S.matches.filter((m) => !m.deleted && m.members?.[pid]).sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0];
  const no = lastM ? lastM.members[pid].no : null;
  const head = `<div class="crumb"><a class="btn sm mpback" href="#/players">‹ 選手</a></div>
    <div class="prhead"><span class="no ${gk ? 'gk' : 'fp'} big">${esc(no ?? '—')}</span><div><h1>${esc(`${p.last || ''} ${p.first || ''}`.trim())}<small>${esc(p.kana || '')}</small></h1>
      <span class="pos ${gk ? 'gk' : 'fp'}">${gk ? 'GK' : 'FP'}</span>${p.status === 'former' ? '<span class="prformer">過去所属</span>' : ''}<span class="mu">${no != null ? '背番号は最近の試合のもの' : ''}</span></div></div>
    <div class="prf"><label>活動の種類<select data-f="type">${o(opts('activityTypes', true).map((x) => x.name), F.type)}</select></label>
      <label>試合の区分<select data-f="cat">${o(opts('matchCategories', true).map((x) => x.name), F.cat)}</select></label>
      <label>期間<span class="pkd"><input type="date" data-f="from" value="${esc(F.from)}">〜<input type="date" data-f="to" value="${esc(F.to)}"></span></label>
      ${F.type || F.cat || F.from || F.to ? '<button class="btn sm" id="prClear">絞り込みをやめる</button>' : ''}</div>`;

  // ---------- ② 通算のまとめ ----------
  const sum = (f) => rows.reduce((a, r0) => a + f(r0), 0);
  const T = sum((r0) => r0.d.time), N = sum((r0) => r0.d.count), L = sum((r0) => r0.len);
  const rests = rows.flatMap((r0) => r0.rests);
  const D = (f) => sum((r0) => f(r0.d));
  const shots = D((d) => d.shots), inn = D((d) => d.in);
  const tile = (l, v, sub = '') => `<div class="prt"><em>${l}</em><b>${v}</b>${sub ? `<small>${sub}</small>` : ''}</div>`;
  const tilesTime = [
    tile('招集された活動', `${acts.length}<i>回</i>`), tile('試合メンバー', `${rows.length}<i>試合</i>`, `先発 ${rows.filter((r0) => r0.start).length}試合`), tile('出場した試合', `${played.length}<i>試合</i>`),
    tile('出場時間（合計）', mmss(T), played.length ? `1試合平均 ${mmss(T / played.length)}` : ''), tile('出場率', pct(T, L), 'メンバーに入った試合の時間に対して'),
    tile('1回の出場の平均', N ? mmss(T / N) : '—', `出場 ${N}回`), tile('休憩の平均', rests.length ? mmss(rests.reduce((a, b) => a + b, 0) / rests.length) : '—', '同じピリオドの中で'),
  ];
  const tilesPlay = gk ? [
    tile('被シュート関与', D((d) => d.on.oshot)), tile('失点関与', D((d) => d.on.ga)), tile('得点関与', D((d) => d.on.gf)),
    tile('シュート関与の差', sg(D((d) => d.on.shot - d.on.oshot))), tile('得失点±', sg(D((d) => d.on.gf - d.on.ga))),
    tile('リカバリー−ロスト', sg(D((d) => d.rec - d.lost)), `リカバリー ${D((d) => d.rec)}・ロスト ${D((d) => d.lost)}`), tile('得点・アシスト', `${D((d) => d.goals)}・${D((d) => d.assists)}`), tile('カード', `${D((d) => d.cY)}・${D((d) => d.cR)}`, 'イエロー・レッド'),
  ] : [
    tile('得点', D((d) => d.goals)), tile('アシスト', D((d) => d.assists)), tile('シュート', shots, `枠内 ${inn}（枠内率 ${pct(inn, shots)}）・SZ内 ${D((d) => d.sz)}`),
    tile('Z4進入・SZ進入', `${D((d) => d.ent.z4.inv)}・${D((d) => d.ent.sz.inv)}`), tile('リカバリー−ロスト', sg(D((d) => d.rec - d.lost)), `リカバリー ${D((d) => d.rec)}・ロスト ${D((d) => d.lost)}`),
    tile('シュート関与の差', sg(D((d) => d.on.shot - d.on.oshot)), `シュート関与 ${D((d) => d.on.shot)}・被 ${D((d) => d.on.oshot)}`),
    tile('進入関与の差', sg(D((d) => d.on.z4 + d.on.sz - d.on.oz4 - d.on.osz))), tile('得失点±', sg(D((d) => d.on.gf - d.on.ga)), `得点関与 ${D((d) => d.on.gf)}・失点関与 ${D((d) => d.on.ga)}`),
    tile('カード', `${D((d) => d.cY)}・${D((d) => d.cR)}`, 'イエロー・レッド'),
  ];
  const sumH = `<h2 class="h">通算のまとめ<small>${rows.length}試合${loading ? '（読み込み中…）' : ''}</small></h2>
    <div class="prtiles">${tilesTime.join('')}</div><div class="prtiles prply">${tilesPlay.join('')}</div>`;

  // ---------- ④ 試合ごとの記録 ----------
  const resC = (r0) => (/勝/.test(r0.res) ? 'w' : /負/.test(r0.res) ? 'l' : 'd');
  const z = (v) => (v ? v : '<span class="z">0</span>');
  const trs = rows.slice().reverse().map((r0) => { const d = r0.d; const a = activityById(r0.m.activityId);
    return `<tr data-go="#/m/${r0.m.id}/review" class="${d.time ? '' : 'zero'}"><td class="pd">${fmtDate(r0.m.date, false)}</td><td class="po">vs ${esc(r0.m.opponent || '')}<small>${esc(a?.name || '')}${r0.m.category ? '・' + esc(r0.m.category) : ''}</small></td>
      <td><span class="prres ${resC(r0)}">${r0.res}</span> ${r0.own}−${r0.opp}${r0.pk && r0.res.startsWith('PK') ? `<small>（PK ${r0.pk.own}−${r0.pk.opp}）</small>` : ''}</td><td>${r0.start ? '◯' : ''}</td>
      <td><b>${d.time ? mmss(d.time) : '<span class="z">0:00</span>'}</b></td><td>${d.time ? pct(d.time, r0.len) : '—'}</td><td>${z(d.count)}</td>
      ${gk ? `<td>${z(d.on.oshot)}</td><td>${z(d.on.ga)}</td>` : `<td>${z(d.goals)}</td><td>${z(d.assists)}</td><td>${z(d.shots)}<small>（${d.in}）</small></td><td>${z(d.ent.z4.inv)}</td><td>${z(d.ent.sz.inv)}</td>`}
      <td class="df">${d.time ? sg(d.on.shot - d.on.oshot) : '—'}</td><td class="df">${d.time ? sg(d.on.gf - d.on.ga) : '—'}</td><td class="gt">›</td></tr>`; }).join('');
  const th = `<tr><th>日付</th><th>相手</th><th>結果</th><th>先発</th><th>出場時間</th><th>出場率</th><th>回数</th>${gk ? '<th>被シュート<br>関与</th><th>失点<br>関与</th>' : '<th>得点</th><th>アシスト</th><th>シュート<br><small>（枠内）</small></th><th>Z4進入</th><th>SZ進入</th>'}<th class="df">シュート<br>関与の差</th><th class="df">得失点±</th><th></th></tr>`;
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

  return {
    active: 'players',
    html: `<div class="prw">${head}${sumH}${matchH}${actH}</div>`,
    bind(root) {
      root.querySelectorAll('[data-f]').forEach((el) => { el.onchange = () => { F[el.dataset.f] = el.value; keepF(); render(); }; });
      const cl = root.querySelector('#prClear'); if (cl) cl.onclick = () => { Object.assign(F, { type: '', cat: '', from: '', to: '' }); keepF(); render(); };
      root.querySelectorAll('tr[data-go]').forEach((tr) => { tr.onclick = () => { location.hash = tr.dataset.go; }; });
    },
  };
}
