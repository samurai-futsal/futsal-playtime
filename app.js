// フットサル出場時間 — 接続の確認版（第1段階の土台）
// When releasing, bump APP_VERSION here AND VERSION in sw.js.
const APP_VERSION = '0.1.0';
const FB = 'https://www.gstatic.com/firebasejs/10.12.2/';
const firebaseConfig = {
  apiKey: 'AIzaSyC0r2kAsSyq9HCcj9IT4WsRMlC8mleBoV4',
  authDomain: 'futsal-playtime-207ea.firebaseapp.com',
  projectId: 'futsal-playtime-207ea',
  storageBucket: 'futsal-playtime-207ea.firebasestorage.app',
  messagingSenderId: '959769848190',
  appId: '1:959769848190:web:b28b0bedcb1a5492fd6b2f',
};

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
$('#ver').textContent = 'バージョン ' + APP_VERSION;

// ---------- network indicator ----------
function showNet() {
  const el = $('#net');
  el.textContent = navigator.onLine ? 'オンライン' : 'オフライン';
  el.className = 'pill ' + (navigator.onLine ? 'on' : 'off');
}
addEventListener('online', showNet);
addEventListener('offline', showNet);
showNet();

// ---------- service worker & manual update ----------
let swReg = null;
async function setupSW() {
  if (!('serviceWorker' in navigator)) return;
  swReg = await navigator.serviceWorker.register('./sw.js');
  const offer = () => { if (swReg.waiting && navigator.serviceWorker.controller) $('#update').hidden = false; };
  offer();
  swReg.addEventListener('updatefound', () => {
    const w = swReg.installing;
    w && w.addEventListener('statechange', () => { if (w.state === 'installed') offer(); });
  });
  $('#btnUpdate').onclick = () => swReg.waiting && swReg.waiting.postMessage('SKIP_WAITING');
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloaded) { reloaded = true; location.reload(); } });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && navigator.onLine) swReg.update().catch(() => {}); });
}
setupSW().catch((e) => console.warn('sw', e));

// ---------- device identity (per device, kept in this browser) ----------
function deviceId() {
  let id = localStorage.getItem('fpt.deviceId');
  if (!id) { id = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random()).replace(/-/g, '').slice(0, 16); localStorage.setItem('fpt.deviceId', id); }
  return id;
}
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

// ---------- Firebase ----------
let fb = null;
async function loadFirebase() {
  const [appM, authM, fsM] = await Promise.all([
    import(FB + 'firebase-app.js'), import(FB + 'firebase-auth.js'), import(FB + 'firebase-firestore.js'),
  ]);
  const app = appM.initializeApp(firebaseConfig);
  const auth = authM.getAuth(app);
  const db = fsM.initializeFirestore(app, { localCache: fsM.persistentLocalCache({ tabManager: fsM.persistentMultipleTabManager() }) });
  return { authM, fsM, auth, db };
}

const AUTH_ERR = {
  'auth/invalid-credential': 'メールアドレスかパスワードが違います',
  'auth/wrong-password': 'メールアドレスかパスワードが違います',
  'auth/user-not-found': 'メールアドレスかパスワードが違います',
  'auth/invalid-email': 'メールアドレスの形が正しくありません',
  'auth/too-many-requests': '失敗が続いたため、しばらく待ってからもう一度お試しください',
  'auth/network-request-failed': 'ネットにつながっていません。最初のログインだけはネットが必要です',
  'auth/unauthorized-domain': 'このアドレスがFirebaseのログイン許可の一覧に入っていません（Authentication の「設定」→「承認済みドメイン」に追加してください）',
};

function renderLogin(msg = '') {
  $('#main').innerHTML = `
  <div class="card">
    <h2>ログイン</h2>
    <p class="mu">チームの共有アカウントでログインします。最初の1回だけネットが必要で、そのあとはオフラインでもログインしたままになります。</p>
    <label for="em">メールアドレス</label><input id="em" type="email" autocomplete="username">
    <label for="pw">パスワード</label><input id="pw" type="password" autocomplete="current-password">
    <div class="row" style="margin-top:14px"><button id="btnLogin" class="btn pri">ログイン</button></div>
    <div id="lerr" class="err">${esc(msg)}</div>
  </div>`;
  $('#btnLogin').onclick = async () => {
    $('#lerr').textContent = '';
    try { await fb.authM.signInWithEmailAndPassword(fb.auth, $('#em').value.trim(), $('#pw').value); }
    catch (e) { $('#lerr').textContent = AUTH_ERR[e.code] || ('ログインできませんでした（' + e.code + '）'); }
  };
}

