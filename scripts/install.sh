#!/usr/bin/env bash
# Install the skill(s) into the folders coding agents scan for SKILL.md.
#
#   ./scripts/install.sh                         user-level, Claude Code + shared .agents folder
#   ./scripts/install.sh --project               into the current directory's repo
#   ./scripts/install.sh --agent codex           only one agent (claude | codex | cursor | all)
#   ./scripts/install.sh --link                  symlink instead of copy (live edits while developing)
#   ./scripts/install.sh --uninstall             remove what this script installs
#
# Targets are chosen so no agent sees the skill twice:
#   claude  -> .claude/skills      (Claude Code; Cursor also reads this in projects)
#   codex   -> .agents/skills      (Codex and other tools on the shared location)
#   cursor  -> .claude/skills      (project only; Cursor reads it)
#   all     -> both folders. Only use it if none of your agents scan both.
#
# Override completely with SKILL_TARGETS="dir1:dir2".
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCOPE="user"
AGENT="default"
LINK=0
UNINSTALL=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project) SCOPE="project" ;;
    --agent) AGENT="${2:?--agent needs a value}"; shift ;;
    --agent=*) AGENT="${1#*=}" ;;
    --link) LINK=1 ;;
    --uninstall) UNINSTALL=1 ;;
    -h|--help) sed -n '2,17p' "$0"; exit 0 ;;
    *) echo "unknown option: $1" >&2; exit 1 ;;
  esac
  shift
done

base="$HOME"
[[ "$SCOPE" == "project" ]] && base="$PWD"

if [[ -n "${SKILL_TARGETS:-}" ]]; then
  IFS=':' read -r -a TARGETS <<< "$SKILL_TARGETS"
else
  case "$AGENT" in
    claude|cursor) TARGETS=("$base/.claude/skills") ;;
    codex) TARGETS=("$base/.agents/skills") ;;
    all|default) TARGETS=("$base/.claude/skills" "$base/.agents/skills") ;;
    *) echo "unknown agent: $AGENT (claude | codex | cursor | all)" >&2; exit 1 ;;
  esac
  if [[ "$AGENT" == "default" && "$SCOPE" == "project" ]]; then
    # In a project, Cursor reads .claude/skills and may also read .agents/skills.
    # Installing to both there is the classic way to get a duplicate entry.
    echo "note: project install defaults to .claude/skills only. Add --agent codex for .agents/skills." >&2
    TARGETS=("$base/.claude/skills")
  fi
fi

for skill in "$REPO"/skills/*/; do
  name="$(basename "$skill")"
  for target in "${TARGETS[@]}"; do
    dest="$target/$name"
    if [[ $UNINSTALL -eq 1 ]]; then
      if [[ -e "$dest" || -L "$dest" ]]; then rm -rf "$dest"; echo "removed $dest"; fi
      continue
    fi
    mkdir -p "$target"
    # rm on the path itself (no trailing slash) removes a symlink, never its target.
    rm -rf "$dest"
    if [[ $LINK -eq 1 ]]; then
      ln -s "${skill%/}" "$dest"
      echo "linked  $dest"
    else
      cp -R "${skill%/}" "$dest"
      echo "copied  $dest"
    fi
  done
done

[[ $UNINSTALL -eq 1 ]] || echo "Done. Restart your agent so it rescans skills."
