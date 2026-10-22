// Sportscode からの取り込み（spec 9章「Sportscodeからの取り込み」）。XML と CSV は同じ中身で、どちらも読める。
// 画面を作らない純粋な処理：ファイルを読む → コードとラベルを対応表で読む → 動画の時刻を試合の時計に直す → イベントにする。
// 出場（#背番号の行）と AT_／DF_ のコードは取り込まない（出場は MATCH PLAY の記録を使う）。読めなかったコード・ラベルは一覧で返す。
import { OPP_OG, UNKNOWN, NO_ASSIST, goalTypeIdOf } from './events.js';

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
export const LEAD_LABEL = { shot: 'シュート（被・SZ内も）', ent: 'ゾーン4・スコアゾーン進入（被も）', foul: 'ファール・被ファール（ファウル）', rl: 'リカバリー・ロスト（ROBO・PERDIDA）', sp: 'FINISH SET PLAY AT／DF（SETPLAY）' };
const leadKey = (k) => (['shot', 'szshot', 'oshot', 'oszshot'].includes(k) ? 'shot' : ['z4', 'oz4', 'sz', 'osz'].includes(k) ? 'ent' : (k === 'rec' || k === 'lost') ? 'rl' : (k === 'fspat' || k === 'fspdf') ? 'sp' : 'foul');

// ファイル名からピリオドを推測する（1P・1H・前半 → 前半、2P・2H・後半 → 後半、E1・延長前半、E2・延長後半）。分からなければ null（SCI-01）
export function periodFromName(name) {
  const n = String(name || '').replace(/\.[A-Za-z0-9]+$/, '').normalize('NFKC');
  if (/延長前半|延長1|(?<![A-Za-z])(?:E|ET|OT)[-_ ]?1(?![0-9])/i.test(n)) return 'E1';
  if (/延長後半|延長2|(?<![A-Za-z])(?:E|ET|OT)[-_ ]?2(?![0-9])/i.test(n)) return 'E2';
  if (/前半|(?<![0-9])1(?:P|H|st)(?![A-Za-z0-9])/i.test(n)) return '1H';
  if (/後半|(?<![0-9])2(?:P|H|nd)(?![A-Za-z0-9])/i.test(n)) return '2H';
  return null;
}

// Kick Off の印（ピリオドの始まり）
export const kickOffs = (inst) => inst.filter((i) => /^kick ?off$/i.test(i.code)).sort((a, b) => a.start - b.start);

// 複数のファイルをまとめて取り込む（前半のファイルと後半のファイルなど。2026-10-17）。
// files：[{ instances, assign: [Kick Off ごとのピリオド] }]。ファイルごとに Kick Off でピリオドに分けて buildImport し、結果を1つにまとめる。
// 同じピリオドを2つ以上の Kick Off で選んでいたら dup に入れる（取り込みは止める）
export function buildImportFiles(files, o) {
  const keys = files.flatMap((f) => f.assign || []).filter((k) => k && k !== '-'); // 「-」＝使わない Kick Off（動画の終わりの印など）
  const dup = [...new Set(keys.filter((k, i) => keys.indexOf(k) !== i))];
  const sum = (lists) => { const m = new Map(); for (const l of lists) for (const [k, n] of l) m.set(k, (m.get(k) || 0) + n); return [...m]; };
  const rs = files.map((f) => {
    const kos = kickOffs(f.instances);
    const periods = kos.map((k, i) => ({ key: f.assign[i], ko: k.start, shift: +(o.shift || {})[f.assign[i]] || 0, from: i ? k.start : -1e9, to: kos[i + 1] ? kos[i + 1].start : 1e9 })).filter((x) => x.key && x.key !== '-');
    return { periods, r: buildImport({ ...o, instances: f.instances, periods }) };
  });
  return {
    periods: rs.flatMap((x) => x.periods), dup, events: rs.flatMap((x) => x.r.events),
    unknownCodes: sum(rs.map((x) => x.r.unknownCodes)), unknownLabels: sum(rs.map((x) => x.r.unknownLabels)),
    unmatched: sum(rs.map((x) => x.r.unmatched)), warnings: sum(rs.map((x) => x.r.warnings)), near: sum(rs.map((x) => x.r.near || [])),
  };
}

