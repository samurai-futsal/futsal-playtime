// マッチレビュー 3. 出場タイムライン の「出てからの時間で見る」（2026-11-07）。
// 選手の帯を、その出場の出てからの時間で 緑（1分以内）→黄（1〜2分）→赤（2分を超えた所）に塗り、
// 上に「FP4人の平均」の段（コメントの「出てから2分」と同じ分け方）と、選んだイベントの印の段を出す。
// 横は試合の時計（経過）。ランニングタイムの切り替えには関係しない。
import { OPP_OG, isOGType } from './events.js';
import { esc } from './ui.js';

const mmss = (ms) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
export const FR_COL = { a: '#2E9E5B', b: '#E8B730', c: '#D93A2B', x: '#B9C0CC' };
export const FR_BAND = { a: '1分以内', b: '1〜2分', c: '2分以降', x: 'FP4人でない' };
// 印の段：[見出し, 上の段（自チーム）, 下の段（相手）, 上の名前, 下の名前]。条件は (e, goalName)
const isOwnShot = (e) => ['shot', 'szshot'].includes(e.kind) || (e.kind === 'goal' && e.pid !== OPP_OG);
const isOppShot = (e, gn) => ['oshot', 'oszshot'].includes(e.kind) || (e.kind === 'conc' && !isOGType(e.gtype, gn));
export const FR_ROWS = {
  shot: ['シュート', isOwnShot, isOppShot, 'シュート', '被シュート'],
  z4: ['Z4進入', (e) => e.kind === 'z4', (e) => e.kind === 'oz4', 'Z4進入', '被Z4進入'],
  sz: ['SZ進入', (e) => e.kind === 'sz', (e) => e.kind === 'osz', 'SZ進入', '被SZ進入'],
  fsp: ['FINISH SET PLAY', (e) => e.kind === 'fspat', (e) => e.kind === 'fspdf', 'FSP（AT）', 'FSP（DF）'],
  rl: ['リカバリー／ロスト', (e) => e.kind === 'rec', (e) => e.kind === 'lost', 'リカバリー', 'ロスト'],
};
const ROWS_KEY = 'fpt.rvFreshRows';
export function freshRows() { try { const v = JSON.parse(localStorage.getItem(ROWS_KEY) || 'null'); if (Array.isArray(v)) return v.filter((k) => FR_ROWS[k]); } catch {} return ['shot']; }
export function setFreshRows(v) { try { localStorage.setItem(ROWS_KEY, JSON.stringify(v)); } catch {} }

// FP4人の「出てからの時間」の平均（4人でないときは null）と、その分け方。マッチレビューのコメント（advice.js）と同じ
export function freshCalc(M, isGK) {
  const fpOn = (period, at) => M.stints.filter((x) => x.period === period && !isGK(x.pid) && x.from < at && at <= x.to);
  const elAt = (period, at) => { const ss = fpOn(period, at); return ss.length === 4 ? ss.reduce((a, x) => a + at - x.from, 0) / 4 : null; };
  const band = (el) => (el == null ? 'x' : el < 60000 ? 'a' : el >= 120000 ? 'c' : 'b');
  return { fpOn, elAt, band };
}

