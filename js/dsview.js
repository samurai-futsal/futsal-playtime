// データシート（Excel）の書き出し（試合ページ・分析画面から）。中身は datasheet.js、ファイルの形は xlsx.js。
import { S, watchOps, watchEvents, opts, teamSettings, activityById } from './store.js';
import { modelOf } from './model.js';
import { datasheetSheets } from './datasheet.js';
import { buildXLSX } from './xlsx.js';
import { esc, toast, openModal, closeModal } from './ui.js';

// 選んだ試合のデータシートを作ってダウンロードする（押したときに呼ぶ。記録の読み込みがまだなら知らせる）
export async function downloadDatasheet(ms) {
  const list = [];
  for (const m of ms.slice().sort((a, b) => (a.date || '').localeCompare(b.date || '') || (a.kickoff || '').localeCompare(b.kickoff || ''))) {
    const opsC = watchOps(m.id); const evC = watchEvents(m.id);
    if ((!opsC.ready && !opsC.list.length) || !evC.ready) { toast('記録を読み込んでいます。少し待ってからもう一度押してください'); ms.forEach((x) => { watchOps(x.id); watchEvents(x.id); }); return false; }
    const cfg = { times: m.times || {}, members: m.members || {}, timesFixed: !!m.timesFixed, setplayAuto: teamSettings().setplayAuto || 60 };
    const { st, M } = modelOf(opsC.list, cfg, m.fix);
    const gts = opts('goalTypes', true);
    list.push({ m, M, st, evs: evC.list.filter((e) => !e.deleted), goalName: (id) => gts.find((o) => o.id === id)?.name || '', players: S.players, activity: activityById(m.activityId)?.name || '', setMin: (teamSettings().setMin ?? 60) * 1000 });
  }
  const t0 = Date.now();
  const bytes = await buildXLSX(datasheetSheets(list, S.team?.name || '自チーム'));
  const blob = new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob);
  const one = list.length === 1 ? list[0].m : null;
  a.download = one ? `データシート_vs${one.opponent || ''}_${(one.date || '').replace(/-/g, '')}.xlsx` : `データシート_${list.length}試合_${(list[0]?.m.date || '').replace(/-/g, '')}-${(list[list.length - 1]?.m.date || '').replace(/-/g, '')}.xlsx`;
  const go = () => { document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 60000); toast(`データシート（Excel）を書き出しました（${list.length}試合）`); };
  // 作るのに時間がかかったときは、iPad が押した操作と見なさずダウンロードを止めることがあるので、もう一度押してもらう
  if (Date.now() - t0 > 700) {
    const md = openModal(`<h2>データシートができました</h2><div class="mbody"><p>${list.length}試合分のファイルができました。下のボタンで保存してください。</p></div><div class="mfoot"><button class="btn" data-x>やめる</button><button class="btn pri xp" data-dl>ダウンロード</button></div>`);
    md.querySelector('[data-x]').onclick = closeModal;
    md.querySelector('[data-dl]').onclick = () => { closeModal(); go(); };
  } else go();
  return true;
}

// 試合ページの「データシート（Excel）」：説明とダウンロードのボタン（iPad では押した操作でダウンロードする必要があるため）
export function vDatasheet(m) {
  watchOps(m.id); watchEvents(m.id);
  return {
    active: 'acts',
    html: `<div class="scw"><div class="crumb"><a class="btn sm mpback" href="#/m/${m.id}">‹ 試合ページ</a><a href="#/m/${m.id}">vs ${esc(m.opponent)}</a> › データシート（Excel）</div>
      <h1>データシート（Excel）</h1>
      <p class="mu">この試合の記録を Excel のファイルで書き出します。試合中（ハーフタイムなど）は、その時点までの記録で作ります。複数の試合をまとめるときは、分析画面の「書き出し」から書き出せます。</p>
      <div class="card"><div class="scrow"><button class="btn pri xp" id="dsGo">データシート（Excel）をダウンロード</button></div>
      <ul class="dsl"><li><b>試合情報</b>：試合の情報とチームの数字（イベント一覧から数式で計算）</li><li><b>イベント一覧</b>：1行1件。時刻・選手・結果・ピッチにいた5人・5×4の時間帯・未入力など</li>
      <li><b>出場時間・出場記録</b>：選手ごと・1回ごとの出場（アプリで集計した値）</li><li><b>選手スタッツ</b>：シュート・シュート関与・被シュート関与・得点・アシスト・Z4進入・SZ進入（本人）・リカバリー・ロスト・得失点±など（数式で計算）</li>
      <li><b>セット・1分ごと・選手一覧</b></li></ul>
      <p class="mu sm">イベント一覧の行を直すと、試合情報・選手スタッツ・1分ごとの数字は Excel の中で計算し直されます。</p></div></div>`,
    bind: (root) => { root.querySelector('#dsGo').onclick = () => downloadDatasheet([m]); },
  };
}
