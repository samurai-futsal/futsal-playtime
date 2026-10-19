// 表の行の強調（2026-10-19）
// ・分析画面の表：行を押すと黄色＋オレンジの枠（マッチレビューと同じ。何行でも。開いている間だけで保存しない）
// （数字の上に選手を出す機能は、見づらいので外した。2026-10-19）
// 行の中で選手（背番号の印）が入っているマス
const whoCell = (tr) => [...tr.cells].find((td) => td.querySelector('span.no')) || null;
// 行の印：選手（セットは4人）の背番号。並べ替えても同じ行と分かるように
const rowKey = (tr) => { const c = whoCell(tr); return c ? [...c.querySelectorAll('span.no')].map((x) => x.textContent.trim()).join(',') : (tr.cells[0]?.textContent || '').trim(); };

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
