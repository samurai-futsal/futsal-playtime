// Sportscode（XML）の書き出し（spec 9章「書き出し」、⑥-2）。Hudl Sportscode のタイムラインに読み込める XML。
// 前半・後半（延長も）を別のファイルで出す（2026-10-15 決定）。ピリオドごとに動画上のキックオフの位置を入れ、
// MATCH PLAY の実際の時刻（ランニングタイム）から動画の時刻を求める。
// 選手の行（#背番号）：時計が動いていた区間ごとに、ピッチにいた選手1人1本（時計が止まっている間は帯を切る）。
// GKをFPと入れ替えてGKがいない区間（特殊局面）は帯を分けて「局面＝特殊局面」のラベルを付ける（spec 9章）。
// イベントの行：今使っているコードウィンドウと同じコード名・色・ラベル（ゾーン4進入、シュート、SETPLAY AT、ROBO など）。
import { OPP_OG, UNKNOWN, isOG } from './events.js';
import { ppWindows, noGkWindows, winTest } from './teamstats.js';

const xesc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const mmss = (ms) => { const x = Math.round(ms / 1000); return `${Math.floor(x / 60)}:${String(x % 60).padStart(2, '0')}`; };

// 行の色（今使っている XML と同じ。Sportscode は 0〜65535）
export const ROW_COLORS = {
  'Kick Off': [0, 0, 0], 'シュート': [6425, 0, 65535], 'スコアゾーン内シュート': [6425, 0, 65535], 'ゾーン4進入': [6425, 0, 65535], 'スコアゾーン進入': [6425, 0, 65535],
  '被シュート': [64764, 14135, 7196], 'スコアゾーン内被シュート': [64507, 0, 7196], 'ゾーン4被進入': [64764, 14135, 7196], 'スコアゾーン被進入': [64507, 0, 7196],
  'SETPLAY AT': [23901, 48316, 1285], 'SETPLAY DF': [15934, 31868, 514], ROBO: [0, 7967, 52685], PERDIDA: [52171, 0, 1285], 'ファウル': [31097, 31097, 31097], '被ファウル': [45746, 45746, 45746],
};
// リード（イベントの何秒前から）とラグ（何秒後まで）。実物で確かめた値（2026-10-13）。書き出し画面で変えられる
export const DEFAULT_LEAD = { shot: [15, 2], ent: [15, 2], foul: [15, 2], rl: [13, 2], sp: [3, 2], ko: [0, 2] };
export const LEAD_LABEL = { shot: 'シュート（被・SZ内も）', ent: 'ゾーン4・スコアゾーン進入（被も）', foul: 'ファウル・被ファウル', rl: 'ROBO・PERDIDA', sp: 'SETPLAY AT／DF', ko: 'Kick Off' };
const CLS_TXT = { pos: '定位置', set: 'セットプレー', trans: 'トランジション', gk: 'GK活用', special: '特殊局面' };
const SP_TXT = { CK: 'CK', 'CK-KI': 'CK-KICK IN', KI: 'KICK IN', FK: 'FK', PK: '6m(PK)', '2PK': '10m(第2PK)' };
const RES_TXT = { in: '枠内', out: '枠外(ポスト)', post: '枠外(ポスト)', block: 'ブロック' };
const CARD_TXT = { yellow: 'イエロー', y2: 'イエロー2枚目', red: 'レッド' };

