// Sportscode からの取り込み（spec 9章「Sportscodeからの取り込み」）。XML と CSV は同じ中身で、どちらも読める。
// 画面を作らない純粋な処理：ファイルを読む → コードとラベルを対応表で読む → 動画の時刻を試合の時計に直す → イベントにする。
// 出場（#背番号の行）と AT_／DF_ のコードは取り込まない（出場は MATCH PLAY の記録を使う）。読めなかったコード・ラベルは一覧で返す。
import { OPP_OG, UNKNOWN, NO_ASSIST } from './events.js';

// ---------- ファイルを読む ----------
const unx = (s) => String(s ?? '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&').trim();
export function parseSC(text) {
  const t = String(text || '').replace(/^﻿/, '');
  if (/<ALL_INSTANCES>|<instance>/i.test(t)) {
    const out = [];
    for (const m of t.matchAll(/<instance>([\s\S]*?)<\/instance>/g)) {
      const b = m[1]; const g = (tag) => (b.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`)) || [])[1];
      const labels = [...b.matchAll(/<label>([\s\S]*?)<\/label>/g)].map((x) => [unx((x[1].match(/<group>([\s\S]*?)<\/group>/) || [])[1] || ''), unx((x[1].match(/<text>([\s\S]*?)<\/text>/) || [])[1] || '')]).filter(([, v]) => v);
      out.push({ code: unx(g('code')), start: +g('start'), end: +g('end'), labels });
    }
    return { kind: 'xml', instances: out };
  }
  // CSV：1行1件。ラベルはグループごとの列（同じグループに2つ付くと「A, B」）
  const rows = csvRows(t); if (!rows.length) return { kind: 'csv', instances: [] };
  const h = rows[0].map((x) => x.trim());
  const iS = h.indexOf('Start time'), iD = h.indexOf('Duration'), iR = h.indexOf('Row'), iN = h.indexOf('Instance number');
  const skip = new Set(['Timeline', 'Start time', 'Duration', 'Row', 'Instance number', 'Ungrouped', 'Notes', 'Flags']);
  const lab = h.map((x, i) => (skip.has(x) || !x ? null : i)).filter((x) => x != null);
  const out = [];
  for (const r of rows.slice(1)) {
    if (!r[iR]) continue;
    const start = +r[iS], end = start + (+r[iD] || 0);
    const labels = []; for (const i of lab) for (const v of String(r[i] || '').split(/,\s*/).map((x) => x.trim()).filter(Boolean)) labels.push([h[i], v]);
    // 「枠外(ポスト), ブロック」のようにラベル自体にカンマが入らないので、カンマで分けてよい
    out.push({ code: r[iR].trim(), start, end, labels, n: +r[iN] || null });
  }
  return { kind: 'csv', instances: out };
}
function csvRows(t) {
  const rows = []; let row = [], cur = '', q = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (q) { if (c === '"') { if (t[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; continue; }
    if (c === '"') q = true; else if (c === ',') { row.push(cur); cur = ''; } else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; row.push(cur); cur = ''; if (row.some((x) => x !== '')) rows.push(row); row = []; } else cur += c;
  }
  if (cur || row.length) { row.push(cur); if (row.some((x) => x !== '')) rows.push(row); }
  return rows;
}

// ---------- コード名・ラベル名の対応表（コードウィンドウの違う版も読めるように） ----------
const CODE = {
  'シュート': 'shot', 'スコアゾーン内シュート': 'szshot', '被シュート': 'oshot', 'スコアゾーン内被シュート': 'oszshot',
  'ゾーン4進入': 'z4', 'ゾーン4被進入': 'oz4', 'スコアゾーン進入': 'sz', 'スコアゾーン被進入': 'osz',
  'SETPLAY AT': 'fspat', 'FINISH SET PLAY AT': 'fspat', 'SETPLAY DF': 'fspdf', 'FINISH SET PLAY DF': 'fspdf',
  ROBO: 'rec', 'ROBO 1/2': 'rec', 'ボールリカバリー': 'rec', PERDIDA: 'lost', 'PERDIDA 1/2': 'lost', 'ボールロスト': 'lost',
  'ファウル': 'foul', 'ファール': 'foul', '被ファウル': 'fouled', '被ファール': 'fouled',
};
// 取り込まない（知らせもしない）コード：出場の行と攻撃・守備の時間のコード
const IGNORE = (c) => /^#\s*\d+/.test(c) || /^(AT|DF)_/.test(c) || c === 'Kick Off' || c === 'KICK OFF';
export const KNOWN_GROUPS = ['シュート分類', 'スコアゾーン進入人数', 'スコアゾーン進入', '局面', '選手', 'シュート選手', 'ゾーン4進入選手', 'スコアゾーン進入選手', '出し手', '受け手', '進入方法', 'セットプレー分類', 'セットの種類', 'ゾーン', 'カード', 'アシスト', '得点の種類', 'タイムコード', '5x4', 'フィニッシュゾーン結末', 'デュエル選手'];
const PHASE = { 定位置: 'pos', セットプレー: 'set', トランジション: 'trans', GK活用: 'gk', 特殊局面: 'special', PK: 'set', 第2PK: 'set' };
const phaseOf = (v) => { const s = String(v).replace(/(攻撃|守備)$/, ''); return PHASE[s] || null; };
const FSP = { CK: 'CK', 'CK-KICK IN': 'CK-KI', 'CK-KI': 'CK-KI', 'KICK IN': 'KI', KI: 'KI', FK: 'FK', '6m(PK)': 'PK', '6m': 'PK', PK: 'PK', '10m(第2PK)': '2PK', '10m': '2PK', '第2PK': '2PK' };
const fspOf = (v) => FSP[String(v).replace(/(\s*DF|-D)$/, '').trim()] || null;
const RES = { 枠内: 'in', 枠外: 'out', 'ポスト': 'post', '枠外(ポスト)': 'out', ブロック: 'block' };
// 動画の時刻＝コードの開始＋リード（コードごとに違う。取り込み画面で変えられる）
export const DEFAULT_LEAD = { shot: 15, ent: 15, foul: 15, rl: 13, sp: 3 };
export const LEAD_LABEL = { shot: 'シュート（被・SZ内も）', ent: 'ゾーン4・スコアゾーン進入（被も）', foul: 'ファウル・被ファウル', rl: 'ROBO・PERDIDA', sp: 'SETPLAY AT／DF' };
const leadKey = (k) => (['shot', 'szshot', 'oshot', 'oszshot'].includes(k) ? 'shot' : ['z4', 'oz4', 'sz', 'osz'].includes(k) ? 'ent' : (k === 'rec' || k === 'lost') ? 'rl' : (k === 'fspat' || k === 'fspdf') ? 'sp' : 'foul');

// Kick Off の印（ピリオドの始まり）
export const kickOffs = (inst) => inst.filter((i) => /^kick ?off$/i.test(i.code)).sort((a, b) => a.start - b.start);

// ---------- イベントにする ----------
// o = { instances, periods:[{key, ko（秒）, shift（秒）, from, to（このピリオドに入れる動画の範囲。秒）}], R（ランニングタイムの試合）, M, members, players, goalTypes:[{id,name}], lead }
export function buildImport(o) {
  const lead = { ...DEFAULT_LEAD, ...(o.lead || {}) };
  const unknownCodes = new Map(), unknownLabels = new Map(), unmatched = new Map();
  const mem = o.members || {};
  const byNo = new Map(Object.entries(mem).map(([pid, m]) => [String(m.no), pid]));
  const P = (id) => o.players.find((p) => p.id === id);
  const full = (pid) => { const p = P(pid); return p ? `${p.last || ''} ${p.first || ''}`.trim() : ''; };
  const norm = (s) => String(s).replace(/[\s　]+/g, '');
  const pidOf = (v) => {
    if (!v) return null;
    const m = String(v).match(/^#?\s*(\d+)$/); if (m) return byNo.get(m[1]) || null;
    const n = norm(v); const ids = Object.keys(mem);
    return ids.find((pid) => norm(full(pid)) === n) || ids.find((pid) => norm(P(pid)?.last || '') === n) || ids.find((pid) => n.startsWith(norm(P(pid)?.last || '-')) && norm(P(pid)?.last || '')) || null;
  };
  const gtId = (name) => o.goalTypes.find((g) => g.name === name)?.id || null;
  const events = []; let seq = 0;
  for (const per of o.periods) {
    const list = o.instances.filter((i) => i.start >= per.from && i.start < per.to).sort((a, b) => a.start - b.start);
    const pend = o.M.periods.find((p) => p.key === per.key)?.elapsed ?? Infinity;
    const toAt = (videoSec) => {
      const rel = Math.max(0, (videoSec - per.ko - (+per.shift || 0)) * 1000);
      const el = o.R.elOfRel ? o.R.elOfRel(per.key, rel) : rel;
      return Math.max(0, Math.min(pend, Math.round(el / 1000) * 1000)); // 時計が0:00になったあとのプレーは、ピリオドの最後に数える
    };
    const fsps = []; const later = []; // セットプレーの得点の種類は、直前の FINISH SET PLAY の種類から
    for (const i of list) {
      if (IGNORE(i.code)) continue;
      const kind = CODE[i.code];
      if (!kind) { unknownCodes.set(i.code, (unknownCodes.get(i.code) || 0) + 1); continue; }
      const L = {}; for (const [g, v] of i.labels) { (L[g] = L[g] || []).push(v); if (g && !KNOWN_GROUPS.includes(g)) unknownLabels.set(g, (unknownLabels.get(g) || 0) + 1); }
      const first = (...gs) => { for (const g of gs) if (L[g]?.length) return L[g][0]; return null; };
      const t = i.start + lead[leadKey(kind)];
      const ev = { id: null, period: per.key, at: toAt(t), seq: ++seq, src: 'sportscode', kind };
      const who = (v, g) => { if (!v) return null; const pid = pidOf(v); if (!pid) unmatched.set(v, (unmatched.get(v) || 0) + 1); return pid; };
      const phase = first('局面'); const cls = phase ? phaseOf(phase) : null;
      if (['shot', 'szshot', 'oshot', 'oszshot'].includes(kind)) {
        const own = kind === 'shot' || kind === 'szshot'; const sz = kind === 'szshot' || kind === 'oszshot';
        const res = L['シュート分類'] || [];
        const n = first('スコアゾーン進入人数', 'スコアゾーン進入');
        if (res.includes('ゴール') || res.includes('オウンゴール')) {
          const og = res.includes('オウンゴール');
          ev.kind = own ? 'goal' : 'conc';
          ev.sz = og ? undefined : (sz ? 'in' : 'out');
          if (!og && n != null && n !== '' && Number.isFinite(+n)) ev.n = +n;
          if (own) {
            if (og) { ev.pid = OPP_OG; ev.assist = NO_ASSIST; ev.gtype = gtId('OG'); }
            else { ev.pid = who(first('選手', 'シュート選手')) || undefined; const a = first('アシスト'); if (a) ev.assist = a === 'なし' ? NO_ASSIST : who(a) || undefined; }
          } else if (og) ev.gtype = gtId('OG');
          if (!og) {
            const gname = first('得点の種類');
            if (gname) ev.gtype = gtId(gname) || undefined; else if (cls) later.push([ev, cls]); // 局面からの種類は、ピリオドのイベントをそろえてから決める
          }
        } else {
          const r = ['枠内', 'ブロック', '枠外(ポスト)', '枠外', 'ポスト'].find((x) => res.includes(x));
          if (r) ev.result = RES[r];
          if (!sz && n != null && n !== '' && Number.isFinite(+n)) ev.n = +n;
          else if (sz && n != null && n !== '' && +n >= 1) ev.n = +n;
          if (cls) ev.cls = cls;
          if (own) ev.pid = who(first('選手', 'シュート選手')) || undefined;
          const sp = first('セットプレー分類', 'セットの種類'); if (sp && cls === 'set') ev.sp = fspOf(sp) || undefined;
        }
      } else if (kind === 'z4' || kind === 'oz4' || kind === 'sz' || kind === 'osz') {
        if (cls && (kind === 'z4' || kind === 'oz4')) ev.cls = cls;
        if (kind === 'z4' || kind === 'sz') {
          const m = first('進入方法'); if (m) ev.method = { ドリブル: 'dribble', パス: 'pass', リバウンド: 'rebound' }[m];
          const p = first('選手', 'ゾーン4進入選手', 'スコアゾーン進入選手', '出し手'); const pid = who(p);
          if (pid) { ev.pid = pid; if (!ev.method) ev.method = undefined; }
          const r2 = first('受け手'); if (r2) ev.pid2 = who(r2) || undefined;
        }
      } else if (kind === 'fspat' || kind === 'fspdf') {
        const sp = first('セットプレー分類', 'セットの種類'); if (sp) ev.fsp = fspOf(sp) || undefined;
        fsps.push(ev);
      } else if (kind === 'rec' || kind === 'lost') {
        ev.pid = who(first('選手')) || undefined; const z = first('ゾーン'); if (z) ev.zone = z;
      } else if (kind === 'foul' || kind === 'fouled') {
        ev.pid = who(first('選手')) || undefined;
        const c = (L['カード'] || []).concat(i.labels.map(([, v]) => v)).find((v) => /イエロー|レッド/.test(v));
        ev.card = !c ? 'none' : /2枚目/.test(c) ? (kind === 'fouled' ? 'y2' : 'yellow') : /イエロー/.test(c) ? 'yellow' : 'red';
      }
      for (const k of Object.keys(ev)) if (ev[k] === undefined) delete ev[k];
      events.push(ev);
    }
    for (const [ev, cls] of later) { const n = goalTypeOf(cls, ev, fsps, per, W(o, per.key)); if (n && gtId(n)) ev.gtype = gtId(n); }
  }
  return { events, unknownCodes: [...unknownCodes], unknownLabels: [...unknownLabels], unmatched: [...unmatched] };
}
// 得点の種類：局面から。セットプレーは直前の FINISH SET PLAY の種類、特殊局面は自チームの5x4ならパワープレー・相手の5x4ならパワープレー返し
function goalTypeOf(cls, ev, fsps, per, Wk) {
  if (!cls) return null;
  if (cls === 'pos') return '定位置'; if (cls === 'trans') return 'トランジション'; if (cls === 'gk') return 'GK活用';
  if (cls === 'set') {
    const want = ev.kind === 'goal' ? 'fspat' : 'fspdf';
    const f = fsps.filter((x) => x.kind === want && x.at <= ev.at && ev.at - x.at <= 30000).pop();
    return f?.fsp ? { CK: 'CK', 'CK-KI': 'CK-KI', KI: 'KI', FK: 'FK', PK: 'PK', '2PK': '第2PK' }[f.fsp] : null;
  }
  if (cls === 'special') {
    const inOwn = (Wk.own || []).some(([a, b]) => ev.at >= a && ev.at <= b);
    const inOpp = (Wk.opp || []).some(([a, b]) => ev.at >= a && ev.at <= b);
    if (ev.kind === 'goal') return inOwn ? 'パワープレー' : inOpp ? 'パワープレー返し' : null;
    return inOpp ? 'パワープレー' : inOwn ? 'パワープレー返し' : null;
  }
  return null;
}
const W = (o, k) => ({ own: o.W?.own?.[k] || [], opp: o.W?.opp?.[k] || [] });
export { UNKNOWN };
