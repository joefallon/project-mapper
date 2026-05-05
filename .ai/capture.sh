#!/usr/bin/env bash
set -euo pipefail

mkdir -p ".ai/out"

usage() {
  echo "Usage:"
  echo "  .ai/capture.sh [-n NAME] -- <command> [args...]"
  echo
  echo "Examples:"
  echo "  .ai/capture.sh -n gold_csv_disable_logic -- rg -B 2 -A 10 'csv' application/controllers/LeadSourceReportController.php"
  echo "  .ai/capture.sh -- git diff -- application/controllers/LeadSourceReportController.php"
}

NAME="capture"

while [[ $# -gt 0 ]]; do
  case "$1" in
    -n|--name)
      [[ $# -ge 2 ]] || { echo "ERROR: missing value for $1" >&2; usage >&2; exit 2; }
      NAME="$2"
      shift 2
      ;;
    --)
      shift
      break
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      break
      ;;
  esac
done

[[ $# -gt 0 ]] || { echo "ERROR: no command provided" >&2; usage >&2; exit 2; }

TS="$(date +%Y%m%d_%H%M%S)"
SAFE_NAME="$(printf '%s' "$NAME" | tr ' /:' '---' | tr -cd 'A-Za-z0-9._-')"
[[ -n "$SAFE_NAME" ]] || SAFE_NAME="capture"

OUT=".ai/out/${TS}_${SAFE_NAME}.txt"

{
  echo "=== host ==="
  hostname
  echo

  echo "=== pwd ==="
  pwd
  echo

  echo "=== date ==="
  date -Is
  echo

  echo "=== cmd ==="
  printf '%q ' "$@"
  echo
  echo

  echo "=== out ==="
  set +e
  "$@"
  STATUS=$?
  set -e
  echo
  echo "=== exit ==="
  echo "$STATUS"
} | tee "$OUT"

if [[ "${STATUS:-0}" -ne 0 ]]; then
  echo "WROTE: $OUT (command failed with exit ${STATUS})" >&2
  exit "$STATUS"
fi

echo "WROTE: $OUT" >&2
echo >&2
echo >&2
