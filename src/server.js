#!/usr/bin/env node
// TradingView MCP server.
//
// Exposes a small set of tools over stdio so an MCP client (Codex, Claude, etc.)
// can read and drive a live TradingView Desktop chart. Launch TradingView with
// remote debugging first (see scripts/launch_tv_debug_*), then point your MCP
// client's config at this file.

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { healthCheck } from "./cdp.js";
import {
  setSymbol,
  setTimeframe,
  manageIndicator,
  readQuote,
  readIndicatorValues,
  getActiveSymbol,
  applyStrategyToSymbol,
  readCandles,
} from "./tradingview.js";
import { loadRules } from "./rules.js";
import { morningBrief } from "./brief.js";
import { countIndicators, PLAN_LIMITS, smallestPlanFor } from "./indicators.js";
import { parsePine } from "./pine.js";
import fs from "node:fs";

import { buildConfig } from "./supertrader/config.js";
import { PaperBroker } from "./supertrader/broker.js";
import { evaluateOrder } from "./supertrader/risk.js";
import { backtest, smaCrossStrategy } from "./supertrader/backtest.js";
import { decide, runWatchlist } from "./supertrader/orchestrator.js";
import { PAPER_STATE_PATH } from "./config.js";

const server = new McpServer({
  name: "tradingview",
  version: "0.1.0",
});

// Helper: wrap a result object as MCP text content (JSON).
function ok(obj) {
  return { content: [{ type: "text", text: JSON.stringify(obj, null, 2) }] };
}
function fail(err) {
  return {
    isError: true,
    content: [{ type: "text", text: String(err?.message || err) }],
  };
}

server.registerTool(
  "tv_health_check",
  {
    title: "Health check",
    description:
      "Check whether TradingView Desktop is reachable over CDP and a chart window is present.",
    inputSchema: {},
  },
  async () => {
    try {
      return ok(await healthCheck());
    } catch (e) {
      return fail(e);
    }
  }
);

server.registerTool(
  "chart_set_symbol",
  {
    title: "Set chart symbol",
    description: "Switch the active chart to a symbol, e.g. 'BITSTAMP:BTCUSD' or 'NASDAQ:AAPL'.",
    inputSchema: { symbol: z.string().describe("Full TradingView ticker") },
  },
  async ({ symbol }) => {
    try {
      return ok(await setSymbol(symbol));
    } catch (e) {
      return fail(e);
    }
  }
);

server.registerTool(
  "chart_set_timeframe",
  {
    title: "Set chart timeframe",
    description: "Change the chart interval. One of 1,3,5,15,30,60,120,240,D,W,M.",
    inputSchema: { timeframe: z.string().describe("Interval code, e.g. '15', 'D', 'W'") },
  },
  async ({ timeframe }) => {
    try {
      return ok(await setTimeframe(timeframe));
    } catch (e) {
      return fail(e);
    }
  }
);

server.registerTool(
  "chart_manage_indicator",
  {
    title: "Add or remove an indicator",
    description:
      "Add (or attempt to remove) an indicator on the current chart. Use the full name, e.g. 'Relative Strength Index'.",
    inputSchema: {
      name: z.string().describe("Indicator name (short forms like 'RSI' are resolved)"),
      action: z.enum(["add", "remove"]).default("add"),
      params: z
        .record(z.union([z.string(), z.number()]))
        .optional()
        .describe("Requested params, e.g. { length: 50 } (reported; see note in result)"),
    },
  },
  async ({ name, action, params }) => {
    try {
      return ok(await manageIndicator({ name, action, params }));
    } catch (e) {
      return fail(e);
    }
  }
);

server.registerTool(
  "chart_read",
  {
    title: "Read current chart data",
    description:
      "Read the active symbol, the latest bar's OHLC, and all indicator values currently shown in the legend.",
    inputSchema: {},
  },
  async () => {
    try {
      const [symbol, quote, indicators] = await Promise.all([
        getActiveSymbol(),
        readQuote(),
        readIndicatorValues(),
      ]);
      return ok({ symbol, quote, indicators });
    } catch (e) {
      return fail(e);
    }
  }
);

