#!/usr/bin/env bash
# 統合後に実際にできあがるコード（統合先のブランチ ＋ いま取り出している commit）を作る。
# このリポジトリの版だけでなく、組み合わせたツリーで回帰テストを実行するため（docs/CI.md 3章）。
#
#   tools/ci/combine.sh <統合先の git URL> <統合先のブランチ> [統合先の版を残すファイル ...]
#
# 例（別のリポジトリで作った変更を、チームの main に重ねて検証する。チームの Firebase 設定ファイルは
# チームの版のまま残すので、できあがるツリーはチームへの PR の内容そのものになる）：
#   tools/ci/combine.sh https://github.com/Devfest-Hackathon-2026/df-2026-t182.git main \
#       .firebaserc firebase.json firebase-config.js
#
# 統合先に対しては読み取りだけ（匿名で fetch する。統合先が公開リポジトリか、読み取り権限があること）。
# 結果はこの作業コピーの detached HEAD になり、どこにも push しない。
# きれいにマージできないときは、衝突したファイルを表示して終了コード 1 で止まる。
set -euo pipefail
[ $# -ge 2 ] || { echo "usage: $0 <upstream-url> <branch> [keep-path ...]" >&2; exit 2; }
url=$1 branch=$2; shift 2
summary=${GITHUB_STEP_SUMMARY:-/dev/null}
[ -z "$(git status --porcelain --untracked-files=no)" ] || { echo "combine: working tree has uncommitted changes" >&2; exit 2; }

head=$(git rev-parse HEAD)
git fetch --no-tags --quiet "$url" "+refs/heads/$branch:refs/remotes/integration/$branch"
base=$(git rev-parse "refs/remotes/integration/$branch")
if ! git merge-base "$base" "$head" >/dev/null; then
  echo "combine: no common history with $url $branch (fetch-depth: 0 is required in CI)" >&2; exit 1
fi

git checkout --quiet --detach "$base"
git_id=(-c user.name="regression-ci" -c user.email="regression-ci@users.noreply.github.com")
if ! git "${git_id[@]}" merge --no-ff --no-edit --quiet -m "integration: $branch + ${head:0:12}" "$head"; then
  conflicts=$(git diff --name-only --diff-filter=U)
  git merge --abort
  git checkout --quiet --detach "$head"
  {
    echo "### ❌ Does not merge cleanly onto \`$branch\` (${base:0:12})"
    echo "Conflicting files — update the branch from the upstream \`$branch\` and resolve them:"
    echo '```'; echo "$conflicts"; echo '```'
  } | tee -a "$summary" >&2
  exit 1
fi

kept=()
for p in "$@"; do
  if git cat-file -e "$base:$p" 2>/dev/null; then git checkout --quiet "$base" -- "$p"; else git rm --quiet --ignore-unmatch -- "$p"; fi
  kept+=("$p")
done
if ! git diff --cached --quiet; then git "${git_id[@]}" commit --quiet -m "integration: keep upstream ${kept[*]}"; fi

{
  echo "### Integration tree: \`$branch\` @ \`${base:0:12}\` + \`${head:0:12}\`"
  [ ${#kept[@]} -gt 0 ] && echo "Upstream versions kept for: \`${kept[*]}\`"
  echo '```'; git diff --stat "$base" HEAD | tail -25; echo '```'
} | tee -a "$summary"
