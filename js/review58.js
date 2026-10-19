// マッチレビューのイベントを使う項目（5 マッチ・ペース、7 スコアとチームスタッツ、8 スタッツまとめ）と、
// 出場タイムラインの得点・失点の線（spec 7章、2026-10-16 決定）。時間はいつもプレーイングタイム（経過時間）。
import { esc } from './ui.js';
import { OPP_OG, NO_ASSIST, UNKNOWN, isOG, isOGType } from './events.js';
import { teamStats, playerStats } from './teamstats.js';

const mmss = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const GREEN = '#13A10E', RED = '#E00000';
// マッチレビューの表・マッチ・ペースの行を押して強調する（黄色＋オレンジの枠。もう一度押すと戻す。2026-10-17）。開いている間だけ覚える
export const rvHl = new Set();
export const hlc = (k) => (rvHl.has(k) ? 'hl' : '');
// 6・8の表の並べ替え（見出しを押す：多い順→少ない順→元の並び）。表ごとに覚える
export const tSort = { 4: { col: '', dir: 'desc' }, 6: { col: '', dir: 'desc' }, 8: { col: '', dir: 'desc' } };
export function tSortNext(t, col) {
  const s = tSort[t];
  tSort[t] = !col ? { col: '', dir: 'desc' } : s.col !== col ? { col, dir: 'desc' } : s.dir === 'desc' ? { col, dir: 'asc' } : { col: '', dir: 'desc' };
}
// 見出し（押すと並べ替え）
export const tsh = (t, col, label, cls = '') => { const s = tSort[t]; const on = s.col === col; return `<th class="srt ${on ? 'on' : ''} ${cls}" data-tsort="${t}:${col}">${label}<i>${on ? (s.dir === 'asc' ? '▲' : '▼') : '⇅'}</i></th>`; };
// 並べ替え。同じ数なら元の並び。last(r) が true の行はいつも下（出場していない選手など）
export function tSorted(t, rows, val, last = () => false) {
  const s = tSort[t]; const ix = new Map(rows.map((r, i) => [r, i]));
  if (!s.col) return rows.slice();
  const k = s.dir === 'asc' ? 1 : -1;
  return rows.slice().sort((a, b) => (last(a) - last(b)) || (val(a, s.col) - val(b, s.col)) * k || ix.get(a) - ix.get(b));
}

