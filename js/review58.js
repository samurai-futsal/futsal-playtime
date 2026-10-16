// マッチレビューのイベントを使う項目（5 マッチ・ペース、7 スコアとチームスタッツ、8 スタッツまとめ）と、
// 出場タイムラインの得点・失点の線（spec 7章、2026-10-16 決定）。時間はいつもプレーイングタイム（経過時間）。
import { esc } from './ui.js';
import { OPP_OG, NO_ASSIST, UNKNOWN } from './events.js';
import { teamStats, playerStats } from './teamstats.js';

const mmss = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const GREEN = '#13A10E', RED = '#E00000';

// 得点・失点の一覧（時刻順）。label＝線の上に出す短い文字
export function goalMarks(R, c) {
  return R.goals.map(({ e, own }) => {
    const who = own ? (e.pid === OPP_OG ? '相手OG' : e.pid && e.pid !== UNKNOWN ? `${c.mem(e.pid).no ?? ''} ${c.last(e.pid)}` : '') : '';
    return { period: e.period, at: e.at, own, label: `${own ? '得点' : '失点'} ${mmss(e.at)}${who ? ' ' + who : ''}` };
  });
}
// ラベルが重ならないように段をずらす（x：0〜100 の位置、w：ラベルのおよその幅）
export function stagger(items, w) {
  const lastX = [];
  return items.map((it) => {
    let row = 0; while (lastX[row] != null && it.x - lastX[row] < w) row++;
    lastX[row] = it.x; return { ...it, row };
  });
}

