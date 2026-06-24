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
} from "./tradingview.js";
import { loadRules } from "./rules.js";
import { morningBrief } from "./brief.js";
import { countIndicators, PLAN_LIMITS, smallestPlanFor } from "./indicators.js";

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
    },
  },
  async ({ name, action }) => {
    try {
      return ok(await manageIndicator({ name, action }));
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

const transport = new StdioServerTransport();
await server.connect(transport);
// stderr is safe for logging; stdout is the MCP transport.
console.error("tradingview MCP server ready (stdio).");
