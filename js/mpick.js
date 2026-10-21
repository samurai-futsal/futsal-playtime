// 試合を探して選ぶ（マッチレビュー・マッチスタッツ）と、前の試合・次の試合（2026-10-22）
// 相手の地域（大陸）も、ここで扱う（分析の絞り込みでも使う）。
import { S, put, activityById, opts, matchStatus } from './store.js';
import { esc, fmtShort, openModal, closeModal, toast } from './ui.js';

// ---------- 相手の地域（大陸） ----------
// 国の名前が相手の名前に入っていれば、地域を自動で決める（設定で直せる。直したものはチームに保存）
export const REGIONS = ['アジア', 'ヨーロッパ', 'アフリカ', '南米', '北中米カリブ', 'オセアニア', '国内', 'その他'];
const GUESS = {
  アジア: ['日本', '韓国', '北朝鮮', '中国', '台湾', 'チャイニーズタイペイ', '香港', 'マカオ', 'モンゴル', 'タイ', 'ベトナム', 'マレーシア', 'インドネシア', 'フィリピン', 'シンガポール', 'ミャンマー', 'カンボジア', 'ラオス', 'ブルネイ', '東ティモール',
    'イラン', 'イラク', 'クウェート', 'サウジアラビア', 'カタール', 'バーレーン', 'アラブ首長国連邦', 'UAE', 'オマーン', 'イエメン', 'ヨルダン', 'レバノン', 'シリア', 'パレスチナ',
    'ウズベキスタン', 'タジキスタン', 'キルギス', 'トルクメニスタン', 'カザフスタン', 'アフガニスタン', 'インド', 'パキスタン', 'バングラデシュ', 'ネパール', 'スリランカ', 'モルディブ', 'ブータン', 'オーストラリア'],
  ヨーロッパ: ['スペイン', 'ポルトガル', 'イタリア', 'フランス', 'ドイツ', 'イングランド', 'スコットランド', 'ウェールズ', 'アイルランド', 'オランダ', 'ベルギー', 'ルクセンブルク', 'スイス', 'オーストリア',
    'ロシア', 'ウクライナ', 'ベラルーシ', 'ポーランド', 'チェコ', 'スロバキア', 'ハンガリー', 'ルーマニア', 'ブルガリア', 'セルビア', 'クロアチア', 'スロベニア', 'ボスニア', 'モンテネグロ', '北マケドニア', 'アルバニア', 'コソボ',
    'ギリシャ', 'キプロス', 'トルコ', 'ジョージア', 'アルメニア', 'アゼルバイジャン', 'モルドバ', 'リトアニア', 'ラトビア', 'エストニア', 'フィンランド', 'スウェーデン', 'ノルウェー', 'デンマーク', 'アイスランド', 'マルタ', 'アンドラ', 'サンマリノ', 'イスラエル'],
  アフリカ: ['モロッコ', 'アルジェリア', 'チュニジア', 'リビア', 'エジプト', 'カーボベルデ', 'セネガル', 'ガーナ', 'ナイジェリア', 'コートジボワール', 'カメルーン', 'アンゴラ', 'モザンビーク', '南アフリカ', 'ザンビア', 'ジンバブエ',
    'ケニア', 'タンザニア', 'ウガンダ', 'エチオピア', 'マダガスカル', 'モーリシャス', 'ギニア', 'マリ', 'ブルキナファソ', 'ニジェール', 'スーダン', 'リベリア', 'シエラレオネ', 'ガンビア', 'ベナン', 'トーゴ', 'ガボン', 'コンゴ', 'ルワンダ', 'ナミビア', 'ボツワナ'],
  南米: ['ブラジル', 'アルゼンチン', 'ウルグアイ', 'パラグアイ', 'チリ', 'ペルー', 'ボリビア', 'エクアドル', 'コロンビア', 'ベネズエラ'],
  北中米カリブ: ['アメリカ', '米国', 'カナダ', 'メキシコ', 'グアテマラ', 'コスタリカ', 'パナマ', 'ホンジュラス', 'エルサルバドル', 'ニカラグア', 'キューバ', 'ジャマイカ', 'ハイチ', 'ドミニカ', 'プエルトリコ', 'トリニダード', 'スリナム', 'ガイアナ', 'ベリーズ', 'バハマ', 'キュラソー'],
  オセアニア: ['ニュージーランド', 'ソロモン', 'フィジー', 'パプアニューギニア', 'バヌアツ', 'タヒチ', 'ニューカレドニア', 'サモア', 'トンガ'],
};
export function guessRegion(name) {
  const n = String(name || '');
  // 長い名前から（「南アフリカ」が「アフリカ」より先、「ドミニカ」など）
  const all = Object.entries(GUESS).flatMap(([r, list]) => list.map((c) => [c, r])).sort((a, b) => b[0].length - a[0].length);
  for (const [c, r] of all) if (n.includes(c)) return r;
  return '';
}
// 決まった地域（設定で直したもの → 自動の推定 → なし）
export const regionOf = (name) => S.team?.oppRegion?.[name] || guessRegion(name) || '';
export function setRegion(name, r) { put(['teams', S.teamId], { oppRegion: { [name]: r || '' } }); }
// 相手の名前の一覧（試合中・終わった試合。試合数の多い順）
export function opponents() {
  const c = new Map();
  for (const m of S.matches) if (!m.deleted && (m.status === 'playing' || m.status === 'done') && m.opponent) c.set(m.opponent, (c.get(m.opponent) || 0) + 1);
  return [...c].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ja'));
}
// 地域を直す画面（分析の絞り込みから開く）
export function regionModal(after) {
  const draw = () => `<h2>相手の地域（大陸）</h2><p class="mu">相手の名前に国の名前が入っていれば自動で決めています。違うときや、クラブチームなどは選んでください（チームに保存し、ほかの端末にも反映）。</p>
    <div class="rglist">${opponents().map(([n, k]) => `<label class="rgrow"><span>${esc(n)}<small>${k}試合</small></span><select data-rg="${esc(n)}"><option value="">未設定</option>${REGIONS.map((r) => `<option ${regionOf(n) === r ? 'selected' : ''}>${r}</option>`).join('')}</select>${!S.team?.oppRegion?.[n] && guessRegion(n) ? '<em>自動</em>' : ''}</label>`).join('') || '<p class="mu">まだ試合がありません</p>'}</div>
    <div class="mfoot"><button class="btn pri" data-c>閉じる</button></div>`;
  const md = openModal(draw(), { wide: true });
  md.addEventListener('change', (e) => { const n = e.target.dataset.rg; if (n == null) return; setRegion(n, e.target.value); toast('保存しました'); });
  md.querySelector('[data-c]').onclick = () => { closeModal(); after && after(); };
}

