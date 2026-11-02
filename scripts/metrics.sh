#!/usr/bin/env bash
# Veridian — weekly metrics snapshot. Idempotent: appends one dated block per run, never edits.
# Everything here is a fact pulled from a registry or the GitHub API; nothing is estimated.
#
#   ./metrics.sh                 # append a snapshot to metrics.md
#   ./metrics.sh --print         # print without writing
#
# Requires: gh (authenticated as the repo owner for the traffic endpoints), curl, python3.
set -euo pipefail

OUT="$(dirname "$0")/metrics.md"
REPO="farmountain/veridian"
PKG="veridian"
NOW="$(date -u '+%Y-%m-%d %H:%M UTC')"

json() { python3 -c "import json,sys;d=json.load(sys.stdin);print($1)" 2>/dev/null || echo "n/a"; }

npm_ver=$(curl -fsS "https://registry.npmjs.org/$PKG" 2>/dev/null | json "d.get('dist-tags',{}).get('latest') or 'UNPUBLISHED'")
npm_mod=$(curl -fsS "https://registry.npmjs.org/$PKG" 2>/dev/null | json "d.get('time',{}).get('modified','n/a')")
dl_week=$(curl -fsS "https://api.npmjs.org/downloads/point/last-week/$PKG" 2>/dev/null | json "d.get('downloads','n/a')" || echo "n/a")
stars=$(gh api "repos/$REPO" --jq .stargazers_count 2>/dev/null || echo "n/a")
forks=$(gh api "repos/$REPO" --jq .forks_count 2>/dev/null || echo "n/a")
issues=$(gh api "repos/$REPO" --jq .open_issues_count 2>/dev/null || echo "n/a")
views=$(gh api "repos/$REPO/traffic/views" --jq '"\(.count)/\(.uniques)"' 2>/dev/null || echo "n/a")
clones=$(gh api "repos/$REPO/traffic/clones" --jq '"\(.count)/\(.uniques)"' 2>/dev/null || echo "n/a")
last_rel=$(gh release list -R "$REPO" -L 1 2>/dev/null | awk -F'\t' '{print $1}' || echo "n/a")

block="
## $NOW

| metric | value |
|---|---|
| npm latest | $npm_ver |
| npm last modified | $npm_mod |
| npm downloads (last week) | $dl_week |
| GitHub stars | $stars |
| GitHub forks | $forks |
| open issues | $issues |
| views 14d (total/unique) | $views |
| clones 14d (total/unique) | $clones |
| latest release | $last_rel |
| paid pilots signed | 0 (update by hand when one is signed) |
| revenue | 0 (update by hand) |
"

if [[ "${1:-}" == "--print" ]]; then
  printf '%s\n' "$block"
else
  [[ -f "$OUT" ]] || printf '# Veridian — metrics\n\nAppended weekly by `metrics.sh`. Manual rows are marked as such.\n' > "$OUT"
  printf '%s\n' "$block" >> "$OUT"
  printf 'appended to %s\n' "$OUT"
fi
