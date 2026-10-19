// 表の行の強調と、数字の上の選手の表示（2026-10-19）
// ・分析画面の表：行を押すと黄色＋オレンジの枠（マッチレビューと同じ。何行でも。開いている間だけで保存しない）
// ・分析画面とマッチレビューの表：数字にカーソルを合わせると（iPadは触れると）、数字のすぐ上にその行の選手の番号と名前（セットは4人）
import { esc } from './ui.js';

let tip = null, timer = 0;
const tipEl = () => {
  if (!tip || !tip.isConnected) tip = document.body.appendChild(Object.assign(document.createElement('div'), { className: 'ctip' }));
  return tip;
};
export function hideCellTip() { clearTimeout(timer); if (tip) tip.style.display = 'none'; }
// 行の中で選手（背番号の印）が入っているマス
const whoCell = (tr) => [...tr.cells].find((td) => td.querySelector('span.no')) || null;
// 行の印：選手（セットは4人）の背番号。並べ替えても同じ行と分かるように
const rowKey = (tr) => { const c = whoCell(tr); return c ? [...c.querySelectorAll('span.no')].map((x) => x.textContent.trim()).join(',') : (tr.cells[0]?.textContent || '').trim(); };
const tipHTML = (c) => [...c.querySelectorAll('span.no')].map((n) => `<span class="ctp"><span class="${esc(n.className)}">${esc(n.textContent.trim())}</span>${esc((n.nextElementSibling?.textContent || '').trim())}</span>`).join('');

let scrollHook = false;
export function bindCellTip(root, tableSel) {
  if (!scrollHook) { scrollHook = true; window.addEventListener('scroll', hideCellTip, { passive: true, capture: true }); }
  root.addEventListener('pointerover', (e) => {
    const td = e.target.closest?.('td');
    if (!td || !td.closest(tableSel) || td.closest('svg') || !td.closest('tbody')) { if (e.pointerType !== 'touch') hideCellTip(); return; }
    const c = whoCell(td.parentElement);
    if (!c || c === td || !td.textContent.trim()) { hideCellTip(); return; }
    const t = tipEl(); t.innerHTML = tipHTML(c); t.style.display = 'block';
    const r = td.getBoundingClientRect(), w = t.offsetWidth, h = t.offsetHeight;
    const x = Math.max(4, Math.min(window.innerWidth - w - 4, r.left + r.width / 2 - w / 2));
    const y = r.top - h - 4 < 4 ? r.bottom + 4 : r.top - h - 4;
    t.style.left = x + 'px'; t.style.top = y + 'px';
    clearTimeout(timer); if (e.pointerType === 'touch') timer = setTimeout(hideCellTip, 2500);
  });
  root.addEventListener('pointerleave', (e) => { if (e.pointerType !== 'touch') hideCellTip(); });
}

// 行を押すと強調。store：強調している行の印（画面を描き直しても残す）、pre：表の場所（タブなど）
export function bindRowHl(root, tableSel, store, pre) {
  root.querySelectorAll(tableSel).forEach((tb, i) => {
    tb.querySelectorAll('tbody tr').forEach((tr) => {
      if (tr.classList.contains('anmore')) return;
      const k = `${pre}|${i}|${rowKey(tr)}`;
      tr.classList.toggle('hl', store.has(k)); tr.classList.add('hlable');
      tr.addEventListener('click', (e) => { if (e.target.closest('button,a,input,select')) return; store.has(k) ? store.delete(k) : store.add(k); tr.classList.toggle('hl', store.has(k)); });
    });
  });
}
