// 静的検査（ステージ static）。通信も Firebase も使わない。
//   node tools/ci/check-static.mjs [root] [--walk]
// （--walk：git が管理するファイルではなく、dist/ のような普通のフォルダーの中身をすべて検査する）
//
// なぜ必要か：このゲームはビルド工程のない ES Modules なので、書き間違いやファイル名の変更は、
// ブラウザでそのページを開くまで気づけない。ブラウザを起動せずに、数秒でその種の事故を見つける。
// 1. 自作の .js / .mjs がすべて構文として正しい（ES Module として、または従来のスクリプトとして）
// 2. JSON ファイルがすべて読める
// 3. 文字列で直接書いた相対参照の先に、ファイルが存在する：
//    JS の import / import() / export-from / new URL('./x', import.meta.url)、HTML の src= / href=、CSS の url()
//    実行時に組み立てる参照（例 `assets/img/${name}.jpg`）は、静的には検査できない。
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, normalize, relative, resolve } from 'node:path';

import { listFiles } from './lib.mjs';

const args = process.argv.slice(2);
const WALK = args.includes('--walk');
const ROOT = resolve(args.find(a => !a.startsWith('--')) || join(dirname(new URL(import.meta.url).pathname), '..', '..'));
// 外部ライブラリ（同梱の配布物）とツールの依存パッケージは自作ではないため対象外。
const VENDOR = [/^assets\/vendor\//, /^assets\/three\.module\.js$/, /^assets\/addons\//, /(^|\/)node_modules\//];
const files = listFiles(ROOT, { walk: WALK });
const ours = f => !VENDOR.some(r => r.test(f));
const errors = [];

// 1. JavaScript の構文
// 注意：Node 22 以降の `node --check file.js` は、ES Module に構文エラーがあっても成功を返すことがある
// （モジュール形式の自動判定が原因）。そのため、ソースを標準入力から --input-type を明示して渡す。
// ES Module（ブラウザ用のファイル）か従来のスクリプトのどちらかとして読めれば合格。
const scripts = files.filter(f => /\.(m?js)$/.test(f) && ours(f));
const parses = (f, type) => spawnSync(process.execPath, [`--input-type=${type}`, '--check'],
  { input: readFileSync(join(ROOT, f)), encoding: 'utf8' });
for (const f of scripts) {
  const asModule = parses(f, 'module');
  if (asModule.status === 0 || (!f.endsWith('.mjs') && parses(f, 'commonjs').status === 0)) continue;
  const msg = (asModule.stderr || '').trim().split('\n').filter(l => !/^\s+at |^Node\.js /.test(l)).slice(0, 4);
  errors.push(`syntax: ${f}\n    ${msg.join('\n    ')}`);
}

// 2. JSON の読み込み
const jsons = files.filter(f => f.endsWith('.json') && ours(f));
for (const f of jsons) {
  try { JSON.parse(readFileSync(join(ROOT, f), 'utf8')); } catch (e) { errors.push(`json: ${f}: ${e.message}`); }
}

// 3. ファイル参照
const isLocal = p => p && !/^(?:[a-z][a-z0-9+.-]*:|\/\/|#|\?)/i.test(p) && !p.includes('${') && !p.includes('{{');
const clean = p => decodeURI(p.split(/[?#]/)[0]);
// ブラウザと同じく、参照を書いたファイルのフォルダー（base）からの相対パスとして解決する。
function exists(ref, base) {
  const p = clean(ref);
  if (!p) return true;
  const target = p.startsWith('/') ? join(ROOT, p) : join(ROOT, base, p);
  if (!normalize(relative(ROOT, target)).split('/').every(s => s !== '..')) return true; // リポジトリの外を指す参照は判定しない
  if (!existsSync(target)) return false;
  // 「dir/」は基準URL（例：ライブラリのフォルダー）。末尾に / がない「dir」は index.html を持つページでなければならない
  return statSync(target).isFile() || p.endsWith('/') || existsSync(join(target, 'index.html'));
}
let refs = 0;
for (const f of files.filter(f => /\.(m?js|html|css)$/.test(f) && ours(f))) {
  // 埋め込みの data: URI（中に url(#id) を含む SVG など）はファイル参照ではないので除く
  const src = readFileSync(join(ROOT, f), 'utf8').replace(/"data:[^"]*"|'data:[^']*'/g, '""');
  const found = [];
  if (/\.m?js$/.test(f)) {
    for (const m of src.matchAll(/\bimport\s*(?:[\w*{}\s,$]+\s*from\s*)?(['"])(\.{1,2}\/[^'"]+)\1/g)) found.push(m[2]);
    for (const m of src.matchAll(/\bimport\(\s*(['"])(\.{1,2}\/[^'"]+)\1\s*\)/g)) found.push(m[2]);
    for (const m of src.matchAll(/\bexport\s*[\w*{}\s,$]*\s*from\s*(['"])(\.{1,2}\/[^'"]+)\1/g)) found.push(m[2]);
    // 公開するコードの new URL('./x', import.meta.url) は実在するファイル・フォルダーを指すこと。tools/ の下では、
    // 実行時に作る出力フォルダー（例 tools/e2e/results/）を指すことが多いので検査しない。
    if (!f.startsWith('tools/')) for (const m of src.matchAll(/new URL\(\s*(['"])(\.{1,2}\/[^'"]+)\1\s*,\s*import\.meta\.url/g)) found.push(m[2]);
  }
  if (f.endsWith('.html')) {
    for (const m of src.matchAll(/\b(?:src|href)\s*=\s*(['"])([^'"]+)\1/g)) if (isLocal(m[2])) found.push(m[2]);
    for (const m of src.matchAll(/\bfrom\s*(['"])(\.{1,2}\/[^'"]+)\1/g)) found.push(m[2]); // HTML に直接書いた <script type="module">
  }
  if (f.endsWith('.css')) {
    for (const m of src.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/g)) if (isLocal(m[2])) found.push(m[2]);
  }
  for (const ref of found) {
    refs++;
    if (!exists(ref, dirname(f))) errors.push(`missing: ${f} -> ${ref}`);
  }
}

console.log(`static: ${scripts.length} scripts, ${jsons.length} JSON files, ${refs} local references checked`);
if (errors.length) {
  console.error(`static: ${errors.length} problem(s)`);
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}
console.log('static: OK');