server.registerTool(
  "chart_list_indicators",
  {
    title: "List indicators on the chart",
    description:
      "List the indicators currently shown in the legend (title + values). Use this to tell the user exactly which to remove, since removal must be done manually from the legend.",
    inputSchema: {},
  },
  async () => {
    try {
      const indicators = await readIndicatorValues();
      return ok({
        count: indicators.length,
        indicators,
        removal_note:
          "Removal isn't scriptable via keyboard shortcuts. To remove one, hover it " +
          "in the chart legend, click the eye/more (…) menu, and choose Remove.",
      });
    } catch (e) {
      return fail(e);
    }
  }
);

server.registerTool(
  "chart_read_candles",
  {
    title: "Read recent candles (best effort)",
    description:
      "Best-effort read of the recent OHLC series. TradingView Desktop doesn't expose its data model publicly, so this may report available:false — in which case use chart_read for the latest bar.",
    inputSchema: {
      count: z.number().int().positive().max(5000).default(50).describe("How many bars to request"),
    },
  },
  async ({ count }) => {
    try {
      return ok(await readCandles(count));
    } catch (e) {
      return fail(e);
    }
  }
);

server.registerTool(
  "strategy_apply",
  {
    title: "Apply strategy to a symbol",
    description:
      "Apply the strategy from rules.json to one symbol: switch chart, set timeframe, add every indicator.",
    inputSchema: {
      symbol: z.string().describe("Ticker to apply the strategy to"),
    },
  },
  async ({ symbol }) => {
    try {
      const rules = loadRules();
      return ok(await applyStrategyToSymbol(symbol, rules));
    } catch (e) {
      return fail(e);
    }
  }
);

server.registerTool(
  "morning_brief",
  {
    title: "Morning brief",
    description:
      "Walk the rules.json watchlist and return a structured bias + reasons + key levels for each symbol.",
    inputSchema: {},
  },
  async () => {
    try {
      const rules = loadRules();
      return ok(await morningBrief(rules));
    } catch (e) {
      return fail(e);
    }
  }
);

server.registerTool(
  "strategy_plan_check",
  {
    title: "Plan / indicator-limit check",
    description:
      "Count the indicators in rules.json and check them against a TradingView plan's per-chart limit.",
    inputSchema: {
      plan: z
        .enum(["free", "basic", "essential", "plus", "premium", "ultimate"])
        .describe("The user's current TradingView plan"),
    },
  },
  async ({ plan }) => {
    try {
      const rules = loadRules();
      const count = countIndicators(rules);
      const limit = PLAN_LIMITS[plan];
      const fits = count <= limit;
      return ok({
        indicator_count: count,
        plan,
        plan_limit: limit,
        fits,
        required_plan: fits ? plan : smallestPlanFor(count),
      });
    } catch (e) {
      return fail(e);
    }
  }
);

// ---------------------------------------------------------------------------
// Super Trader: multi-agent decision engine layered on the chart reads above.
// Advisory by default; execution only ever touches the local PaperBroker.
// ---------------------------------------------------------------------------

// Read one symbol's chart into the shape the engine expects.
async function readChart(symbol, timeframe) {
  await setSymbol(symbol);
  if (timeframe) await setTimeframe(timeframe);
  const [sym, quote, indicators] = await Promise.all([
    getActiveSymbol(),
    readQuote(),
    readIndicatorValues(),
  ]);
  return { symbol: sym, quote, indicators };
}

function traderConfig(rules) {
  return buildConfig(rules?.supertrader || {});
}

server.registerTool(
  "supertrader_decide",
  {
    title: "Super Trader: decide (one symbol)",
    description:
      "Read a symbol's chart, gather agent signals, aggregate them, and run the " +
      "proposed trade through the code-enforced risk rails. Advisory only — does not execute.",
    inputSchema: {
      symbol: z.string().describe("Full TradingView ticker"),
      timeframe: z.string().optional().describe("Interval code, defaults to rules' default"),
    },
  },
  async ({ symbol, timeframe }) => {
    try {
      const rules = loadRules();
      const cfg = traderConfig(rules);
      const broker = PaperBroker.load(PAPER_STATE_PATH);
      const chart = await readChart(symbol, timeframe || rules.default_timeframe);
      const prices = chart.quote?.close ? { [symbol]: chart.quote.close } : {};
      const decision = await decide({
        chart, symbol, config: cfg,
        equity: broker.equity(prices), state: broker.riskState(prices),
      });
      return ok(decision);
    } catch (e) {
      return fail(e);
    }
  }
);