// ---------- 5. マッチ・ペース ----------
// 下段に並べられる行（分析画面で選べる。マッチレビューは shot・ent・fsp の3段）
export const PACE_ROWS = {
  shot: ['シュート', '（SZ内・得点を含む）', (e) => ['shot', 'szshot'].includes(e.kind) || (e.kind === 'goal' && e.pid !== OPP_OG), (e) => ['oshot', 'oszshot'].includes(e.kind) || e.kind === 'conc', 'own', 'opp'],
  ent: ['Z4・SZ進入', '（合計）', (e) => e.kind === 'z4' || e.kind === 'sz', (e) => e.kind === 'oz4' || e.kind === 'osz', 'own', 'opp'],
  fsp: ['FINISH SET PLAY', '（AT／DF）', (e) => e.kind === 'fspat', (e) => e.kind === 'fspdf', 'own', 'opp'],
  rl: ['リカバリー／ロスト', '（自チーム）', (e) => e.kind === 'rec', (e) => e.kind === 'lost', 'リカバリー', 'ロスト'],
};
// o：{ bin（ms、初めは1分）, rows（PACE_ROWS のキー）, svgOnly, tap（タップで強調できる印を付ける） }
export function paceSection(c, o = {}) {
  const { M0, order, mem, last, R, T0, own, opp } = c;
  const BIN = o.bin || 60000; const rowKeys = o.rows || ['shot', 'ent', 'fsp'];
  const axis = M0.periods.filter((p) => !p.extra || p.status !== 'none');
  // 名前の列は一番長い名前に合わせ、番号と名前を0:00のすぐ横にそろえる。右端は番号と合計を近づける
  const nameW = Math.max(2, ...order.map((pid) => last(pid).length)) * 13.5;
  const X0 = 40 + nameW, MID = 46 + nameW, RW = 8, TW = 840, rowH = 24; // 右端の合計は出さない（流れを見る項目なので。2026-10-16）
  const sumLen = axis.reduce((a, p) => a + p.len, 0);
  const HW = Object.fromEntries(axis.map((p) => [p.key, TW * p.len / sumLen]));
  const X = {}; let xx = X0; axis.forEach((p, i) => { if (i) xx += MID; X[p.key] = xx; xx += HW[p.key]; });
  const PW = xx + RW;
  const x = (k, at) => X[k] + Math.min(1, at / axis.find((p) => p.key === k).len) * HW[k];
  const marks = goalMarks(R, c);
  const lanes = stagger(marks.map((g) => ({ ...g, x: x(g.period, g.at) })), 96);
  const nLane = Math.max(0, ...lanes.map((l) => l.row + 1));
  const top = 44 + nLane * 14;
  const yEnd = top + order.length * rowH;
  const groups = rowKeys.map((k) => PACE_ROWS[k]).filter(Boolean);
  const unit = BIN < 60000 ? 9 : 11;
  const H = yEnd + 30 + groups.length * 138;
  let s = `<svg class="pace" viewBox="0 0 ${PW} ${H}" xmlns="http://www.w3.org/2000/svg" font-family="Hiragino Sans, Noto Sans CJK JP, sans-serif">`;
  // 目盛り：ピリオドごとの経過時間（5分ごと）
  for (const p of axis) {
    s += `<text x="${X[p.key] + 2}" y="12" font-size="12" font-weight="800" fill="#0B2D6B">${p.label}</text>`;
    for (let mn = 0; mn * 60000 <= p.len; mn += 5) {
      const lx = x(p.key, mn * 60000); const edge = mn === 0 || mn * 60000 === p.len;
      s += `<line x1="${lx}" x2="${lx}" y1="${top - 4}" y2="${H - 8}" stroke="${edge ? '#0B2D6B' : '#E3E8F0'}" stroke-width="${edge ? 1.5 : 1}"/>`;
      s += `<text x="${lx}" y="${top - 8}" font-size="10" text-anchor="${mn === 0 ? 'start' : mn * 60000 === p.len ? 'end' : 'middle'}" fill="#56607A">${mn}:00</text>`;
    }
  }
  // 得点・失点のラベル（目盛りの上の段）
  for (const l of lanes) s += `<text x="${l.x}" y="${26 + l.row * 14}" font-size="10.5" font-weight="800" text-anchor="${l.x > PW - 60 ? 'end' : l.x < X0 + 40 ? 'start' : 'middle'}" fill="${l.own ? GREEN : RED}">${esc(l.label)}</text>`;
  const who = (pid, x0, y) => `<rect x="${x0}" y="${y + 3}" width="24" height="${rowH - 6}" rx="3" fill="${mem(pid).pos === 'GK' ? '#C8312B' : '#1F5FBF'}"/><text x="${x0 + 12}" y="${y + rowH - 8}" font-size="11" font-weight="700" fill="#fff" text-anchor="middle">${esc(mem(pid).no ?? '')}</text>`;
  order.forEach((pid, i) => {
    const y = top + i * rowH;
    if (o.tap) s += `<g class="prow" data-prow="${pid}"><rect class="phl" x="0" y="${y}" width="${PW}" height="${rowH}" rx="4" fill="${i % 2 === 0 ? '#EAF0F9' : 'transparent'}"/>`;
    else if (i % 2 === 0) s += `<rect x="0" y="${y}" width="${PW}" height="${rowH}" rx="4" fill="#EAF0F9"/>`;
    for (const p of axis) s += `<rect x="${X[p.key]}" y="${y + 2}" width="${HW[p.key]}" height="${rowH - 4}" fill="#F3F5F9" opacity=".9"/>`;
    s += who(pid, 4, y) + `<text x="34" y="${y + rowH - 7}" font-size="13" font-weight="700" fill="#1B2433">${esc(last(pid))}</text>`;
    axis.slice(1).forEach((p) => { s += who(pid, X[p.key] - MID + 10, y) + `<text x="${X[p.key] - MID + 40}" y="${y + rowH - 7}" font-size="13" font-weight="700" fill="#1B2433">${esc(last(pid))}</text>`; });
    for (const z of (M0.zero || []).filter((q) => q.pid === pid && X[q.period] != null)) s += `<rect x="${x(z.period, z.from) - 1.5}" y="${y + 1}" width="3" height="${rowH - 2}" fill="#E0832B"/>`;
    for (const st of M0.stints.filter((q) => q.pid === pid && X[q.period] != null)) {
      const x1 = x(st.period, st.from), x2 = x(st.period, st.to);
      s += `<rect x="${x1}" y="${y + 2}" width="${Math.max(0.8, x2 - x1)}" height="${rowH - 4}" fill="${mem(pid).pos === 'GK' ? '#C8312B' : '#1F5FBF'}" opacity=".85"/>`;
    }
    if (o.tap) s += `<rect class="pname" data-pname="${pid}" x="0" y="${y}" width="${X0 - 4}" height="${rowH}" fill="transparent" style="cursor:pointer"/></g>`;
  });
  for (const g of marks) { if (X[g.period] == null) continue; const gx = x(g.period, g.at); s += `<line x1="${gx}" x2="${gx}" y1="${top - 2}" y2="${yEnd}" stroke="${g.own ? GREEN : RED}" stroke-width="2"/>`; }
  // 下段：区切りごとの回数（上＝自チーム、下＝相手）
  let gy = yEnd + 30;
  const lowTop = gy;
  for (const [lab, sub, fo, fp, upL, dnL] of groups) {
    const mid = gy + 60;
    // 見出しはグラフの上に1行で（左の名前の列は狭いので）
    s += `<text x="4" y="${gy + 4}" font-size="11.5" font-weight="800" fill="#0B2D6B">${lab}<tspan font-size="9.5" font-weight="500" fill="#56607A">${sub}</tspan><tspan dx="10" font-size="10" fill="#1F5FBF">上＝${esc(upL === 'own' ? own : upL)}</tspan><tspan dx="6" font-size="10" fill="${RED}">下＝${esc(dnL === 'opp' ? opp : dnL)}</tspan></text>`;
    for (const p of axis) {
      const nMin = Math.ceil(p.len / BIN);
      const bo = Array(nMin).fill(0), bp = Array(nMin).fill(0);
      for (const e of c.evs) { if (e.period !== p.key) continue; const b = Math.min(nMin - 1, Math.floor(e.at / BIN)); if (fo(e)) bo[b]++; if (fp(e)) bp[b]++; }
      s += `<line x1="${X[p.key]}" x2="${X[p.key] + HW[p.key]}" y1="${mid}" y2="${mid}" stroke="#8A93A6"/>`;
      const bw0 = HW[p.key] / nMin;
      for (let i = 0; i < nMin; i++) {
        const bx = X[p.key] + i * bw0 + (BIN < 60000 ? 1 : 2), bw = bw0 - (BIN < 60000 ? 2 : 4);
        if (bo[i]) s += `<rect x="${bx}" y="${mid - bo[i] * unit}" width="${bw}" height="${bo[i] * unit}" fill="#1F5FBF"/><text x="${bx + bw / 2}" y="${mid - bo[i] * unit - 2}" font-size="10" text-anchor="middle" fill="#1F5FBF">${bo[i]}</text>`;
        if (bp[i]) s += `<rect x="${bx}" y="${mid}" width="${bw}" height="${bp[i] * unit}" fill="#E04A3A"/><text x="${bx + bw / 2}" y="${mid + bp[i] * unit + 11}" font-size="10" text-anchor="middle" fill="#E04A3A">${bp[i]}</text>`;
      }
    }
    gy += 138;
  }
  // タップ用：区切りごとの透明な枠（その時間帯にピッチにいた選手を data-on に持つ）
  if (o.tap) for (const p of axis) {
    const nMin = Math.ceil(p.len / BIN), bw0 = HW[p.key] / nMin;
    for (let i = 0; i < nMin; i++) {
      const a = i * BIN, b = Math.min(p.len, (i + 1) * BIN);
      const on = [...new Set(M0.stints.filter((q) => q.period === p.key && q.from < b && q.to > a).map((q) => q.pid))];
      s += `<rect class="pbin" data-bin="${esc(p.label)} ${mmss(a)}〜${mmss(b)}" data-on="${on.join(',')}" x="${X[p.key] + i * bw0}" y="${top - 2}" width="${bw0}" height="${gy - top + 2}" fill="transparent"/>`;
    }
  }
  s += '</svg>';
  if (o.svgOnly) return s;
  return `<section class="rvsec" id="rv5"><div class="rvtt"><b>5. マッチ・ペース</b><span>上段＝出場の帯（GKは赤。並び＝GK、先発のFP（背番号順）、そのあとは初めてピッチに入った順。ピリオドの間にも背番号と名前）と得点（緑）・失点（赤）の線。線の上の文字＝経過時間と得点者。オレンジの細い線＝時計が止まっている間だけの出場（0:00）。下段＝1分ごとの回数（上＝${esc(own)}、下＝${esc(opp)}）。時間はプレーイングタイム（ピリオドごとの経過時間）</span></div><div class="rvbox">${s}</div></section>`;
}

