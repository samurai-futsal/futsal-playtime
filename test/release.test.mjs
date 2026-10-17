// 公開前の確認：版の番号と、オフライン用のファイル一覧（sw.js の SHELL と views.js の SHELL_FILES）。
// Run: node test/release.test.mjs
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, normalize, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => readFileSync(join(root, f), 'utf8');
let pass = 0, fail = 0;
const ok = (c, msg) => { if (c) pass++; else { fail++; console.log('NG:', msg); } };

// 1) APP_VERSION（app.js）と VERSION（sw.js）が同じ
const appV = read('app.js').match(/const APP_VERSION = '([^']+)'/)?.[1];
const swV = read('sw.js').match(/const VERSION = '([^']+)'/)?.[1];
ok(appV && swV && appV === swV, `APP_VERSION ${appV} と sw.js の VERSION ${swV} が違います`);

// 2) 一覧
const swShell = [...read('sw.js').match(/const SHELL = \[([\s\S]*?)\];/)[1].matchAll(/'\.\/([^']+)'/g)].map((x) => x[1]);
const viewsShell = JSON.parse(read('js/views.js').match(/const SHELL_FILES = (\[[^\]]*\])/)[1].replace(/'/g, '"'));
const sw = new Set(swShell), vw = new Set(viewsShell);
for (const f of swShell) ok(existsSync(join(root, f)), `sw.js の SHELL にある ${f} がありません`);
for (const f of viewsShell) ok(existsSync(join(root, f)), `views.js の SHELL_FILES にある ${f} がありません`);
for (const f of ['index.html', 'style.css', 'app.js']) { ok(sw.has(f), `sw.js の SHELL に ${f} がありません`); ok(vw.has(f), `views.js の SHELL_FILES に ${f} がありません`); }

// 3) app.js から import でたどれるファイルと js/ のファイルすべてが、両方の一覧に入っている
const reach = new Set();
const walk = (f) => {
  if (reach.has(f)) return; reach.add(f);
  const src = read(f);
  const specs = [...src.matchAll(/(?:import|export)\s[^'"]*?from\s*['"](\.[^'"]+)['"]/g), ...src.matchAll(/import\(\s*['"](\.[^'"]+)['"]\s*\)/g), ...src.matchAll(/^\s*import\s*['"](\.[^'"]+)['"]/gm)].map((x) => x[1]);
  for (const s of specs) {
    const p = relative(root, normalize(join(root, dirname(f), s))).split('\\').join('/');
    ok(existsSync(join(root, p)), `${f} が読み込む ${p} がありません`);
    if (existsSync(join(root, p))) walk(p);
  }
};
walk('app.js');
const jsDir = readdirSync(join(root, 'js')).filter((f) => f.endsWith('.js')).map((f) => 'js/' + f);
for (const f of new Set([...reach, ...jsDir])) {
  ok(sw.has(f), `${f} が sw.js の SHELL に入っていません`);
  ok(vw.has(f), `${f} が views.js の SHELL_FILES に入っていません`);
}
console.log(`release: ${pass} passed, ${fail} failed（版 ${appV}・たどれたファイル ${reach.size}個）`);
process.exit(fail ? 1 : 0);
