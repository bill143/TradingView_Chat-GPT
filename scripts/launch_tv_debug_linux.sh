#!/usr/bin/env bash
# Launch TradingView Desktop on Linux with the Chrome DevTools Protocol enabled
# so the MCP server can read the live chart.
#
# Usage: scripts/launch_tv_debug_linux.sh [PORT]
set -euo pipefail

PORT="${1:-9222}"

# Quit any running instance first so the new debug flag takes effect.
pkill -f -i "tradingview" >/dev/null 2>&1 || true
sleep 1

# Find the TradingView binary across the common install methods.
TV_BIN=""
for candidate in \
  "$(command -v tradingview || true)" \
  "/opt/TradingView/tradingview" \
  "/usr/bin/tradingview" \
  "$HOME/.local/bin/tradingview"; do
  if [ -n "$candidate" ] && [ -x "$candidate" ]; then
    TV_BIN="$candidate"
    break
  fi
done

# Flatpak fallback.
if [ -z "$TV_BIN" ] && command -v flatpak >/dev/null 2>&1; then
  if flatpak info com.tradingview.TradingView >/dev/null 2>&1; then
    echo "Launching TradingView via Flatpak with CDP on port ${PORT}..."
    exec flatpak run com.tradingview.TradingView --remote-debugging-port="${PORT}"
  fi
fi

if [ -z "$TV_BIN" ]; then
  echo "ERROR: could not find a TradingView Desktop binary." >&2
  echo "Install it from https://www.tradingview.com/desktop/ and re-run." >&2
  exit 1
fi

echo "Launching ${TV_BIN} with CDP on port ${PORT}..."
exec "$TV_BIN" --remote-debugging-port="${PORT}" >/dev/null 2>&1 &
