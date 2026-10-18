// 拡大表示（マッチスタッツ・分析。2026-10-18）：アプリの上の帯と左右の余白をなくし、中身を画面いっぱいの大きさにする。
// 「⛶ 拡大表示」で入り、「× 閉じる」か Esc で戻る。ほかの画面へ移ると自動で戻る。
// マッチレビューの拡大表示（review.js）と同じ考え方。広げ方（fit）は画面ごとに渡す
import { render } from './views.js';

let on = false;
let page = null; // 拡大表示にした画面（ハッシュの形）
export const bigOn = () => on && page === pageKey();
const pageKey = () => (location.hash.match(/^#\/(m\/[^/]+\/stats|analysis)/) || [])[1] || null;
export const bigBtn = () => `<button class="btn ${bigOn() ? 'pri' : ''}" id="bigBtn">${bigOn() ? '× 閉じる' : '⛶ 拡大表示'}</button>`;
function set(v) { on = v; page = v ? pageKey() : null; document.body.classList.toggle('bigv', v); render(); }
export function bindBig(root, fit) {
  document.body.classList.toggle('bigv', bigOn());
  const b = root.querySelector('#bigBtn'); if (b) b.onclick = () => set(!bigOn());
  if (bigOn() && fit) fit(root);
}
if (typeof window !== 'undefined' && !window.__bigv) {
  window.__bigv = true;
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && bigOn()) set(false); });
  window.addEventListener('hashchange', () => { if (on && page !== pageKey()) { on = false; page = null; document.body.classList.remove('bigv'); } });
  let t = null; window.addEventListener('resize', () => { if (!bigOn()) return; clearTimeout(t); t = setTimeout(() => render(), 250); });
}
// 中身（el）を、幅 availW・高さ availH に入る一番大きい倍率に広げる（maxZ まで）。入らないときは等倍で上下に動かして見る
export function fitBox(el, availW, availH, { maxZ = 1.8, minW = 0 } = {}) {
  el.style.zoom = ''; el.style.width = '';
  for (let z = maxZ; z >= 1; z -= 0.02) {
    if (minW && availW / z < minW) continue;
    el.style.width = `${availW / z}px`;
    if (el.offsetHeight * z <= availH) { el.style.zoom = z.toFixed(2); return z; }
  }
  el.style.width = ''; return 1;
}
