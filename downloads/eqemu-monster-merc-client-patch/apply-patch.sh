#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 /path/to/EverQuest"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
EQ_PATH="$1"
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

echo "Backup created: $BACKUP_FILE"
echo "Lines added: $added"
echo "Done. Restart the EQ client and test the merc window again."