server.registerTool(
  "supertrader_run",
  {
    title: "Super Trader: run the watchlist",
    description:
      "Run the decision engine across every symbol in rules.json (advisory). " +
      "Returns an action + risk verdict + signal breakdown per symbol.",
    inputSchema: {},
  },
  async () => {
    try {
      const rules = loadRules();
      const cfg = traderConfig(rules);
      const broker = PaperBroker.load(PAPER_STATE_PATH);
      const results = await runWatchlist(
        rules.watchlist,
        (sym) => readChart(sym, rules.default_timeframe),
        { config: cfg, equity: broker.equity(), state: broker.riskState() }
      );
      return ok({ generated_at: new Date().toISOString(), items: results });
    } catch (e) {
      return fail(e);
    }
  }
);

server.registerTool(
  "supertrader_risk_check",
  {
    title: "Super Trader: risk check an order",
    description:
      "Run a proposed order through the code-enforced risk rails against the current " +
      "paper account. Returns approve/adjust/reject with explicit reasons.",
    inputSchema: {
      symbol: z.string(),
      side: z.enum(["buy", "sell"]),
      qty: z.number().positive(),
      price: z.number().positive(),
      stop: z.number().optional(),
      target: z.number().optional(),
      sector: z.string().optional(),
    },
  },
  async (order) => {
    try {
      const rules = loadRules();
      const cfg = traderConfig(rules);
      const broker = PaperBroker.load(PAPER_STATE_PATH);
      const verdict = evaluateOrder(
        { ...order, stop: order.stop ?? null },
        broker.riskState(),
        cfg.risk
      );
      return ok(verdict);
    } catch (e) {
      return fail(e);
    }
  }
);

server.registerTool(
  "supertrader_backtest",
  {
    title: "Super Trader: backtest a series",
    description:
      "Backtest an OHLC series with the reference SMA-cross strategy and return the " +
      "equity curve summary plus the composite fitness score (Sharpe/Sortino/return/win-rate/PF).",
    inputSchema: {
      series: z
        .array(z.object({
          open: z.number(), high: z.number(), low: z.number(), close: z.number(),
        }))
        .min(2)
        .describe("Array of OHLC bars, oldest first"),
      fast: z.number().int().positive().default(10),
      slow: z.number().int().positive().default(30),
      startCash: z.number().positive().default(100000),
    },
  },
  async ({ series, fast, slow, startCash }) => {
    try {
      const res = backtest(series, smaCrossStrategy(fast, slow), { startCash });
      return ok({ finalEquity: res.finalEquity, trades: res.trades.length, fitness: res.fitness });
    } catch (e) {
      return fail(e);
    }
  }
);

server.registerTool(
  "supertrader_paper_status",
  {
    title: "Super Trader: paper account status",
    description: "Return the current paper-trading account: cash, equity, open positions, realised P&L.",
    inputSchema: {},
  },
  async () => {
    try {
      const broker = PaperBroker.load(PAPER_STATE_PATH);
      return ok(broker.getAccount());
    } catch (e) {
      return fail(e);
    }
  }
);

server.registerTool(
  "pine_summary",
  {
    title: "Summarise a Pine Script",
    description:
      "Parse a Pine Script and extract its name, type, indicators, and entry/exit/alert lines. Pass the script inline or a file path; defaults to rules.json's strategy.pine_script_path.",
    inputSchema: {
      source: z.string().optional().describe("Raw Pine Script text"),
      path: z.string().optional().describe("Path to a .pine file"),
    },
  },
  async ({ source, path: pinePath }) => {
    try {
      let text = source;
      if (!text && pinePath) text = fs.readFileSync(pinePath, "utf8");
      if (!text) {
        const configured = loadRules().strategy?.pine_script_path;
        if (!configured) throw new Error("No Pine source, path, or strategy.pine_script_path set.");
        text = fs.readFileSync(configured, "utf8");
      }
      return ok(parsePine(text));
    } catch (e) {
      return fail(e);
    }
  }
);

const transport = new StdioServerTransport();
await server.connect(transport);
// stderr is safe for logging; stdout is the MCP transport.
console.error("tradingview MCP server ready (stdio).");
