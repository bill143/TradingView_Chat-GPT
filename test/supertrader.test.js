// Offline, deterministic tests for the Super Trader engine. No network, no CDP.
// Run with: npm test  (node --test)

import { test } from "node:test";
import assert from "node:assert/strict";

import { buildConfig } from "../src/supertrader/config.js";
import { technicalSignal, quantSignal, sentimentSignal } from "../src/supertrader/signals.js";
import {
  aggregateSignals,
  proposeOrder,
  deriveStop,
  readAtr,
} from "../src/supertrader/portfolio.js";
import { evaluateOrder } from "../src/supertrader/risk.js";
import { PaperBroker } from "../src/supertrader/broker.js";
import { backtest, fitness, smaCrossStrategy } from "../src/supertrader/backtest.js";
import {
  decide,
  decideAndTrade,
  runWatchlist,
  activeSymbol,
} from "../src/supertrader/orchestrator.js";

const cfg = buildConfig();

function baseState(over = {}) {
  return {
    equity: 100000,
    cash: 100000,
    dayStartEquity: 100000,
    weekStartEquity: 100000,
    realizedPnLToday: 0,
    realizedPnLWeek: 0,
    positions: {},
    ...over,
  };
}

const bullishChart = {
  symbol: { symbol: "TEST" },
  quote: { open: 99, high: 102, low: 98, close: 101 },
  indicators: [
    { title: "Relative Strength Index", values: [60] },
    { title: "Moving Average Exponential", values: [95] },
    { title: "Average True Range", values: [2] },
  ],
};

// ---------------------------------------------------------------- signals ----
test("technical agent reads a bullish chart as long", () => {
  const s = technicalSignal(bullishChart);
  assert.equal(s.agent, "technical");
  assert.equal(s.direction, "long");
  assert.ok(s.confidence > 0.9);
});

test("quant agent abstains without enough history, votes on a trend", () => {
  assert.equal(quantSignal("X", []).direction, "flat");
  const up = Array.from({ length: 60 }, (_, i) => ({ close: 100 + i }));
  assert.equal(quantSignal("X", up).direction, "long");
});

test("sentiment agent is a safe stub without a provider, uses provider when given", async () => {
  const stub = await sentimentSignal("X");
  assert.equal(stub.direction, "flat");
  const live = await sentimentSignal("X", {
    provider: () => ({ score: 0.8, reasons: ["bullish news"] }),
  });
  assert.equal(live.direction, "long");
  assert.ok(live.confidence > 0.7);
});

test("readAtr / deriveStop", () => {
  assert.equal(readAtr(bullishChart), 2);
  assert.equal(deriveStop("long", 100, { atr: 2, sizing: cfg.sizing }), 96);
  assert.equal(deriveStop("long", 100, { atr: null, sizing: cfg.sizing }), 93);
});

// ------------------------------------------------------------ aggregation ----
test("portfolio aggregates weighted signals", () => {
  const c = aggregateSignals(
    [
      { agent: "technical", direction: "long", confidence: 1 },
      { agent: "quant", direction: "short", confidence: 1 },
      { agent: "sentiment", direction: "flat", confidence: 0 },
    ],
    cfg.weights
  );
  assert.equal(c.direction, "long");
  assert.ok(Math.abs(c.net - 0.25) < 1e-9); // (0.5 - 0.3) / 0.8
});

test("proposeOrder sizes by risk budget and respects confidence floor", () => {
  const strong = { direction: "long", confidence: 0.5 };
  const o = proposeOrder({
    symbol: "T",
    consensus: strong,
    price: 100,
    atr: null,
    equity: 100000,
    sizing: cfg.sizing,
  });
  assert.equal(o.side, "buy");
  assert.equal(o.stop, 93);
  assert.equal(o.qty, Math.floor((0.01 * 100000 * 0.5) / 7)); // 71
  assert.equal(
    proposeOrder({
      symbol: "T",
      consensus: { direction: "long", confidence: 0.1 },
      price: 100,
      equity: 100000,
      sizing: cfg.sizing,
    }),
    null
  );
  assert.equal(
    proposeOrder({
      symbol: "T",
      consensus: { direction: "flat", confidence: 1 },
      price: 100,
      equity: 100000,
      sizing: cfg.sizing,
    }),
    null
  );
});