// ---------- イベントにする ----------
// o = { instances, periods:[{key, ko（秒）, shift（秒）, from, to（このピリオドに入れる動画の範囲。秒）}], R（ランニングタイムの試合）, M, members, players, goalTypes:[{id,name}], lead, seqBase }
// ピリオドの範囲（from・to）は、コードの開始ではなくプレーの瞬間（開始＋リード）で見る（前半の最後の数秒が後半に入らないように）
// seqBase：入力の順（seq）の始まり。取り込む時刻を入れると、同じ秒のイベントも取り込んだ順に並ぶ（アプリで入れたものとも混ざらない）
export function buildImport(o) {
  const lead = { ...DEFAULT_LEAD, ...(o.lead || {}) };
  const unknownCodes = new Map(), unknownLabels = new Map(), unmatched = new Map(), warnings = new Map(), near = new Map();
  const warn = (w) => warnings.set(w, (warnings.get(w) || 0) + 1);
  const mem = o.members || {};
  const byNo = new Map(Object.entries(mem).map(([pid, m]) => [String(m.no), pid]));
  const P = (id) => o.players.find((p) => p.id === id);
  const full = (pid) => { const p = P(pid); return p ? `${p.last || ''} ${p.first || ''}`.trim() : ''; };
  // 見た目がそっくりなカタカナと漢字（ニ／二 など）は同じ字とみなす（2026-10-17）
  const LOOK = { ニ: '二', ロ: '口', カ: '力', エ: '工', ト: '卜', タ: '夕', ハ: '八', ー: '一', 'ｰ': '一', '－': '一', '―': '一' };
  const norm = (s) => String(s).normalize('NFKC').replace(/[\s　]+/g, '').replace(/[ニロカエトタハーｰ－―]/g, (c) => LOOK[c] || c);
  // 名前で探すのは、ちょうど1人に決まるときだけ（同じ名字が2人・名字の前だけ合う、は「見つからない」にして一覧で知らせる）
  const pidOf = (v) => {
    if (!v) return null;
    const m = String(v).match(/^#?\s*(\d+)$/); if (m) return byNo.get(m[1]) || null;
    const n = norm(v); const ids = Object.keys(mem);
    const one = (f) => { const h = ids.filter(f); return h.length === 1 ? h[0] : h.length > 1 ? false : null; };
    // 似た字（ニ／二 など）で合ったときも、そのまま合わせて知らせる
    const plain = (s) => String(s).normalize('NFKC').replace(/[\s　]+/g, '');
    const note = (pid) => { const k = `${v} → ${mem[pid]?.no ?? ''} ${full(pid)}`; near.set(k, (near.get(k) || 0) + 1); return pid; };
    const a = one((pid) => norm(full(pid)) === n); if (a !== null) return a ? (plain(full(a)) === plain(v) ? a : note(a)) : null;
    const b = one((pid) => norm(P(pid)?.last || '') === n); if (b !== null) return b ? (plain(P(b)?.last || '') === plain(v) ? b : note(b)) : null;
    // 名前が少し違う（下の名前の打ち間違いなど）：最初の言葉（名字）が試合メンバーの1人の名字とぴったり合えば、その選手にして知らせる（2026-10-17）
    const sur = String(v).normalize('NFKC').trim().split(/[\s　]+/)[0];
    if (sur && norm(sur) !== n) {
      const c = one((pid) => norm(P(pid)?.last || '') === norm(sur));
      if (c) return note(c);
    }
    return null;
  };
  const gtId = (name) => goalTypeIdOf(o.goalTypes, name); // 種類の名前を変えても、初めからある種類は id で見つける（記15）
  const events = []; let seq = +o.seqBase || 0;
  const tOf = (i) => { const k = CODE[i.code]; return i.start + (k ? lead[leadKey(k)] : 0); };
  for (const per of o.periods) {
    const list = o.instances.filter((i) => { const t = tOf(i); return t >= per.from && t < per.to; }).sort((a, b) => tOf(a) - tOf(b) || a.start - b.start);
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
      const L = {}; for (const [g, v] of i.labels) { if (!(L[g] = L[g] || []).includes(v)) L[g].push(v); if (g && !KNOWN_GROUPS.includes(g)) unknownLabels.set(g, (unknownLabels.get(g) || 0) + 1); }
      const used = new Set(); // 読んだグループ（同じグループに2つのラベルがあれば要確認にする）
      const first = (...gs) => { for (const g of gs) if (L[g]?.length) { used.add(g); return L[g][0]; } return null; };
      const t = i.start + lead[leadKey(kind)];
      const ev = { id: null, period: per.key, at: toAt(t), seq: ++seq, src: 'sportscode', kind };
      const who = (v, g) => { if (!v) return null; const pid = pidOf(v); if (!pid) unmatched.set(v, (unmatched.get(v) || 0) + 1); return pid; };
      const phase = first('局面'); const cls = phase ? phaseOf(phase) : null;
      if (['shot', 'szshot', 'oshot', 'oszshot'].includes(kind)) {
        const own = kind === 'shot' || kind === 'szshot'; const sz = kind === 'szshot' || kind === 'oszshot';
        const res = L['シュート分類'] || []; used.add('シュート分類');
        const n = first('スコアゾーン進入人数', 'スコアゾーン進入');
        if (res.includes('ゴール') || res.includes('オウンゴール')) {
          const og = res.includes('オウンゴール');
          ev.kind = own ? 'goal' : 'conc';
          ev.sz = og ? undefined : (sz ? 'in' : 'out'); // OGはSZ内／SZ外を記録しない（決5）
          if (!og && n != null && n !== '' && Number.isFinite(+n)) { if (sz && +n === 0) warn('SZ内の得点・失点で「ゾーン内の人数」が0人になっているもの（人数は空けて取り込みます）'); else ev.n = +n; }
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
          else if (sz && n != null && n !== '' && +n === 0) warn('SZ内シュートで「ゾーン内の人数」が0人になっているもの（SZ内は打った選手を1人目に数えるので、人数は空けて取り込みます）');
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
        ev.pid = who(first('選手')) || undefined;
        const z = first('ゾーン'); const zz = z && String(z).normalize('NFKC').trim().toUpperCase();
        if (zz && /^Z[1-4]$/.test(zz)) ev.zone = zz; else if (z) warn(`ROBO・PERDIDAのゾーンが Z1〜Z4 でないもの「${z}」（ゾーンは空けて取り込みます）`);
      } else if (kind === 'foul' || kind === 'fouled') {
        ev.pid = who(first('選手')) || undefined;
        const c = (L['カード'] || []).concat(i.labels.map(([, v]) => v)).find((v) => /イエロー|レッド/.test(v));
        ev.card = !c ? 'none' : /2枚目/.test(c) ? (kind === 'fouled' ? 'y2' : 'yellow') : /イエロー/.test(c) ? 'yellow' : 'red';
      }
      const multi = [...used].filter((g) => (L[g] || []).length > 1);
      if (multi.length) { ev.impWhy = `Sportscodeで同じグループに2つ以上のラベルがあります（${multi.map((g) => `${g}：${L[g].join('・')}`).join('、')}）`; ev.check = true; }
      for (const k of Object.keys(ev)) if (ev[k] === undefined) delete ev[k];
      events.push(ev);
    }
    for (const [ev, cls] of later) { const n = goalTypeOf(cls, ev, fsps, per, W(o, per.key)); if (n && gtId(n)) ev.gtype = gtId(n); }
  }
  return { events, unknownCodes: [...unknownCodes], unknownLabels: [...unknownLabels], unmatched: [...unmatched], warnings: [...warnings], near: [...near] };
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
