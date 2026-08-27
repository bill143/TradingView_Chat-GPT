import { test } from "node:test";
import assert from "node:assert/strict";

import { classify, morningBrief } from "../src/brief.js";
import { createFakeIO } from "./helpers/fake-io.js";

test("classify is bullish when candle up, RSI high, price above MA", () => {
  const quote = { open: 100, high: 110, low: 99, close: 108 };
  const indicators = [
    { title: "Relative Strength Index 14", values: [62] },
    { title: "Moving Average Exponential 50", values: [101] },
  ];
  const { bias, score } = classify(quote, indicators);
  assert.equal(bias, "bullish");
  assert.ok(score >= 2);
});

test("classify is bearish when candle down, RSI low, price below MA", () => {
  const quote = { open: 108, high: 109, low: 95, close: 96 };
  const indicators = [
    { title: "Relative Strength Index 14", values: [38] },
    { title: "Moving Average Exponential 50", values: [101] },
  ];
  const { bias, score } = classify(quote, indicators);
  assert.equal(bias, "bearish");
  assert.ok(score <= -2);
});

test("classify is neutral with conflicting / weak signals", () => {
  const quote = { open: 100, high: 101, low: 99, close: 101 }; // mildly up (+1)
  const indicators = [
    { title: "Relative Strength Index 14", values: [50] }, // neutral
  ];
  const { bias } = classify(quote, indicators);
  assert.equal(bias, "neutral");
});

test("classify tolerates missing data without throwing", () => {
  assert.doesNotThrow(() => classify(null, null));
  const { bias, reasons } = classify({ open: null, close: null }, []);
  assert.equal(bias, "neutral");
  assert.deepEqual(reasons, []);
});

test("classify reasons explain the score", () => {
  const quote = { open: 100, high: 110, low: 99, close: 108 };
  const { reasons } = classify(quote, [{ title: "RSI", values: [70] }]);
  assert.ok(reasons.some((r) => /candle closed up/.test(r)));
  assert.ok(reasons.some((r) => /RSI/.test(r)));
});

test("classify factors MACD histogram direction", () => {
  const quote = { open: 100, high: 101, low: 99, close: 100.5 }; // mildly up (+1)
  const up = classify(quote, [{ title: "MACD 12 26 9", values: [1.0, 0.5, 0.5] }]);
  assert.ok(up.reasons.some((r) => /MACD histogram positive/.test(r)));
  assert.equal(up.bias, "bullish"); // +1 candle, +1 macd

  const down = classify(quote, [{ title: "MACD 12 26 9", values: [-1.0, -0.5, -0.5] }]);
  assert.ok(down.reasons.some((r) => /MACD histogram negative/.test(r)));
});

test("classify reports ADX/ATR as context, not direction", () => {
  const quote = { open: 100, high: 101, low: 99, close: 100.5 };
  const { context } = classify(quote, [
    { title: "Average Directional Index 14", values: [30] },
    { title: "Average True Range 14", values: [2.4] },
  ]);
  assert.equal(context.trend_strength, "strong");
  assert.equal(context.atr, 2.4);
});

test("classify evaluates structured bias_criteria from rules", () => {
  const quote = { open: 100, high: 110, low: 99, close: 108 };
  const indicators = [{ title: "Relative Strength Index 14", values: [62] }];
  const rules = {
    bias_criteria: {
      bullish: [{ indicator: "rsi", op: ">=", value: 55 }, "narrative kept"],
      bearish: [{ indicator: "rsi", op: "<", value: 30 }],
    },
  };
  const res = classify(quote, indicators, rules);
  assert.ok(res.reasons.some((r) => /bullish criterion met/.test(r)));
  assert.equal(res.criteria.bullish.length, 2);
  assert.equal(res.criteria.bearish[0].status, "unmet");
  assert.equal(res.bias, "bullish");
});

test("morningBrief walks the watchlist and returns a bias per symbol", async () => {
  const io = createFakeIO({
    symbol: "BITSTAMP:BTCUSD",
    quote: { open: 100, high: 110, low: 99, close: 108, change: null, raw: "x" },
    indicators: [
      { title: "Relative Strength Index 14", values: [62] },
      { title: "Moving Average Exponential 50", values: [101] },
    ],
  });
  const rules = { default_timeframe: "D", watchlist: ["BITSTAMP:BTCUSD", "NASDAQ:AAPL"] };
  const brief = await morningBrief(rules, io);

  assert.equal(brief.items.length, 2);
  assert.equal(brief.timeframe, "D");
  for (const item of brief.items) {
    assert.equal(item.bias, "bullish");
    assert.ok(item.key_level.recent_high === 110);
    assert.ok(item.reasons.length > 0);
  }
});

test("morningBrief records an error entry when a symbol read fails", async () => {
  const io = createFakeIO({ quote: { open: 1, high: 2, low: 0, close: 1, raw: "x" } });
  // Force readQuote to throw for this run.
  io.evaluate = async () => {
    throw new Error("legend not found");
  };
  const brief = await morningBrief({ default_timeframe: "D", watchlist: ["X:Y"] }, io);
  assert.equal(brief.items.length, 1);
  assert.match(brief.items[0].error, /legend not found/);
});
