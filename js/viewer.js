// フィジカルコーチ用（閲覧専用）：交代のタイミングを考えるための画面。記録は一切しない（opsを書かない）。
// ピッチ＝「今の出場」が長い順、ベンチ＝「休み」が長い順。数字は実際の時間（ランニングタイム）が大きく、
// プレーイングタイム（試合の時計）を小さく添える。「合計出場」＝この試合の合計。色はランニングタイム用の目安（設定で変えられる）。
import { watchOps, resyncOps, playerById, teamSettings } from './store.js';
import { replay, periodLabel, periodLen, nowElapsed, PERIODS } from './engine.js';
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
// 最新かどうか：緑＝サーバーとつながっていて最新／黄＝確認中／赤＝つながっていない（いつの数字か）
function syncState(c) {
  const t = Date.now();
  const lastTxt = c.srvAt ? `${clock(c.srvAt)}時点` : '保存済みの数字';
  if (!navigator.onLine) return { cls: 'ng', txt: `つながっていません（${lastTxt}）` };
  if (!c.fromCache) return { cls: 'ok', txt: '最新' };
  const since = c.checkAt || c.cacheAt || t;
  if (t - since < 10000) return { cls: 'wait', txt: '確認中…' };
  return { cls: 'ng', txt: `つながっていません（${lastTxt}）` };
}
export function stopPhysTick() { clearInterval(tick); tick = null; }
const mmss = (ms) => { if (ms == null) return '—'; const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
const mmssUp = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000 - 1e-6)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

