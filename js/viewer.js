// フィジカルコーチ用（閲覧専用）：交代のタイミングを考えるための画面。記録は一切しない（opsを書かない）。
// ピッチ＝「今の出場」が長い順、ベンチ＝「休み」が長い順。数字は実際の時間（ランニングタイム）が大きく、
// プレーイングタイム（試合の時計）を小さく添える。「合計出場」＝この試合の合計。色はランニングタイム用の目安（設定で変えられる）。
import { watchOps, playerById, teamSettings } from './store.js';
import { replay, periodLabel, periodLen, nowElapsed, PERIODS } from './engine.js';
import { matchModel, toRunning, playerTable, periodSig } from './model.js';
import { esc } from './ui.js';
import { render } from './views.js';

let tick = null;
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
  const bench = rows.filter((r) => !r.on && r.played && !st.ejected.has(r.pid)).sort((a, b) => b.rest - a.rest || noOf(a.pid) - noOf(b.pid));
  const unused = rows.filter((r) => !r.on && !r.played && !st.ejected.has(r.pid)).sort((a, b) => noOf(a.pid) - noOf(b.pid));

  // 上の帯
  const len = periodLen(cfg, st.current);
  const runEl = R.periods.find((p) => p.key === st.current)?.elapsed || 0;
  let state;
  if (st.matchOver) state = '<span class="phst">試合終了</span><span class="phrt">試合終了時点の数字（止まっています）</span>';
  else if (live) state = `<span class="phper">${periodLabel(st.current)}</span><span class="phclk">残り <b>${mmssUp(len - el)}</b></span><span class="phrun ${running ? 'on' : ''}">● ${running ? '時計が動いています' : '時計が止まっています'}</span><span class="phrt">${periodLabel(st.current)}の実際の経過 <b>${mmss(runEl)}</b></span>`;
  else if (lastEnd) state = `<span class="phst">${st.periods['1H']?.status === 'done' && st.periods['2H']?.status !== 'done' ? 'ハーフタイム' : 'ピリオドの間'}</span><span class="phrt">${[...PERIODS].reverse().find((p) => st.periods[p.key].status === 'done')?.label || ''}終了時点の数字（止まっています）</span>`;
  else state = '<span class="phst">試合前</span>';
  const pend = live && st.batch.outs.length ? `<div class="phpend">交代待ち：OUT ${st.batch.outs.map((o) => badge(o.pid) + name(o.pid)).join('　')}${st.batch.ins.length ? `　→ IN ${st.batch.ins.map((p) => badge(p) + name(p)).join('　')}` : ''}</div>` : '';
  const head = `<div class="phtop">${state}<span class="sp"></span><span class="phvs">vs ${esc(m.opponent || '')}</span>${navigator.onLine ? '' : '<span class="phoff">オフライン（記録が届いていません）</span>'}<span class="phro">閲覧専用</span><a class="btn sm" href="#/m/${m.id}">‹ 試合ページ</a></div>
    <div class="phlg">数字は<b>実際の時間（ランニングタイム）</b>、<span class="pt">灰色の小さい数字＝プレーイングタイム（試合の時計）</span>。色：<i class="org"></i>${mmss(OR)}〜 <i class="red"></i>${mmss(RD)}〜（設定で変えられる）</div>${pend}`;

  const bar = (ms) => `<div class="phbar"><i class="${col(ms)}" style="width:${Math.min(100, ms / MAX * 100).toFixed(1)}%"></i><b style="left:${(OR / MAX * 100).toFixed(1)}%"></b><b style="left:${(RD / MAX * 100).toFixed(1)}%"></b></div>
    <div class="phtk"><span style="left:${(OR / MAX * 100).toFixed(1)}%">${mmss(OR)}</span><span style="left:${(RD / MAX * 100).toFixed(1)}%">${mmss(RD)}</span></div>`;
  const pitchHTML = pitch.map((r) => `<div class="phpr"><div class="phnm">${badge(r.pid)}<span>${name(r.pid)}</span></div>
      <div><div class="lab">今の出場</div><div class="phbig ${col(r.curRun)}">${mmss(r.curRun)}</div><div class="pt">プレーイングタイム ${mmss(r.curPlay)}</div></div>
      <div class="phbw">${bar(r.curRun)}</div>
      <div><div class="lab">合計出場</div><div class="phmid">${mmss(r.totRun)}</div><div class="pt">プレーイングタイム ${mmss(r.totPlay)}</div></div></div>`).join('')
    + gks.map((r) => `<div class="phgk">${badge(r.pid)}<span class="phgkn">${name(r.pid)}</span><span>今の出場 <b>${mmss(r.curRun)}</b> <em>プレーイングタイム ${mmss(r.curPlay)}</em></span><span>合計出場 <b>${mmss(r.totRun)}</b> <em>プレーイングタイム ${mmss(r.totPlay)}</em></span></div>`).join('')
    || '<p class="mu pad">ピッチに選手がいません（ピリオドの間）</p>';
  // ベンチは人数が多いので1行に収める（見出しは上に1回だけ）
  const benchHTML = (bench.length ? '<div class="phbr phbh"><span></span><span>休み</span><span>前回の出場</span><span>合計出場</span></div>' : '')
    + bench.map((r) => `<div class="phbr"><div class="phnm">${badge(r.pid)}<span>${name(r.pid)}</span></div>
      <div class="phbig2">${mmss(r.rest)}</div><div class="phmid2">${mmss(r.lastRun)} <span class="pt">${mmss(r.lastPlay)}</span></div>
      <div class="phmid2">${mmss(r.totRun)} <span class="pt">${mmss(r.totPlay)}</span></div></div>`).join('')
    + (ejected.length ? `<div class="phun"><span class="phunl">退場</span>${ejected.map((r) => `<span class="phchip">${badge(r.pid)}${name(r.pid)}</span>`).join('')}</div>` : '')
    + (unused.length ? `<div class="phun"><span class="phunl">まだ出ていない</span>${unused.map((r) => `<span class="phchip">${badge(r.pid)}${name(r.pid)}</span>`).join('')}</div>` : '');

  return {
    active: 'acts',
    html: `<div class="phw">${head}<div class="phcols"><div class="phpane"><h3>ピッチ <small>今の出場が長い順</small></h3>${pitchHTML}</div>
      <div class="phpane"><h3>ベンチ <small>休みが長い順。前回・合計の右の灰色の数字＝プレーイングタイム</small></h3>${benchHTML || '<p class="mu pad">ベンチの選手はまだ出場していません</p>'}</div></div></div>`,
  };
}
