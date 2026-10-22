// コートの図（2026-10-22）。イベント入力で場所を押す図と、分析の場所の図で使う。
// 座標はメートル（40m×20m）。x：自陣のゴールライン 0 → 相手のゴールライン 40。y：+10 が上（L）〜 −10 が下（R）。
import { PITCH, areaOf } from './events.js';

const S = 20, M = 14; // 1m = 20（図の中の単位）、まわりの余白
export const CW = PITCH.L * S + M * 2, CH = PITCH.W * S + M * 2 + 18;
const X = (m) => M + m * S, Y = (m) => M + (10 - m) * S;
const poly = (pts, attrs) => `<polygon points="${pts.map(([a, b]) => `${X(a).toFixed(1)},${Y(b).toFixed(1)}`).join(' ')}" ${attrs}/>`;

// marks：[{ loc, cls, label }]。opp：相手のイベント（自陣のゴール前を強める）
export function courtSVG({ marks = [], opp = false, cls = '', labels = true } = {}) {
  const g = [];
  g.push(`<rect x="${X(0)}" y="${Y(10)}" width="${40 * S}" height="${20 * S}" class="cbg"/>`);
  g.push(`<rect x="${X(0)}" y="${Y(10)}" width="${10 * S}" height="${20 * S}" class="cz1"/><rect x="${X(30)}" y="${Y(10)}" width="${10 * S}" height="${20 * S}" class="cz4"/>`);
  for (const [gl, sg, c] of [[40, 1, 'csz'], [0, -1, 'csz o']]) {
    const b = gl - 10 * sg;
    g.push(poly([[b, 5], [gl, 7.5], [gl, -7.5], [b, -5]], `class="${c}"`));
    g.push(`<line x1="${X(gl - 5 * sg)}" y1="${Y(6.25)}" x2="${X(gl - 5 * sg)}" y2="${Y(-6.25)}" class="cszl"/>`);
    for (const yy of [1, -1]) g.push(poly([[gl, 10 * yy], [gl, 5 * yy], [gl - 10 * sg, 10 * yy]], 'class="cdz"'));
  }
  for (const xx of [10, 30]) g.push(`<line x1="${X(xx)}" y1="${Y(10)}" x2="${X(xx)}" y2="${Y(-10)}" class="cdash"/>`);
  for (const yy of [5, -5]) g.push(`<line x1="${X(0)}" y1="${Y(yy)}" x2="${X(40)}" y2="${Y(yy)}" class="cdash2"/>`);
  g.push(`<rect x="${X(0)}" y="${Y(10)}" width="${40 * S}" height="${20 * S}" class="cline"/>`);
  g.push(`<line x1="${X(20)}" y1="${Y(10)}" x2="${X(20)}" y2="${Y(-10)}" class="cline"/><circle cx="${X(20)}" cy="${Y(0)}" r="${3 * S}" class="cline"/>`);
  for (const [gl, sg] of [[0, 1], [40, -1]]) {
    const x6 = gl + 6 * sg, sw = sg === 1 ? 1 : 0;
    g.push(`<path d="M${X(gl)} ${Y(7.5)} A${6 * S} ${6 * S} 0 0 ${sw} ${X(x6)} ${Y(1.5)} L${X(x6)} ${Y(-1.5)} A${6 * S} ${6 * S} 0 0 ${sw} ${X(gl)} ${Y(-7.5)}" class="cline thin"/>`);
    g.push(`<rect x="${gl === 0 ? X(0) - 8 : X(40)}" y="${Y(1.5)}" width="8" height="${3 * S}" class="cgoal"/><circle cx="${X(gl + 10 * sg)}" cy="${Y(0)}" r="3.5" class="cdot"/><circle cx="${X(gl + 6 * sg)}" cy="${Y(0)}" r="3" class="cdot"/>`);
  }
  if (labels) {
    const L = [[5, 7.5, '1L'], [5, 0, '1C'], [5, -7.5, '1R'], [15, 7.5, '2L'], [15, 0, '2C'], [15, -7.5, '2R'], [25, 7.5, '3L'], [25, 0, '3C'], [25, -7.5, '3R'],
      [32.4, 7.6, '4L'], [32.4, -7.6, '4R'], [32.5, 0, 'X'], [37.5, 0, 'XP'], [38.6, 8.9, 'DL'], [38.6, -8.9, 'DR']];
    for (const [a, b, t] of L) g.push(`<text x="${X(a)}" y="${Y(b) + 5}" class="clab ${t === 'X' || t === 'XP' ? 'sz' : ''}">${t}</text>`);
    ['ZONE 1', 'ZONE 2', 'ZONE 3', 'ZONE 4'].forEach((t, i) => g.push(`<text x="${X(5 + 10 * i)}" y="${Y(-10) + 15}" class="czn">${t}</text>`));
  }
  for (const mk of marks) {
    if (!mk.loc) continue; const cx = X(+mk.loc.x), cy = Y(+mk.loc.y);
    g.push(mk.shape === 'diamond' ? `<path d="M${cx} ${cy - 8} l8 8 -8 8 -8 -8z" class="cmk ${mk.cls || ''}"/>` : `<circle cx="${cx}" cy="${cy}" r="${mk.r || 8}" class="cmk ${mk.cls || ''}"/>`);
  }
  return `<svg class="court ${cls} ${opp ? 'opp' : ''}" viewBox="0 0 ${CW} ${CH}">${g.join('')}</svg>`;
}
// 押した場所（画面の座標）→ メートル
export function locFromEvent(svg, e) {
  const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY;
  const p = pt.matrixTransform(svg.getScreenCTM().inverse());
  const x = (p.x - M) / S, y = 10 - (p.y - M) / S;
  if (x < -0.5 || x > PITCH.L + 0.5 || y < -10.5 || y > 10.5) return null;
  return { x: Math.round(Math.max(0, Math.min(PITCH.L, x)) * 10) / 10, y: Math.round(Math.max(-10, Math.min(10, y)) * 10) / 10 };
}
export { areaOf };
