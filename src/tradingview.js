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
// chart model is not a public API. These selectors were reverse-engineered
// against TradingView Desktop 3.2.0 by inspecting the live DOM over CDP
// (see docs/LIVE_VERIFICATION.md). They mix two kinds of selector:
//
//   * STABLE anchors that survive rebuilds: the legend container carries the
//     BEM-style class `chart-gui-wrapper__legend`, and the header symbol button
//     has the id `header-toolbar-symbol-search`. Prefer these.
//   * HASHED, BUILD-SPECIFIC classes like `series-YTFIJ62h` / `valueValue-…` /
//     `title-…`. The hash suffix changes between TradingView releases, so we
//     match on the prefix with `[class*="series-"]` etc. This is inherently
//     fragile — if reads come back empty, re-inspect the DOM and update the
//     prefixes here rather than inventing values.
//
// Each read expression carries a `/*MARK:…*/` comment so the fake I/O in tests
// can route it without coupling to the exact selector strings.

import * as cdp from "./cdp.js";
import { resolveIndicatorName } from "./indicators.js";
import { SETTLE_MS, SYMBOL_CONFIRM_TRIES, SYMBOL_CONFIRM_MS, DIALOG_SETTLE_MS } from "./config.js";

// The default I/O surface: the real CDP connection.
export const defaultIO = {
  evaluate: cdp.evaluate,
  pressKey: cdp.pressKey,
  typeString: cdp.typeString,
  sleep: cdp.sleep,
  click: cdp.click,
  clickAt: cdp.clickAt,
};

// Stable selectors for the clickable controls we can't drive by keyboard.
const SEL_SYMBOL_BUTTON = "#header-toolbar-symbol-search";
const SEL_OPEN_INDICATORS = '[data-name="open-indicators-dialog"]';
const SEL_INDICATORS_DIALOG = '[data-name="indicators-dialog"]';

// Day/Week/Month must be typed digit-first or TradingView routes the keystroke
// to symbol search instead of the interval input. See setTimeframe.
const TF_KEYBOARD = { D: "1D", W: "1W", M: "1M" };

/**
 * The currently displayed symbol's ticker, e.g. "BTCUSD".
 *
 * Source of truth is the header symbol-search button (`#header-toolbar-symbol-
 * search`), whose inner `value-…` span holds the ticker. We fall back to the
 * on-chart legend's series title (which shows the *description*, e.g. "Bitcoin /
 * U.S. Dollar", on this build) and finally the page title.
 */
export async function getActiveSymbol(io = defaultIO) {
  return io.evaluate(`
    /*MARK:active*/
    // De-double guard: on some (broken-symbol) states TradingView renders the
    // legend title with every character duplicated. Only collapse when the
    // string is *exactly* its first half repeated, so real tickers are untouched.
    const deDouble = (s) => {
      if (!s || s.length % 2) return s;
      for (let i = 0; i < s.length; i += 2) if (s[i] !== s[i + 1]) return s;
      let r = ""; for (let i = 0; i < s.length; i += 2) r += s[i]; return r;
    };
    const btn = document.getElementById('header-toolbar-symbol-search');
    if (btn) {
      const v = btn.querySelector('[class*="value-"]') || btn;
      const t = deDouble((v.textContent || '').trim());
      if (t) return t;
    }
    const legend = document.querySelector('.chart-gui-wrapper__legend');
    const st = legend && legend.querySelector('[class*="series-"] [class*="title-"]');
    if (st && st.textContent.trim()) return deDouble(st.textContent.trim());
    return document.title.trim();
  `);
}

/**
 * Read the latest bar's OHLC (+ change) from the on-chart legend.
 *
 * The price series row (`[class*="series-"]` inside `.chart-gui-wrapper__legend`)
 * renders each value as a labelled `valueItem-…`, e.g. "O60,772", "H60,772",
 * "L60,707", "C60,717". We parse by the leading O/H/L/C label rather than by
 * position, because the row also contains hidden duplicates, a volume cell and
 * two change cells whose order isn't guaranteed. Returns null fields when the
 * legend can't be parsed (e.g. an invalid symbol shows "∅").
 */
export async function readQuote(io = defaultIO) {
  return io.evaluate(`
    /*MARK:quote*/
    const out = { open: null, high: null, low: null, close: null, change: null, raw: null };
    // Pull the first number out of a cell, honouring TradingView's unicode minus,
    // thousands separators, and K/M/B magnitude suffixes (the legend abbreviates
    // large values, e.g. "Vol44.88 K"). Dropping the suffix would silently
    // mis-read a high-priced symbol by 1000x, so we multiply it back in.
    const num = (s) => {
      const str = String(s).replace(/\\u2212/g, '-').replace(/,/g, '');
      const m = str.match(/-?\\d+(?:\\.\\d+)?/);
      if (!m) return null;
      let n = parseFloat(m[0]);
      const suf = (str.slice(m.index + m[0].length).match(/[KMB]/i) || [])[0];
      if (suf) n *= { K: 1e3, M: 1e6, B: 1e9 }[suf.toUpperCase()];
      return n;
    };
    const legend = document.querySelector('.chart-gui-wrapper__legend');
    const series = legend && legend.querySelector('[class*="series-"]');
    if (!series) return out;
    for (const it of series.querySelectorAll('[class*="valueItem-"]')) {
      const t = (it.textContent || '').trim();
      // Values are labelled by a leading O/H/L/C; parse by label, not position,
      // because the row also holds a hidden close duplicate, volume and two
      // change cells whose order isn't guaranteed.
      if (t[0] === 'O') out.open = num(t.slice(1));
      else if (t[0] === 'H') out.high = num(t.slice(1));
      else if (t[0] === 'L') out.low = num(t.slice(1));
      else if (t[0] === 'C') out.close = num(t.slice(1));
      // First "(…%)" cell that isn't volume is the absolute change.
      else if (out.change === null && /\\(.*%\\)/.test(t) && !/^Vol/i.test(t)) out.change = num(t);
    }
    out.raw = (series.textContent || '').trim().slice(0, 120) || null;
    return out;
  `);
}

