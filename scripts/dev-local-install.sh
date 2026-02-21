#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

usage() {
  cat <<'EOF'
Usage:
  scripts/dev-local-install.sh [--codex-home <dir>] [--no-skill-sync] [--quiet] [--force]

Builds the SurfWright CLI from the current checkout, links it into the active Node/npm global
prefix (npm link), and installs the Codex skill into:
  ${CODEX_HOME:-~/.codex}/skills/surfwright

This is intended for local development. It may shadow any published npm installation of
`surfwright` for the current Node version.
EOF
}

codex_home="${CODEX_HOME:-${HOME}/.codex}"
skill_sync=1
quiet=0
force=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --codex-home) codex_home="$2"; shift 2 ;;
    --no-skill-sync) skill_sync=0; shift 1 ;;
    --quiet) quiet=1; shift 1 ;;
    --force) force=1; shift 1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "dev-local-install: ERROR unknown arg $1" >&2; usage; exit 2 ;;
  esac
done

say() {
  if [[ "$quiet" == "1" ]]; then
    return 0
  fi
  echo "$@"
}

if [[ ! -d ".git" ]]; then
  echo "dev-local-install: ERROR not a git repo (missing .git)" >&2
  exit 2
fi

head="$(git rev-parse HEAD 2>/dev/null || true)"
dirty="clean"
if ! git diff --quiet >/dev/null 2>&1; then
  dirty="dirty"
fi

state_dir="${root}/tmp"
mkdir -p "$state_dir"
state_file="${state_dir}/dev-local-install.head"

if [[ "$force" != "1" && -n "$head" && "$dirty" == "clean" && -f "$state_file" ]]; then
  prev="$(cat "$state_file" 2>/dev/null || true)"
  if [[ "$prev" == "$head" ]]; then
    say "dev-local-install: SKIP head=${head}"
    exit 0
  fi
fi

say "dev-local-install: build (head=${head:-unknown} ${dirty})"
if [[ "$quiet" == "1" ]]; then
  pnpm -s build >/dev/null
else
  pnpm -s build
fi

# Link this checkout into the active npm global prefix (Node-version scoped under nvm).
# This makes `surfwright` resolve to this repo's dist/cli.js.
say "dev-local-install: npm link"
if [[ "$quiet" == "1" ]]; then
  npm link --force >/dev/null 2>&1
else
  npm link --force
fi

if [[ "$skill_sync" == "1" ]]; then
  src="${root}/skills/surfwright"
  dest_root="${codex_home}/skills"
  dest="${dest_root}/surfwright"
  lock="${dest_root}/surfwright.lock.json"
  mkdir -p "$dest_root"

  say "dev-local-install: skill install -> ${dest}"
  if [[ "$quiet" == "1" ]]; then
    node "${root}/dist/cli.js" skill install --source "$src" --dest "$dest" --lock "$lock" >/dev/null 2>&1
  else
    node "${root}/dist/cli.js" skill install --source "$src" --dest "$dest" --lock "$lock"
  fi
fi

if [[ -n "$head" && "$dirty" == "clean" ]]; then
  printf '%s' "$head" >"$state_file"
fi

say "dev-local-install: OK"
