// バックアップから戻すときの「何を書くか」を決める（画面や Firestore に依存しない。test/restore.test.mjs）。
// spec 5章：「足りない記録だけを足す」（初めの選択）と「丸ごと置き換える」（確認2回）。
//   add     ：クラウドに無い id の記録だけを足す。クラウドにある記録は上書きしない。
//             クラウドで削除した記録（deleted:true）は、ファイルにあっても戻さない（その中の記録も）。
//   replace ：選んだチームの記録をファイルの中身にする。ファイルに無い選手・活動・試合・イベントは削除の印、
//             ファイルに無い MATCH PLAY の操作と修正の履歴は消す（そのままだと記録の計算に入るため）。
import { readOptions, OPT_KEYS, nameTaken } from './options.js';

export const SUBS = ['players', 'activities', 'matches'];
export const MSUBS = ['ops', 'events', 'fixlog'];

// ファイルの形を確かめる（exportBackup の形）。だめなら日本語の理由を返す
export function checkFile(o) {
  if (!o || typeof o !== 'object') return 'ファイルの中身が読めません';
  if (o.app !== 'futsal-playtime') return 'このアプリのバックアップファイルではありません';
  if (!Array.isArray(o.teams)) return 'チームの記録が入っていません';
  for (const t of o.teams) if (!t || typeof t.id !== 'string') return 'チームの記録の形が正しくありません';
  return null;
}
export function fileCounts(o, teamIds = null) {
  const c = { teams: 0, players: 0, activities: 0, matches: 0, ops: 0, events: 0, fixlog: 0 };
  for (const t of o.teams) {
    if (teamIds && !teamIds.includes(t.id)) continue;
    c.teams++;
    for (const k of SUBS) c[k] += (t[k] || []).length;
    for (const m of t.matches || []) for (const k of MSUBS) c[k] += (m[k] || []).length;
  }
  return c;
}
const body = (d, drop = []) => { const r = { ...d }; delete r.id; for (const k of drop) delete r[k]; return r; };

// cloud: { teams: { [teamId]: { data|null, players:{id:data}, activities:{...}, matches:{...}, sub:{ [matchId]: { ops:{}, events:{}, fixlog:{} } } } } }
//   data が null ＝ クラウドに無い。sub は、ファイルにもクラウドにもある試合の分だけあればよい。
// 返す値：{ writes: [{op:'set'|'merge'|'delete', path:[...], data?}], count: {added, replaced, removed, skippedDeleted}, options }
export function planRestore(file, cloud, { mode = 'add', teamIds = null, cloudGlobal = {} } = {}) {
  const writes = [];
  const count = { added: 0, replaced: 0, removed: 0, skippedDeleted: 0, kept: 0 };
  const add = (path, data) => { writes.push({ op: 'set', path, data }); count.added++; };
  const teams = file.teams.filter((t) => !teamIds || teamIds.includes(t.id));
  for (const t of teams) {
    const ct = cloud.teams[t.id] || { data: null, players: {}, activities: {}, matches: {}, sub: {} };
    const tpath = ['teams', t.id];
    if (mode === 'add') {
      if (ct.data && ct.data.deleted) { count.skippedDeleted++; continue; } // 削除したチームは戻さない
      if (!ct.data) add(tpath, body(t, SUBS)); else count.kept++;
      const delActs = new Set(Object.entries(ct.activities || {}).filter(([, d]) => d && d.deleted).map(([id]) => id));
      for (const k of SUBS) {
        for (const d of t[k] || []) {
          const c = (ct[k] || {})[d.id];
          if (k === 'matches') {
            if (c && c.deleted) { count.skippedDeleted++; continue; }
            if (!c && delActs.has(d.activityId)) { count.skippedDeleted++; continue; } // 削除した活動の試合
            const mpath = [...tpath, 'matches', d.id];
            if (!c) add(mpath, body(d, MSUBS)); else count.kept++;
            const cs = (ct.sub || {})[d.id] || {};
            for (const s of MSUBS) for (const x of d[s] || []) {
              if (c && (cs[s] || {})[x.id]) { count.kept++; continue; }
              add([...mpath, s, x.id], body(x));
            }
            continue;
          }
          if (c) { if (c.deleted) count.skippedDeleted++; else count.kept++; continue; }
          add([...tpath, k, d.id], body(d));
        }
      }
    } else {
      writes.push({ op: 'set', path: tpath, data: body(t, SUBS) }); count.replaced++;
      for (const k of SUBS) {
        const ids = new Set((t[k] || []).map((d) => d.id));
        for (const d of t[k] || []) {
          const exists = !!(ct[k] || {})[d.id];
          writes.push({ op: 'set', path: [...tpath, k, d.id], data: body(d, k === 'matches' ? MSUBS : []) });
          exists ? count.replaced++ : count.added++;
          if (k !== 'matches') continue;
          const cs = exists ? ((ct.sub || {})[d.id] || {}) : {};
          for (const s of MSUBS) {
            const fids = new Set((d[s] || []).map((x) => x.id));
            for (const x of d[s] || []) {
              const ex = !!(cs[s] || {})[x.id];
              writes.push({ op: 'set', path: [...tpath, 'matches', d.id, s, x.id], data: body(x) });
              ex ? count.replaced++ : count.added++;
            }
            for (const [id, x] of Object.entries(cs[s] || {})) {
              if (fids.has(id)) continue;
              if (s === 'events') { if (!x?.deleted) { writes.push({ op: 'merge', path: [...tpath, 'matches', d.id, s, id], data: { deleted: true } }); count.removed++; } }
              else { writes.push({ op: 'delete', path: [...tpath, 'matches', d.id, s, id] }); count.removed++; }
            }
          }
        }
        for (const [id, c] of Object.entries(ct[k] || {})) {
          if (ids.has(id) || (c && c.deleted)) continue;
          writes.push({ op: 'merge', path: [...tpath, k, id], data: { deleted: true } }); count.removed++;
        }
      }
    }
  }
  // 選択肢：クラウドに無い id のものだけ足す（同じ名前がもうあるものは足さない）。消したり名前を変えたりはしない
  const options = {};
  const fg = file.config && file.config.global;
  if (fg) {
    const mine = readOptions(cloudGlobal || {}), theirs = readOptions(fg);
    for (const k of OPT_KEYS) {
      let order = mine[k].length;
      for (const o of theirs[k]) {
        if (mine[k].some((x) => x.id === o.id) || nameTaken(mine[k], o.name)) continue;
        (options[k] = options[k] || {})[o.id] = { name: o.name, hidden: !!o.hidden, order: order++ };
      }
    }
  }
  return { writes, count, options };
}

// ファイルの日時（書き出しで文字にしたもの）を、書き込むときに日時の形へ戻す
const ISO = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/;
export function reviveDates(v, toTs) {
  if (typeof v === 'string') return ISO.test(v) && toTs ? toTs(new Date(v)) : v;
  if (Array.isArray(v)) return v.map((x) => reviveDates(x, toTs));
  if (v && typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, reviveDates(x, toTs)]));
  return v;
}
