import { test } from "node:test";
import assert from "node:assert/strict";

import {
  resolveIndicatorName,
  countIndicators,
  smallestPlanFor,
  PLAN_LIMITS,
} from "../src/indicators.js";

test("resolveIndicatorName maps short forms to full TradingView names", () => {
  assert.equal(resolveIndicatorName("RSI"), "Relative Strength Index");
  assert.equal(resolveIndicatorName("ema"), "Moving Average Exponential");
  assert.equal(resolveIndicatorName("MACD"), "MACD");
  assert.equal(resolveIndicatorName("Bollinger Bands"), "Bollinger Bands");
});

test("resolveIndicatorName passes unknown names through unchanged", () => {
  assert.equal(resolveIndicatorName("My Custom Pine"), "My Custom Pine");
  assert.equal(resolveIndicatorName(""), "");
});

test("countIndicators counts each instance (object form)", () => {
  const rules = {
    indicators: {
      ema: [{ length: 20 }, { length: 50 }],
      rsi: [{ length: 14 }],
      atr: [{ length: 14 }],
    },
  };
  assert.equal(countIndicators(rules), 4);
});

test("countIndicators counts array form and handles empty", () => {
  assert.equal(countIndicators({ indicators: [{ name: "RSI" }, { name: "MACD" }] }), 2);
  assert.equal(countIndicators({ indicators: {} }), 0);
  assert.equal(countIndicators({}), 0);
});

test("smallestPlanFor returns the cheapest plan that fits", () => {
  assert.equal(smallestPlanFor(1), "basic");
  assert.equal(smallestPlanFor(2), "basic");
  assert.equal(smallestPlanFor(3), "essential");
  assert.equal(smallestPlanFor(5), "essential");
  assert.equal(smallestPlanFor(6), "plus");
  assert.equal(smallestPlanFor(10), "plus");
  assert.equal(smallestPlanFor(11), "premium");
  assert.equal(smallestPlanFor(25), "premium");
  assert.equal(smallestPlanFor(26), "ultimate");
});

test("PLAN_LIMITS are self-consistent with smallestPlanFor boundaries", () => {
  for (const [plan, limit] of Object.entries(PLAN_LIMITS)) {
    // A count equal to a plan's limit must fit in that plan or a cheaper-equal one.
    assert.ok(PLAN_LIMITS[smallestPlanFor(limit)] >= limit, `limit ${limit} for ${plan}`);
  }
});
