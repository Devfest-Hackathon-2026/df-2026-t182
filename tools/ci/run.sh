#!/usr/bin/env bash
# 回帰テストの入口。GitHub Actions も開発者の手元も、このスクリプトだけを実行する（同じ結果になるように）。
#
#   tools/ci/run.sh            # = fast（Java・Emulator 不要、約5秒）
#   tools/ci/run.sh all        # fast ＋ Firestore ルールのテスト（Emulator）
#   tools/ci/run.sh static|guard|unit|build|rules [...]   # ステージを選んで実行
#
# デプロイも本番 Firebase への接続もしない。Emulator はオフラインの「demo-」プロジェクトで動き、認証情報は読まない。
# 任意の環境変数（CI が ci.yml の設定から渡す。意味は check-guard.mjs の冒頭を参照）：
#   EXPECT_FIREBASE_PROJECT, FORBID_FIREBASE_IDS, ALLOW_FIREBASE_IDS
#   FIREBASE_CLI   Firebase CLI のコマンド（既定：PATH の firebase、無ければバージョン固定の npx firebase-tools）
set -euo pipefail
cd "$(dirname "$0")/../.."

DEMO_PROJECT=demo-mi-rules            # demo- で始まるIDは Emulator 専用。本番のプロジェクトには接続できない
FIREBASE_TOOLS_VERSION=14.27.0

stage_static() { node tools/ci/check-static.mjs; }
stage_guard()  { node tools/ci/check-guard.mjs; }
stage_unit() {
  node --test --test-reporter=spec tools/ci/tests/*.test.mjs
  # Python のツールが構文として正しいこと。tools/test_*.py（デプロイ前確認のテストなど）があれば自動で実行する。
  python3 - <<'PY'
import pathlib, sys
bad = 0
for p in sorted(pathlib.Path('tools').rglob('*.py')):
    if 'node_modules' in p.parts: continue
    try: compile(p.read_bytes(), str(p), 'exec')
    except SyntaxError as e: print(f'{p}:{e.lineno}: {e.msg}', file=sys.stderr); bad += 1
print(f'python: compiled tools/**/*.py ({"OK" if not bad else f"{bad} failed"})')
sys.exit(1 if bad else 0)
PY
  # tools/ は Python のパッケージではないため、テストは tools/ 直下の test_*.py だけを集める。
  if compgen -G 'tools/test_*.py' >/dev/null; then python3 -m unittest discover -s tools -p 'test_*.py' -v; fi
}
stage_build() {
  python3 tools/build_dist.py
  node tools/ci/check-dist.mjs
}
stage_rules() {
  case "$DEMO_PROJECT" in demo-*) ;; *) echo "refusing: emulator project must start with demo-" >&2; exit 1;; esac
  command -v java >/dev/null || { echo "rules: Java 11+ is required for the Firestore emulator" >&2; exit 1; }
  if [ ! -d tools/rules-test/node_modules ]; then npm ci --prefix tools/rules-test --no-audit --no-fund; fi
  local cli="${FIREBASE_CLI:-}"
  if [ -z "$cli" ]; then
    if command -v firebase >/dev/null; then cli=firebase; else cli="npx --yes firebase-tools@${FIREBASE_TOOLS_VERSION}"; fi
  fi
  # ログインもトークンも使わない。demo- プロジェクトの emulators:exec はオフラインで動き、本物の資源には触れない。
  $cli emulators:exec --only firestore --project "$DEMO_PROJECT" --config firebase.json "npm test --prefix tools/rules-test"
}

stages=("$@"); [ ${#stages[@]} -eq 0 ] && stages=(fast)
expanded=()
for s in "${stages[@]}"; do
  case "$s" in
    fast) expanded+=(static guard unit build) ;;
    all)  expanded+=(static guard unit build rules) ;;
    static|guard|unit|build|rules) expanded+=("$s") ;;
    *) echo "unknown stage: $s (static|guard|unit|build|rules|fast|all)" >&2; exit 2 ;;
  esac
done
# 時間のかからないステージから順に実行し、最初の失敗で止める（set -e）。結果を早く返すため。
for s in "${expanded[@]}"; do
  # ::group:: は GitHub Actions のログでステージごとに折りたたむ印。手元では不要なので出さない。
  [ -n "${GITHUB_ACTIONS:-}" ] && echo "::group::regression: $s"
  start=$SECONDS
  "stage_$s"
  [ -n "${GITHUB_ACTIONS:-}" ] && echo "::endgroup::"
  echo "✔ $s ($((SECONDS - start))s)"
done