// 順位（2026-10-19）：並べ替えている列の数が多い順の順位（同じ数は同じ順位）。並べ替えていないときは def の多い順。
// 少ない順に並べると、下から 1位・2位… になる（順位の意味はいつも「多い順」）
export function tRank(t, rows, val, def) {
  const s = tSort[t]; const f = s.col ? (r) => val(r, s.col) : def;
  const vs = rows.map(f); const out = new Map();
  rows.forEach((r, i) => out.set(r, 1 + vs.filter((v) => v > vs[i]).length));
  return out;
}
// 順位の見出しの下に小さく、何の順位か
export const tRankHead = (t, labels, defLabel) => { const s = tSort[t]; const l = s.col ? labels(s.col) : defLabel; return `順位<small class="rkof">${l}</small>`; };

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
// 下段に並べられる行（分析画面で選べる。マッチレビューは shot・ent・fsp の3段）。数える条件は (e, goalName)。
// シュートはチームスタッツと同じ：得点・失点を含み、OG（相手OG・自チームのOG）は両チームとも数えない
export const PACE_ROWS = {
  shot: ['シュート', '（SZ内・得点を含む）', (e) => ['shot', 'szshot'].includes(e.kind) || (e.kind === 'goal' && e.pid !== OPP_OG), (e, gn) => ['oshot', 'oszshot'].includes(e.kind) || (e.kind === 'conc' && !isOGType(e.gtype, gn)), 'own', 'opp'],
  ent: ['Z4・SZ進入', '（合計）', (e) => e.kind === 'z4' || e.kind === 'sz', (e) => e.kind === 'oz4' || e.kind === 'osz', 'own', 'opp'],
  fsp: ['FINISH SET PLAY', '（AT／DF）', (e) => e.kind === 'fspat', (e) => e.kind === 'fspdf', 'own', 'opp'],
  rl: ['リカバリー／ロスト', '（自チーム）', (e) => e.kind === 'rec', (e) => e.kind === 'lost', 'リカバリー', 'ロスト'],
};
// 区切りの番号（終わりを含む）：0:00 → 0、0:00超〜1:00 → 0、1:00超〜2:00 → 1 …
export const binOf = (at, BIN, n) => Math.max(0, Math.min(n - 1, at <= 0 ? 0 : Math.ceil(at / BIN) - 1));
// o：{ bin（ms、初めは1分）, rows（PACE_ROWS のキー）, svgOnly, tap（タップで強調できる印を付ける） }
export function paceSection(c, o = {}) {
  const { M0, order, mem, last, R, T0, own, opp } = c;
  const BIN = o.bin || 60000; const rowKeys = o.rows || ['shot', 'ent', 'fsp'];
  const axis = M0.periods.filter((p) => !p.extra || p.status !== 'none');
  // 名前の列は一番長い名前に合わせ、番号と名前を0:00のすぐ横にそろえる。右端は番号と合計を近づける
  const nameW = Math.max(2, ...order.map((pid) => last(pid).length)) * 13.5;
  // 下のグラフの見出しは、グラフの左の列に（グラフとは重ならない）。列の幅は見出しとチーム名の長さに合わせる
  const tw = (t, fs) => [...String(t)].reduce((a, ch) => a + (ch.charCodeAt(0) < 0x2000 ? 0.6 : 1) * fs, 0);
  const groups0 = (o.rows || ['shot', 'ent', 'fsp']).map((k) => PACE_ROWS[k]).filter(Boolean);
  const labW = groups0.length ? Math.max(...groups0.flatMap(([lab, sub, , , upL, dnL]) => [tw(lab, 13), tw(sub, 10.5), tw('上＝' + (upL === 'own' ? own : upL), 11.5), tw('下＝' + (dnL === 'opp' ? opp : dnL), 11.5)])) + 16 : 0;
  const X0 = Math.max(40 + nameW, Math.min(230, labW)), MID = 46 + nameW, RW = 8, TW = o.tw || 840, rowH = o.rowH || 24, GH = o.gh || 138; // 右端の合計は出さない（流れを見る項目なので。2026-10-16）
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
  const H = yEnd + 16 + groups.length * GH;
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
  // 番号の枠は行の高さいっぱい近くまで使い、番号と名前は行の真ん中にそろえる（窮屈・はみ出しに見えないように。2026-10-17）
  const bh = Math.max(14, rowH - 3), fsN = Math.min(11, bh - 4), fsName = Math.min(13, rowH - 6);
  const who = (pid, x0, y) => `<rect x="${x0}" y="${y + (rowH - bh) / 2}" width="26" height="${bh}" rx="3" fill="${mem(pid).pos === 'GK' ? '#C8312B' : '#1F5FBF'}"/><text x="${x0 + 13}" y="${y + rowH / 2}" dy=".36em" font-size="${fsN}" font-weight="700" fill="#fff" text-anchor="middle">${esc(mem(pid).no ?? '')}</text>`;
  order.forEach((pid, i) => {
    const y = top + i * rowH;
    if (o.tap) s += `<g class="prow" data-prow="${pid}"><rect class="phl" x="0" y="${y}" width="${PW}" height="${rowH}" rx="4" fill="${i % 2 === 0 ? '#EAF0F9' : 'transparent'}"/>`;
    else if (o.pick) s += `<g class="prl ${rvHl.has('5:' + pid) ? 'on' : ''}" data-prl="${pid}" style="cursor:pointer"><rect class="phl" x="0" y="${y}" width="${PW}" height="${rowH}" rx="4" fill="${i % 2 === 0 ? '#EAF0F9' : '#FFFFFF'}"/>`;
    else if (i % 2 === 0) s += `<rect x="0" y="${y}" width="${PW}" height="${rowH}" rx="4" fill="#EAF0F9"/>`;
    for (const p of axis) s += `<rect x="${X[p.key]}" y="${y + 2}" width="${HW[p.key]}" height="${rowH - 4}" fill="#F3F5F9" opacity=".9"/>`;
    s += who(pid, X0 - 37 - nameW, y) + `<text x="${X0 - 6 - nameW}" y="${y + rowH / 2}" dy=".36em" font-size="${fsName}" font-weight="700" fill="#1B2433">${esc(last(pid))}</text>`;
    axis.slice(1).forEach((p) => { s += who(pid, X[p.key] - MID + 9, y) + `<text x="${X[p.key] - MID + 40}" y="${y + rowH / 2}" dy=".36em" font-size="${fsName}" font-weight="700" fill="#1B2433">${esc(last(pid))}</text>`; });
    for (const z of (M0.zero || []).filter((q) => q.pid === pid && X[q.period] != null)) s += `<rect x="${x(z.period, z.from) - 1.5}" y="${y + 1}" width="3" height="${rowH - 2}" fill="#E0832B"/>`;
    for (const st of M0.stints.filter((q) => q.pid === pid && X[q.period] != null)) {
      const x1 = x(st.period, st.from), x2 = x(st.period, st.to);
      // 帯にカーソルを合わせる（iPadは指で触れる）と、帯の上に名前と時間を出す（2026-10-17）
      const pt = `${mem(pid).no ?? ''} ${last(pid)}　${mmss(st.to - st.from)}`;
      s += `<rect class="pst" data-pt="${esc(pt)}" x="${x1}" y="${y + 2}" width="${Math.max(0.8, x2 - x1)}" height="${rowH - 4}" fill="${mem(pid).pos === 'GK' ? '#C8312B' : '#1F5FBF'}" opacity=".85"/>`;
    }
    if (o.tap) s += `<rect class="pname" data-pname="${pid}" x="0" y="${y}" width="${X0 - 4}" height="${rowH}" fill="transparent" style="cursor:pointer"/></g>`;
    else if (o.pick) s += `<rect class="pol" x="1" y="${y + 1}" width="${PW - 2}" height="${rowH - 2}" rx="4" fill="none" stroke="#F0A030" stroke-width="2"/></g>`;
  });
  for (const g of marks) { if (X[g.period] == null) continue; const gx = x(g.period, g.at); s += `<line x1="${gx}" x2="${gx}" y1="${top - 2}" y2="${yEnd}" stroke="${g.own ? GREEN : RED}" stroke-width="2"/>`; }
  // 下段：区切りごとの回数（上＝自チーム、下＝相手）
  let gy = yEnd + 10;
  const lowTop = gy;
  const gaps = {}; // 区切りごとの、棒と数字がある高さ（縦の線をそこだけあける）
  for (const [lab, sub, fo, fp, upL, dnL] of groups) {
    // 区切りごとの回数を先に数え、一番多い数でも隣のグラフにかからない高さにする
    const bins = axis.map((p) => {
      const nMin = Math.ceil(p.len / BIN);
      const bo = Array(nMin).fill(0), bp = Array(nMin).fill(0);
      // 区切りは終わりを含む（10:00ちょうどは 9:00〜10:00。0:00は最初の区切り）
      for (const e of c.evs) { if (e.period !== p.key) continue; const b = binOf(e.at, BIN, nMin); if (fo(e, c.goalName)) bo[b]++; if (fp(e, c.goalName)) bp[b]++; }
      return { p, nMin, bo, bp };
    });
    const half = (GH - 10) / 2, mid = gy + 5 + half;
    if (gy > lowTop) s += `<line x1="0" x2="${PW}" y1="${gy}" y2="${gy}" stroke="#D5DCE8" stroke-dasharray="3 3"/>`;
    // 左の列：見出し・説明・上下のチーム（上の段は線より上、下の段は線より下に置いて、位置でもわかるように）
    s += `<text x="6" y="${mid - 31}" font-size="13" font-weight="800" fill="#0B2D6B">${lab}</text><text x="6" y="${mid - 17}" font-size="10.5" fill="#56607A">${sub}</text>`
      + `<text x="6" y="${mid - 3}" font-size="11.5" font-weight="700" fill="#1F5FBF">上＝${esc(upL === 'own' ? own : upL)}</text><text x="6" y="${mid + 14}" font-size="11.5" font-weight="700" fill="${RED}">下＝${esc(dnL === 'opp' ? opp : dnL)}</text>`;
    const mxUp = Math.max(1, ...bins.flatMap((b) => b.bo)), mxDn = Math.max(1, ...bins.flatMap((b) => b.bp));
    const unitU = Math.min(BIN < 60000 ? 9 : 11, (half - 13) / mxUp), unitD = Math.min(BIN < 60000 ? 9 : 11, (half - 13) / mxDn);
    for (const { p, nMin, bo, bp } of bins) {
      s += `<line x1="${X[p.key]}" x2="${X[p.key] + HW[p.key]}" y1="${mid}" y2="${mid}" stroke="#8A93A6"/>`;
      const bw0 = HW[p.key] / nMin;
      for (let i = 0; i < nMin; i++) {
        const bx = X[p.key] + i * bw0 + (BIN < 60000 ? 1 : 2), bw = bw0 - (BIN < 60000 ? 2 : 4);
        const gk = `${p.key}:${i}`; if (bo[i]) (gaps[gk] = gaps[gk] || []).push(`${(mid - bo[i] * unitU - 13).toFixed(1)}-${mid.toFixed(1)}`); if (bp[i]) (gaps[gk] = gaps[gk] || []).push(`${mid.toFixed(1)}-${(mid + bp[i] * unitD + 13).toFixed(1)}`);
        if (bo[i]) s += `<rect x="${bx}" y="${mid - bo[i] * unitU}" width="${bw}" height="${bo[i] * unitU}" fill="#1F5FBF"/><text x="${bx + bw / 2}" y="${mid - bo[i] * unitU - 2}" font-size="10" text-anchor="middle" fill="#1F5FBF">${bo[i]}</text>`;
        if (bp[i]) s += `<rect x="${bx}" y="${mid}" width="${bw}" height="${bp[i] * unitD}" fill="#E04A3A"/><text x="${bx + bw / 2}" y="${mid + bp[i] * unitD + 11}" font-size="10" text-anchor="middle" fill="#E04A3A">${bp[i]}</text>`;
      }
    }
    gy += GH;
  }
  // タップ用：区切りごとの透明な枠（その時間帯にピッチにいた選手を data-on に持つ）
  if (o.tap) for (const p of axis) {
    const nMin = Math.ceil(p.len / BIN), bw0 = HW[p.key] / nMin;
    for (let i = 0; i < nMin; i++) {
      const a = i * BIN, b = Math.min(p.len, (i + 1) * BIN);
      const on = [...new Set(M0.stints.filter((q) => q.period === p.key && q.from < b && q.to > a).map((q) => q.pid))];
      s += `<rect class="pbin" data-bin="${esc(p.label)} ${mmss(a)}〜${mmss(b)}（残り ${mmss(p.len - a)}〜${mmss(p.len - b)}）" data-on="${on.join(',')}" x="${X[p.key] + i * bw0}" y="${top - 2}" width="${bw0}" height="${gy - top + 2}" fill="transparent"/>`;
    }
  }
  // マッチレビュー：下のグラフの区切りを押すと、その区切りの真ん中に縦の線を引き、そのときピッチにいた選手の帯に●を付ける（2026-10-17）
  if (o.pick) {
    for (const p of axis) {
      const nMin = Math.ceil(p.len / BIN), bw0 = HW[p.key] / nMin;
      for (let i = 0; i < nMin; i++) {
        const a = i * BIN, b = Math.min(p.len, (i + 1) * BIN), tc = (a + b) / 2;
        const ys = order.map((pid, k) => (M0.stints.some((q) => q.pid === pid && q.period === p.key && q.from <= tc && q.to > tc) ? top + k * rowH + rowH / 2 : null)).filter((v) => v != null);
        s += `<rect class="pbk" data-k="${p.key}:${i}" data-x="${x(p.key, tc).toFixed(1)}" data-ys="${ys.join(',')}" data-gaps="${(gaps[`${p.key}:${i}`] || []).join(',')}" data-lab="${esc(p.label)} ${mmss(a)}〜${mmss(b)}" data-c="${mmss(tc)}" x="${X[p.key] + i * bw0}" y="${lowTop}" width="${bw0}" height="${gy - lowTop}" fill="transparent" style="cursor:pointer"/>`;
      }
    }
    s += `<g class="pmk" data-top="${top - 2}" data-bot="${gy}"></g>`;
  }
  s += '</svg>';
  if (o.svgOnly) return s;
  if (o.pick) return `<section class="rvsec" id="rv5"><div class="rvtt"><b>5. マッチ・ペース</b><span>上段＝出場の帯と得点（緑）・失点（赤）。下段＝1分ごとの回数（上＝${esc(own)}、下＝${esc(opp)}）。行を押すと強調・下のグラフを押すと●</span></div><div class="rvbox">${s}<p class="rvhint pinfo" id="paceInfo"></p></div></section>`;
  return `<section class="rvsec" id="rv5"><div class="rvtt"><b>5. マッチ・ペース</b><span>上段＝出場の帯と得点（緑）・失点（赤）。下段＝1分ごとの回数（上＝${esc(own)}、下＝${esc(opp)}）</span></div><div class="rvbox">${s}</div></section>`;
}

