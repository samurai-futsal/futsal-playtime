// フットサル出場時間 — entry point: service worker, Firebase, login, then the app screens.
// When releasing, bump APP_VERSION here AND VERSION in sw.js.
import { initStore } from './js/store.js';
import { startApp, render } from './js/views.js';
import { $, esc } from './js/ui.js';

const APP_VERSION = '0.2.0';
const FB = 'https://www.gstatic.com/firebasejs/10.12.2/';
const firebaseConfig = {
  apiKey: 'AIzaSyC0r2kAsSyq9HCcj9IT4WsRMlC8mleBoV4',
  authDomain: 'futsal-playtime-207ea.firebaseapp.com',
  projectId: 'futsal-playtime-207ea',
  storageBucket: 'futsal-playtime-207ea.firebasestorage.app',
  messagingSenderId: '959769848190',
  appId: '1:959769848190:web:b28b0bedcb1a5492fd6b2f',
};

// ---------- service worker & manual update (spec 5章: 更新は「更新する」を押したときだけ) ----------
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
// Ask the browser to keep our data (spec 5章「データが消えないための対策」)
navigator.storage?.persist?.().catch(() => {});

// ---------- Firebase ----------
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
  'auth/unauthorized-domain': 'このアドレスがFirebaseのログイン許可の一覧に入っていません',
};

function renderLogin(fb, msg = '') {
  $('#main').innerHTML = `<div class="login">
    <div class="brand">フットサル出場時間<span>バージョン ${APP_VERSION}</span></div>
    <div class="card">
      <h2>ログイン</h2>
      <p class="mu">チームの共有アカウントでログインします。最初の1回だけネットが必要で、そのあとはオフラインでもログインしたままになります。</p>
      <label for="em">メールアドレス</label><input id="em" type="email" autocomplete="username">
      <label for="pw">パスワード</label><input id="pw" type="password" autocomplete="current-password">
      <div class="row mt"><button id="btnLogin" class="btn pri">ログイン</button></div>
      <div id="lerr" class="err">${esc(msg)}</div>
    </div></div>`;
  const doLogin = async () => {
    $('#lerr').textContent = '';
    try { await fb.authM.signInWithEmailAndPassword(fb.auth, $('#em').value.trim(), $('#pw').value); }
    catch (e) { $('#lerr').textContent = AUTH_ERR[e.code] || ('ログインできませんでした（' + e.code + '）'); }
  };
  $('#btnLogin').onclick = doLogin;
  $('#pw').onkeydown = (e) => { if (e.key === 'Enter') doLogin(); };
}

(async () => {
  let fb;
  try { fb = await loadFirebase(); }
  catch (e) {
    $('#main').innerHTML = '<div class="login"><div class="card"><h2>読み込めませんでした</h2><p class="mu">初めて開くときはネットが必要です。ネットにつないでから開き直してください。</p></div></div>';
    return;
  }
  let started = false;
  fb.authM.onAuthStateChanged(fb.auth, (user) => {
    if (!user) { renderLogin(fb); return; }
    if (!started) {
      started = true;
      initStore(fb.fsM, fb.db);
      startApp({ fb, user, appVersion: APP_VERSION, swReg: { update: () => swReg?.update(), get waiting() { return swReg?.waiting; } }, signOut: () => fb.authM.signOut(fb.auth).then(() => location.reload()) });
    } else render();
  });
})();
