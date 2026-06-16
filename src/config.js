// Central configuration. Override any of these with environment variables.

import os from "node:os";
import path from "node:path";

export const CDP_HOST = process.env.TV_CDP_HOST || "127.0.0.1";
export const CDP_PORT = Number(process.env.TV_CDP_PORT || 9222);

// Where the user's strategy file lives. Defaults to rules.json next to the repo
// root, but can be pointed elsewhere (e.g. on a VPS) with TV_RULES_PATH.
export const RULES_PATH =
  process.env.TV_RULES_PATH ||
  path.join(path.dirname(new URL("..", import.meta.url).pathname), "rules.json");

// Where the Super Trader persists its paper-trading account between MCP calls.
export const PAPER_STATE_PATH =
  process.env.TV_PAPER_STATE ||
  path.join(path.dirname(new URL("..", import.meta.url).pathname), "paper_state.json");

// Heuristic: which Electron/Chromium frame is the real TradingView chart app.
// TradingView Desktop loads its SPA from a tradingview.com origin.
export const TV_URL_MATCH = /tradingview\.com/i;

// How long to wait (ms) for in-page operations like symbol switches to settle.
export const SETTLE_MS = Number(process.env.TV_SETTLE_MS || 1500);

export const HOME = os.homedir();
