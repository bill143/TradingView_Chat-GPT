// High-level operations against the live TradingView chart.
//
// Two kinds of operation:
//   1. READS  – pull data out of the page with Runtime.evaluate (DOM scrape).
//   2. WRITES – drive the UI with synthesised keystrokes (symbol/timeframe/
//               indicator changes), exactly as a human would type them.
//
// All functions take an injectable `io` (the CDP interface) as their last
// argument, defaulting to the real connection. Tests pass a fake `io` to drive
// the logic against a simulated chart without a running TradingView.
//
// NOTE ON FRAGILITY: TradingView ships UI changes regularly and its internal
// chart model is not a public API. The selectors below target the on-chart
// legend, which is the most stable place to read the current bar's OHLC. If a
// future TradingView build moves these, update the selectors in `readQuote`.

import * as cdp from "./cdp.js";
import { resolveIndicatorName } from "./indicators.js";
import { SETTLE_MS } from "./config.js";

// The default I/O surface: the real CDP connection.
export const defaultIO = {
  evaluate: cdp.evaluate,
  pressKey: cdp.pressKey,
  typeString: cdp.typeString,
  sleep: cdp.sleep,
};

/**
 * The currently displayed symbol, read from the document title / legend.
 */
export async function getActiveSymbol(io = defaultIO) {
  return io.evaluate(`
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
export async function readQuote(io = defaultIO) {
  return io.evaluate(`
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
export async function readIndicatorValues(io = defaultIO) {
  return io.evaluate(`
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
 * Normalise whatever the in-page candle probe returns into a stable shape.
 * Pure (no I/O) so it can be unit-tested.
 */
export function normalizeCandles(raw) {
  if (raw == null) return { available: false, reason: "no data returned from the chart" };
  if (raw.available === false) {
    return { available: false, reason: raw.reason || "candle data not available" };
  }
  const arr = Array.isArray(raw) ? raw : Array.isArray(raw.candles) ? raw.candles : null;
  if (!arr) return { available: false, reason: "unrecognised candle payload" };

  const n = (x) => (typeof x === "number" && !Number.isNaN(x) ? x : null);
  const candles = arr
    .map((c) => ({
      time: c.time ?? c.t ?? null,
      open: n(c.open ?? c.o),
      high: n(c.high ?? c.h),
      low: n(c.low ?? c.l),
      close: n(c.close ?? c.c),
      volume: n(c.volume ?? c.v),
    }))
    .filter((c) => c.open != null && c.close != null);

  return { available: true, count: candles.length, source: raw.source || "chart", candles };
}

/**
 * Best-effort read of the recent candle series.
 *
 * IMPORTANT: TradingView Desktop does not expose its chart data model as a
 * public API, so this probes for a series and otherwise reports
 * `available: false` rather than inventing data. The normalisation is solid and
 * tested; the in-page extraction is the part that needs validating against a
 * live build (and may need updating when a working hook is identified).
 *
 * @param {number} count how many recent bars to request
 */
export async function readCandles(count = 50, io = defaultIO) {
  const raw = await io.evaluate(`
    // candle-series probe — returns {available:false} until a stable hook is found.
    const want = ${Number(count) || 50};
    try {
      // Some embeds expose a widget API; the desktop app generally does not.
      const api = window.TradingViewApi || (window.tvWidget && window.tvWidget.activeChart && window.tvWidget);
      if (api && typeof api.exportData === 'function') {
        // Placeholder for a verified extraction path.
        return { available: false, reason: 'export hook present but extraction not yet implemented', source: 'tvWidget' };
      }
      return { available: false, reason: 'no chart data hook exposed by TradingView Desktop; only the latest bar (chart_read) is reliably available', want };
    } catch (e) {
      return { available: false, reason: String(e && e.message || e) };
    }
  `);
  return normalizeCandles(raw);
}

/**
 * Switch the active chart to a new symbol. TradingView opens its symbol search
 * as soon as you start typing on the chart; we type the ticker and hit Enter to
 * accept the top match.
 *
 * @param {string} symbol e.g. "BITSTAMP:BTCUSD" or "NASDAQ:AAPL"
 */
export async function setSymbol(symbol, io = defaultIO) {
  if (!symbol) throw new Error("setSymbol requires a symbol");
  await io.typeString(symbol);
  await io.sleep(600); // let the search results populate
  await io.pressKey("Enter");
  await io.sleep(SETTLE_MS);
  const active = await getActiveSymbol(io);
  return { requested: symbol, active };
}

/**
 * Change the chart timeframe. TradingView accepts the interval typed directly
 * (e.g. "15" then Enter, "D" then Enter).
 *
 * @param {string} timeframe one of 1,3,5,15,30,60,120,240,D,W,M
 */
export async function setTimeframe(timeframe, io = defaultIO) {
  if (!timeframe) throw new Error("setTimeframe requires a timeframe");
  await io.typeString(String(timeframe));
  await io.pressKey("Enter");
  await io.sleep(SETTLE_MS);
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
 * @param {object} [opts.params] requested parameters, e.g. { length: 50 }
 */
export async function manageIndicator({ name, action = "add", params = null }, io = defaultIO) {
  const full = resolveIndicatorName(name);
  const hasParams = params && Object.keys(params).length > 0;

  if (action === "add") {
    // Open the "Indicators, metrics & strategies" dialog. The default shortcut
    // is "/" on the chart. We then type the indicator name and accept.
    await io.typeString("/");
    await io.sleep(700);
    await io.typeString(full);
    await io.sleep(900);
    await io.pressKey("Enter");
    await io.sleep(400);
    await io.pressKey("Escape"); // close the dialog, leaving the indicator applied
    await io.sleep(SETTLE_MS);

    const result = { action, indicator: full, applied: true };
    if (hasParams) {
      // The add-indicator dialog only applies an indicator with its DEFAULT
      // inputs — there's no stable keyboard path to set a specific length from
      // here. Surface the requested params honestly so the agent can tell the
      // user what still needs setting in the indicator's settings dialog.
      result.requested_params = params;
      result.params_applied = false;
      result.note =
        "Applied with default settings. Set " +
        Object.entries(params)
          .map(([k, v]) => `${k}=${v}`)
          .join(", ") +
        " in the indicator's settings dialog (double-click it in the legend).";
    }
    return result;
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
 * Expand a strategy's `indicators` block into [{ name, params }] in apply
 * order. Object form expands each instance (EMA 20 + EMA 50 = two entries, each
 * carrying its own params); array form passes name + the entry as params.
 */
export function strategyIndicators(rules) {
  const indicators = rules.indicators || {};
  if (Array.isArray(indicators)) {
    return indicators.map((i) => {
      if (typeof i === "string") return { name: i, params: {} };
      const { name, type, ...params } = i;
      return { name: name || type, params };
    });
  }
  return Object.entries(indicators).flatMap(([key, val]) => {
    if (Array.isArray(val)) return val.map((cfg) => ({ name: key, params: cfg || {} }));
    return [{ name: key, params: typeof val === "object" ? val : {} }];
  });
}

/**
 * Names only — kept for callers/tests that just want the apply order.
 */
export function strategyIndicatorNames(rules) {
  return strategyIndicators(rules).map((i) => i.name);
}

/**
 * Apply a whole strategy (from rules.json) across a single symbol: switch
 * symbol, set timeframe, add every indicator (with its requested params).
 */
export async function applyStrategyToSymbol(symbol, rules, io = defaultIO) {
  const result = { symbol, indicators: [] };
  await setSymbol(symbol, io);
  await setTimeframe(rules.default_timeframe, io);

  for (const { name, params } of strategyIndicators(rules)) {
    const r = await manageIndicator({ name, action: "add", params }, io);
    result.indicators.push(r);
  }
  return result;
}
