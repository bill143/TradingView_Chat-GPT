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