// ---------- 7. スコアとチームスタッツ ----------
// PK戦のキッカー（自チーム、蹴った順）：「1 甲斐 ○　2 水谷 ×（GKが止めた）」
const PKR = { goal: '○', saved: '×（GKが止めた）', missed: '×（枠外・ポスト）' };
const PKC = { tl: '左上', tc: '中央上', tr: '右上', bl: '左下', bc: '中央下', br: '右下', ol: '左枠外', ot: '上枠外', or: '右枠外' };
function pkLine(c) {
  const k = c.pk?.kicks || []; if (!k.length) return '';
  return `<div class="rvpk"><b>PK戦のキッカー</b>${k.map((x, i) => `<span>${i + 1}人目 ${x.pid ? `${c.badge(x.pid)}${esc(c.last(x.pid))}` : '<span class="na">—</span>'}${x.course ? ` <small>${PKC[x.course] || ''}</small>` : ''} ${PKR[x.res] || '<span class="na">結果なし</span>'}</span>`).join('')}</div>`;
}
export function teamSection(c, o = {}) {
  const { R, badge, last, own, opp, goalName, M0 } = c;
  const { A, B } = R;
  const tot = (side) => Object.values(R.score[side]).reduce((a, b) => a + b, 0);
  // スコアの下に、前半・後半…を1行ずつ（2026-10-18）
  const per = M0.periods.filter((p) => p.status !== 'none').map((p) => `<span>${p.label}　${R.score.own[p.key]} − ${R.score.opp[p.key]}</span>`).join('') + (c.pk ? `<span>PK　${c.pk.own ?? 0} − ${c.pk.opp ?? 0}</span>` : '');
  let so = 0, sp = 0;
  const P = (pid) => (pid === OPP_OG ? '相手OG' : pid === UNKNOWN ? '不明' : pid ? `${badge(pid)}<span class="gnm">${esc(last(pid))}</span>` : '<span class="na">—</span>');
  const flow = R.goals.map(({ e, own: o }) => {
    o ? so++ : sp++;
    const pl = M0.periods.find((p) => p.key === e.period);
    const scorer = o ? P(e.pid) : (e.og ? `OG ${P(e.og)}` : '<span class="na">—</span>');
    const assist = !o || e.pid === OPP_OG ? '<span class="na">—</span>' : e.assist === NO_ASSIST ? 'なし' : e.assist ? P(e.assist) : '<span class="na">未入力</span>';
    // 1点ごとに1行。左から スコア・時間・チーム・得点者・アシスト・得点の種類（目を横に大きく動かさずに読めるよう、列は中身の幅だけ。2026-10-18）
    return `<tr class="${o ? 'own' : 'opp'}"><td class="gsc"><b>${so} − ${sp}</b></td><td class="gtm">${pl?.label || ''} ${mmss(e.at)}</td><td class="gtn">${esc(o ? own : opp)}</td><td>${scorer}</td><td>${o ? `<small>アシスト</small> ${assist}` : ''}</td><td>${e.gtype ? esc(goalName(e.gtype)) : '<span class="na">種類 未入力</span>'}</td></tr>`;
  }).join('') || `<tr><td colspan="6" class="nog">${M0.live ? 'ここまで得点・失点なし' : '得点・失点なし'}（0 − 0）</td></tr>`;
  const cmpMax = Math.max(1, A.shots, B.shots, A.z4, B.z4, A.fsp, B.fsp, A.foul, B.foul);
  const cmp = (label, a, b, sub = null) => `<tr><td class="xb l"><i style="width:${a == null ? 0 : Math.round(a / cmpMax * 170)}px"></i></td><td class="cv">${a == null ? '<span class="na">—</span>' : a}${sub && a != null ? `<small>${sub[0]}</small>` : ''}</td><td class="cl">${label}</td><td class="cv">${b == null ? '<span class="na">—</span>' : b}${sub && b != null ? `<small>${sub[1]}</small>` : ''}</td><td class="xb r"><i style="width:${b == null ? 0 : Math.round(b / cmpMax * 170)}px"></i></td></tr>`;
  const fspSub = (s) => `CK ${s.fspT[0]}・CK-KI ${s.fspT[1]}・KI ${s.fspT[2]}・FK ${s.fspT[3]}`;
  const cardSub = (s) => `イエロー${s.cards.yellow}・レッド${s.cards.red}`;
  const scoreH = `<div class="rvscore7"><div class="sc1"><span class="tn">${esc(own)}</span><span class="sv">${tot('own')} − ${tot('opp')}</span><span class="tn">${esc(opp)}</span></div><div class="hv">${per}</div></div>${pkLine(c)}
`;
  const flowH = `<table class="rvflow"><tr><th>スコア</th><th>時間</th><th>チーム</th><th>得点者</th><th>アシスト</th><th>得点の種類</th></tr>${flow}</table>
`;
  const cmpH = `<table class="rvcmp"><tr><th></th><th class="own">${esc(own)}</th><th></th><th class="opp">${esc(opp)}</th><th></th></tr>
${cmp('シュート', A.shots, B.shots, [`SZ内 ${A.sz}`, `SZ内 ${B.sz}`])}${cmp('枠内', A.in, B.in)}${cmp('Z4進入', A.z4, B.z4)}${cmp('SZ進入', A.szE, B.szE)}${cmp('FINISH SET PLAY', A.fsp, B.fsp, [fspSub(A), fspSub(B)])}${cmp('ファール', A.foul, B.foul)}${cmp('カード', A.cardN, B.cardN, [cardSub(A), cardSub(B)])}${cmp('退場', R.ejOwn, R.ejOpp)}${cmp('タイムアウト', R.timeouts.own, R.timeouts.opp)}</table>
`;
  const rlH = `<div class="rvrl"><b>${esc(own)}のリカバリーとロスト</b><span>リカバリー <b>${R.rec}</b></span><span>ロスト <b>${R.lost}</b></span><span>差 <b>${R.rec - R.lost}</b></span></div>
`;
  const hintH = `<p class="rvhint">シュートは得点を含む（OGは除く）。${esc(opp)}のファール・カード＝${esc(own)}の被ファールで記録したもの。2枚目のイエロー（退場）は、イエローとレッドの両方に1枚ずつ数える。退場：${esc(own)}はMATCH PLAYの退場の記録、${esc(opp)}は被ファールのイエロー2枚目とレッド。タイムアウトはMATCH PLAYの記録</p>`;
  const inner = scoreH + flowH + cmpH + rlH + hintH;
  if (o.plain) return inner;
  // 画面：上から スコア → 得点経過 → 比較 → リカバリーとロスト（1画面に入るように詰めて表示。2026-10-18）
  return `<section class="rvsec" id="rv7"><div class="rvtt"><b>7. スコアとチームスタッツ</b><span>得点経過と、${esc(own)}と${esc(opp)}の比較。時間は経過時間</span></div>
<div class="rvbox">${scoreH}${flowH}${cmpH}${rlH}${hintH}</div></section>`;
}