// -------------------------------------------------------------------- risk ----
test("risk approves a sane order untrimmed", () => {
  const r = evaluateOrder(
    { symbol: "A", side: "buy", qty: 50, price: 100, stop: 95 },
    baseState(),
    cfg.risk
  );
  assert.ok(r.approved);
  assert.equal(r.adjustedQty, 50);
});

test("risk trims oversized orders to the position cap", () => {
  const r = evaluateOrder(
    { symbol: "A", side: "buy", qty: 1000, price: 100, stop: 95 },
    baseState(),
    cfg.risk
  );
  assert.ok(r.approved);
  assert.equal(r.adjustedQty, 80); // 8% of 100k / 100
  assert.ok(r.violations[0].includes("trimmed"));
});

test("risk rejects a missing or wrong-side stop", () => {
  assert.equal(
    evaluateOrder(
      { symbol: "A", side: "buy", qty: 10, price: 100, stop: null },
      baseState(),
      cfg.risk
    ).approved,
    false
  );
  assert.equal(
    evaluateOrder(
      { symbol: "A", side: "buy", qty: 10, price: 100, stop: 105 },
      baseState(),
      cfg.risk
    ).approved,
    false
  );
});

test("risk rejects a stop that is too wide", () => {
  const r = evaluateOrder(
    { symbol: "A", side: "buy", qty: 10, price: 100, stop: 80 },
    baseState(),
    cfg.risk
  );
  assert.equal(r.approved, false);
  assert.ok(r.reason.includes("too wide"));
});

test("daily and weekly circuit breakers block new risk", () => {
  const day = evaluateOrder(
    { symbol: "A", side: "buy", qty: 10, price: 100, stop: 95 },
    baseState({ realizedPnLToday: -2500 }),
    cfg.risk
  );
  assert.equal(day.approved, false);
  assert.ok(day.reason.includes("daily"));
  const week = evaluateOrder(
    { symbol: "A", side: "buy", qty: 10, price: 100, stop: 95 },
    baseState({ realizedPnLWeek: -6000 }),
    cfg.risk
  );
  assert.equal(week.approved, false);
  assert.ok(week.reason.includes("weekly"));
});

test("max open positions blocks a brand-new symbol", () => {
  const c = buildConfig({ risk: { maxOpenPositions: 2 } });
  const state = baseState({
    positions: { X: { qty: 10, avgPrice: 50 }, Y: { qty: 10, avgPrice: 50 } },
  });
  const r = evaluateOrder(
    { symbol: "Z", side: "buy", qty: 1, price: 100, stop: 95 },
    state,
    c.risk
  );
  assert.equal(r.approved, false);
  assert.ok(r.reason.includes("max open positions"));
});

test("cash reserve cap can block a buy", () => {
  const r = evaluateOrder(
    { symbol: "A", side: "buy", qty: 10, price: 100, stop: 95 },
    baseState({ cash: 4000 }),
    cfg.risk
  );
  assert.equal(r.approved, false);
  assert.ok(r.reason.includes("cashCap"));
});

test("risk-reducing sells are always allowed and capped to the position", () => {
  const state = baseState({ positions: { A: { qty: 100, avgPrice: 90 } } });
  const r = evaluateOrder(
    { symbol: "A", side: "sell", qty: 150, price: 110, stop: null },
    state,
    cfg.risk
  );
  assert.ok(r.approved);
  assert.equal(r.adjustedQty, 100);
  assert.ok(r.reason.includes("risk-reducing"));
});