// 1つのピリオドの XML。o = { M（プレーイングタイム）, R（ランニングタイム）, st, members, events, goalName, key, ko（秒）, shift（秒）, lead, name(pid), players: bool, events: bool }
export function buildXML(o) {
  const { M, R, st, members, key, name } = o;
  const ko = (+o.ko || 0) + (+o.shift || 0);
  const lead = { ...DEFAULT_LEAD, ...(o.lead || {}) };
  const mem = (pid) => members[pid] || {};
  const ps = st.periods[key]; const per = R.periods.find((p) => p.key === key);
  const inst = [];
  inst.push({ start: ko - lead.ko[0], end: ko + lead.ko[1], code: 'Kick Off', labels: [] });
  // ---------- 選手の行（ランニングタイム。時計が止まっている間は帯を切る） ----------
  if (o.withPlayers !== false && ps?.kickT != null) {
    const runs = (R.clock?.[key]?.runs || ps.runs.map((r) => ({ t0: r.t0, t1: r.t1 ?? ps.endT }))).map((r) => [r.t0 - ps.kickT, (r.t1 ?? ps.endT) - ps.kickT]);
    const stints = R.stints.filter((s) => s.period === key).sort((a, b) => a.from - b.from || (+mem(a.pid).no || 0) - (+mem(b.pid).no || 0));
    const cnt = {};
    const sp = noGkWindows(R)[key] || []; // 実際の時間（ランニングタイム）での特殊局面
    for (const s of stints) {
      cnt[s.pid] = (cnt[s.pid] || 0) + 1;
      const segs = runs.map(([a, b]) => [Math.max(a, s.from), Math.min(b, s.to)]).filter(([a, b]) => b - a >= 500);
      const play = segs.reduce((t, [a, b]) => t + b - a, 0);
      const labels = [['選手', name(s.pid)], ['ピリオド', per?.label || key], ['出場', `${cnt[s.pid]}回目`], ['この出場の時間', `実際 ${mmss(s.to - s.from)}／プレー ${mmss(play)}`]];
      for (const [a, b] of segs) {
        // 特殊局面の境目で帯を分ける
        const cuts = [...new Set([a, b, ...sp.flat().filter((c) => c > a && c < b)])].sort((x, y) => x - y);
        for (let i = 0; i + 1 < cuts.length; i++) {
          const x = cuts[i], y = cuts[i + 1]; if (y - x < 500 && cuts.length > 2) continue;
          const special = sp.some(([p0, p1]) => x >= p0 && y <= p1);
          inst.push({ start: ko + x / 1000, end: ko + y / 1000, code: '#' + mem(s.pid).no, labels: special ? [...labels, ['局面', '特殊局面']] : labels });
        }
      }
    }
  }
  // ---------- イベントの行 ----------
  if (o.withEvents !== false) {
    // 5x4の時間帯（区間の境目とピリオドの終わりの瞬間は、分析・データシートと同じ決め方）
    const gn = o.goalName; const W = ppWindows(M); const inOwn = winTest(W.own, M), inOpp = winTest(W.opp, M);
    const inPP = (e) => (inOwn(e) ? '自チーム5x4' : inOpp(e) ? '相手5x4' : null);
    const offset = M.periods.slice(0, M.periods.findIndex((p) => p.key === key)).reduce((t, p) => t + (p.len || 0), 0);
    // イベントの時刻（試合の時計の経過、1秒単位）→ キックオフからの実際の時間。
    // その1秒の間に時計が止まっていたら、止まった瞬間に起きたとみる（シュートでボールが外に出て時計が止まる、など）
    const rel = (at) => (R.relOf ? R.relOf(key, at) : at);
    const vidRel = (at) => { const a = rel(at); if (at < 1000) return a; const b = rel(at - 1000); return a - b > 1500 ? b + 1000 : a; };
    const P = (pid) => (pid && pid !== UNKNOWN && pid !== OPP_OG ? name(pid) : null);
    for (const e of o.events.filter((x) => !x.deleted && x.period === key)) {
      // SETPLAY はプレーの再開（時計が動き出す）に合わせる。それ以外は時計が止まった瞬間に寄せる
      const t = ko + ((e.kind === 'fspat' || e.kind === 'fspdf') ? rel(e.at) : vidRel(e.at)) / 1000;
      const L = []; const add = (g, v) => { if (v != null && v !== '') L.push([g, String(v)]); };
      const k = e.kind; const own = ['shot', 'szshot', 'z4', 'sz', 'goal', 'fspat', 'rec', 'lost', 'foul', 'fouled'].includes(k);
      const phase = (cls) => (cls ? CLS_TXT[cls] + (own ? '攻撃' : '守備') : null);
      let code = null, lk = 'shot';
      if (k === 'shot' || k === 'szshot' || k === 'oshot' || k === 'oszshot' || k === 'goal' || k === 'conc') {
        const sz = k === 'szshot' || k === 'oszshot' || ((k === 'goal' || k === 'conc') && e.sz === 'in');
        const og = (k === 'goal' && e.pid === OPP_OG) || (k === 'conc' && isOG(gn(e.gtype)));
        const mine = k === 'shot' || k === 'szshot' || k === 'goal';
        code = mine ? (sz ? 'スコアゾーン内シュート' : 'シュート') : (sz ? 'スコアゾーン内被シュート' : '被シュート');
        add('シュート分類', og ? 'オウンゴール' : (k === 'goal' || k === 'conc') ? 'ゴール' : RES_TXT[e.result]);
        if (!og) add('スコアゾーン進入人数', e.n);
        let cls = e.cls; if (!cls && (k === 'goal' || k === 'conc')) cls = clsOf(gn(e.gtype));
        add('局面', cls ? CLS_TXT[cls] + (mine ? '攻撃' : '守備') : null);
        if (mine && !og) add('選手', P(e.pid));
        if (e.sp) add('セットプレー分類', SP_TXT[e.sp] + (mine ? '' : ' DF'));
        if (k === 'goal' && e.assist && e.assist !== 'none') add('アシスト', P(e.assist));
        if ((k === 'goal' || k === 'conc') && e.gtype) add('得点の種類', gn(e.gtype));
      } else if (k === 'z4' || k === 'sz' || k === 'oz4' || k === 'osz') {
        lk = 'ent'; code = { z4: 'ゾーン4進入', sz: 'スコアゾーン進入', oz4: 'ゾーン4被進入', osz: 'スコアゾーン被進入' }[k];
        add('局面', phase(e.cls));
        add('進入方法', { dribble: 'ドリブル', pass: 'パス', rebound: 'リバウンド' }[e.method]);
        add('選手', P(e.pid)); if (e.method === 'pass') add('受け手', P(e.pid2));
      } else if (k === 'fspat' || k === 'fspdf') {
        lk = 'sp'; code = k === 'fspat' ? 'SETPLAY AT' : 'SETPLAY DF';
        add('セットプレー分類', e.fsp ? SP_TXT[e.fsp] + (k === 'fspdf' ? ' DF' : '') : null);
      } else if (k === 'rec' || k === 'lost') {
        lk = 'rl'; code = k === 'rec' ? 'ROBO' : 'PERDIDA'; add('選手', P(e.pid)); add('ゾーン', e.zone);
      } else if (k === 'foul' || k === 'fouled') {
        lk = 'foul'; code = k === 'foul' ? 'ファウル' : '被ファウル'; add('選手', P(e.pid)); add('カード', CARD_TXT[e.card]);
      }
      if (!code) continue;
      add('タイムコード', `${String(Math.floor((offset + e.at) / 60000)).padStart(2, '0')}:00`);
      add('5x4', inPP(e));
      inst.push({ start: t - lead[lk][0], end: t + lead[lk][1], code, labels: L });
    }
  }
  inst.sort((a, b) => a.start - b.start);
  let id = 1;
  let xml = '<file>\n<ALL_INSTANCES>\n';
  for (const i of inst) {
    xml += `<instance>\n<ID>${id++}</ID>\n<start>${Math.max(0, i.start).toFixed(3)}</start>\n<end>${Math.max(0, i.end).toFixed(3)}</end>\n<code>${xesc(i.code)}</code>\n`
      + i.labels.map(([g, t]) => `<label>\n<group>${xesc(g)}</group>\n<text>${xesc(t)}</text>\n</label>\n`).join('') + '</instance>\n';
  }
  xml += '</ALL_INSTANCES>\n<ROWS>\n';
  const codes = [...new Set(inst.map((i) => i.code))];
  const evCodes = codes.filter((c) => !c.startsWith('#'));
  for (const c of evCodes) { const [r, g, b] = ROW_COLORS[c] || [30000, 30000, 30000]; xml += `<row>\n<code>${xesc(c)}</code>\n<R>${r}</R>\n<G>${g}</G>\n<B>${b}</B>\n</row>\n`; }
  if (o.withPlayers !== false) {
    const nos = Object.keys(members).sort((a, b) => (mem(a).pos === 'GK' ? 0 : 1) - (mem(b).pos === 'GK' ? 0 : 1) || (+mem(a).no || 0) - (+mem(b).no || 0));
    for (const pid of nos) { const gk = mem(pid).pos === 'GK'; xml += `<row>\n<code>#${xesc(mem(pid).no)}</code>\n<R>${gk ? 51400 : 8000}</R>\n<G>${gk ? 12800 : 24400}</G>\n<B>${gk ? 11000 : 49000}</B>\n</row>\n`; }
  }
  xml += '</ROWS>\n</file>\n';
  const rowOrder = [...evCodes, ...(o.withPlayers !== false ? Object.keys(members).sort((a, b) => (mem(a).pos === 'GK' ? 0 : 1) - (mem(b).pos === 'GK' ? 0 : 1) || (+mem(a).no || 0) - (+mem(b).no || 0)).map((pid) => '#' + mem(pid).no) : [])];
  return { xml, inst, rowOrder, count: inst.length, players: inst.filter((i) => i.code.startsWith('#')).length, events: inst.filter((i) => !i.code.startsWith('#') && i.code !== 'Kick Off').length };
}
function clsOf(name) {
  if (['CK', 'CK-KI', 'KI', 'FK', 'PK', '第2PK'].includes(name)) return 'set';
  if (name === 'パワープレー' || name === 'パワープレー返し') return 'special';
  return { 定位置: 'pos', トランジション: 'trans', GK活用: 'gk' }[name] || null;
}