// ---------- 8. スタッツまとめ ----------
export function playerSection(c) {
  const { M0, evs, goalName, T0, byNo, gkLast, badge, last, R } = c;
  const P = playerStats(M0, evs, goalName, gkLast(byNo), T0);
  const played = M0.periods.reduce((a, p) => a + p.elapsed, 0);
  const sum = (k) => P.rows.reduce((a, r) => a + r[k], 0);
  // 2026-10-19：パスの出し手・受け手をやめ、枠内率と、評価につながる差（シュート関与の差・進入関与の差・リカバリー−ロスト）を足す。
  // 並び：本人のプレー → ピッチにいた間（関与）→ 差 → 得失点±
  const sg = (v) => `${v > 0 ? '+' : ''}${v}`;
  const rate = (a, b) => (b ? Math.round(a / b * 100) + '%' : '—');
  const rows = tSorted(8, P.rows, (r, k) => r[k], (r) => !r.time).map((r) => {
    const z = (v) => (r.time ? v : `<span class="na">${v}</span>`);
    return `<tr class="${r.time ? '' : 'zero'} ${hlc('8:' + r.pid)}" data-hlk="8:${r.pid}"><td><span class="pnm">${badge(r.pid)}<span>${esc(last(r.pid))}</span></span></td><td>${mmss(r.time)}</td><td>${z(r.shots)}<small>（${r.sz}）</small></td><td>${z(r.in)}</td><td>${z(rate(r.in, r.shots))}</td><td>${z(r.goals)}</td><td>${z(r.assists)}</td><td>${z(r.z4)}</td><td>${z(r.szE)}</td><td>${z(r.rec)}</td><td>${z(r.lost)}</td><td>${z(r.foul)}</td><td class="w">${z(r.shotOn)}</td><td class="o">${z(r.oshotOn)}</td><td class="df"><b>${z(sg(r.shotDiff))}</b></td><td class="df"><b>${z(sg(r.entDiff))}</b></td><td class="df"><b>${z(sg(r.rlDiff))}</b></td><td><b>${r.time ? sg(r.pm) : '<span class="na">0</span>'}</b></td></tr>`;
  }).join('');
  const tot = (side) => Object.values(R.score[side]).reduce((a, b) => a + b, 0);
  const goalsN = tot('own');
  const A = R.A, B = R.B;
  return `<section class="rvsec" id="rv8"><div class="rvtt"><b>8. スタッツまとめ</b><span>選手ごと（背番号順、GKは一番下）。見出しを押すと並べ替え。関与＝ピッチにいる間の数。差＝自チーム−相手。±＝得点−失点</span></div>
<div class="rvbox"><table class="rvtb rvs8 rveq rvauto rvnm" style="--nmw:${Math.max(2, ...P.rows.map((r) => last(r.pid).length))}"><colgroup><col class="c1"></colgroup><tr><th class="srt ${tSort[8].col ? '' : 'on'}" data-tsort="8:">選手<i>${tSort[8].col ? '' : '背番号順'}</i></th>${tsh(8, 'time', '出場')}${tsh(8, 'shots', 'シュート<br><small>（SZ内）</small>')}${tsh(8, 'in', '枠内')}${tsh(8, 'inRate', '枠内率')}${tsh(8, 'goals', '得点')}${tsh(8, 'assists', 'アシスト')}${tsh(8, 'z4', 'Z4進入')}${tsh(8, 'szE', 'SZ進入')}${tsh(8, 'rec', 'リカバリー')}${tsh(8, 'lost', 'ロスト')}${tsh(8, 'foul', 'ファール')}${tsh(8, 'shotOn', 'シュート<br>関与', 'w')}${tsh(8, 'oshotOn', '被シュート<br>関与', 'o')}${tsh(8, 'shotDiff', 'シュート<br>関与の差', 'df')}${tsh(8, 'entDiff', '進入<br>関与の差', 'df')}${tsh(8, 'rlDiff', 'リカバリー<br>−ロスト', 'df')}${tsh(8, 'pm', '得失点±')}</tr>${rows}
<tr class="tot"><td>チーム合計</td><td>${mmss(played)}</td><td>${A.shots}<small>（${A.sz}）</small></td><td>${A.in}</td><td>${rate(A.in, A.shots)}</td><td>${goalsN}</td><td>${sum('assists')}${P.assistMiss ? `<div class="miss">未入力 ${P.assistMiss}</div>` : ''}</td><td>${A.z4}</td><td>${A.szE}</td><td>${R.rec}</td><td>${R.lost}</td><td>${A.foul}</td><td class="w">${A.shots}</td><td class="o">${B.shots}</td><td class="df">${sg(A.shots - B.shots)}</td><td class="df">${sg(A.z4 + A.szE - B.z4 - B.szE)}</td><td class="df">${sg(R.rec - R.lost)}</td><td>${sg(goalsN - tot('opp'))}</td></tr></table>
<p class="rvhint">シュートは得点を含む。枠内率＝枠内÷シュート。シュート関与の差＝シュート関与−被シュート関与。進入関与の差＝ピッチにいる間の自チームのZ4・SZ進入−相手のZ4・SZ進入。Z4進入・SZ進入＝本人が進入に関わった回数（ドリブル・パスの出し手と受け手・リバウンド。パスは2人とも +1 なので、選手の合計はチーム合計（進入の本数）より多くなります）。関与＝ピッチにいる間の数。チーム合計のシュート・リカバリーなどは、選手が「不明」や未入力のものも含むので、選手の合計と合わないことがあります。得点には相手OGを含む</p></div></section>`;
}

