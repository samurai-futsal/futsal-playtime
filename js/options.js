// 選択肢（活動の種類・試合の区分・得点失点の種類）の読み書きの決まり。画面や Firestore に依存しない（テストできる）。
//
// 保存の形（config/global）:
//   新しい形 optMap: { activityTypes: { <id>: { name, hidden, order } }, matchCategories: {...}, goalTypes: {...} }
//     → 1つの選択肢ごとに書き足す（merge）ので、2台で同時に別の選択肢を直しても消し合わない。
//   古い形 activityTypes: [{ id, name, hidden }]（配列まるごと）。optMap が無いあいだはこちらを読む。
// 試合・活動には選択肢の id を保存する（categoryId / typeId）。名前は表示用の写し（古い版のため）で、
// 読むときは id から今の名前を引くので、名前を変えると過去の試合の表示も変わる。

export const DEFAULT_OPTIONS = {
  activityTypes: ['合宿', '大会', 'リーグ戦の節', '遠征', '練習試合'],
  matchCategories: ['予選リーグ', '決勝トーナメント', '順位決定戦'],
  goalTypes: ['定位置', 'トランジション', 'CK', 'CK-KI', 'KI', 'FK', 'GK活用', 'パワープレー', 'パワープレー返し', 'PK', '第2PK', 'OG'],
};
export const OPT_KEYS = Object.keys(DEFAULT_OPTIONS);
export const defaultList = (k) => DEFAULT_OPTIONS[k].map((n, i) => ({ id: 'o' + i + '_' + n, name: n, hidden: false, order: i, aliases: [] }));

// config/global の中身 → { key: [{id,name,hidden,order}] }（並び順どおり）
export function readOptions(v = {}) {
  const g = {};
  for (const k of OPT_KEYS) {
    const map = v.optMap && v.optMap[k];
    if (map && typeof map === 'object' && Object.keys(map).length) {
      g[k] = Object.entries(map).filter(([, o]) => o && typeof o === 'object' && o.name)
        .map(([id, o]) => ({ id, name: String(o.name), hidden: !!o.hidden, order: Number.isFinite(o.order) ? o.order : 1e9, aliases: Array.isArray(o.aliases) ? o.aliases : [] }))
        .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
    } else if (Array.isArray(v[k]) && v[k].length) {
      g[k] = v[k].map((o, i) => ({ id: o.id, name: o.name, hidden: !!o.hidden, order: i, aliases: [] }));
    } else g[k] = defaultList(k);
  }
  return g;
}
// optMap がまだ無い選択肢を初めて直すときは、今の一覧をまるごと新しい形で書く（以降は1件ずつ）
export function hasMap(v, k) { const m = v && v.optMap && v.optMap[k]; return !!(m && typeof m === 'object' && Object.keys(m).length); }
export function fullMap(list) { return Object.fromEntries(list.map((o, i) => [o.id, { name: o.name, hidden: !!o.hidden, order: i, ...(o.aliases?.length ? { aliases: o.aliases } : {}) }])); }
// 名前を変えるときは前の名前を aliases に残す（名前だけが保存されている古い試合を、変えたあとも同じ選択肢として読むため）
export function renamePatch(o, name) { return { name, aliases: [...new Set([...(o.aliases || []), o.name])].filter((x) => x !== name) }; }

// id でも名前でも引ける（古い試合には名前が入っている）
export function findOpt(list, v) {
  if (v == null || v === '') return null;
  return list.find((o) => o.id === v) || list.find((o) => o.name === v) || list.find((o) => (o.aliases || []).includes(v)) || null;
}
// 名前の重なり（同じ一覧の中で、自分以外に同じ名前があるか）
export function nameTaken(list, name, exceptId = null) { return list.some((o) => o.id !== exceptId && o.name === name); }

// 読むとき：試合・活動の id と今の名前をそろえる（書き込みはしない）
// field = 'category'（試合）/ 'type'（活動）、idField = 'categoryId' / 'typeId'
export function resolveDoc(doc, list, field, idField) {
  const byId = doc[idField] ? list.find((o) => o.id === doc[idField]) : null;
  const o = byId || (doc[idField] ? null : findOpt(list, doc[field]));
  if (o) return { ...doc, [idField]: o.id, [field]: o.name };
  // id が見つからない（選択肢が消された）ときは、保存されている名前の写しを出す
  return { ...doc, [idField]: doc[idField] || '', [field]: doc[field] || '' };
}
// 書くとき：名前（または id）で渡されたら id と名前の写しの両方を書く
export function normalizeWrite(data, list, field, idField) {
  if (!(field in data) || idField in data) return data;
  const v = data[field];
  if (typeof v !== 'string') return data;
  const o = findOpt(list, v);
  if (!v) return { ...data, [idField]: '', [field]: '' };
  if (o) return { ...data, [idField]: o.id, [field]: o.name };
  return { ...data, [idField]: '' }; // 一覧にない名前：名前だけを残す（古い id は外す）
}
