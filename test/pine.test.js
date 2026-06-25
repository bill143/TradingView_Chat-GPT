import { test } from "node:test";
import assert from "node:assert/strict";

import { parsePine, mergePineIntoRules } from "../src/pine.js";
import { normaliseRules } from "../src/rules.js";

const SAMPLE = `
//@version=5
strategy("EMA Cross + RSI", overlay=true)

// inputs
fast = ta.ema(close, 20)
slow = ta.ema(close, 50)
r = ta.rsi(close, 14)
[macdLine, signalLine, hist] = ta.macd(close, 12, 26, 9)
atr = ta.atr(14)

longCond = ta.crossover(fast, slow) and r > 50
if (longCond)
    strategy.entry("Long", strategy.long)

if (ta.crossunder(fast, slow))
    strategy.close("Long")

alertcondition(longCond, "Long alert", "Go long")
// a comment mentioning ema(999) that must be ignored
`;

test("parsePine extracts name and type", () => {
  const p = parsePine(SAMPLE);
  assert.equal(p.type, "strategy");
  assert.equal(p.name, "EMA Cross + RSI");
});

test("parsePine extracts indicators with lengths, deduped", () => {
  const p = parsePine(SAMPLE);
  const byKey = p.indicators.map((i) => `${i.fn}:${i.length}`);
  assert.ok(byKey.includes("ema:20"));
  assert.ok(byKey.includes("ema:50"));
  assert.ok(byKey.includes("rsi:14"));
  assert.ok(byKey.includes("macd:12"));
  assert.ok(byKey.includes("atr:14"));
  // The two EMAs have different lengths so both are kept (not collapsed).
  assert.equal(p.indicators.filter((i) => i.fn === "ema").length, 2);
});

test("parsePine ignores tokens inside comments and strings", () => {
  const p = parsePine(SAMPLE);
  assert.ok(!p.indicators.some((i) => i.length === 999));
});

test("parsePine captures entries, exits, and alerts", () => {
  const p = parsePine(SAMPLE);
  assert.equal(p.entries.length, 1);
  assert.match(p.entries[0], /strategy\.entry/);
  assert.equal(p.exits.length, 1);
  assert.match(p.exits[0], /strategy\.close/);
  assert.equal(p.alerts.length, 1);
});

test("parsePine handles v4-style bare function calls", () => {
  const v4 = `study("X")\na = ema(close, 9)\nb = rsi(close, 7)`;
  const p = parsePine(v4);
  assert.equal(p.type, "indicator");
  assert.ok(p.indicators.some((i) => i.fn === "ema" && i.length === 9));
  assert.ok(p.indicators.some((i) => i.fn === "rsi" && i.length === 7));
});

test("parsePine returns unknown type for non-Pine input without throwing", () => {
  const p = parsePine("just some text");
  assert.equal(p.type, "unknown");
  assert.deepEqual(p.indicators, []);
});

test("mergePineIntoRules folds indicators and metadata into rules", () => {
  const parsed = parsePine(SAMPLE);
  const merged = normaliseRules(mergePineIntoRules(normaliseRules({}), parsed, "pine/x.pine"));
  assert.equal(merged.strategy.source, "pine-import");
  assert.equal(merged.strategy.pine_script_path, "pine/x.pine");
  assert.equal(merged.indicators.ema.length, 2);
  assert.deepEqual(merged.indicators.rsi, [{ length: 14 }]);
  assert.equal(merged.entry_rules.long.length, 1);
  assert.equal(merged.exit_rules.length, 1);
});
