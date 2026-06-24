import { test } from "node:test";
import assert from "node:assert/strict";

import {
  setSymbol,
  setTimeframe,
  manageIndicator,
  readQuote,
  readIndicatorValues,
  getActiveSymbol,
  applyStrategyToSymbol,
  strategyIndicatorNames,
} from "../src/tradingview.js";
import { createFakeIO } from "./helpers/fake-io.js";

test("setSymbol types the ticker, presses Enter, and reads back the active symbol", async () => {
  const io = createFakeIO({ symbol: "NASDAQ:AAPL" });
  const res = await setSymbol("NASDAQ:AAPL", io);
  assert.deepEqual(io.typed(), ["NASDAQ:AAPL"]);
  assert.deepEqual(io.keys(), ["Enter"]);
  assert.deepEqual(res, { requested: "NASDAQ:AAPL", active: "NASDAQ:AAPL" });
});

test("setSymbol rejects an empty symbol", async () => {
  const io = createFakeIO();
  await assert.rejects(() => setSymbol("", io), /requires a symbol/);
});

test("setTimeframe types the interval and presses Enter", async () => {
  const io = createFakeIO();
  const res = await setTimeframe("15", io);
  assert.deepEqual(io.typed(), ["15"]);
  assert.deepEqual(io.keys(), ["Enter"]);
  assert.deepEqual(res, { timeframe: "15" });
});

test("manageIndicator add opens the dialog, types the full name, accepts and closes", async () => {
  const io = createFakeIO();
  const res = await manageIndicator({ name: "RSI", action: "add" }, io);
  // "/" opens the dialog, then the resolved full name is typed.
  assert.deepEqual(io.typed(), ["/", "Relative Strength Index"]);
  assert.deepEqual(io.keys(), ["Enter", "Escape"]);
  assert.deepEqual(res, { action: "add", indicator: "Relative Strength Index", applied: true });
});

test("manageIndicator remove makes no keystrokes and reports unsupported", async () => {
  const io = createFakeIO();
  const res = await manageIndicator({ name: "MACD", action: "remove" }, io);
  assert.deepEqual(io.typed(), []);
  assert.deepEqual(io.keys(), []);
  assert.equal(res.applied, false);
  assert.match(res.note, /isn't supported/);
});

test("manageIndicator throws on an unknown action", async () => {
  const io = createFakeIO();
  await assert.rejects(
    () => manageIndicator({ name: "RSI", action: "flip" }, io),
    /Unknown indicator action/
  );
});

test("read helpers return the canned chart data", async () => {
  const quote = { open: 1, high: 2, low: 0.5, close: 1.5, change: null, raw: "x" };
  const indicators = [{ title: "RSI 14", values: [55] }];
  const io = createFakeIO({ symbol: "BITSTAMP:BTCUSD", quote, indicators });
  assert.equal(await getActiveSymbol(io), "BITSTAMP:BTCUSD");
  assert.deepEqual(await readQuote(io), quote);
  assert.deepEqual(await readIndicatorValues(io), indicators);
});

test("strategyIndicatorNames expands each instance (object form)", () => {
  const names = strategyIndicatorNames({
    indicators: { ema: [{ length: 20 }, { length: 50 }], rsi: [{ length: 14 }] },
  });
  assert.deepEqual(names, ["ema", "ema", "rsi"]);
});

test("strategyIndicatorNames handles array form", () => {
  const names = strategyIndicatorNames({ indicators: [{ name: "RSI" }, { type: "MACD" }] });
  assert.deepEqual(names, ["RSI", "MACD"]);
});

test("applyStrategyToSymbol switches symbol, sets timeframe, and adds every indicator", async () => {
  const io = createFakeIO({ symbol: "BITSTAMP:ETHUSD" });
  const rules = {
    default_timeframe: "D",
    indicators: { ema: [{ length: 20 }, { length: 50 }], rsi: [{ length: 14 }] },
  };
  const res = await applyStrategyToSymbol("BITSTAMP:ETHUSD", rules, io);

  // symbol typed, timeframe typed, then "/" + name for each of the 3 indicators.
  assert.deepEqual(io.typed(), [
    "BITSTAMP:ETHUSD",
    "D",
    "/",
    "Moving Average Exponential",
    "/",
    "Moving Average Exponential",
    "/",
    "Relative Strength Index",
  ]);
  assert.equal(res.indicators.length, 3);
  assert.ok(res.indicators.every((i) => i.applied));
});
