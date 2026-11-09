// 公開物の検査（ステージ build）：tools/build_dist.py が作る dist/ を、デプロイせずに調べる。
//   python3 tools/build_dist.py && node tools/ci/check-dist.mjs
// - firebase.json が dist/ を配信する設定で、プレイヤーと主催者が開くページがそろっている
// - dist/ の中の import / src / href がすべて dist/ の中で解決する（ビルドで取りこぼしたファイルがない）
// - ツール・文書・Firebase CLI の設定・認証情報のファイルを公開しない
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, lstatSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { listFiles, isSecretName, SECRET_TEXT, BINARY } from './lib.mjs';

const ROOT = resolve(process.argv[2] || join(dirname(new URL(import.meta.url).pathname), '..', '..'));
const DIST = join(ROOT, 'dist');
const errors = [];

const fj = JSON.parse(readFileSync(join(ROOT, 'firebase.json'), 'utf8'));
for (const h of [fj.hosting].flat().filter(Boolean)) if (h.public !== 'dist') errors.push(`firebase.json: hosting.public is "${h.public}", expected "dist"`);
if (!existsSync(DIST)) { console.error('dist: missing — run python3 tools/build_dist.py first'); process.exit(1); }

const files = listFiles(DIST, { walk: true });
const has = new Set(files);
for (const f of ['index.html', 'firebase-config.js', 'fb.js', 'teach/index.html', 'assets/voice/manifest.json']) {
  if (!has.has(f)) errors.push(`dist: required file missing: ${f}`);
}
if (has.has('firebase-config.js') && readFileSync(join(DIST, 'firebase-config.js'), 'utf8') !== readFileSync(join(ROOT, 'firebase-config.js'), 'utf8')) {
  errors.push('dist/firebase-config.js differs from the source firebase-config.js');
}
const NOT_PUBLIC = [/^tools\//, /(^|\/)node_modules\//, /\.md$/i, /(^|\/)\./, /\.py$/,
  /^firebase\.json$/, /^firestore\.(rules|indexes\.json)$/, /(^|\/)package(-lock)?\.json$/, /^docs\//, /^\.github\//];
for (const f of files) {
  if (NOT_PUBLIC.some(r => r.test(f))) errors.push(`dist: should not be published: ${f}`);
  if (isSecretName(f)) errors.push(`dist: credential-like file: ${f}`);
  if (lstatSync(join(DIST, f)).isSymbolicLink()) errors.push(`dist: symlink: ${f}`);
  if (!BINARY.test(f)) {
    const t = readFileSync(join(DIST, f), 'utf8');
    for (const [re, what] of SECRET_TEXT) if (re.test(t)) errors.push(`dist: ${what} in ${f}`);
  }
}

// 公開物の中の参照は、すべて公開物の中で解決しなければならない（check-static.mjs を dist/ に対して実行）。
const r = spawnSync(process.execPath, [join(dirname(new URL(import.meta.url).pathname), 'check-static.mjs'), DIST, '--walk'], { encoding: 'utf8' });
process.stdout.write(r.stdout.replace(/^static:/gm, 'dist/static:'));
if (r.status !== 0) errors.push('dist: broken references or syntax inside the bundle:\n' + r.stderr.trim());

console.log(`dist: ${files.length} files checked`);
if (errors.length) {
  console.error(`dist: ${errors.length} problem(s)`);
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}
console.log('dist: OK');
