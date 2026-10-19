// PDFで保存（印刷の画面を通さずに、PDFのファイルを作って保存する）。
// 1項目＝1ページ。項目ごとに A4 の横・縦のうち大きく見える方を選び、用紙いっぱいに広げる。
// 画面の表やグラフをそのまま絵（JPEG）にして並べる（vendor/html2canvas.min.js）。
// PC：そのままダウンロード。iPad：共有の画面 →「ファイルに保存」。
import { openModal, closeModal, toast } from './ui.js';

const PT = { L: [842, 595], P: [595, 842] }; // A4（pt）
const MG = 22; // 余白（pt）

let h2cP = null;
function loadH2C() {
  if (window.html2canvas) return Promise.resolve(window.html2canvas);
  if (!h2cP) h2cP = new Promise((ok, ng) => {
    const s = document.createElement('script'); s.src = './vendor/html2canvas.min.js';
    s.onload = () => ok(window.html2canvas); s.onerror = () => { h2cP = null; ng(new Error('html2canvas')); };
    document.head.appendChild(s);
  });
  return h2cP;
}
// 先に読み込んでおく（ボタンを押してからの待ちを減らす）
export function preloadPdf() { loadH2C().catch(() => {}); }

const isTouch = () => navigator.maxTouchPoints > 1 && /iPad|iPhone|Macintosh/.test(navigator.userAgent);

// items: [{ html, fix?(el, W, aw, ah) }]。stageCls：画面と同じ見た目にするための外側のクラス
// widths：組む幅の候補（px）。広いほど文字は小さくなる
export async function savePdf(items, fileName, { stageCls = '', widths = [1000, 1150, 1300, 1500, 1700] } = {}) {
  const md = openModal(`<h2>PDFを作っています</h2><p class="mu" id="pdfMsg">準備しています…</p><div class="pdfbar"><i id="pdfBar"></i></div>`);
  const msg = (t, f) => { const m = md.querySelector('#pdfMsg'); if (m) m.textContent = t; const b = md.querySelector('#pdfBar'); if (b && f != null) b.style.width = Math.round(f * 100) + '%'; };
  const stage = document.createElement('div');
  stage.className = 'pdfstage ' + stageCls;
  document.body.appendChild(stage);
  try {
    const h2c = await loadH2C();
    await document.fonts?.ready;
    const pages = [];
    for (let i = 0; i < items.length; i++) {
      msg(`${i + 1} / ${items.length} ページ目を作っています`, i / items.length);
      await new Promise((r) => setTimeout(r, 0)); // 画面の表示を進める
      pages.push(await renderItem(h2c, stage, items[i], items[i].widths || widths));
    }
    msg('ファイルにまとめています', 1);
    const blob = pdfBlob(pages);
    stage.remove();
    await deliver(blob, fileName, md);
  } catch (e) {
    stage.remove(); closeModal();
    console.error(e);
    toast('PDFを作れませんでした。もう一度押してください');
  }
}

