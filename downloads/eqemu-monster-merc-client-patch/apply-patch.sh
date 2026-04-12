#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PATCHER_URL="https://dev.deacyde.com/eqemu/patcher.txt"

resolve_eq_path() {
  if [[ $# -ge 1 && -n "${1:-}" ]]; then
    printf '%s\n' "$1"
    return 0
  fi

  if ! command -v curl >/dev/null 2>&1; then
    echo "curl is required when no EQ path is passed explicitly."
    return 1
  fi

  local manifest
  manifest="$(curl -fsSL "$PATCHER_URL")" || {
    echo "Failed to fetch patch manifest: $PATCHER_URL"
    return 1
  }

  local eq_path
  eq_path="$(printf '%s\n' "$manifest" | awk '/^Client root:/{getline; print; exit}')" || true
  if [[ -z "$eq_path" ]]; then
    echo "Could not find 'Client root' in patch manifest."
    return 1
  fi

  printf '%s\n' "$eq_path"
}

EQ_PATH="$(resolve_eq_path "${1:-}")"
DBSTR_FILE="${EQ_PATH}/dbstr_us.txt"
PATCH_FILE="${SCRIPT_DIR}/dbstr_us.append.txt"

if [[ ! -f "$DBSTR_FILE" ]]; then
  echo "dbstr_us.txt not found at: $DBSTR_FILE"
  exit 1
fi

if [[ ! -f "$PATCH_FILE" ]]; then
  echo "Patch file not found at: $PATCH_FILE"
  exit 1
fi

BACKUP_FILE="${DBSTR_FILE}.bak.$(date +%Y%m%d-%H%M%S)"
cp "$DBSTR_FILE" "$BACKUP_FILE"

added=0
while IFS= read -r line || [[ -n "$line" ]]; do
  [[ -z "$line" ]] && continue
  if ! grep -Fqx "$line" "$DBSTR_FILE"; then
    printf '%s\n' "$line" >> "$DBSTR_FILE"
    added=$((added + 1))
  fi
done < "$PATCH_FILE"

echo "EQ path: $EQ_PATH"
echo "Backup created: $BACKUP_FILE"
echo "Lines added: $added"
echo "Done. Restart the EQ client and test the merc window again."