// 試合の状況の帯に出すスコア
export function scoreBadge(c, R) {
  const tot = (side) => Object.values(R.score[side]).reduce((a, b) => a + b, 0);
  return `<span class="rvscore">${esc(c.own)} <b>${tot('own')}−${tot('opp')}</b> ${esc(c.opp)}</span>`;
}
export { teamStats };

// マッチ・ペースの操作：選手の行を押すと強調、下のグラフの区切りを押すと縦の線と●（同じ区切りをもう一度押すと消す）
let paceSel = null;
export function bindPacePick(root) {
  const svg = root.querySelector('#rv5 svg.pace'); if (!svg) return;
  const info = root.querySelector('#paceInfo'); const mk = svg.querySelector('.pmk');
  const draw = (b) => {
    mk.innerHTML = ''; svg.querySelectorAll('.pbk.on').forEach((x) => x.classList.remove('on'));
    if (!b) { if (info) info.textContent = ''; return; }
    b.classList.add('on');
    const x = b.dataset.x, top = mk.dataset.top, bot = mk.dataset.bot, ys = b.dataset.ys ? b.dataset.ys.split(',') : [];
    // 縦の線は、下のグラフの棒と数字があるところだけあける
    const gp = (b.dataset.gaps ? b.dataset.gaps.split(',') : []).map((g) => g.split('-').map(Number)).sort((a, c) => a[0] - c[0]);
    let seg = '', y0 = +top;
    for (const [g1, g2] of gp) { if (g1 > y0) seg += `<line x1="${x}" x2="${x}" y1="${y0}" y2="${g1}" stroke="#F08C00" stroke-width="2.5"/>`; y0 = Math.max(y0, g2); }
    if (+bot > y0) seg += `<line x1="${x}" x2="${x}" y1="${y0}" y2="${bot}" stroke="#F08C00" stroke-width="2.5"/>`;
    mk.innerHTML = seg + ys.map((y) => `<circle cx="${x}" cy="${y}" r="6" fill="#F08C00" stroke="#fff" stroke-width="2"/>`).join('');
    if (info) info.textContent = `${b.dataset.lab} の真ん中（${b.dataset.c}）にピッチにいた選手に●を付けています（${ys.length}人）。同じところをもう一度押すと消えます`;
  };
  if (paceSel) draw(svg.querySelector(`.pbk[data-k="${paceSel}"]`));
  // 帯の名前：PCはカーソルを合わせている間、iPadは触れたときに出す（ほかを触ると消える）
  const tipper = bandTip(svg.closest('.rvbox'), svg, '.pst', (r) => r.dataset.pt);
  svg.addEventListener('click', (e) => {
    if (tipper.touch() && e.target.closest('.pst')) return; // iPad で帯に触れたときは名前を出すだけ（行の強調はしない）
    const b = e.target.closest('.pbk');
    if (b) { paceSel = paceSel === b.dataset.k ? null : b.dataset.k; draw(paceSel ? b : null); return; }
    // 選手の行を押すと強調（黄色＋オレンジの枠。何人でも。もう一度押すと戻す）
    const r = e.target.closest('[data-prl]');
    if (r) { const k = '5:' + r.dataset.prl; rvHl.has(k) ? rvHl.delete(k) : rvHl.add(k); r.classList.toggle('on', rvHl.has(k)); }
  });
}