export function vPhys(m) {
  const opsC = watchOps(m.id);
  if (!opsC.ready && !opsC.list.length) return { active: 'acts', html: '<p class="mu pad">読み込み中…</p>' };
  const ts = teamSettings();
  const OR = (ts.runOrange || 180) * 1000, RD = (ts.runRed || 300) * 1000, MAX = Math.max(RD + 60000, RD * 1.2);
  const cfg = { times: m.times || {}, members: m.members || {}, setplayAuto: ts.setplayAuto || 60 };
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
  const bench = rows.filter((r) => !r.on && r.played && !st.ejected.has(r.pid)).sort((a, b) => {
    const [k, d] = benchSort.split('-'); const va = k === 'rest' ? a.rest : a.totPlay, vb = k === 'rest' ? b.rest : b.totPlay;
    return (d === 'desc' ? vb - va : va - vb) || noOf(a.pid) - noOf(b.pid);
  });
  const unused = rows.filter((r) => !r.on && !r.played && !st.ejected.has(r.pid)).sort((a, b) => noOf(a.pid) - noOf(b.pid));

  // 上の帯
  const len = periodLen(cfg, st.current);
  const runEl = R.periods.find((p) => p.key === st.current)?.elapsed || 0;
  let state;
  if (st.matchOver) state = '<span class="phst">試合終了</span><span class="phrt">試合終了時点の数字（止まっています）</span>';
  else if (live) state = `<span class="phper">${periodLabel(st.current)}</span><span class="phclk">残り <b>${mmssUp(len - el)}</b></span><span class="phrun ${running ? 'on' : ''}">● ${running ? '時計が動いています' : '時計が止まっています'}</span><span class="phrt">${periodLabel(st.current)}の実際の経過 <b>${mmss(runEl)}</b></span>`;
  else if (lastEnd) state = `<span class="phst">${st.periods['1H']?.status === 'done' && st.periods['2H']?.status !== 'done' ? 'ハーフタイム' : 'ピリオドの間'}</span><span class="phrt">${[...PERIODS].reverse().find((p) => st.periods[p.key].status === 'done')?.label || ''}終了時点の数字（止まっています）</span>`;
  else state = '<span class="phst">試合前</span>';
  const ss = syncState(opsC);
  if (!live && ss.cls === 'wait') setTimeout(() => { if (physMatch() === m.id) render(); }, 10500 - (Date.now() - (opsC.checkAt || opsC.cacheAt || 0)));
  const head = `<div class="phtop">${state}<span class="sp"></span><span class="phright"><span class="phvs">vs ${esc(m.opponent || '')}</span><span class="phsy ${ss.cls}">● ${ss.txt}</span><button class="btn sm phsyb" id="phSync">⟳ 同期</button><span class="phro">閲覧専用</span><a class="btn sm" href="#/m/${m.id}">‹ 試合ページ</a></span></div>
    <div class="phlg"><span class="lgrun">0:00</span> 枠の中の黒い数字＝<b>実際の時間（ランニングタイム）</b>　<span class="ptv s">0:00</span> 緑の数字＝<b>プレーイングタイム（試合の時計）</b>　枠の色：<i class="org"></i>${mmss(OR)}〜 <i class="red"></i>${mmss(RD)}〜（設定で変えられる）</div>`;

  const bar = (ms) => `<div class="phbar"><i class="${col(ms)}" style="width:${Math.min(100, ms / MAX * 100).toFixed(1)}%"></i><b style="left:${(OR / MAX * 100).toFixed(1)}%"></b><b style="left:${(RD / MAX * 100).toFixed(1)}%"></b></div>
    <div class="phtk"><span style="left:${(OR / MAX * 100).toFixed(1)}%">${mmss(OR)}</span><span style="left:${(RD / MAX * 100).toFixed(1)}%">${mmss(RD)}</span></div>`;
  const PT = (ms, cls = '') => `<span class="ptv ${cls}">${mmss(ms)}</span>`;
  const pitchHTML = pitch.map((r) => `<div class="phpr"><div class="phnm">${badge(r.pid)}<span>${name(r.pid)}</span></div>
      <div class="phnow"><div class="phnowh">今の出場</div><div class="phrbox ${col(r.curRun)}"><div class="lab">ランニングタイム</div><div class="phbig">${mmss(r.curRun)}</div></div>
        <div class="phpt"><div class="lab">プレーイングタイム</div>${PT(r.curPlay, 'l')}</div></div>
      <div class="phbw">${bar(r.curRun)}</div>
      <div class="phtot"><div class="lab">合計出場</div><div class="phmid">${mmss(r.totRun)}</div>${PT(r.totPlay, 'm')}</div></div>`).join('')
    + gks.map((r) => `<div class="phgk">${badge(r.pid)}<span class="phgkn">${name(r.pid)}</span><span class="phgkc"><span class="lab">今の出場</span><b class="phrbox sm">${mmss(r.curRun)}</b>${PT(r.curPlay, 's')}</span><span class="phgkc"><span class="lab">合計出場</span><b>${mmss(r.totRun)}</b>${PT(r.totPlay, 's')}</span></div>`).join('')
    || '<p class="mu pad">ピッチに選手がいません（ピリオドの間）</p>';
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
      const b = root.querySelector('#phSync'); if (b) b.onclick = () => { resyncOps(m.id); };
      root.querySelectorAll('[data-bs]').forEach((x) => { x.onclick = () => { benchSort = x.dataset.bs; try { localStorage.setItem('fpt.physBenchSort', benchSort); } catch {} render(); }; });
    },
    html: `<div class="phw">${head}<div class="phcols"><div class="phpane"><h3>ピッチ <small>今の出場が長い順</small></h3>${pitchHTML}</div>
      <div class="phpane"><h3>ベンチ <small>${benchSort.startsWith('rest') ? '休み' : '合計出場（プレーイングタイム）'}が${SORTS[benchSort][1]}</small></h3>
        <div class="phsort"><span class="phsortl">並べ方</span><span class="seg sr">${Object.entries(SORTS).filter(([k]) => k.startsWith('rest')).map(([k, [a, b]]) => `<button data-bs="${k}" class="${k === benchSort ? 'on' : ''}">${b}</button>`).join('')}</span><span class="seg st">${Object.entries(SORTS).filter(([k]) => k.startsWith('tot')).map(([k, [a, b]]) => `<button data-bs="${k}" class="${k === benchSort ? 'on' : ''}">${b}</button>`).join('')}</span></div>${benchHTML || '<p class="mu pad">ベンチの選手はまだ出場していません</p>'}</div></div></div>`,
  };
}
