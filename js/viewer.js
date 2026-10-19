// フィジカルコーチ用（閲覧専用）：交代のタイミングを考えるための画面。記録は一切しない（opsを書かない）。
// ピッチ＝「今の出場」が長い順、ベンチ＝「休み」が長い順。数字は実際の時間（ランニングタイム）が大きく、
// プレーイングタイム（試合の時計）を小さく添える。「合計出場」＝この試合の合計。色はランニングタイム用の目安（設定で変えられる）。
import { watchOps, resyncOps, playerById, teamSettings, probeMatch, heardRev } from './store.js';
import { replay, periodLabel, periodLen, perLen, nowElapsed, PERIODS } from './engine.js';
import { matchModel, toRunning, playerTable, periodSig } from './model.js';
import { esc } from './ui.js';
import { render } from './views.js';

let tick = null;
// ベンチの並べ方（この端末だけで覚える）。合計出場はプレーイングタイムの合計で並べる
const SORTS = { 'rest-desc': ['休み', '長い順'], 'rest-asc': ['休み', '短い順'], 'tot-desc': ['合計出場', '長い順'], 'tot-asc': ['合計出場', '短い順'] };
let benchSort = (() => { try { const v = localStorage.getItem('fpt.physBenchSort'); return SORTS[v] ? v : 'rest-desc'; } catch { return 'rest-desc'; } })();
// 他のアプリから戻ってきたら、自動でつなぎ直す（記録は書かない）
const physMatch = () => { const x = location.hash.match(/^#\/m\/([^/]+)\/physical/); return x ? x[1] : null; };
document.addEventListener('visibilitychange', () => { const id = physMatch(); if (!document.hidden && id) resyncOps(id); });
addEventListener('pageshow', (e) => { const id = physMatch(); if (e.persisted && id) resyncOps(id); });
addEventListener('online', () => { const id = physMatch(); if (id) resyncOps(id); });
const clock = (t) => { const d = new Date(t); return `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`; };
const clockS = (t) => { const d = new Date(t); return `${clock(t)}:${String(d.getSeconds()).padStart(2, '0')}`; };
// 見張り（2026-10-18）：15秒ごとにサーバーに直接「いまの試合の印」を聞いて、この画面に届いている印と比べる。
// ・返事がない（8秒）→ つながっていない
// ・印が違うまま5秒以上 → 知らせが止まっている（MATCH PLAY の新しい記録が届いていない）
// どちらも自動でつなぎ直し、直るまでは「同期してください」を点滅させる。読み取りは15秒に1回（1時間で240回）
const W = { id: null, timer: null, okAt: 0, fails: 0, diffAt: 0, autoAt: 0, busy: false };
async function watchdog() {
  const id = physMatch();
  if (!id) { clearInterval(W.timer); W.timer = null; W.id = null; return; }
  if (document.hidden || W.busy) return;
  W.busy = true;
  try {
    const r = await probeMatch(id);
    const t = Date.now();
    if (!r.ok) W.fails++;
    else {
      W.fails = 0; W.okAt = t;
      if (r.rev && r.rev !== heardRev(id)) { if (!W.diffAt) W.diffAt = t; } else W.diffAt = 0;
    }
    // おかしいかもしれない（返事がない・印が違う）ときは、まず黙ってつなぎ直す（点滅はしない）。30秒に1回まで
    if ((W.fails || W.diffAt) && t - W.autoAt > 30000) { W.autoAt = t; resyncOps(id); setTimeout(watchdog, 3000); }
  } finally { W.busy = false; render(); }
}
function startWatch(id) {
  if (W.id === id && W.timer) return;
  clearInterval(W.timer); Object.assign(W, { id, okAt: 0, fails: 0, diffAt: 0, autoAt: 0 });
  W.timer = setInterval(watchdog, 15000); setTimeout(watchdog, 1500);
}
// 最新でないかもしれない（同期してほしい）：ちょっとした遅れでは点滅させない（2026-10-18）。
// 自動のつなぎ直しでも直らず、次のような状態が続いたときだけ：返事がないのが2回続いた（約30秒）／
// 印の違いが20秒以上続いた／最後に確かめられてから60秒以上たった／端末がオフライン
function stale() {
  const t = Date.now();
  return !navigator.onLine || W.fails >= 2 || (W.diffAt && t - W.diffAt > 20000) || (W.okAt && t - W.okAt > 60000);
}
// 最新かどうか：緑＝最新（サーバーで確かめた）／黄＝確認中／赤の点滅＝最新でないかもしれない（同期してください）
function syncState(c) {
  const t = Date.now();
  const lastTxt = c.srvAt ? `${clock(c.srvAt)}時点` : '保存済みの数字';
  // 同期をうながす状態は1つの表示にまとめる（つながっていない／最新でないかもしれない。2026-10-19）
  const ng = { cls: 'ng blink', txt: `同期できていません（${c.srvAt ? `${clock(c.srvAt)}時点の数字` : '保存済みの数字'}）`, short: `同期できていません（${lastTxt}）`, need: true };
  if (!navigator.onLine) return ng;
  const since = c.checkAt || c.cacheAt || t;
  if (c.fromCache && t - since < 10000) return { cls: 'wait', txt: '確認中…' };
  if (c.fromCache || stale()) return ng;
  return { cls: 'ok', txt: `最新${W.okAt ? `（${clockS(W.okAt)} 確認）` : ''}` };
}
export function stopPhysTick() { clearInterval(tick); tick = null; }
const mmss = (ms) => { if (ms == null) return '—'; const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const mmssUp = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000 - 1e-6)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

export function vPhys(m) {
  const opsC = watchOps(m.id);
  if (!opsC.ready && !opsC.list.length) return { active: 'acts', html: '<p class="mu pad">読み込み中…</p>' };
  const ts = teamSettings();
  const OR = (ts.runOrange || 180) * 1000, RD = (ts.runRed || 300) * 1000, MAX = Math.max(RD + 60000, RD * 1.2);
  const cfg = { times: m.times || {}, members: m.members || {}, timesFixed: !!m.timesFixed, setplayAuto: ts.setplayAuto || 60 };
  const st = replay(opsC.list, cfg); st.sig = periodSig(opsC.list);
  const per = st.periods[st.current];
  const live = per?.status === 'live';
  const running = live && per.runningSince != null;
  // 試合中は今の時刻まで数える。ハーフタイム・試合終了のあとは、最後に終わったピリオドの終わり（時計が0:00になった時刻）で止める
  const lastEnd = Math.max(0, ...Object.values(st.periods).filter((p) => p.status === 'done' && p.endT != null).map((p) => p.endT));
  const now = live || !lastEnd ? Date.now() : lastEnd;
  const M = matchModel(st, now, m.fix); const R = toRunning(M, st, now);
  const TP = playerTable(M), TR = playerTable(R);
  stopPhysTick();
  if (live) tick = setInterval(() => { if (!location.hash.endsWith('/physical')) return stopPhysTick(); render(); }, 1000); // 数字が進むのは試合中だけ

  const mem = (pid) => m.members?.[pid] || {};
  const isGK = (pid) => mem(pid).pos === 'GK';
  const badge = (pid) => `<span class="no ${isGK(pid) ? 'gk' : 'fp'}">${esc(mem(pid).no ?? '')}</span>`;
  const name = (pid) => esc(playerById(pid)?.last || '');
  const el = live ? nowElapsed(st, now) : 0;
  const col = (ms) => (ms >= RD ? 'red' : ms >= OR ? 'org' : 'ok');

  const rows = Object.keys(m.members || {}).map((pid) => {
    const ss = st.stints.filter((s) => s.pid === pid);
    const cur = live ? ss.find((s) => s.period === st.current && s.to == null) : null;
    const last = ss.filter((s) => s.to != null && s.wt != null).sort((a, b) => b.wt - a.wt)[0];
    return {
      pid, on: !!cur, played: ss.length > 0,
      curRun: cur ? Math.max(0, now - cur.wf) : null, curPlay: cur ? Math.max(0, el - cur.from) : null,
      rest: !cur && last ? Math.max(0, now - last.wt) : null, lastRun: last ? Math.max(0, last.wt - last.wf) : null, lastPlay: last ? Math.max(0, last.to - last.from) : null,
      totRun: TR[pid]?.total || 0, totPlay: TP[pid]?.total || 0,
    };
  });
  const noOf = (pid) => parseInt(mem(pid).no, 10) || 999;
  const pitch = rows.filter((r) => r.on && !isGK(r.pid)).sort((a, b) => b.curRun - a.curRun || noOf(a.pid) - noOf(b.pid));
  const gks = rows.filter((r) => r.on && isGK(r.pid));
  const ejected = rows.filter((r) => st.ejected.has(r.pid)).sort((a, b) => noOf(a.pid) - noOf(b.pid));
  // GKは並べ方にかかわらず、いつもベンチの一番下（GKどうしは選んだ並べ方で並べる）
  const bench = rows.filter((r) => !r.on && r.played && !st.ejected.has(r.pid)).sort((a, b) => {
    if (isGK(a.pid) !== isGK(b.pid)) return isGK(a.pid) ? 1 : -1;
    const [k, d] = benchSort.split('-'); const va = k === 'rest' ? a.rest : a.totPlay, vb = k === 'rest' ? b.rest : b.totPlay;
    return (d === 'desc' ? vb - va : va - vb) || noOf(a.pid) - noOf(b.pid);
  });
  const unused = rows.filter((r) => !r.on && !r.played && !st.ejected.has(r.pid)).sort((a, b) => noOf(a.pid) - noOf(b.pid));

  // 上の帯
  const len = perLen(st, st.current);
  const runEl = R.periods.find((p) => p.key === st.current)?.elapsed || 0;
  let state;
  if (st.matchOver) state = '<span class="phst">試合終了</span><span class="phrt">試合終了時点の数字（止まっています）</span>';
  else if (live) state = `<span class="phper">${periodLabel(st.current)}</span><span class="phclk">残り <b>${mmssUp(len - el)}</b></span><span class="phrun ${running ? 'on' : ''}">● ${running ? '時計が動いています' : '時計が止まっています'}</span><span class="phrt">実際の経過 <b>${mmss(runEl)}</b></span>`;
  else if (lastEnd) state = `<span class="phst">${st.periods['1H']?.status === 'done' && st.periods['2H']?.status !== 'done' ? 'ハーフタイム' : 'ピリオドの間'}</span><span class="phrt">${[...PERIODS].reverse().find((p) => st.periods[p.key].status === 'done')?.label || ''}終了時点の数字（止まっています）</span>`;
  else state = '<span class="phst">試合前</span>';
  // 試合が終わったら、同期の表示とボタンは出さない（数字はもう動かないので。見張りも止める。2026-10-19）
  const over = !!st.matchOver;
  if (over) { clearInterval(W.timer); W.timer = null; W.id = null; } else startWatch(m.id);
  const ss = syncState(opsC);
  const lastOp = opsC.list.reduce((a, o) => Math.max(a, o.t || 0), 0);
  if (!live && !over && ss.cls === 'wait') setTimeout(() => { if (physMatch() === m.id) render(); }, 10500 - (Date.now() - (opsC.checkAt || opsC.cacheAt || 0)));
  // 上の帯は、いつも同じ2段の形（状態や文字の長さで並びが変わらないように。2026-10-18）
  // 1段目：試合の状態 … マッチレビュー・試合ページ　2段目：相手・最新かどうか … 最後の記録・同期ボタン
  const head = `<div class="phtop"><div class="phr1">${state}<span class="sp"></span><a class="btn sm phrv" href="#/m/${m.id}/review">マッチレビュー ›</a><a class="btn sm" href="#/m/${m.id}">‹ 試合ページ</a></div>
    <div class="phr2"><span class="phvs">vs ${esc(m.opponent || '')}</span>${over ? '' : `<span class="phsy ${ss.cls}">● ${ss.short ? `<span class="l">${ss.txt}</span><span class="s">${ss.short}</span>` : ss.txt}</span>`}<span class="sp"></span>${lastOp ? `<span class="phlast">最後の記録 ${clockS(lastOp)}</span>` : ''}${over ? '' : `<button class="btn sm phsyb ${ss.need ? 'need' : ''}" id="phSync">${ss.need ? '⟳ 同期してください' : '⟳ 同期'}</button>`}</div></div>
    <div class="phlg"><span class="lgrun">0:00</span><span>黒＝<b>実際の時間</b>（ランニングタイム）</span><span class="ptv s">0:00</span><span>緑＝<b>試合の時計</b>（プレーイングタイム）</span><span>枠の色<i class="org"></i>${mmss(OR)}〜<i class="red"></i>${mmss(RD)}〜</span></div>`;

  const bar = (ms) => `<div class="phbar"><i class="${col(ms)}" style="width:${Math.min(100, ms / MAX * 100).toFixed(1)}%"></i><b style="left:${(OR / MAX * 100).toFixed(1)}%"></b><b style="left:${(RD / MAX * 100).toFixed(1)}%"></b></div>
    <div class="phtk"><span style="left:${(OR / MAX * 100).toFixed(1)}%">${mmss(OR)}</span><span style="left:${(RD / MAX * 100).toFixed(1)}%">${mmss(RD)}</span></div>`;
  const PT = (ms, cls = '') => `<span class="ptv ${cls}">${mmss(ms)}</span>`;
  const pitchHTML = pitch.map((r) => `<div class="phpr"><div class="phnm">${badge(r.pid)}<span>${name(r.pid)}</span></div>
      <div class="phnow"><div class="phnowh">今の出場</div><div class="phrbox ${col(r.curRun)}"><div class="lab">ランニングタイム</div><div class="phbig">${mmss(r.curRun)}</div></div>
        <div class="phpt"><div class="lab">プレーイングタイム</div>${PT(r.curPlay, 'l')}</div></div>
      <div class="phbw">${bar(r.curRun)}</div>
      <div class="phtot"><div class="lab">合計出場</div><div class="phmid">${mmss(r.totRun)}</div>${PT(r.totPlay, 'm')}</div></div>`).join('')
    + gks.map((r) => `<div class="phgk">${badge(r.pid)}<span class="phgkn">${name(r.pid)}</span><span class="phgkc"><span class="lab">今の出場</span><b class="phrbox sm">${mmss(r.curRun)}</b>${PT(r.curPlay, 's')}</span><span class="phgkc"><span class="lab">合計出場</span><b>${mmss(r.totRun)}</b>${PT(r.totPlay, 's')}</span></div>`).join('')
    || `<p class="mu pad">${!live && !lastEnd && !st.matchOver ? '試合開始前です' : 'ピッチに選手がいません（ピリオドの間）'}</p>`;
  const benchHTML = (bench.length ? `<div class="phbr phbh"><span></span><span class="${benchSort.startsWith('rest') ? 'on' : ''}">休み${benchSort === 'rest-desc' ? ' ▼' : benchSort === 'rest-asc' ? ' ▲' : ''}</span><span>前回の出場</span><span class="${benchSort.startsWith('tot') ? 'on' : ''}">合計出場${benchSort === 'tot-desc' ? ' ▼' : benchSort === 'tot-asc' ? ' ▲' : ''}</span></div>` : '')
    + bench.map((r) => `<div class="phbr"><div class="phnm">${badge(r.pid)}<span>${name(r.pid)}</span></div>
      <div><span class="phrbox rest">${mmss(r.rest)}</span></div>
      <div class="phpair"><b>${mmss(r.lastRun)}</b>${PT(r.lastPlay, 's')}</div>
      <div class="phpair"><b>${mmss(r.totRun)}</b>${PT(r.totPlay, 's')}</div></div>`).join('')
    + (ejected.length ? `<div class="phun"><span class="phunl">退場</span>${ejected.map((r) => `<span class="phchip">${badge(r.pid)}${name(r.pid)}</span>`).join('')}</div>` : '')
    + (unused.length ? `<div class="phun"><span class="phunl">まだ出ていない</span>${unused.map((r) => `<span class="phchip">${badge(r.pid)}${name(r.pid)}</span>`).join('')}</div>` : '');

  return {
    active: 'acts',
    bind: (root) => {
      const b = root.querySelector('#phSync'); if (b) b.onclick = () => { Object.assign(W, { fails: 0, diffAt: 0, okAt: Date.now() }); resyncOps(m.id); setTimeout(watchdog, 3000); render(); };
      root.querySelectorAll('[data-bs]').forEach((x) => { x.onclick = () => { benchSort = x.dataset.bs; try { localStorage.setItem('fpt.physBenchSort', benchSort); } catch {} render(); }; });
    },
    html: `<div class="phw">${head}<div class="phcols"><div class="phpane"><h3>ピッチ <small>今の出場が長い順</small></h3>${pitchHTML}</div>
      <div class="phpane"><h3>ベンチ <small>${benchSort.startsWith('rest') ? '休み' : '合計出場（プレーイングタイム）'}が${SORTS[benchSort][1]}</small></h3>
        <div class="phsort ph2"><span class="phsg"><span class="phsortl">休みで並べる</span><span class="seg sr">${Object.entries(SORTS).filter(([k]) => k.startsWith('rest')).map(([k, [a, b]]) => `<button data-bs="${k}" class="${k === benchSort ? 'on' : ''}">${b}</button>`).join('')}</span></span><span class="phsg"><span class="phsortl">合計出場で並べる</span><span class="seg st">${Object.entries(SORTS).filter(([k]) => k.startsWith('tot')).map(([k, [a, b]]) => `<button data-bs="${k}" class="${k === benchSort ? 'on' : ''}">${b}</button>`).join('')}</span></span></div>${benchHTML || '<p class="mu pad">ベンチの選手はまだ出場していません</p>'}</div></div></div>`,
  };
}
