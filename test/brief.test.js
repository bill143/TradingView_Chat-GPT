import { test } from "node:test";
import assert from "node:assert/strict";

import { classify } from "../src/brief.js";

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