/**
 * Read every indicator currently shown in any pane's legend, with its displayed
 * values. Returns e.g. [{ title: "Relative Strength Index 14", values: [48.2] }].
 *
 * Oscillators (RSI, Squeeze Momentum, …) render in their own sub-pane, each with
 * its own `.chart-gui-wrapper__legend`, so we iterate ALL legends — not just the
 * main price pane — and pick up the study rows (`[class*="study-"]`). Values
 * collapse to "∅" when the crosshair isn't over a bar, so an empty `values`
 * array is normal and not an error.
 */
export async function readIndicatorValues(io = defaultIO) {
  return io.evaluate(`
    /*MARK:indicators*/
    const deDouble = (s) => {
      if (!s || s.length % 2) return s;
      for (let i = 0; i < s.length; i += 2) if (s[i] !== s[i + 1]) return s;
      let r = ""; for (let i = 0; i < s.length; i += 2) r += s[i]; return r;
    };
    const num = (s) => {
      const str = String(s).replace(/\\u2212/g, '-').replace(/,/g, '');
      const m = str.match(/-?\\d+(?:\\.\\d+)?/);
      if (!m) return null;
      let n = parseFloat(m[0]);
      const suf = (str.slice(m.index + m[0].length).match(/[KMB]/i) || [])[0];
      if (suf) n *= { K: 1e3, M: 1e6, B: 1e9 }[suf.toUpperCase()];
      return n;
    };
    const out = [];
    for (const legend of document.querySelectorAll('.chart-gui-wrapper__legend')) {
      for (const row of legend.querySelectorAll('[class*="study-"]')) {
        const te = row.querySelector('[class*="title-"]');
        const title = te ? deDouble(te.textContent.trim()) : null;
        const values = Array.from(row.querySelectorAll('[class*="valueValue-"]'))
          .map(el => num((el.textContent || '').trim()))
          .filter(n => n !== null);
        if (title) out.push({ title, values });
      }
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
  // Open the symbol search by clicking the header button. This is deterministic
  // — relying on "type a letter to open search" races the dialog mount and
  // drops early keystrokes.
  await io.click(SEL_SYMBOL_BUTTON);
  await io.sleep(DIALOG_SETTLE_MS);
  await io.typeString(symbol);
  await io.sleep(600); // let the search results populate
  await io.pressKey("Enter");
  await io.sleep(SETTLE_MS);

  // Confirm the switch took. The header button shows the bare ticker (e.g.
  // "BTCUSD") while we may have requested "BITSTAMP:BTCUSD", so match on the
  // ticker portion. TradingView can take a beat to repaint the header after
  // accepting the search result, so poll a few times before giving up rather
  // than reading once and reporting a stale symbol.
  const ticker = symbol.split(":").pop().toUpperCase();
  let active = await getActiveSymbol(io);
  for (let i = 0; i < SYMBOL_CONFIRM_TRIES && !(active || "").toUpperCase().includes(ticker); i++) {
    await io.sleep(SYMBOL_CONFIRM_MS);
    active = await getActiveSymbol(io);
  }
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
  // TradingView's quick interval entry only opens on a DIGIT keystroke. A bare
  // letter (D/W/M) instead opens the symbol search, so typing "D" would change
  // the SYMBOL to ticker "D" (Dominion Energy) rather than the daily interval —
  // exactly the bug this guards against. Map day/week/month to their digit-first
  // forms (1D/1W/1M) so they always land on the interval input.
  const keys = TF_KEYBOARD[String(timeframe).toUpperCase()] || String(timeframe);
  await io.typeString(keys);
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
    // Open the "Indicators, metrics & strategies" dialog by CLICKING the toolbar
    // button. The old "/" hotkey opens the SYMBOL search on this build, so the
    // name was being typed as a ticker — never as an indicator. Then type the
    // name, click the first matching result row, and Escape out of the dialog.
    await io.click(SEL_OPEN_INDICATORS);
    await io.sleep(DIALOG_SETTLE_MS);
    await io.typeString(full);
    await io.sleep(DIALOG_SETTLE_MS); // let the result list filter
    const coords = await io.evaluate(`
      /*MARK:clickresult*/
      const dlg = document.querySelector(${JSON.stringify(SEL_INDICATORS_DIALOG)});
      if (!dlg) return null;
      const name = ${JSON.stringify(full.toLowerCase())};
      const rows = Array.from(dlg.querySelectorAll('[class*="container-"]'))
        .filter(e => (e.textContent || '').trim().toLowerCase().startsWith(name));
      if (!rows.length) return null;
      const r = rows[0].getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    `);
    if (coords) await io.clickAt(coords.x, coords.y);
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
