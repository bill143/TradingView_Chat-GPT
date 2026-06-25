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

// Heuristic: which Electron/Chromium frame is the real TradingView chart app.
// TradingView Desktop loads its SPA from a tradingview.com origin.
export const TV_URL_MATCH = /tradingview\.com/i;

// How long to wait (ms) for in-page operations like symbol switches to settle.
export const SETTLE_MS = Number(process.env.TV_SETTLE_MS || 1500);

// Symbol-switch confirmation: after pressing Enter we re-read the active symbol
// and, if it hasn't updated yet, poll up to SYMBOL_CONFIRM_TRIES times waiting
// SYMBOL_CONFIRM_MS between reads. Tune up on a slow machine / network.
export const SYMBOL_CONFIRM_TRIES = Number(process.env.TV_SYMBOL_CONFIRM_TRIES || 5);
export const SYMBOL_CONFIRM_MS = Number(process.env.TV_SYMBOL_CONFIRM_MS || 500);

// How long to wait (ms) after opening a dialog/search before typing, and after
// typing before reading results. TradingView mounts these panels asynchronously.
export const DIALOG_SETTLE_MS = Number(process.env.TV_DIALOG_SETTLE_MS || 900);

export const HOME = os.homedir();
