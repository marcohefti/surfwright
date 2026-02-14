#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKILL_NAME="surfwright"
DEST_ROOT="${CODEX_HOME:-$HOME/.codex}/skills"
LOCK_PATH="$ROOT_DIR/skills/surfwright.lock.json"

usage() {
  cat <<USAGE
Usage: scripts/install-skill.sh [--skill <name>] [--dest <dir>]

Compatibility wrapper around the authoritative CLI path:
  surfwright skill install
USAGE
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skill)
      SKILL_NAME="$2"
      shift 2
      ;;
    --dest)
      DEST_ROOT="$2"
      shift 2
      ;;
    --lock)
      LOCK_PATH="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage
      exit 1
      ;;
  esac
done

SOURCE_DIR="$ROOT_DIR/skills/$SKILL_NAME"
if [[ ! -d "$SOURCE_DIR" ]]; then
  echo "Skill not found: $SOURCE_DIR" >&2
  exit 1
fi

mkdir -p "$DEST_ROOT"
DEST_DIR="$DEST_ROOT/$SKILL_NAME"

pnpm -s build >/dev/null

node "$ROOT_DIR/dist/cli.js" --json skill install --source "$SOURCE_DIR" --dest "$DEST_DIR" --lock "$LOCK_PATH"
