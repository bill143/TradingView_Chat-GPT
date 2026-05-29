#!/usr/bin/env bash
# Launch TradingView Desktop on macOS with the Chrome DevTools Protocol enabled.
#
# Usage: scripts/launch_tv_debug_mac.sh [PORT]
set -euo pipefail

PORT="${1:-9222}"
APP="/Applications/TradingView.app"

if [ ! -d "$APP" ]; then
  echo "ERROR: TradingView.app not found in /Applications." >&2
  echo "Install it from https://www.tradingview.com/desktop/ and re-run." >&2
  exit 1
fi

# Quit any running instance so the debug flag takes effect.
osascript -e 'quit app "TradingView"' >/dev/null 2>&1 || true
sleep 1

echo "Launching TradingView with CDP on port ${PORT}..."
open -a "$APP" --args --remote-debugging-port="${PORT}"