// 帯の上に名前を出す（マッチ・ペース、出場タイムライン）。box：位置の基準（position:relative）、area：帯のある所
// PC：カーソルを合わせている間。iPad：触れたとき（4秒か、ほかを触ると消える）
export function bandTip(box, area, sel, textOf) {
  let tip = null, touch = false, t = null;
  const show = (r) => {
    if (!box) return;
    // 画面に直接置く（大きく表示で枠が拡大されていても、位置がずれないように）
    if (!tip || !tip.isConnected) { tip = document.querySelector('body > .ptip') || document.body.appendChild(Object.assign(document.createElement('div'), { className: 'ptip' })); }
    { const v = textOf(r); if (v && v.html) { tip.innerHTML = v.html; tip.classList.add('rich'); } else { tip.textContent = v; tip.classList.remove('rich'); } } tip.style.display = 'block';
    const rr = (r.querySelector('[data-anchor]') || r).getBoundingClientRect();
    const tw = tip.offsetWidth; let lx = rr.left + rr.width / 2 - tw / 2; lx = Math.max(4, Math.min(window.innerWidth - tw - 4, lx));
    tip.style.left = lx + 'px'; tip.style.top = Math.max(2, rr.top - tip.offsetHeight - 4) + 'px';
  };
  const hide = () => { if (tip) tip.style.display = 'none'; };
  area.addEventListener('pointerdown', (e) => { touch = e.pointerType === 'touch' || e.pointerType === 'pen'; if (touch) { const r = e.target.closest(sel); if (r) { show(r); clearTimeout(t); t = setTimeout(hide, 4000); } else hide(); } });
  area.addEventListener('pointermove', (e) => { if (e.pointerType !== 'mouse') return; const r = e.target.closest(sel); if (r) show(r); else hide(); });
  area.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse') hide(); });
  window.addEventListener('scroll', hide, { passive: true });
  return { touch: () => touch };
}