async function renderItem(h2c, stage, it, widths) {
  stage.innerHTML = `<div class="pdfpage">${it.html}</div>`;
  const el = stage.firstElementChild;
  // 幅と向きを選ぶ：中身がいちばん大きく見える組み合わせ
  let best = null;
  for (const W of widths) {
    for (const o of ['L', 'P']) {
      const [pw, ph] = PT[o]; const aw = pw - MG * 2, ah = ph - MG * 2;
      stage.style.width = W + 'px';
      if (it.shrink) el.style.width = it.shrink(el) + 'px'; // 中身の幅だけ（左右の余白を作らない）
      if (it.fix) it.fix(el, W, aw, ah);
      const H = el.offsetHeight, Wr = it.shrink ? el.offsetWidth : Math.max(W, el.scrollWidth); // 表が幅からはみ出すときは、はみ出した分も入れる
      const s = Math.min(aw / Wr, ah / H);
      if (!best || s > best.s * 1.02) best = { W, o, s, aw, ah };
    }
  }
  stage.style.width = best.W + 'px';
  if (it.fix) it.fix(el, best.W, best.aw, best.ah);
  const H = el.offsetHeight, Wr = it.shrink ? el.offsetWidth : Math.max(best.W, el.scrollWidth);
  best.s = Math.min(best.aw / Wr, best.ah / H);
  // 1pt あたり 2.5px くらいの細かさ（印刷してもにじまない）
  const scale = Math.min(2.5, Math.max(1.5, 2.2 * best.s));
  const cv = await h2c(el, { scale, backgroundColor: '#ffffff', logging: false, useCORS: true, width: Wr, height: H, windowWidth: window.innerWidth, windowHeight: window.innerHeight, // 画面と同じ幅として組む（測ったときと同じ見た目に）
    // 画面の本体は写し取らない（ページ全体を写し取ると遅くなる）
    ignoreElements: (n) => n.id === 'main' || n.id === 'update' || n.classList?.contains('modal-bg') || n.id === 'toast' });
  const jpg = new Uint8Array(await (await new Promise((r) => cv.toBlob(r, 'image/jpeg', 0.9))).arrayBuffer());
  const [pw, ph] = PT[best.o];
  const dw = Wr * best.s, dh = H * best.s;
  return { jpg, iw: cv.width, ih: cv.height, pw, ph, x: (pw - dw) / 2, y: ph - MG - dh, dw, dh };
}

// 組み終わったページを、そのまま1枚ずつ PDF のページにする（マッチレポート：A4横、余白8mm）。
// build(stage)：stage の中にページを組み、ページの要素の一覧を返す（測って振り分けるのもここで）
export async function savePdfPages(build, fileName, { stageCls = '', orient = 'L', margin = 22.7, quality = 0.88 } = {}) {
  const md = openModal(`<h2>PDFを作っています</h2><p class="mu" id="pdfMsg">ページを組んでいます…</p><div class="pdfbar"><i id="pdfBar"></i></div>`);
  const msg = (t, f) => { const m = md.querySelector('#pdfMsg'); if (m) m.textContent = t; const b = md.querySelector('#pdfBar'); if (b && f != null) b.style.width = Math.round(f * 100) + '%'; };
  const stage = document.createElement('div');
  stage.className = 'pdfstage ' + stageCls;
  document.body.appendChild(stage);
  try {
    const h2c = await loadH2C();
    await document.fonts?.ready;
    await new Promise((r) => setTimeout(r, 30)); // 「組んでいます」を先に出す
    const els = build(stage);
    const [pw, ph] = PT[orient]; const aw = pw - margin * 2, ah = ph - margin * 2;
    const pages = [];
    for (let i = 0; i < els.length; i++) {
      msg(`${i + 1} / ${els.length} ページ目を作っています`, i / els.length);
      await new Promise((r) => setTimeout(r, 0));
      const el = els[i]; const W = el.offsetWidth, H = el.offsetHeight;
      const s = Math.min(aw / W, ah / H);
      const scale = Math.min(2.4, Math.max(1.4, 2.2 * s));
      el.setAttribute('data-pdfnow', '1');
      const cv = await h2c(el, { scale, backgroundColor: '#ffffff', logging: false, width: W, height: H, windowWidth: window.innerWidth, windowHeight: window.innerHeight,
        // ほかのページと画面の本体は写し取らない（速くするため）
        ignoreElements: (n) => n.id === 'main' || n.id === 'update' || n.id === 'toast' || n.classList?.contains('modal-bg') || (n.hasAttribute?.('data-pdfpg') && !n.hasAttribute('data-pdfnow')) });
      el.removeAttribute('data-pdfnow');
      const jpg = new Uint8Array(await (await new Promise((r) => cv.toBlob(r, 'image/jpeg', quality))).arrayBuffer());
      const iw = cv.width, ih = cv.height; cv.width = cv.height = 0; // メモリを早く返す
      const dw = W * s, dh = H * s;
      pages.push({ jpg, iw, ih, pw, ph, x: (pw - dw) / 2, y: ph - margin - dh, dw, dh });
    }
    msg('ファイルにまとめています', 1);
    const blob = pdfBlob(pages);
    stage.remove();
    await deliver(blob, fileName, md);
  } catch (e) {
    stage.remove(); closeModal();
    console.error(e);
    toast('PDFを作れませんでした。もう一度押してください');
  }
}

