#!/usr/bin/env node
// Live verification harness — exercises every CDP interaction against a REAL
// running TradingView Desktop and reports pass/fail per step with the actual
// data it saw. This is the tool for validating the Blockers (#1–#3): the legend
// selectors, the keyboard flows, and symbol-switch confirmation.
//
// Prereq: TradingView Desktop launched with debugging on, e.g.
//   scripts/launch_tv_debug_<os>.sh    (or .bat on Windows)
//
// Usage:
//   node scripts/verify_live.js [--symbol BITSTAMP:BTCUSD] [--timeframe D]
//                               [--indicator "Relative Strength Index"] [--json]

import { healthCheck, closeClient } from "../src/cdp.js";
import {
  getActiveSymbol,
  setSymbol,
  setTimeframe,
  readQuote,
  readIndicatorValues,
  manageIndicator,
  readCandles,
} from "../src/tradingview.js";

function arg(flag, fallback) {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const SYMBOL = arg("--symbol", "BITSTAMP:BTCUSD");
const TIMEFRAME = arg("--timeframe", "D");
const INDICATOR = arg("--indicator", "Relative Strength Index");
const JSON_OUT = process.argv.includes("--json");

const results = [];
function record(step, status, detail) {
  results.push({ step, status, detail });
  if (!JSON_OUT) {
    const mark = status === "pass" ? "✓" : status === "warn" ? "!" : "✗";
    console.log(`${mark} ${step}${detail ? ` — ${detail}` : ""}`);
  }
}

async function run() {
  // 1. Connection — hard gate.
  const health = await healthCheck();
  if (!health.cdp_connected) {
    record("CDP connection", "fail", health.error || "not connected on the debug port");
    record(
      "hint",
      "fail",
      "Launch TradingView with scripts/launch_tv_debug_<os> first, then re-run."
    );
    return;
  }
  record("CDP connection", "pass", health.target?.title || "connected");
  if (!health.tradingview_window) {
    record("TradingView window", "warn", "connected to CDP but no tradingview.com page found");
  }

  // 2. Read the symbol we start on.
  const startSym = await getActiveSymbol().catch((e) => `ERROR: ${e.message}`);
  record(
    "getActiveSymbol",
    startSym && !/^ERROR/.test(startSym) ? "pass" : "fail",
    String(startSym)
  );

  // 3. Switch symbol and confirm it took.
  let switched = null;
  try {
    switched = await setSymbol(SYMBOL);
    const ok = (switched.active || "")
      .toUpperCase()
      .includes(SYMBOL.split(":").pop().toUpperCase());
    record("setSymbol", ok ? "pass" : "warn", `requested ${SYMBOL}, active "${switched.active}"`);
  } catch (e) {
    record("setSymbol", "fail", e.message);
  }

  // 4. Timeframe.
  try {
    await setTimeframe(TIMEFRAME);
    record("setTimeframe", "pass", `set ${TIMEFRAME} (visually confirm the chart changed)`);
  } catch (e) {
    record("setTimeframe", "fail", e.message);
  }

  // 5. Read the latest bar — the core legend scrape.
  const quote = await readQuote().catch((e) => ({ error: e.message }));
  const haveOHLC = quote && quote.open != null && quote.close != null;
  record(
    "readQuote (legend OHLC)",
    haveOHLC ? "pass" : "fail",
    haveOHLC ? `O${quote.open} H${quote.high} L${quote.low} C${quote.close}` : JSON.stringify(quote)
  );

  // 6. Add an indicator, then confirm it shows up in the legend.
  try {
    await manageIndicator({ name: INDICATOR, action: "add" });
    record("manageIndicator add", "pass", `requested "${INDICATOR}"`);
  } catch (e) {
    record("manageIndicator add", "fail", e.message);
  }
  const inds = await readIndicatorValues().catch((e) => [{ error: e.message }]);
  const found =
    Array.isArray(inds) && inds.some((i) => /relative strength|rsi/i.test(i.title || ""));
  record(
    "readIndicatorValues",
    Array.isArray(inds) && inds.length ? (found ? "pass" : "warn") : "fail",
    Array.isArray(inds)
      ? inds.map((i) => i.title).join(", ") || "empty legend"
      : JSON.stringify(inds)
  );

  // 7. Candle series — expected best-effort (likely available:false).
  const candles = await readCandles(10).catch((e) => ({ available: false, reason: e.message }));
  record(
    "readCandles (best effort)",
    candles.available ? "pass" : "warn",
    candles.available ? `${candles.count} bars` : `available:false — ${candles.reason}`
  );
}

try {
  await run();
} finally {
  await closeClient();
}

const fails = results.filter((r) => r.status === "fail").length;
const warns = results.filter((r) => r.status === "warn").length;

if (JSON_OUT) {
  console.log(
    JSON.stringify({ summary: { fails, warns, total: results.length }, results }, null, 2)
  );
} else {
  console.log(`\nSummary: ${results.length} steps, ${fails} fail, ${warns} warn.`);
  if (fails) {
    console.log(
      "Failures usually mean a DOM selector in src/tradingview.js needs updating, " +
        "or a keyboard flow/timing needs tuning. Paste this output to your agent to fix."
    );
  }
}
process.exitCode = fails > 0 ? 1 : 0;