// ---------- 7. スコアとチームスタッツ ----------
export function teamSection(c, o = {}) {
  const { R, badge, last, own, opp, goalName, M0 } = c;
  const { A, B } = R;
  const tot = (side) => Object.values(R.score[side]).reduce((a, b) => a + b, 0);
  const per = M0.periods.filter((p) => p.status !== 'none').map((p) => `${p.label} ${R.score.own[p.key]}−${R.score.opp[p.key]}`).join('　');
  let so = 0, sp = 0;
  const P = (pid) => (pid === OPP_OG ? '相手OG' : pid === UNKNOWN ? '不明' : pid ? `${badge(pid)}${esc(last(pid))}` : '<span class="na">—</span>');
  const flow = R.goals.map(({ e, own: o }) => {
    o ? so++ : sp++;
    const pl = M0.periods.find((p) => p.key === e.period);
    const scorer = o ? P(e.pid) : (e.og ? `OG ${P(e.og)}` : '<span class="na">—</span>');
    const assist = !o || e.pid === OPP_OG ? '<span class="na">—</span>' : e.assist === NO_ASSIST ? 'なし' : e.assist ? P(e.assist) : '<span class="na">未入力</span>';
    return `<tr><td>${pl?.label || ''}　${mmss(e.at)}</td><td class="${o ? 'own' : 'opp'}">${esc(o ? own : opp)}</td><td style="text-align:left">${scorer}</td><td style="text-align:left">${assist}</td><td>${e.gtype ? esc(goalName(e.gtype)) : '<span class="na">未入力</span>'}</td><td><b>${so} − ${sp}</b></td></tr>`;
  }).join('') || '<tr><td colspan="6" class="na" style="text-align:center">得点・失点はまだありません</td></tr>';
  const cmpMax = Math.max(1, A.shots, B.shots, A.z4, B.z4, A.fsp, B.fsp, A.foul, B.foul);
  const cmp = (label, a, b, sub = null) => `<tr><td class="xb l"><i style="width:${a == null ? 0 : Math.round(a / cmpMax * 170)}px"></i></td><td class="cv">${a == null ? '<span class="na">—</span>' : a}${sub && a != null ? `<small>${sub[0]}</small>` : ''}</td><td class="cl">${label}</td><td class="cv">${b == null ? '<span class="na">—</span>' : b}${sub && b != null ? `<small>${sub[1]}</small>` : ''}</td><td class="xb r"><i style="width:${b == null ? 0 : Math.round(b / cmpMax * 170)}px"></i></td></tr>`;
  const fspSub = (s) => `CK ${s.fspT[0]}・CK-KI ${s.fspT[1]}・KI ${s.fspT[2]}・FK ${s.fspT[3]}`;
  const cardSub = (s) => `イエロー${s.cards.yellow}・2枚目${s.cards.y2}・レッド${s.cards.red}`;
  const inner = `<div class="rvscore7"><span class="tn">${esc(own)}</span><span class="sv">${tot('own')} − ${tot('opp')}</span><span class="tn">${esc(opp)}</span><span class="hv">${per}</span></div>
<table class="rvtb rvflow"><tr><th>時間</th><th>チーム</th><th style="text-align:left">得点者</th><th style="text-align:left">アシスト</th><th>得点の種類</th><th>スコア</th></tr>${flow}</table>
<table class="rvcmp"><tr><th></th><th class="own">${esc(own)}</th><th></th><th class="opp">${esc(opp)}</th><th></th></tr>
${cmp('シュート', A.shots, B.shots, [`SZ内 ${A.sz}`, `SZ内 ${B.sz}`])}${cmp('枠内', A.in, B.in)}${cmp('Z4進入', A.z4, B.z4)}${cmp('SZ進入', A.szE, B.szE)}${cmp('FINISH SET PLAY', A.fsp, B.fsp, [fspSub(A), fspSub(B)])}${cmp('ファール', A.foul, B.foul)}${cmp('カード', A.cardN, B.cardN, [cardSub(A), cardSub(B)])}${cmp('退場', R.ejOwn, R.ejOpp)}${cmp('タイムアウト', R.timeouts.own, R.timeouts.opp)}</table>
<div class="rvrl"><b>${esc(own)}のリカバリーとロスト</b><span>リカバリー <b>${R.rec}</b></span><span>ロスト <b>${R.lost}</b></span><span>差 <b>${R.rec - R.lost}</b></span></div>
<p class="rvhint">シュートは得点を含む（OGは除く）。${esc(opp)}のファール・カード＝${esc(own)}の被ファールで記録したもの。同じ選手の2枚目のイエローは「2枚目」に数える。退場：${esc(own)}はMATCH PLAYの退場の記録、${esc(opp)}は被ファールのイエロー2枚目とレッド。タイムアウトはMATCH PLAYの記録</p>`;
  if (o.plain) return inner;
  return `<section class="rvsec" id="rv7"><div class="rvtt"><b>7. スコアとチームスタッツ</b><span>得点経過と、${esc(own)}と${esc(opp)}の比較。SZ内シュートの数、FINISH SET PLAYとカードの内訳は数字の下に表示。時間は経過時間</span></div>
<div class="rvbox">${inner}</div></section>`;
}