// JPEG を1枚ずつ載せた PDF
function pdfBlob(pages) {
  const enc = new TextEncoder();
  const parts = []; const offs = []; let len = 0;
  const push = (x) => { const b = typeof x === 'string' ? enc.encode(x) : x; parts.push(b); len += b.length; };
  const obj = (n, body, stream) => {
    offs[n] = len;
    push(`${n} 0 obj\n${body}\n`);
    if (stream) { push('stream\n'); push(stream); push('\nendstream\n'); }
    push('endobj\n');
  };
  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  const n = pages.length; const kids = pages.map((_, i) => `${3 + i * 3} 0 R`).join(' ');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, `<< /Type /Pages /Kids [${kids}] /Count ${n} >>`);
  pages.forEach((p, i) => {
    const pg = 3 + i * 3, ct = pg + 1, im = pg + 2;
    const f = (v) => v.toFixed(2);
    const content = enc.encode(`q ${f(p.dw)} 0 0 ${f(p.dh)} ${f(p.x)} ${f(p.y)} cm /Im0 Do Q`);
    obj(pg, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${p.pw} ${p.ph}] /Resources << /XObject << /Im0 ${im} 0 R >> >> /Contents ${ct} 0 R >>`);
    obj(ct, `<< /Length ${content.length} >>`, content);
    obj(im, `<< /Type /XObject /Subtype /Image /Width ${p.iw} /Height ${p.ih} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpg.length} >>`, p.jpg);
  });
  const xref = len; const total = 3 + n * 3;
  let x = `xref\n0 ${total}\n0000000000 65535 f \n`;
  for (let i = 1; i < total; i++) x += String(offs[i]).padStart(10, '0') + ' 00000 n \n';
  push(x + `trailer\n<< /Size ${total} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(parts, { type: 'application/pdf' });
}

async function deliver(blob, fileName, md) {
  const file = new File([blob], fileName, { type: 'application/pdf' });
  if (isTouch() && navigator.canShare?.({ files: [file] })) {
    // iPad：共有の画面から「ファイルに保存」。作るのに時間がかかると、すぐには開けないことがあるので、そのときはボタンを出す
    const share = () => navigator.share({ files: [file], title: fileName }).then(() => { closeModal(); toast('保存しました'); }, (e) => { if (e?.name === 'AbortError') closeModal(); else throw e; });
    // 共有の画面が開いている間、後ろの表示も「保存先を選ぶ」にしておく（「まとめています」のまま残らないように）
    const box = md.querySelector('.modal') || md;
    box.innerHTML = `<h2>PDFができました</h2><p class="mu">保存の画面で「"ファイル"に保存」を選んでください。</p>`;
    try { await share(); return; } catch {}
    // 作るのに時間がかかったときは、共有の画面をすぐに開けないことがある（iPadの決まり）。ボタンを押してもらう
    // （白い枠の中を入れ替える。2026-10-19：前は枠ごと消えて、文字とボタンが画面の上に重なっていた）
    box.innerHTML = `<h2>PDFができました</h2><p class="pdfname">${fileName}</p><p class="mu">「ファイルに保存」を押して、出てきた画面で「"ファイル"に保存」を選んでください。</p>
      <div class="mfoot"><button class="btn" id="pdfX">閉じる</button><button class="btn pri" id="pdfGo">ファイルに保存</button></div>`;
    md.querySelector('#pdfX').onclick = closeModal;
    md.querySelector('#pdfGo').onclick = () => share().catch(() => toast('保存できませんでした。もう一度押してください'));
    return;
  }
  // PC：ダウンロード
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = fileName; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  closeModal(); toast(`${fileName} を保存しました（ダウンロード）`);
}

// ファイル名に使えない文字を除く
export const safeName = (s) => String(s).replace(/[\\/:*?"<>|\s]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
