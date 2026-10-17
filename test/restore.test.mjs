// 選択肢の id 化（options.js）と、バックアップから戻すときの計画（restoreplan.js）。
// Run: node test/restore.test.mjs
import { readOptions, resolveDoc, normalizeWrite, nameTaken, fullMap, renamePatch } from '../js/options.js';
import { planRestore, checkFile, fileCounts, reviveDates } from '../js/restoreplan.js';

let pass = 0, fail = 0;
const eq = (a, b, msg) => { const A = JSON.stringify(a), B = JSON.stringify(b); if (A === B) pass++; else { fail++; console.log('NG:', msg, '\n  got ', A, '\n  want', B); } };

// ---- options ----
const def = readOptions({});
eq(def.matchCategories.map((o) => o.name), ['予選リーグ', '決勝トーナメント', '順位決定戦'], '初期値');
const arr = { matchCategories: [{ id: 'a', name: '予選' }, { id: 'b', name: '決勝', hidden: true }] };
eq(readOptions(arr).matchCategories.map((o) => [o.id, o.name, o.hidden]), [['a', '予選', false], ['b', '決勝', true]], '古い配列の形を読む');
const map = { ...arr, optMap: { matchCategories: { b: { name: '決勝T', hidden: false, order: 0 }, a: { name: '予選', order: 1 } } } };
eq(readOptions(map).matchCategories.map((o) => o.name), ['決勝T', '予選'], '新しい形（optMap）を優先し、order で並べる');
const L = readOptions(map).matchCategories;
eq(resolveDoc({ category: '予選' }, L, 'category', 'categoryId'), { category: '予選', categoryId: 'a' }, '名前だけの古い試合は名前で id を引く');
eq(resolveDoc({ categoryId: 'b', category: '決勝' }, L, 'category', 'categoryId'), { categoryId: 'b', category: '決勝T' }, 'id があれば今の名前（名前を変えると過去の試合も変わる）');
eq(resolveDoc({ category: '昔の区分' }, L, 'category', 'categoryId'), { category: '昔の区分', categoryId: '' }, '一覧にない名前はそのまま');
eq(resolveDoc({ categoryId: 'zz', category: '消えた' }, L, 'category', 'categoryId'), { categoryId: 'zz', category: '消えた' }, 'id が見つからなければ名前の写し');
eq(normalizeWrite({ category: '決勝T' }, L, 'category', 'categoryId'), { category: '決勝T', categoryId: 'b' }, '名前で書いても id で保存');
eq(normalizeWrite({ category: 'a' }, L, 'category', 'categoryId'), { category: '予選', categoryId: 'a' }, 'id で書いても名前の写しをそろえる');
eq(normalizeWrite({ category: '' }, L, 'category', 'categoryId'), { category: '', categoryId: '' }, '空＝なし');
eq(normalizeWrite({ category: '自由な名前' }, L, 'category', 'categoryId'), { category: '自由な名前', categoryId: '' }, '一覧にない名前');
eq(normalizeWrite({ categoryId: 'a', category: '予選' }, L, 'category', 'categoryId'), { categoryId: 'a', category: '予選' }, 'id つきはそのまま');
eq([nameTaken(L, '予選'), nameTaken(L, '予選', 'a'), nameTaken(L, '新')], [true, false, false], '名前の重なり');
eq(fullMap(L), { b: { name: '決勝T', hidden: false, order: 0 }, a: { name: '予選', hidden: false, order: 1 } }, '一覧まるごとの形');

const d0 = readOptions({}).matchCategories[0];
const rp1 = renamePatch(d0, 'グループリーグ');
eq(rp1, { name: 'グループリーグ', aliases: ['予選リーグ'] }, '名前を変えると前の名前を残す');
const L2 = readOptions({ optMap: { matchCategories: { [d0.id]: { ...rp1, order: 0 } } } }).matchCategories;
eq(resolveDoc({ category: '予選リーグ' }, L2, 'category', 'categoryId'), { category: 'グループリーグ', categoryId: d0.id }, '名前だけの古い試合も、名前を変えたあとの名前で出る');
eq(renamePatch({ name: 'B', aliases: ['A'] }, 'A'), { name: 'A', aliases: ['B'] }, '元の名前に戻したとき');