// ---------- 8. スタッツまとめ ----------
export function playerSection(c) {
  const { M0, evs, goalName, T0, byNo, gkLast, badge, last, R } = c;
  const P = playerStats(M0, evs, goalName, gkLast(byNo), T0);
  const played = M0.periods.reduce((a, p) => a + p.elapsed, 0);
  const sum = (k) => P.rows.reduce((a, r) => a + r[k], 0);
  const rows = P.rows.map((r) => {
    const z = (v) => (r.time ? v : `<span class="na">${v}</span>`);
    return `<tr class="${r.time ? '' : 'zero'}"><td>${badge(r.pid)} ${esc(last(r.pid))}</td><td>${mmss(r.time)}</td><td>${z(r.shots)}<small>（${r.sz}）</small></td><td class="w">${z(r.shotOn)}</td><td class="o">${z(r.oshotOn)}</td><td>${z(r.in)}</td><td>${z(r.goals)}</td><td>${z(r.assists)}</td><td>${z(r.inv)}</td><td>${z(r.passFrom)}</td><td>${z(r.passTo)}</td><td>${z(r.rec)}</td><td>${z(r.lost)}</td><td>${z(r.foul)}</td><td><b>${r.time ? (r.pm > 0 ? '+' + r.pm : r.pm) : '<span class="na">0</span>'}</b></td></tr>`;
  }).join('');
  const tot = (side) => Object.values(R.score[side]).reduce((a, b) => a + b, 0);
  const goalsN = tot('own');
  return `<section class="rvsec" id="rv8"><div class="rvtt"><b>8. スタッツまとめ</b><span>選手ごと（背番号順、GKは一番下）。出場＝プレーイングタイム。シュート関与・被シュート関与＝ピッチにいる間の自チームのシュート・相手のシュートの数（得点・失点を含む、OGは除く）。得失点±＝ピッチにいる間の得点−失点</span></div>
<div class="rvbox"><table class="rvtb rvs8"><tr><th>選手</th><th>出場</th><th>シュート<br><small>（SZ内）</small></th><th class="w">シュート<br>関与</th><th class="o">被シュート<br>関与</th><th>枠内</th><th>得点</th><th>アシスト</th><th>進入関与</th><th>パス<br>出し手</th><th>パス<br>受け手</th><th>リカバリー</th><th>ロスト</th><th>ファール</th><th>得失点±</th></tr>${rows}
<tr class="tot"><td>チーム合計</td><td>${mmss(played)}</td><td>${R.A.shots}<small>（${R.A.sz}）</small></td><td class="w">${R.A.shots}</td><td class="o">${R.B.shots}</td><td>${R.A.in}</td><td>${goalsN}</td><td>${sum('assists')}${P.assistMiss ? `<div class="miss">未入力 ${P.assistMiss}</div>` : ''}</td><td>${sum('inv')}</td><td>${sum('passFrom')}</td><td>${sum('passTo')}</td><td>${R.rec}</td><td>${R.lost}</td><td>${R.A.foul}</td><td>${goalsN - tot('opp') > 0 ? '+' : ''}${goalsN - tot('opp')}</td></tr></table>
<p class="rvhint">シュートは得点を含む。進入関与＝Z4進入・SZ進入に選手（パスの出し手・受け手を含む）として付いている回数。チーム合計のシュート・リカバリーなどは、選手が「不明」や未入力のものも含むので、選手の合計と合わないことがあります。得点には相手OGを含む</p></div></section>`;
}

// 試合の状況の帯に出すスコア
export function scoreBadge(c, R) {
  const tot = (side) => Object.values(R.score[side]).reduce((a, b) => a + b, 0);
  return `<span class="rvscore">${esc(c.own)} <b>${tot('own')}−${tot('opp')}</b> ${esc(c.opp)}</span>`;
}
export { teamStats };
