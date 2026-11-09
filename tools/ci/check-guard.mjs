// 安全検査（ステージ guard）：秘密情報、CI の権限、Firebase の接続先。通信も Firebase も使わない。
//   node tools/ci/check-guard.mjs [repoRoot]
//
// 常に検査すること（どのリポジトリでも）：
//   1. 認証情報のファイル、秘密鍵、サービスアカウント鍵、CLI のトークンが git に入っていない
//   2. GitHub Actions のワークフローが、デプロイ・pull_request_target・書き込み権限・Secrets を使わない
//      （回帰テストにはどれも不要。使えないようにしておけば、誤デプロイや権限の悪用が起きない）
//   3. Firebase Emulator の起動はすべて「demo-」プロジェクト（オフライン。本物のプロジェクトに接続できない）
//
// リポジトリごとの任意の設定（呼び出し側の ci.yml が渡す。このファイル自体はどのリポジトリでも同一）：
//   EXPECT_FIREBASE_PROJECT=<id>        .firebaserc の default と firebase-config.js の projectId・authDomain が <id> で、
//                                       ほかの別名や Hosting の site / target 指定がないこと
//   FORBID_FIREBASE_IDS=<id>,<id>,...   これらのプロジェクト・サイトIDが、Firebase の設定ファイルにも、
//                                       公開コード中の <id>.web.app / .firebaseapp.com の URL にも現れないこと
//   ALLOW_FIREBASE_IDS=<id>,<id>,...    許可リスト：.firebaserc・firebase.json・firebase-config.js と公開コード中の
//                                       Firebase の URL に出てくるプロジェクト・サイトIDが、すべてこの中にあること。
//                                       名前を挙げなくても、ほかの環境の設定の混入をすべて止められる。
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { listFiles, isSecretName, SECRET_TEXT, BINARY } from './lib.mjs';

const ROOT = resolve(process.argv[2] || join(dirname(new URL(import.meta.url).pathname), '..', '..'));
const tracked = listFiles(ROOT);
const errors = [];
const read = f => readFileSync(join(ROOT, f), 'utf8');
const SELF = 'tools/ci/check-guard.mjs';

// --- 1. 認証情報のファイルと秘密情報 --------------------------------------------------------
for (const f of tracked) if (isSecretName(f)) errors.push(`secret file is tracked: ${f}`);
for (const f of tracked) {
  // このファイルと lib.mjs は検出パターンそのものを含むため、検査対象から外す。
  if (f === SELF || f === 'tools/ci/lib.mjs' || BINARY.test(f)) continue;
  let text;
  try { text = read(f); } catch { continue; }
  if (text.includes('\u0000')) continue; // バイナリファイル
  for (const [re, what] of SECRET_TEXT) if (re.test(text)) errors.push(`${what} found in ${f}`);
}
// Firebase の Web 用設定（apiKey "AIza..."）は公開してよい値だが、置き場所は firebase-config.js だけに限る。
for (const f of tracked.filter(f => /\.(m?js|html|json)$/.test(f) && !f.startsWith('assets/vendor/'))) {
  if (f !== 'firebase-config.js' && /\bAIza[0-9A-Za-z_-]{35}\b/.test(read(f))) errors.push(`Firebase web apiKey outside firebase-config.js: ${f}`);
}

