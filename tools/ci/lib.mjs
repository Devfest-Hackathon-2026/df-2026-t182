// tools/ci/*.mjs が共有する関数と検出パターン（外部の依存パッケージなし）。
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

// git の作業ツリーのファイル（管理中＋未追加だが無視されていないもの）、または普通のフォルダー（例 dist/）の全ファイル。
export function listFiles(root, { walk = false } = {}) {
  if (!walk) {
    return execFileSync('git', ['-C', root, 'ls-files', '-co', '--exclude-standard'], { encoding: 'utf8' })
      .split('\n').filter(Boolean).filter(f => existsSync(join(root, f)));
  }
  const out = [];
  (function rec(dir) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) rec(p); else out.push(relative(root, p));
    }
  })(root);
  return out.sort();
}

// コミットも公開もしてはいけない、認証情報のファイル名。
export const SECRET_NAME = [
  /(^|\/)\.env(\..+)?$/, /(^|\/)\.dev\.vars(\..+)?$/, /\.(pem|key|p12|pfx|jks|keystore)$/i,
  /(^|\/)service-account[^/]*\.json$/i, /(^|\/)credentials[^/]*\.json$/i, /(^|\/)[^/]*-adminsdk-[^/]*\.json$/i,
  /(^|\/)google-services\.json$/, /(^|\/)GoogleService-Info\.plist$/, /(^|\/)\.firebase\//, /(^|\/)firebase-debug\.log$/
];
export const SECRET_NAME_OK = [/(^|\/)\.env\.example$/, /(^|\/)\.dev\.vars\.example$/];
export const isSecretName = f => SECRET_NAME.some(r => r.test(f)) && !SECRET_NAME_OK.some(r => r.test(f));

// テキストファイルの中に書かれた秘密情報。
export const SECRET_TEXT = [
  [/-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/, 'private key'],
  [/"type"\s*:\s*"service_account"/, 'service-account JSON'],
  [/"private_key"\s*:\s*"/, 'service-account private_key'],
  [/\b1\/\/0[0-9A-Za-z_-]{30,}/, 'Google OAuth refresh token (e.g. FIREBASE_TOKEN)'],
  [/\bgh[pousr]_[A-Za-z0-9]{36,}\b/, 'GitHub token'],
  [/\bgithub_pat_[A-Za-z0-9_]{40,}\b/, 'GitHub fine-grained token']
];
export const BINARY = /\.(jpe?g|png|webp|gif|ico|woff2?|ttf|otf|mp3|m4a|ogg|wav|glb|bin|pdf|ktx2)$/i;
