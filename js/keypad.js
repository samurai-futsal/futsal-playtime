// 時刻の入力（「:」は常に表示。数字のボタンで右から入れる：1→4→5→0 で 14:50）。
// MATCH PLAYの時刻合わせと記録の修正で同じものを使う（spec 8章「時刻は時刻合わせと同じ入れ方」）。
// PCではキーボードの数字・Backspace・Enterでも入れられる。
const mmss = (sec) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;

export function keypadHTML({ steps = [-10, -1, 1, 10], id = 'kp' } = {}) {
  const lab = (d) => `${d < 0 ? '－' : '＋'}${Math.abs(d)}秒`;
  return `<div class="kp" data-kp="${id}" style="touch-action:manipulation">
    <div class="adjdisp"><span class="dg kpM"></span><span class="col">:</span><span class="dg kpS"></span></div>
    <div class="adjnow kpNote"></div>
    <div class="adjpm">${steps.map((d) => `<button type="button" class="btn" data-d="${d}">${lab(d)}</button>`).join('')}</div>
    <div class="adjpad">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button type="button" class="btn" data-k="${n}">${n}</button>`).join('')}<button type="button" class="btn s" data-clr><span class="kl">はじめ</span><span class="kl">から</span></button><button type="button" class="btn" data-k="0">0</button><button type="button" class="btn s" data-bs><span class="kl">⌫</span><span class="kl">1つ消す</span></button></div>
  </div>`;
}

// root: element containing keypadHTML. init: seconds shown first. min/max: allowed seconds (for ±).
// live: () => seconds. 時計が動いている間の時刻合わせ用：どれかのボタンを押すまでは、表示を今の時刻のまま動かし続け、
//   ±は押した瞬間の今の時刻に足す（試4）。refresh() で表示を今の時刻にする（押したあとは何もしない）。
// Returns { value(): {ok, sec, msg}, set(sec), note(html), refresh() }.
export function bindKeypad(root, { init = 0, min = 0, max = 99 * 60, onChange, onEnter, live = null } = {}) {
  const box = root.querySelector('.kp');
  const toDigits = (sec) => String(Math.floor(sec / 60) * 100 + (sec % 60));
  const clamp = (sec) => Math.max(min, Math.min(max, sec));
  let buf = toDigits(live ? clamp(live()) : init); let fresh = true; // 最初の数字を押すと新しく入れ直す
  let touched = false; // どれかのボタンを押したか
  const follow = () => { if (live && !touched) buf = toDigits(clamp(live())); };
  const parts = () => { const n = parseInt(buf || '0', 10); return { mm: Math.floor(n / 100), ss: n % 100 }; };
  const show = () => {
    const { mm, ss } = parts();
    box.querySelector('.kpM').textContent = String(mm); box.querySelector('.kpS').textContent = String(ss).padStart(2, '0');
    onChange && onChange(api.value());
  };
  const digit = (d) => { touched = true; if (fresh) { buf = ''; fresh = false; } buf = (buf + d).replace(/^0+(?=\d)/, '').slice(-4); show(); };
  const back = () => { follow(); touched = true; buf = buf.slice(0, -1); fresh = false; show(); };
  box.addEventListener('click', (e) => {
    const k = e.target.closest('[data-k]'), d = e.target.closest('[data-d]');
    if (k) return digit(k.dataset.k);
    if (e.target.closest('[data-clr]')) { touched = true; buf = ''; fresh = false; return show(); }
    if (e.target.closest('[data-bs]')) return back();
    if (d) { follow(); touched = true; const { mm, ss } = parts(); const sec = Math.max(min, Math.min(max, mm * 60 + Math.min(ss, 59) + +d.dataset.d)); buf = toDigits(sec); fresh = false; show(); }
  });
  const onKey = (e) => {
    if (!document.body.contains(box)) { removeEventListener('keydown', onKey); return; }
    if (e.target.closest && e.target.closest('input,textarea,select')) return;
    if (/^[0-9]$/.test(e.key)) { e.preventDefault(); digit(e.key); }
    else if (e.key === 'Backspace') { e.preventDefault(); back(); }
    else if (e.key === 'Enter' && onEnter) { e.preventDefault(); onEnter(); }
  };
  addEventListener('keydown', onKey);
  const api = {
    value() {
      follow();
      const { mm, ss } = parts();
      if (ss > 59) return { ok: false, msg: '秒は 00〜59 で入れてください' };
      const sec = mm * 60 + ss;
      if (sec < min || sec > max) return { ok: false, sec, msg: `${mmss(min)}〜${mmss(max)} の範囲で入れてください` };
      return { ok: true, sec };
    },
    set(sec) { buf = toDigits(sec); fresh = true; show(); },
    refresh() { if (live && !touched) { follow(); show(); } },
    note(html) { box.querySelector('.kpNote').innerHTML = html; },
  };
  show();
  return api;
}