// ------------------------------------------------------------------ broker ----
test("paper broker fills, marks to market, and realises P&L", () => {
  const b = new PaperBroker({ cash: 100000 });
  b.submitOrder({ symbol: "A", side: "buy", qty: 100, price: 100 });
  assert.equal(b.cash, 90000);
  assert.equal(b.equity({ A: 110 }), 101000);
  const fill = b.submitOrder({ symbol: "A", side: "sell", qty: 100, price: 110 });
  assert.equal(fill.realized, 1000);
  assert.equal(b.realizedPnL, 1000);
  assert.equal(b.getPositions().length, 0);
});

// ---------------------------------------------------------------- backtest ----
test("backtest + fitness produce a bounded, sensible score on an uptrend", () => {
  const series = Array.from({ length: 80 }, (_, i) => {
    const close = 100 + i + Math.sin(i / 5) * 2;
    return { open: close - 0.5, high: close + 1, low: close - 1, close };
  });
  const res = backtest(series, smaCrossStrategy(5, 20));
  assert.ok(res.finalEquity > 100000, "uptrend should be profitable");
  assert.ok(Number.isFinite(res.fitness.score));
  assert.ok(res.fitness.totalReturn > 0);
});

test("fitness handles an empty/flat curve without NaN", () => {
  const f = fitness([100000, 100000, 100000], []);
  assert.ok(Number.isFinite(f.score));
  assert.equal(f.totalReturn, 0);
});

// ------------------------------------------------------------- orchestrator ----
test("decide end-to-end approves a buy on a bullish chart", async () => {
  const broker = new PaperBroker({ cash: 100000 });
  const decision = await decide({
    chart: bullishChart,
    symbol: "TEST",
    equity: 100000,
    state: broker.riskState(),
    config: cfg,
  });
  assert.equal(decision.action, "buy");
  assert.ok(decision.risk.approved);
  assert.equal(decision.proposedOrder.stop, 97); // 101 - 2*ATR(2)
});

test("decideAndTrade executes the approved order on the paper broker", async () => {
  const broker = new PaperBroker({ cash: 100000 });
  const { decision, fill } = await decideAndTrade({
    chart: bullishChart,
    symbol: "TEST",
    broker,
    config: cfg,
  });
  assert.ok(fill, "an approved order should fill");
  assert.equal(fill.symbol, "TEST");
  assert.equal(broker.getPositions()[0].symbol, "TEST");
  assert.equal(broker.getPositions()[0].qty, decision.risk.order.qty);
});

test("runWatchlist tolerates a failing read and keeps going", async () => {
  const reader = async (sym) => {
    if (sym === "BAD") throw new Error("read failed");
    return bullishChart;
  };
  const out = await runWatchlist(["TEST", "BAD"], reader, {
    equity: 100000,
    state: baseState(),
    config: cfg,
  });
  assert.equal(out.length, 2);
  assert.equal(out[0].action, "buy");
  assert.ok(out[1].error.includes("read failed"));
});

// --- regression tests for review findings (risk/broker/backtest/orchestrator) ---

test("broker persists daily/weekly realised losses across save/reload (breaker survives)", () => {
  const b = new PaperBroker({ cash: 100000 });
  b.submitOrder({ symbol: "A", side: "buy", qty: 100, price: 100 });
  b.submitOrder({ symbol: "A", side: "sell", qty: 100, price: 70 }); // -3000 realised today
  assert.equal(b.realizedPnLToday, -3000);
  const reloaded = new PaperBroker(JSON.parse(JSON.stringify(b.toJSON())));
  assert.equal(reloaded.realizedPnLToday, -3000);
  assert.equal(reloaded.realizedPnLWeek, -3000);
  const v = evaluateOrder(
    { symbol: "B", side: "buy", qty: 1, price: 100, stop: 95 },
    reloaded.riskState(),
    cfg.risk
  );
  assert.equal(v.approved, false);
  assert.ok(v.reason.includes("daily"));
});

test("broker baseline equity includes pre-existing positions", () => {
  const b = new PaperBroker({ cash: 0, positions: { X: { qty: 1, avgPrice: 100000 } } });
  assert.equal(b.dayStartEquity, 100000);
  assert.equal(b.weekStartEquity, 100000);
});