// CSV（Sportscode の「書き出し」と同じ形。2026-10-16 決定）：Sportscode への読み込みと、Excel などで見る・集計する両方に使う。
// 列：Timeline, Start time, Duration, Row, Instance number, ラベルのグループ（名前の順）, Ungrouped, Notes, Flags。1行1件。
// 同じグループに2つ付くときは「A, B」で1つのマスに入れる。行はコード（Row）ごとにまとめ、その中は時刻順。
export function buildCSV(r, timeline, { bom = false } = {}) {
  const q = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const groups = [...new Set(r.inst.flatMap((i) => i.labels.map(([g]) => g)))].sort();
  const order = (c) => { const k = r.rowOrder.indexOf(c); return k < 0 ? (c === 'Kick Off' ? -1 : 9999) : k; };
  const list = r.inst.slice().sort((a, b) => order(a.code) - order(b.code) || a.start - b.start);
  const n = {}; const lines = [['Timeline', 'Start time', 'Duration', 'Row', 'Instance number', ...groups, 'Ungrouped', 'Notes', 'Flags'].map(q).join(',')];
  for (const i of list) {
    n[i.code] = (n[i.code] || 0) + 1;
    const byG = {}; for (const [g, t] of i.labels) (byG[g] = byG[g] || []).push(t);
    const st = Math.max(0, i.start), en = Math.max(0, i.end);
    lines.push([timeline, +st.toFixed(3), +(en - st).toFixed(3), i.code, n[i.code], ...groups.map((g) => (byG[g] || []).join(', ')), '', '', ''].map(q).join(','));
  }
  return (bom ? '\uFEFF' : '') + lines.join('\n') + '\n';
}