// --- 2. GitHub Actions のワークフロー ---------------------------------------------------------
// あえて行単位・正規表現で調べる：YAML パーサーに依存せず、想定外の書き方のステップでも一致すれば失敗にする
// （疑わしいときは止める）。説明文で禁止語に触れられるよう、コメントは先に取り除く。
// proposals/**.yml は別のリポジトリ用に用意したワークフローなので、同じ基準で検査する。
const workflows = tracked.filter(f => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(f) || /^proposals\/.+\.ya?ml$/.test(f));
const ALLOWED_SECRETS = new Set(['GITHUB_TOKEN']);
for (const f of workflows) {
  const lines = read(f).split('\n');
  const code = lines.map(l => l.replace(/(^|\s)#.*$/, '')); // コメントは無視する
  const text = code.join('\n');
  if (/\bpull_request_target\b/.test(text)) errors.push(`${f}: pull_request_target is not allowed (it runs with secrets and a write token)`);
  if (/\bworkflow_run\b/.test(text)) errors.push(`${f}: workflow_run is not allowed (privileged follow-up runs on untrusted code)`);
  if (/firebase(?:-tools(?:@[\w.]+)?)?\s+(?:[^\n]*\s)?(?:deploy|hosting:channel:deploy|hosting:clone|firestore:delete|database:)/.test(text)) errors.push(`${f}: Firebase deploy/destructive command in CI`);
  if (/FirebaseExtended\/action-hosting-deploy|google-github-actions\/(?:auth|deploy)|w9jds\/firebase-action/.test(text)) errors.push(`${f}: deployment/cloud-auth action in CI`);
  if (/\bwrite-all\b/.test(text)) errors.push(`${f}: permissions: write-all`);
  code.forEach((l, i) => { if (/^\s*[a-z-]+\s*:\s*write\s*$/.test(l)) errors.push(`${f}:${i + 1}: write permission "${l.trim()}"`); });
  if (!/^permissions\s*:/m.test(text)) errors.push(`${f}: no top-level "permissions:" (defaults may grant write access)`);
  for (const m of text.matchAll(/\bsecrets\.([A-Za-z0-9_]+)/g)) if (!ALLOWED_SECRETS.has(m[1])) errors.push(`${f}: uses secrets.${m[1]} (the regression suite must not need secrets)`);
  if (/\bsecrets\s*:\s*inherit\b/.test(text)) errors.push(`${f}: secrets: inherit`);
}

// --- 3. Emulator はオフラインの demo- プロジェクトで起動すること ----------------------------
// コマンドが書かれる場所（ワークフロー、.sh、package.json の scripts）だけを調べる。JS の中の行は、
// コマンド名に触れただけの説明文やエラーメッセージであることが多く、誤検知になるため対象外。
const emuFiles = [...workflows, ...tracked.filter(f => /\.sh$|(^|\/)package\.json$/.test(f) && !f.includes('node_modules'))];
for (const f of emuFiles) {
  read(f).split('\n').forEach((l, i) => {
    if (!/^\s*(#|\/\/)/.test(l) && /emulators:(exec|start)/.test(l) && !/--project[ =]["']?(demo-[\w-]+|\$\{?DEMO_PROJECT)/.test(l)) {
      errors.push(`${f}:${i + 1}: emulator started without --project demo-… (could attach to a real project)`);
    }
  });
}

// --- 4. 任意：Firebase の接続先の設定（ci.yml から渡されたときだけ） -------------------------
const expect = (process.env.EXPECT_FIREBASE_PROJECT || '').trim();
const forbid = (process.env.FORBID_FIREBASE_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
const allow = new Set((process.env.ALLOW_FIREBASE_IDS || '').split(',').map(s => s.trim()).filter(Boolean));
const json = f => { try { return JSON.parse(read(f)); } catch (e) { errors.push(`${f}: ${e.message}`); return null; } };
if (expect) {
  const rc = existsSync(join(ROOT, '.firebaserc')) ? json('.firebaserc') : null;
  const projects = rc?.projects || {};
  if (projects.default !== expect) errors.push(`.firebaserc: default project is "${projects.default}", expected "${expect}"`);
  const others = Object.keys(projects).filter(k => k !== 'default');
  if (others.length) errors.push(`.firebaserc: extra project aliases (${others.join(', ')}) — only "default" is allowed here`);
  if (rc?.targets) errors.push('.firebaserc: deploy targets are not allowed here');
  const fj = json('firebase.json');
  for (const h of [fj?.hosting].flat().filter(Boolean)) {
    if (h.site || h.target) errors.push('firebase.json: hosting.site/target must not be set (use the project\'s default site)');
  }
  const cfg = read('firebase-config.js');
  const field = k => [...cfg.matchAll(new RegExp(`\\b${k}\\s*:\\s*(['"])([^'"]*)\\1`, 'g'))].map(m => m[2]);
  if (JSON.stringify(field('projectId')) !== JSON.stringify([expect])) errors.push(`firebase-config.js: projectId is ${JSON.stringify(field('projectId'))}, expected ["${expect}"]`);
  if (JSON.stringify(field('authDomain')) !== JSON.stringify([`${expect}.firebaseapp.com`])) errors.push(`firebase-config.js: authDomain does not belong to "${expect}"`);
}
if (forbid.length) {
  for (const f of ['.firebaserc', 'firebase.json', 'firebase-config.js'].filter(f => existsSync(join(ROOT, f)))) {
    const t = read(f);
    for (const id of forbid) if (t.includes(id)) errors.push(`${f}: refers to forbidden Firebase project/site "${id}"`);
  }
  const shipped = tracked.filter(f => /\.(m?js|html)$/.test(f) && !f.startsWith('tools/') && !f.startsWith('assets/vendor/'));
  for (const f of shipped) {
    const t = read(f);
    for (const id of forbid) {
      const host = new RegExp(`\\b${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.(web\\.app|firebaseapp\\.com|firebasestorage\\.app|appspot\\.com)`);
      if (host.test(t)) errors.push(`${f}: hard-codes a URL of forbidden Firebase project/site "${id}"`);
    }
  }
}
if (allow.size) {
  // このリポジトリが接続しうる Firebase のプロジェクト・サイトIDをすべて集め、許可リストと照合する。
  const used = []; // [id, where]
  if (existsSync(join(ROOT, '.firebaserc'))) {
    const rc = json('.firebaserc') || {};
    for (const id of Object.values(rc.projects || {})) used.push([id, '.firebaserc projects']);
    for (const [proj, byType] of Object.entries(rc.targets || {})) {
      used.push([proj, '.firebaserc targets']);
      for (const t of Object.values(byType || {})) for (const sites of Object.values(t || {})) for (const id of [sites].flat()) used.push([id, '.firebaserc targets']);
    }
  }
  if (existsSync(join(ROOT, 'firebase.json'))) {
    for (const h of [json('firebase.json')?.hosting].flat().filter(Boolean)) if (h.site) used.push([h.site, 'firebase.json hosting.site']);
  }
  if (existsSync(join(ROOT, 'firebase-config.js'))) {
    const cfg = read('firebase-config.js');
    for (const m of cfg.matchAll(/\b(projectId|authDomain|storageBucket)\s*:\s*(['"])([^'"]*)\2/g)) {
      used.push([m[3].replace(/\.(firebaseapp\.com|web\.app|firebasestorage\.app|appspot\.com)$/, ''), `firebase-config.js ${m[1]}`]);
    }
  }
  const shipped = tracked.filter(f => /\.(m?js|html)$/.test(f) && !f.startsWith('tools/') && !f.startsWith('assets/vendor/'));
  for (const f of shipped) {
    for (const m of read(f).matchAll(/\b([a-z0-9][a-z0-9-]*)\.(web\.app|firebaseapp\.com|firebasestorage\.app)\b/g)) used.push([m[1], f]);
  }
  for (const [id, where] of used) if (!allow.has(id)) errors.push(`${where}: Firebase project/site "${id}" is not in this repository's allow-list`);
}

console.log(`guard: ${tracked.length} files, ${workflows.length} workflows checked` +
  (expect ? `, Firebase target pinned to "${expect}"` : '') + (forbid.length ? `, ${forbid.length} forbidden IDs` : '') +
  (allow.size ? `, ${allow.size} allowed Firebase IDs` : ''));
if (errors.length) {
  console.error(`guard: ${errors.length} problem(s)`);
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}
console.log('guard: OK');
