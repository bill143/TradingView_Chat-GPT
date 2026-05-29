// High-level operations against the live TradingView chart.
//
// Two kinds of operation:
//   1. READS  – pull data out of the page with Runtime.evaluate (DOM scrape).
//   2. WRITES – drive the UI with synthesised keystrokes (symbol/timeframe/
//               indicator changes), exactly as a human would type them.
//
// NOTE ON FRAGILITY: TradingView ships UI changes regularly and its internal
// chart model is not a public API. The selectors below target the on-chart
// legend, which is the most stable place to read the current bar's OHLC. If a
// future TradingView build moves these, update the selectors in `readQuote`.

import { evaluate, pressKey, typeString, sleep } from "./cdp.js";
import { resolveIndicatorName } from "./indicators.js";
import { SETTLE_MS } from "./config.js";

/**
 * The currently displayed symbol, read from the document title / legend.
 */
export async function getActiveSymbol() {
  return evaluate(`
    // The page title is usually "<PRICE> <SYMBOL> ..." on TradingView.
    const legend = document.querySelector('[data-name="legend-source-title"]');
    if (legend && legend.textContent) return legend.textContent.trim();
    return document.title.trim();
  `);
}

/**
 * Read the latest bar's OHLC (+ change) from the on-chart legend.
 * Returns null fields when the legend can't be parsed.
 */
export async function readQuote() {
  return evaluate(`
    const out = { open: null, high: null, low: null, close: null, change: null, raw: null };
    const items = document.querySelectorAll('[data-name="legend-source-item"] [class*="valueValue"]');
    // The OHLC legend renders four values in order O H L C.
    const nums = Array.from(items)
      .map(el => parseFloat((el.textContent || '').replace(/[^0-9eE.\\-]/g, '')))
      .filter(n => !Number.isNaN(n));
    if (nums.length >= 4) {
      out.open = nums[0]; out.high = nums[1]; out.low = nums[2]; out.close = nums[3];
    }
    out.raw = document.querySelector('[data-name="legend-source-item"]')?.textContent?.trim() || null;
    return out;
  `);
}

/**
 * Read every indicator currently shown in the legend, with its displayed
 * values. Returns e.g. [{ title: "RSI 14", values: [48.2] }, ...].
 */
export async function readIndicatorValues() {
  return evaluate(`
    const out = [];
    const sources = document.querySelectorAll('[data-name="legend-source-item"]');
    for (const src of sources) {
      const title = src.querySelector('[data-name="legend-source-title"]')?.textContent?.trim()
        || src.textContent?.trim()?.split('\\n')[0] || null;
      const values = Array.from(src.querySelectorAll('[class*="valueValue"]'))
        .map(el => parseFloat((el.textContent || '').replace(/[^0-9eE.\\-]/g, '')))
        .filter(n => !Number.isNaN(n));
      if (title) out.push({ title, values });
    }
    return out;
  `);
}

/**
 * Switch the active chart to a new symbol. TradingView opens its symbol search
 * as soon as you start typing on the chart; we type the ticker and hit Enter to
 * accept the top match.
 *
 * @param {string} symbol e.g. "BITSTAMP:BTCUSD" or "NASDAQ:AAPL"
 */
export async function setSymbol(symbol) {
  if (!symbol) throw new Error("setSymbol requires a symbol");
  await typeString(symbol);
  await sleep(600); // let the search results populate
  await pressKey("Enter");
  await sleep(SETTLE_MS);
  const active = await getActiveSymbol();
  return { requested: symbol, active };
}

/**
 * Change the chart timeframe. TradingView accepts the interval typed directly
 * (e.g. "15" then Enter, "D" then Enter).
 *
 * @param {string} timeframe one of 1,3,5,15,30,60,120,240,D,W,M
 */
export async function setTimeframe(timeframe) {
  if (!timeframe) throw new Error("setTimeframe requires a timeframe");
  await typeString(String(timeframe));
  await pressKey("Enter");
  await sleep(SETTLE_MS);
  return { timeframe };
}

/**
 * Add or remove an indicator on the current chart.
 *
 * Adding: open the indicators dialog ("/" focuses the symbol-search style box
 * in recent builds; the explicit dialog is opened with the toolbar). We open
 * the Indicators dialog via its keyboard shortcut, type the full indicator
 * name, and select the first match.
 *
 * @param {object} opts
 * @param {string} opts.name   indicator name (short or full)
 * @param {"add"|"remove"} opts.action
 */
export async function manageIndicator({ name, action = "add" }) {
  const full = resolveIndicatorName(name);

  if (action === "add") {
    // Open the "Indicators, metrics & strategies" dialog. The default shortcut
    // is "/" on the chart. We then type the indicator name and accept.
    await typeString("/");
    await sleep(700);
    await typeString(full);
    await sleep(900);
    await pressKey("Enter");
    await sleep(400);
    await pressKey("Escape"); // close the dialog, leaving the indicator applied
    await sleep(SETTLE_MS);
    return { action, indicator: full, applied: true };
  }

  if (action === "remove") {
    // Removal is per-instance and must be done from the legend's context menu,
    // which has no stable keyboard path. Surface this clearly rather than
    // pretending it worked.
    return {
      action,
      indicator: full,
      applied: false,
      note:
        "Programmatic indicator removal isn't supported via keyboard shortcuts; " +
        "remove it from the chart legend manually, or reset the layout.",
    };
  }

  throw new Error(`Unknown indicator action: ${action}`);
}

/**
 * Apply a whole strategy (from rules.json) across a single symbol: switch
 * symbol, set timeframe, add every indicator.
 */
export async function applyStrategyToSymbol(symbol, rules) {
  const result = { symbol, indicators: [] };
  await setSymbol(symbol);
  await setTimeframe(rules.default_timeframe);

  const indicators = rules.indicators || {};
  const names = Array.isArray(indicators)
    ? indicators.map((i) => i.name || i.type || i)
    : Object.entries(indicators).flatMap(([key, val]) =>
        Array.isArray(val) ? val.map(() => key) : [key]
      );

  for (const name of names) {
    const r = await manageIndicator({ name, action: "add" });
    result.indicators.push(r);
  }
  return result;
}
