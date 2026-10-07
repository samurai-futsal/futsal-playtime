// Small UI helpers shared by all screens.
export const $ = (s, root = document) => root.querySelector(s);
export const $$ = (s, root = document) => [...root.querySelectorAll(s)];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const WD = ['日', '月', '火', '水', '木', '金', '土'];
export function fmtDate(s, withWd = true) {
  if (!s) return '—';
  const [y, m, d] = s.split('-').map(Number);
  const wd = WD[new Date(y, m - 1, d).getDay()];
  return `${y}/${m}/${d}${withWd ? `（${wd}）` : ''}`;
}
export function fmtShort(s) { if (!s) return '—'; const [, m, d] = s.split('-').map(Number); return `${m}/${d}`; }

// 背番号のバッジ：GKは赤、FPは青（spec 7章）
export function no(n, pos) {
  return `<span class="no ${pos === 'GK' ? 'gk' : 'fp'}">${esc(n ?? '—')}</span>`;
}

// ---------- modal ----------
let modalEl = null;
export function closeModal() { modalEl?.remove(); modalEl = null; }
export function openModal(html, { wide = false, onOpen } = {}) {
  closeModal();
  modalEl = document.createElement('div');
  modalEl.className = 'modal-bg';
  modalEl.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">${html}</div>`;
  document.body.appendChild(modalEl);
  modalEl.addEventListener('click', (e) => { if (e.target === modalEl) closeModal(); });
  const first = modalEl.querySelector('input,select,textarea');
  first && setTimeout(() => first.focus(), 30);
  onOpen && onOpen(modalEl);
  return modalEl;
}
// Confirmation inside the page (no browser dialogs). Returns a Promise<boolean>.
export function confirmBox({ title, body = '', ok = 'OK', danger = false, cancel = 'やめる' }) {
  return new Promise((resolve) => {
    const m = openModal(`<h2>${esc(title)}</h2><div class="mbody">${body}</div>
      <div class="mfoot"><button class="btn" data-x="0">${esc(cancel)}</button><button class="btn ${danger ? 'danger' : 'pri'}" data-x="1">${esc(ok)}</button></div>`);
    m.addEventListener('click', (e) => {
      const x = e.target.closest('[data-x]'); if (!x) return;
      closeModal(); resolve(x.dataset.x === '1');
    });
  });
}
// 確認を2回挟む削除など（spec：試合の削除・チームの削除）
export async function confirmTwice(first, second) {
  if (!(await confirmBox(first))) return false;
  return confirmBox(second);
}

// ---------- toast ----------
let toastT = null;
export function toast(msg) {
  let t = $('#toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
  t.textContent = msg; t.className = 'show';
  clearTimeout(toastT); toastT = setTimeout(() => { t.className = ''; }, 2400);
}

export function formVals(root) {
  const o = {};
  $$('[name]', root).forEach((el) => {
    if (el.type === 'checkbox') o[el.name] = el.checked;
    else if (el.type === 'radio') { if (el.checked) o[el.name] = el.value; }
    else o[el.name] = el.value.trim();
  });
  return o;
}
export function optionTags(list, selected, { blank = '' } = {}) {
  return (blank !== null ? `<option value="">${esc(blank)}</option>` : '') +
    list.map((o) => `<option value="${esc(o.name)}" ${o.name === selected ? 'selected' : ''}>${esc(o.name)}</option>`).join('');
}