let unsub = null;
function renderMain(user) {
  const name = localStorage.getItem('fpt.deviceName') || '';
  $('#main').innerHTML = `
  <div class="card">
    <h2>この版でできること</h2>
    <p class="mu">アプリの土台（公開・ログイン・同期・オフライン）が動くかを確かめるための版です。試合の記録の機能は、次の版から順に入ります。</p>
    <ol class="steps mu">
      <li>iPadのSafariで開き、共有ボタン →「ホーム画面に追加」。以降はホーム画面のアイコンから開く</li>
      <li>この端末の名前を入れて「記録を送る」。もう1台（PCなど）でも同じことをして、下の一覧に両方の端末が並ぶか見る</li>
      <li>iPadを機内モードにして、ホーム画面のアイコンから開き直す。画面が開き、「記録を送る」が「送信待ち」になること。機内モードを切ると「送信済み」に変わること</li>
    </ol>
  </div>
  <div class="card">
    <h2>状態</h2>
    <table>
      <tr><th>ログイン</th><td><span class="ok">ログイン中</span> ${esc(user.email)}　<button id="btnOut" class="btn">ログアウト</button></td></tr>
      <tr><th>開き方</th><td>${isStandalone() ? '<span class="ok">ホーム画面のアイコンから</span>' : '<span class="wait">ブラウザのタブから</span>（iPadではホーム画面に追加して開いてください）'}</td></tr>
      <tr><th>オフライン用の保存</th><td id="swst">確認中</td></tr>
      <tr><th>端末内のデータ保存</th><td id="persist">確認中</td></tr>
    </table>
  </div>
  <div class="card">
    <h2>同期の確認</h2>
    <label for="dn">この端末の名前</label>
    <div class="row"><input id="dn" placeholder="例：iPad、谷本PC" value="${esc(name)}"><button id="btnSend" class="btn pri">記録を送る</button></div>
    <div id="serr" class="err"></div>
    <table style="margin-top:12px"><thead><tr><th>端末</th><th>最後に送った時刻</th><th>回数</th><th>状態</th></tr></thead><tbody id="devs"><tr><td colspan="4" class="mu">まだ記録がありません</td></tr></tbody></table>
    <p class="mu" id="src"></p>
  </div>`;
  $('#btnOut').onclick = () => fb.authM.signOut(fb.auth);
  $('#btnSend').onclick = sendPing;

  navigator.serviceWorker?.ready.then(() => { $('#swst').innerHTML = '<span class="ok">済み</span>（ネットがなくても開けます）'; }).catch(() => {});
  if (!('serviceWorker' in navigator)) $('#swst').innerHTML = '<span class="ng">この端末では使えません</span>';
  (async () => {
    try {
      let p = await navigator.storage?.persisted?.();
      if (!p && navigator.storage?.persist) p = await navigator.storage.persist();
      $('#persist').innerHTML = p ? '<span class="ok">消えにくい保存が有効</span>' : '<span class="wait">通常の保存</span>（ホーム画面から開くと有効になりやすい）';
    } catch { $('#persist').textContent = '確認できません'; }
  })();

  const { fsM, db } = fb;
  unsub && unsub();
  unsub = fsM.onSnapshot(fsM.collection(db, 'diag'), { includeMetadataChanges: true }, (snap) => {
    const me = deviceId();
    const rows = snap.docs.map((d) => {
      const v = d.data({ serverTimestamps: 'estimate' });
      const t = v.at?.toDate ? v.at.toDate() : null;
      return { id: d.id, name: v.name || '（名前なし）', t, n: v.count || 0, pend: d.metadata.hasPendingWrites };
    }).sort((a, b) => (b.t || 0) - (a.t || 0));
    $('#devs').innerHTML = rows.length ? rows.map((r) => `<tr><td>${esc(r.name)}${r.id === me ? '（この端末）' : ''}</td><td>${r.t ? r.t.toLocaleString('ja-JP') : '—'}</td><td>${r.n}</td><td>${r.pend ? '<span class="wait">送信待ち</span>' : '<span class="ok">送信済み</span>'}</td></tr>`).join('')
      : '<tr><td colspan="4" class="mu">まだ記録がありません</td></tr>';
    $('#src').textContent = snap.metadata.fromCache ? 'いまは端末内に保存された内容を表示しています（クラウドとまだつながっていません）' : 'クラウドの最新の内容を表示しています';
  }, (err) => {
    $('#serr').textContent = err.code === 'permission-denied'
      ? 'データベースの読み書きのルールがまだ設定されていません（Firestore の「ルール」に、案内した文面を貼り付けてください）'
      : '同期でエラーが出ました（' + err.code + '）';
  });
}

async function sendPing() {
  const { fsM, db } = fb;
  const name = $('#dn').value.trim();
  localStorage.setItem('fpt.deviceName', name);
  $('#serr').textContent = '';
  try {
    // Not awaited: offline writes resolve only after reaching the server; the list shows 「送信待ち」 meanwhile.
    fsM.setDoc(fsM.doc(db, 'diag', deviceId()), {
      name: name || '（名前なし）', count: fsM.increment(1), at: fsM.serverTimestamp(),
      standalone: isStandalone(), ua: navigator.userAgent.slice(0, 160), ver: APP_VERSION,
    }, { merge: true }).catch((err) => {
      $('#serr').textContent = err.code === 'permission-denied'
        ? 'データベースの読み書きのルールがまだ設定されていません' : '送れませんでした（' + err.code + '）';
    });
  } catch (err) { $('#serr').textContent = '送れませんでした（' + (err.code || err.message) + '）'; }
}

(async () => {
  try { fb = await loadFirebase(); }
  catch (e) {
    $('#main').innerHTML = '<div class="card"><h2>読み込めませんでした</h2><p class="mu">初めて開くときはネットが必要です。ネットにつないでから開き直してください。</p></div>';
    return;
  }
  fb.authM.onAuthStateChanged(fb.auth, (u) => (u ? renderMain(u) : renderLogin()));
})();
