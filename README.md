# futsal-playtime

フットサルの出場時間をプレーイングタイムで記録し、試合のイベントと合わせて分析するアプリ（PWA）。

- 公開先: https://samurai-futsal.github.io/futsal-playtime/
- いまの版: app.js の `APP_VERSION`（sw.js の `VERSION` と同じ番号）。設定画面の「アプリ」にも出ます。
- できること: 準備（選手・活動・招集・試合メンバー）、MATCH PLAY（交代・時計・退場・セットプレー・5x4・タイムアウト・1つ戻す・リセット）、
  マッチレビュー、記録の修正、イベント入力（試合中・試合後）、分析、書き出し（マッチスタッツ・マッチレビュー・マッチレポートのPDF、データシートのExcel、Sportscode）、
  Sportscodeからの取り込み、バックアップ（書き出し・ファイルから戻す）。
- テスト（公開の前に全部）: `node test/scenarios.test.mjs` / `engine` / `events` / `running` / `analysis` / `scimport` / `datasheet` / `restore` / `release`（`node test/<名前>.test.mjs`）
