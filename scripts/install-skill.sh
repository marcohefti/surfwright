#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SKILL_NAME="surfwright"
DEST_ROOT="${CODEX_HOME:-$HOME/.codex}/skills"

usage() {
  cat <<USAGE
Usage: scripts/install-skill.sh [--skill <name>] [--dest <dir>]

Installs or updates a local skill from this repository into a Codex skills directory.
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
TMP_DIR="$DEST_ROOT/.${SKILL_NAME}.tmp.$$"

rm -rf "$TMP_DIR"
cp -R "$SOURCE_DIR" "$TMP_DIR"
rm -rf "$DEST_DIR"
mv "$TMP_DIR" "$DEST_DIR"

echo "Installed skill '$SKILL_NAME' to: $DEST_DIR"
echo "Restart Codex to pick up skill changes."
