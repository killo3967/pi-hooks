#!/usr/bin/env bash
#
# Fails unless the given commit is reachable from the release branch.
#
# The publish workflow runs on `v*` tags, and a tag can point anywhere: a local
# experiment, an unmerged branch, a commit that was never reviewed. Without this
# check the workflow would happily publish that commit to npm.
#
# Usage: check-release-tag.sh <sha> [branch-ref]
# Exit:  0 when the commit is on the branch (or is the branch head),
#        1 when it is not, or when the branch ref cannot be resolved.

set -euo pipefail

sha="${1:-}"
ref="${2:-main}"

if [[ -z "$sha" ]]; then
  echo "usage: check-release-tag.sh <sha> [branch-ref]" >&2
  exit 2
fi

if ! git rev-parse --verify --quiet "${ref}^{commit}" >/dev/null; then
  echo "cannot resolve ref '$ref': the release branch was not fetched" >&2
  exit 1
fi

if ! git merge-base --is-ancestor "$sha" "$ref"; then
  echo "tag points to $sha, which is not on $ref" >&2
  exit 1
fi

echo "$sha is on $ref"