// 1・2・4・6・8 の表の列幅（2026-10-18）：等間隔をやめて、列の中身の長さに合わせて配る。
// 列ごとに「中身（その試合の一番長い数字・名前）」と「見出しの文字（並べ替えの印は除く）」の長い方を測り、
// 選手の列はその倍にして、表の幅をその比で分ける（中身の長い列ほど広い）。PDF にもそのまま写る（％で書くので）
export function sizeCols(root) {
  const rng = document.createRange();
  const textW = (el) => { rng.selectNodeContents(el); return rng.getBoundingClientRect().width; };
  const done = [];
  for (const t of root.querySelectorAll('table.rvauto')) {
    const rows = [...t.rows]; if (rows.length < 2) continue;
    const head = rows[0]; const n = head.cells.length;
    // 測るときは折り返さない・幅を決めない形にする
    t.classList.add('rvmeasure');
    const w = Array(n).fill(0);
    for (const r of rows.slice(1)) {
      if (r.cells.length !== n) continue; // 「まだありません」など横につないだ行
      const label = r.classList.contains('ex') || r.classList.contains('tot');
      [...r.cells].forEach((c, i) => { if (label && c.classList.contains('setn')) return; w[i] = Math.max(w[i], textW(c)); });
    }
    [...head.cells].forEach((c, i) => {
      const k = c.cloneNode(true); k.querySelectorAll('i').forEach((x) => x.remove());
      // 見出しは改行（<br>）ごとの一番長い行
      const lines = k.innerHTML.split(/<br\s*\/?>/i).map((h) => { const sp = document.createElement('span'); sp.style.cssText = 'position:absolute;visibility:hidden;white-space:nowrap;font:inherit'; sp.innerHTML = h; c.appendChild(sp); const v = sp.getBoundingClientRect().width; sp.remove(); return v; });
      w[i] = Math.max(w[i], ...lines);
    });
    t.classList.remove('rvmeasure');
    if (t.classList.contains('rvs8') && window.innerWidth < 1000) w[0] *= 1.1; // 8は列が多いので、狭い画面では選手の列を広げすぎない
    else if (t.classList.contains('rvnm')) w[0] *= t.dataset.nmx ? +t.dataset.nmx : t.closest('.rvpgrid') && window.innerWidth > 1000 ? 1.4 : 2; // 選手の列は倍（2 は表が2つ並ぶので控えめ）
    // 狭い画面（iPad縦など）はマスの左右の余白が小さいので、足す分も小さく（2026-10-19）
    const pad = window.innerWidth < 1000 && t.classList.contains('rvs8') ? 8 : 18; const ws = w.map((x) => Math.max(18, x) + pad);
    done.push({ t, ws });
  }
  // 4 と 6 の表は、順位とFP4人のセットの列を同じ幅にそろえる（2026-10-19）
  const sets = done.filter((d) => d.t.classList.contains('rvset4') || d.t.classList.contains('rvset2'));
  if (sets.length > 1) {
    const fix = [0, 1].map((i) => Math.max(...sets.map((d) => d.ws[i])));
    for (const d of sets) {
      const W = d.t.parentElement?.clientWidth || 0; const rest = d.ws.slice(2).reduce((a, b) => a + b, 0);
      const fx = fix[0] + fix[1];
      if (W > fx + rest * 0.6) { d.pct = [fix[0] / W * 100, fix[1] / W * 100, ...d.ws.slice(2).map((x) => x / rest * (100 - fx / W * 100))]; }
    }
  }
  for (const d of done) {
    const sum = d.ws.reduce((a, b) => a + b, 0); const pct = d.pct || d.ws.map((x) => x / sum * 100);
    let cg = d.t.querySelector('colgroup'); if (!cg) { cg = document.createElement('colgroup'); d.t.prepend(cg); }
    cg.innerHTML = pct.map((x) => `<col style="width:${x.toFixed(2)}%">`).join('');
    // 中身が枠に入りきらないときは、縮めて重ねずに横に動かして見る（2026-10-19）
    const W = d.t.parentElement?.clientWidth || 0; const sum2 = d.ws.reduce((x, y) => x + y, 0);
    if (d.t.classList.contains('rvs8')) { d.t.style.minWidth = W && sum2 > W ? Math.ceil(sum2) + 'px' : ''; if (d.t.parentElement) d.t.parentElement.style.overflowX = W && sum2 > W ? 'auto' : ''; }
  }
}