test("risk values existing positions at their own price for the exposure cap", () => {
  const state = baseState({ positions: { BTC: { qty: 2, avgPrice: 50000 } } });
  const r = evaluateOrder(
    { symbol: "XYZ", side: "buy", qty: 100, price: 100, stop: 95 },
    state,
    cfg.risk
  );
  assert.equal(r.approved, false);
  assert.ok(r.reason.includes("expCap"));
});

test("risk allows a buy that covers a short even with a tripped breaker", () => {
  const state = baseState({
    realizedPnLToday: -5000,
    positions: { A: { qty: -100, avgPrice: 100 } },
  });
  const cover = evaluateOrder(
    { symbol: "A", side: "buy", qty: 150, price: 90, stop: null },
    state,
    cfg.risk
  );
  assert.ok(cover.approved);
  assert.equal(cover.adjustedQty, 100);
  assert.ok(cover.reason.includes("risk-reducing"));
  assert.equal(
    evaluateOrder({ symbol: "B", side: "buy", qty: 1, price: 90, stop: 85 }, state, cfg.risk)
      .approved,
    false
  );
});

test("fitness annualisation scales with periodsPerYear", () => {
  const curve = [100000, 101000, 100500, 101500, 102000];
  const daily = fitness(curve, [], { periodsPerYear: 252 });
  const weekly = fitness(curve, [], { periodsPerYear: 52 });
  assert.ok(Number.isFinite(daily.sharpe) && Number.isFinite(weekly.sharpe));
  assert.ok(Math.abs(daily.sharpe) > Math.abs(weekly.sharpe));
});

test("backtest fills on the next bar's open, not the signal bar (no look-ahead)", () => {
  const series = [
    { open: 10, high: 10, low: 10, close: 10 },
    { open: 20, high: 20, low: 20, close: 20 },
    { open: 30, high: 30, low: 30, close: 30 },
  ];
  const res = backtest(series, () => "long", { startCash: 100 });
  assert.equal(res.finalEquity, 150);
});

test("backtest does not execute a signal generated on the final bar", () => {
  const series = [
    { open: 100, high: 101, low: 99, close: 100 },
    { open: 100, high: 101, low: 99, close: 100 },
    { open: 100, high: 105, low: 99, close: 104 },
  ];
  const longOnlyLast = ({ i }) => (i === series.length - 1 ? "long" : "flat");
  const res = backtest(series, longOnlyLast);
  assert.equal(res.trades.length, 0);
  assert.equal(res.finalEquity, 100000);
});

test("activeSymbol prefers the chart's active symbol, falls back to requested", () => {
  assert.equal(activeSymbol({ symbol: { symbol: "AAA" } }, "bbb"), "AAA");
  assert.equal(activeSymbol({ symbol: "CCC" }, "bbb"), "CCC");
  assert.equal(activeSymbol({}, "bbb"), "bbb");
  assert.equal(activeSymbol(null, null), "?");
});

test("decide keys the decision by the chart's active symbol, not the requested ticker", async () => {
  const chart = {
    symbol: { symbol: "BINANCE:BTCUSDT" },
    quote: { open: 99, high: 102, low: 98, close: 101 },
    indicators: [{ title: "Average True Range", values: [2] }],
  };
  const d = await decide({ chart, symbol: "btc", equity: 100000, state: baseState(), config: cfg });
  assert.equal(d.symbol, "BINANCE:BTCUSDT");
});

test("decideAndTrade executes and keys the fill under the active symbol", async () => {
  const broker = new PaperBroker({ cash: 100000 });
  const chart = {
    symbol: { symbol: "NASDAQ:AAPL" },
    quote: { open: 99, high: 102, low: 98, close: 101 },
    indicators: [
      { title: "Relative Strength Index", values: [60] },
      { title: "Average True Range", values: [2] },
    ],
  };
  const { fill } = await decideAndTrade({ chart, symbol: "aapl", broker, config: cfg });
  assert.ok(fill);
  assert.equal(fill.symbol, "NASDAQ:AAPL");
  assert.equal(broker.getPositions()[0].symbol, "NASDAQ:AAPL");
});