// ---------- 試合を探して選ぶ（マッチレビュー・マッチスタッツ） ----------
const F = { type: '', cat: '', from: '', to: '', q: '', rg: '' };
const played = () => S.matches.filter((m) => !m.deleted && (m.status === 'playing' || m.status === 'done'));
const byTime = (a, b) => (a.date || '').localeCompare(b.date || '') || (a.kickoff || '').localeCompare(b.kickoff || '') || (a.createdOrder || 0) - (b.createdOrder || 0);
// 同じ活動の、前の試合・次の試合（試合中・終わった試合だけ）
export function neighbors(m) {
  const list = played().filter((x) => x.activityId === m.activityId || x.id === m.id).sort(byTime);
  const i = list.findIndex((x) => x.id === m.id);
  return { prev: i > 0 ? list[i - 1] : null, next: i >= 0 && i < list.length - 1 ? list[i + 1] : null };
}
// 前後のボタンと「試合を選ぶ」ボタン（sub＝'review' か 'stats'）
export function pickBar(m, sub) {
  const { prev, next } = neighbors(m);
  const b = (x, l, cls) => (x ? `<a class="btn sm mpnav ${cls}" href="#/m/${x.id}/${sub}" title="vs ${esc(x.opponent)}（${fmtShort(x.date)}）">${l}</a>` : `<span class="btn sm mpnav ${cls} off">${l}</span>`);
  return `<span class="mpbar">${b(prev, '‹ 前の試合', 'p')}<button class="btn mppick" data-mpick="${sub}" title="どの活動のどの試合でも探して選べます"><b>vs ${esc(m.opponent || '')}</b><small>${fmtShort(m.date)}</small> ▾</button>${b(next, '次の試合 ›', 'n')}</span>`;
}
export function bindPickBar(root, m) {
  root.querySelectorAll('[data-mpick]').forEach((btn) => { btn.onclick = () => openMatchPicker(m, btn.dataset.mpick); });
}
export function openMatchPicker(cur, sub) {
  const o = (list, v) => `<option value="">すべて</option>${list.map((n) => `<option ${n === v ? 'selected' : ''}>${esc(n)}</option>`).join('')}`;
  const list = () => {
    const q = F.q.trim();
    const ms = played().filter((m) => { const a = activityById(m.activityId);
      return (!F.type || a?.type === F.type) && (!F.cat || m.category === F.cat) && (!F.from || (m.date || '') >= F.from) && (!F.to || (m.date || '') <= F.to)
        && (!q || (m.opponent || '').includes(q) || (a?.name || '').includes(q)) && (!F.rg || regionOf(m.opponent) === F.rg); });
    const groups = new Map(); for (const m of ms.sort(byTime).reverse()) { const k = m.activityId; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(m); }
    return [...groups].map(([aid, arr]) => { const a = activityById(aid);
      return `<div class="mpg"><h4>${esc(a?.name || '活動なし')}<small>${a?.type ? esc(a.type) + '・' : ''}${arr.length}試合</small></h4>${arr.map((m) => `<button class="mprow ${m.id === cur.id ? 'cur' : ''}" data-go="${m.id}"><span class="d">${fmtShort(m.date)}</span><b>vs ${esc(m.opponent || '')}</b><small>${esc(m.category || '')}</small><em>${esc(matchStatus(m))}</em></button>`).join('')}</div>`; }).join('')
      || '<p class="mu">条件に合う試合はありません</p>';
  };
  const md = openModal(`<h2>試合を選ぶ</h2>
    <div class="pkf"><label>相手・活動の名前<input data-f="q" value="${esc(F.q)}" placeholder="例：モロッコ"></label>
      <label>相手の地域<select data-f="rg">${o(REGIONS, F.rg)}</select></label>
      <label>活動の種類<select data-f="type">${o(opts('activityTypes', true).map((x) => x.name), F.type)}</select></label>
      <label>試合の区分<select data-f="cat">${o(opts('matchCategories', true).map((x) => x.name), F.cat)}</select></label>
      <label>期間<span class="pkd"><input type="date" data-f="from" value="${F.from}">〜<input type="date" data-f="to" value="${F.to}"></span></label></div>
    <p class="mu">試合中・終わった試合を、活動ごとに新しい順で出します。押すとその試合の${sub === 'stats' ? 'マッチスタッツ' : 'マッチレビュー'}へ。</p>
    <div id="mpList" class="pklist mplist">${list()}</div><div class="mfoot"><button class="btn" data-c>閉じる</button></div>`, { wide: true });
  const redraw = () => { md.querySelector('#mpList').innerHTML = list(); };
  md.addEventListener('input', (e) => { const k = e.target.dataset.f; if (k) { F[k] = e.target.value; redraw(); } });
  // 文字の欄は入力のたびに出し直す。離れたとき（change）にもう一度出し直すと、押した行が消えて押せないので、値が変わったときだけ
  md.addEventListener('change', (e) => { const k = e.target.dataset.f; if (k && F[k] !== e.target.value) { F[k] = e.target.value; redraw(); } });
  md.addEventListener('click', (e) => { const g = e.target.closest('[data-go]'); if (g) { closeModal(); location.hash = `#/m/${g.dataset.go}/${sub}`; } });
  md.querySelector('[data-c]').onclick = closeModal;
}