// ---- restore ----
const file = {
  app: 'futsal-playtime', version: 'x', exportedAt: '2026-10-15T00:00:00.000Z',
  config: { global: { matchCategories: [{ id: 'a', name: '予選' }, { id: 'n', name: '新しい区分' }, { id: 'dupe', name: '決勝T' }] } },
  teams: [{
    id: 'T', name: 'チーム', createdAt: '2026-10-01T01:02:03.000Z',
    players: [{ id: 'p1', last: 'A' }, { id: 'p2', last: 'B' }, { id: 'pDel', last: 'C' }],
    activities: [{ id: 'a1', name: '大会' }, { id: 'aDel', name: '消した活動' }],
    matches: [
      { id: 'm1', activityId: 'a1', ops: [{ id: 'o1' }, { id: 'o2' }], events: [{ id: 'e1' }], fixlog: [] },
      { id: 'm2', activityId: 'a1', ops: [{ id: 'o3' }], events: [], fixlog: [{ id: 'f1' }] },
      { id: 'mDel', activityId: 'a1', ops: [{ id: 'o4' }], events: [], fixlog: [] },
      { id: 'mOfDelAct', activityId: 'aDel', ops: [], events: [], fixlog: [] },
    ],
  }, { id: 'Tdel', name: '消したチーム', players: [{ id: 'q' }], activities: [], matches: [] }],
};
eq(checkFile(file), null, 'ファイルの形 OK');
eq(checkFile({ app: 'other', teams: [] }), 'このアプリのバックアップファイルではありません', 'ほかのファイル');
eq(fileCounts(file), { teams: 2, players: 4, activities: 2, matches: 4, ops: 4, events: 1, fixlog: 1 }, '数');
const cloud = { teams: {
  T: { data: { name: 'チーム' }, players: { p1: { last: 'A2' }, pDel: { deleted: true }, pNew: { last: 'あとで追加' } }, activities: { a1: {}, aDel: { deleted: true } },
    matches: { m1: { activityId: 'a1' }, mDel: { deleted: true }, mNew: { activityId: 'a1' } },
    sub: { m1: { ops: { o1: {}, o9: {} }, events: { e1: {}, e9: {} }, fixlog: {} } } },
  Tdel: { data: { deleted: true }, players: {}, activities: {}, matches: {}, sub: {} },
} };
const add = planRestore(file, cloud, { mode: 'add', cloudGlobal: map });
const paths = (p) => p.writes.map((w) => `${w.op}:${w.path.join('/')}`);
eq(paths(add), ['set:teams/T/players/p2', 'set:teams/T/matches/m1/ops/o2', 'set:teams/T/matches/m2', 'set:teams/T/matches/m2/ops/o3', 'set:teams/T/matches/m2/fixlog/f1'],
  '足りないだけ：無い id だけ足す。削除した選手・試合・チーム・削除した活動の試合は戻さない。あるものは上書きしない');
eq(add.writes.find((w) => w.path.join('/') === 'teams/T/matches/m2').data, { activityId: 'a1' }, '試合の文書には中の記録（ops など）と id を入れない');
eq(add.options, { matchCategories: { n: { name: '新しい区分', hidden: false, order: 2 } } }, '選択肢は無い id だけ足す（同じ名前は足さない）');
eq(add.count.skippedDeleted, 5, '削除済みで戻さない数');
const rep = planRestore(file, cloud, { mode: 'replace', teamIds: ['T'] });
const rp = paths(rep);
eq(rp.includes('set:teams/T') && rp.includes('set:teams/T/players/p1') && rp.includes('set:teams/T/matches/mDel'), true, '置き換え：ファイルの記録はすべて書く（削除してあっても）');
eq(rp.filter((x) => x.startsWith('merge') || x.startsWith('delete')), ['merge:teams/T/players/pNew', 'delete:teams/T/matches/m1/ops/o9', 'merge:teams/T/matches/m1/events/e9', 'merge:teams/T/matches/mNew'],
  '置き換え：ファイルに無いものは削除の印（操作は消す）');
eq(rp.some((x) => x.includes('Tdel')), false, '選ばなかったチームは変えない');
eq(reviveDates({ a: '2026-10-01T01:02:03.000Z', d: '2026-10-01', n: [1, '2026-10-01T01:02:03Z'] }, (d) => ({ ts: d.getTime() })), { a: { ts: Date.parse('2026-10-01T01:02:03Z') }, d: '2026-10-01', n: [1, { ts: Date.parse('2026-10-01T01:02:03Z') }] }, '日時を戻す');

console.log(`restore: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
