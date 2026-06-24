#!/usr/bin/env bash
# Install (or update) a daily 08:00 cron job that runs the morning brief and
# appends it to ~/brief.log. Idempotent: re-running replaces the existing entry
# rather than duplicating it.
#
# Usage: scripts/install_cron.sh [HOUR]    (HOUR defaults to 8, 24h local time)
#
# Remove it later with: scripts/install_cron.sh --uninstall
set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
NODE_BIN="$(command -v node || true)"
MARKER="# tradingview-chat-gpt morning brief"
LOG="$HOME/brief.log"

if [ -z "$NODE_BIN" ]; then
  echo "ERROR: node not found on PATH." >&2
  exit 1
fi

# Strip any existing entry we previously installed.
strip_existing() {
  crontab -l 2>/dev/null | grep -vF "$MARKER" || true
}

if [ "${1:-}" = "--uninstall" ]; then
  strip_existing | crontab -
  echo "Removed the morning-brief cron job."
  exit 0
fi

HOUR="${1:-8}"
ENTRY="0 ${HOUR} * * * cd ${REPO_DIR} && ${NODE_BIN} scripts/morning_brief.js >> ${LOG} 2>&1 ${MARKER}"

{ strip_existing; echo "$ENTRY"; } | crontab -

echo "Installed daily morning brief at ${HOUR}:00 local time."
echo "  Repo:  ${REPO_DIR}"
echo "  Log:   ${LOG}  (view with: tail -f ${LOG})"
echo "Note: your machine must be awake and TradingView running with CDP enabled"
echo "at that time for the brief to produce data."
