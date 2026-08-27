import { test } from "node:test";
import assert from "node:assert/strict";

import {
  classifyIndicator,
  lengthFromTitle,
  buildContext,
  resolveRef,
  evaluateCriterion,
  evaluateCriteria,
} from "../src/signals.js";

test("classifyIndicator recognises common indicators", () => {
  assert.equal(classifyIndicator("Relative Strength Index 14"), "rsi");
  assert.equal(classifyIndicator("MACD 12 26 9"), "macd");
  assert.equal(classifyIndicator("Average True Range 14"), "atr");
  assert.equal(classifyIndicator("Moving Average Exponential 50"), "ma");
  assert.equal(classifyIndicator("Average Directional Index 14"), "adx");
  assert.equal(classifyIndicator("VWAP"), "vwap");
  assert.equal(classifyIndicator("Some Custom Thing"), "other");
});

test("lengthFromTitle extracts the first number", () => {
  assert.equal(lengthFromTitle("Moving Average Exponential 50"), 50);
  assert.equal(lengthFromTitle("RSI"), null);
});

test("buildContext indexes readings by type", () => {
  const ctx = buildContext({ open: 100, high: 110, low: 99, close: 108 }, [
    { title: "Relative Strength Index 14", values: [62] },
    { title: "Moving Average Exponential 20", values: [105] },
    { title: "Moving Average Exponential 50", values: [101] },
    { title: "MACD 12 26 9", values: [1.2, 0.8, 0.4] },
    { title: "Average True Range 14", values: [3.5] },
    { title: "Average Directional Index 14", values: [27] },
  ]);
  assert.equal(ctx.rsi, 62);
  assert.equal(ctx.atr, 3.5);
  assert.equal(ctx.adx, 27);
  assert.deepEqual(ctx.macd, { line: 1.2, signal: 0.8, hist: 0.4 });
  assert.equal(ctx.mas.length, 2);
  assert.equal(ctx.mas.find((m) => m.length === 50).value, 101);
});

test("resolveRef resolves quote, indicator, ma, and literal references", () => {
  const ctx = buildContext({ close: 108 }, [
    { title: "Relative Strength Index 14", values: [62] },
    { title: "Moving Average Exponential 50", values: [101] },
    { title: "MACD 12 26 9", values: [1.2, 0.8, 0.4] },
  ]);
  assert.equal(resolveRef(ctx, "close"), 108);
  assert.equal(resolveRef(ctx, "rsi"), 62);
  assert.equal(resolveRef(ctx, "ema:50"), 101);
  assert.equal(resolveRef(ctx, "macd.hist"), 0.4);
  assert.equal(resolveRef(ctx, 55), 55);
  assert.equal(resolveRef(ctx, "ema:200"), null); // not present
  assert.equal(resolveRef(ctx, "garbage"), null);
});

test("evaluateCriterion handles structured comparisons and references", () => {
  const ctx = buildContext({ close: 108 }, [
    { title: "Relative Strength Index 14", values: [62] },
    { title: "Moving Average Exponential 50", values: [101] },
  ]);
  assert.equal(evaluateCriterion(ctx, { indicator: "rsi", op: ">=", value: 55 }).status, "met");
  assert.equal(evaluateCriterion(ctx, { indicator: "rsi", op: "<", value: 55 }).status, "unmet");
  assert.equal(evaluateCriterion(ctx, { left: "close", op: ">", right: "ema:50" }).status, "met");
  assert.equal(
    evaluateCriterion(ctx, { left: "close", op: ">", right: "ema:200" }).status,
    "unknown"
  );
  assert.equal(evaluateCriterion(ctx, { indicator: "rsi", op: "??", value: 1 }).status, "unknown");
});

test("evaluateCriterion treats strings as narrative", () => {
  const ctx = buildContext({}, []);
  const r = evaluateCriterion(ctx, "price looks strong");
  assert.equal(r.kind, "narrative");
  assert.equal(r.status, "narrative");
  assert.equal(r.text, "price looks strong");
});

test("evaluateCriteria counts met structured entries and ignores narrative", () => {
  const ctx = buildContext({ close: 108 }, [{ title: "RSI 14", values: [62] }]);
  const { results, met } = evaluateCriteria(ctx, [
    "narrative one",
    { indicator: "rsi", op: ">=", value: 55 },
    { indicator: "rsi", op: ">=", value: 80 },
  ]);
  assert.equal(results.length, 3);
  assert.equal(met, 1);
});
