# Project notes for Claude

- Owner: 谷本俊介 (futsal coach). Always reply in Japanese, plain words, no jargon.
- Spec (source of truth): Claude Docs project da78d761-6d3f-4a14-ae1d-539ab067cb99 (file e502923c-d42f),
  「フットサル出場時間管理アプリ 仕様書」. Demo canvas: https://claude.ai/artifact/TdaVUfdqkXdrqRvAkRe1tC
- Working style: propose first, change the spec/app only after the owner decides. Build in the order
  agreed: 接続確認 → ①準備画面 → ②MATCH PLAY+自動テスト → ③レビュー1-3+修正 → ④イベント入力 → ⑤分析 → ⑥書き出し → ⑦仕上げ.
- Hosting: GitHub Pages from `main` / (root). No build step: plain HTML/CSS/ES modules.
  (npm registry and CDNs are blocked from the Claude workspace, so no bundler.)
- Firebase project: futsal-playtime-207ea (Spark plan). SDK loaded at runtime from
  https://www.gstatic.com/firebasejs/10.12.2/ and precached by sw.js for offline use.
  One shared team account (email/password). Firestore rules restrict access to that account's UID.
- Releasing: bump APP_VERSION in app.js AND VERSION in sw.js together. Updates apply only when the
  user presses 「更新する」 (no skipWaiting on install).
- MATCH PLAY: js/engine.js is a pure replay of an append-only op log (teams/{t}/matches/{m}/ops).
  Undo/reset are new ops. Tests: `node test/scenarios.test.mjs` (spec cases) and
  `node test/engine.test.mjs [seed] [runs]` (random-operation invariants, spec 10章). Run both before pushing.
- UI testing in the workspace: serve the repo with `python3 -m http.server` and drive it with Playwright,
  routing the three gstatic Firebase URLs to in-memory fakes (Firebase itself is unreachable from here).