// c：{ M（プレーイングタイムの記録）, evs, goalName, mem, last, order }。rows：FR_ROWS のキー
export function freshHTML(c, rows) {
  const { M, evs, goalName, mem, last } = c;
  const isGK = (pid) => mem(pid).pos === 'GK';
  const { elAt, band, fpOn } = freshCalc(M, isGK);
  const num = (pid) => parseInt(mem(pid).no, 10) || 999;
  const pers = M.periods.filter((p) => p.status !== 'none' && p.elapsed > 0);
  const live = evs.filter((e) => !e.deleted);
  const evOf = (k, side) => live.filter((e) => FR_ROWS[k][side === 'w' ? 1 : 2](e, goalName));
  const isGoal = (e) => e.kind === 'goal' || e.kind === 'conc';
  // 表：選んだ項目を、印が付いた瞬間の「FP4人の平均」で分けて数える
  const T = { a: 0, b: 0, c: 0, x: 0 };
  for (const p of pers) for (let at = 1000; at <= p.elapsed; at += 1000) T[band(elAt(p.key, at))] += 1000;
  const cnt = (list) => { const o = { a: 0, b: 0, c: 0, x: 0 }; for (const e of list) o[band(elAt(e.period, e.at || 0))]++; return o; };
  const tip = (e, lab) => {
    const el = elAt(e.period, e.at || 0); const fps = fpOn(e.period, e.at || 0).sort((a, b) => a.from - b.from);
    const who = e.pid && e.pid !== OPP_OG && mem(e.pid).no != null ? `（${mem(e.pid).no} ${last(e.pid)}）` : '';
    return `${M.periods.find((p) => p.key === e.period)?.label || ''} ${mmss(e.at || 0)}　${lab}${isGoal(e) ? (e.kind === 'goal' ? '・得点' : '・失点') : ''}${who}\nFP4人の平均 ${el == null ? '—（4人でない）' : mmss(el)}${fps.length ? `：${fps.map((x) => `${mem(x.pid).no ?? ''}${last(x.pid)} ${mmss((e.at || 0) - x.from)}`).join('・')}` : ''}`;
  };
  const svgs = pers.map((p) => {
    const L = p.elapsed; const st = M.stints.filter((s) => s.period === p.key && s.to > s.from);
    const pids = [...new Set(st.map((s) => s.pid))].sort((a, b) => (isGK(a) - isGK(b)) || num(a) - num(b));
    const nmW = Math.max(4, ...pids.map((pid) => String(mem(pid).no ?? '').length + 1 + last(pid).length + (isGK(pid) ? 4 : 0))) * 12.5 + 14;
    const X0 = Math.max(120, nmW), W = 1000, xs = (ms) => X0 + ms / L * W;
    const LH = 15; const lanes = rows.flatMap((k) => [[k, 'w'], [k, 'o']]);
    const yAvg = 8 + lanes.length * LH + 4, top = yAvg + 26, RH = 24, H = top + pids.length * RH + 26;
    const g = [];
    for (let m = 0; m * 60000 <= L; m++) { const x = xs(m * 60000); g.push(`<line x1="${x}" y1="4" x2="${x}" y2="${H - 22}" class="${m % 5 ? 'fgl' : 'fgl5'}"/>${m % 5 === 0 ? `<text x="${x}" y="${H - 8}" class="fax">${m}:00</text>` : ''}`); }
    if (L % 300000) g.push(`<text x="${xs(L)}" y="${H - 8}" class="fax">${mmss(L)}</text>`);
    // FP4人の平均の段
    let run = null; const runs = [];
    for (let at = 1000; at <= L; at += 1000) { const b = band(elAt(p.key, at)); if (!run || run.b !== b) { run = { b, from: at - 1000, to: at }; runs.push(run); } run.to = at; }
    g.push(`<text x="${X0 - 8}" y="${yAvg + 13}" class="flab" text-anchor="end">FP4人の平均</text>`);
    for (const r of runs) g.push(`<rect x="${xs(r.from).toFixed(1)}" y="${yAvg}" width="${Math.max(0.6, xs(r.to) - xs(r.from)).toFixed(1)}" height="17" fill="${FR_COL[r.b]}"><title>${FR_BAND[r.b]}　${mmss(r.from)}〜${mmss(r.to)}</title></rect>`);
    // 印の段と、「2分以降」の印の縦の線
    const vl = [];
    lanes.forEach(([k, side], i) => {
      const y = 8 + i * LH; const R = FR_ROWS[k]; const lab = side === 'w' ? R[3] : R[4];
      g.push(`<text x="${X0 - 8}" y="${y + 10}" class="flab ${side}" text-anchor="end">${esc(lab)}</text><line x1="${X0}" y1="${y + 6}" x2="${X0 + W}" y2="${y + 6}" class="flane"/>`);
      for (const e of evOf(k, side).filter((e) => e.period === p.key)) {
        const x = xs(e.at || 0); const bt = esc(tip(e, lab)); const cb = band(elAt(p.key, e.at || 0));
        g.push(isGoal(e) ? `<circle cx="${x.toFixed(1)}" cy="${y + 6}" r="6" class="fmk ${side} g" data-bt="${bt}"/>` : `<path d="M${(x - 5).toFixed(1)} ${y + 1} h10 l-5 9z" class="fmk ${side}" data-bt="${bt}"/>`);
        if (cb === 'c') vl.push(`<line x1="${x.toFixed(1)}" y1="${y + 10}" x2="${x.toFixed(1)}" y2="${H - 22}" class="fvl ${side}"/>`);
      }
    });
    // 選手の帯
    pids.forEach((pid, i) => {
      const y = top + i * RH;
      g.push(`<rect x="${X0}" y="${y}" width="${W}" height="${RH - 4}" class="frow"/><text x="${X0 - 8}" y="${y + 15}" class="fnm" text-anchor="end">${esc(String(mem(pid).no ?? ''))} ${esc(last(pid))}${isGK(pid) ? '（GK）' : ''}</text>`);
      for (const s of st.filter((s) => s.pid === pid)) {
        const len = s.to - s.from; const x1 = xs(s.from), x2 = xs(s.to);
        if (isGK(pid)) { g.push(`<rect x="${x1.toFixed(1)}" y="${y + 3}" width="${(x2 - x1).toFixed(1)}" height="${RH - 10}" fill="#6B7A99"/>`); continue; }
        for (const [k, a, b] of [['a', 0, 60000], ['b', 60000, 120000], ['c', 120000, 1e9]]) { if (len <= a) continue; g.push(`<rect x="${xs(s.from + a).toFixed(1)}" y="${y + 3}" width="${(xs(s.from + Math.min(len, b)) - xs(s.from + a)).toFixed(1)}" height="${RH - 10}" fill="${FR_COL[k]}"/>`); }
        g.push(`<rect x="${x1.toFixed(1)}" y="${y + 3}" width="${(x2 - x1).toFixed(1)}" height="${RH - 10}" class="fsb"><title>${esc(last(pid))}　${mmss(s.from)}〜${mmss(s.to)}（${mmss(len)}）</title></rect>`);
        if (x2 - x1 > 28) g.push(`<text x="${((x1 + x2) / 2).toFixed(1)}" y="${y + 15}" class="fsl ${len >= 120000 ? 'r' : ''}">${mmss(len)}</text>`);
      }
    });
    return `<div class="frp"><div class="rvst2"><b>${esc(p.label)}</b><span>（${mmss(L)}）</span></div><svg class="frsv" viewBox="0 0 ${X0 + W + 16} ${H}" preserveAspectRatio="xMinYMin meet">${g.join('')}${vl.join('')}</svg></div>`;
  }).join('');
  const lg = `<div class="frlg"><span><i style="background:${FR_COL.a}"></i>出てから1分以内</span><span><i style="background:${FR_COL.b}"></i>1〜2分</span><span><i style="background:${FR_COL.c}"></i>2分を超えた所</span><span><i style="background:#6B7A99"></i>GK</span><span>▼＝イベント　●＝得点・失点　縦の点線＝「2分以降」にあったもの</span></div>`;
  const tb = `<table class="rvtb frtb"><tr><th class="l">FP4人の「出てからの時間」の平均</th>${[...'abcx'].map((k) => `<th><i class="frsw" style="background:${FR_COL[k]}"></i>${k === 'x' ? 'FPが4人でない' : FR_BAND[k]}</th>`).join('')}</tr>
    <tr class="tm"><td class="l">時間</td>${[...'abcx'].map((k) => `<td>${mmss(T[k])}</td>`).join('')}</tr>
    ${rows.flatMap((k) => [['w', FR_ROWS[k][3]], ['o', FR_ROWS[k][4]]].map(([side, lab]) => { const o = cnt(evOf(k, side)); return `<tr><td class="l ${side}">${esc(lab)}</td>${[...'abcx'].map((b) => `<td class="${side} ${b === 'c' ? 'cc' : ''}">${o[b] ? `<b>${o[b]}</b>` : '<span class="z">0</span>'}</td>`).join('')}</tr>`; })).join('')}</table>`;
  return `${lg}${svgs}<div class="frtw">${tb}<p class="rvhint">数え方はマッチレビューのコメント（💬）と同じ：試合の時計の1秒ごとに、ピッチにいるFP4人それぞれの出てからの時間を出し、4人の平均で分けます（GKは入れない。退場・5×4などでFPが4人でないときは「FPが4人でない」）。イベントは、その瞬間の平均で分けます。横は試合の時計（経過）</p></div>`;
}
