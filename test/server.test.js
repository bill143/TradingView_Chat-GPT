import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const SERVER = path.join(import.meta.dirname, "..", "src", "server.js");

const EXPECTED_TOOLS = [
  "tv_health_check",
  "chart_set_symbol",
  "chart_set_timeframe",
  "chart_manage_indicator",
  "chart_read",
  "strategy_apply",
  "morning_brief",
  "strategy_plan_check",
  "pine_summary",
  "chart_read_candles",
  "chart_list_indicators",
];

test("server boots over stdio and advertises all tools", async () => {
  const transport = new StdioClientTransport({ command: "node", args: [SERVER] });
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(transport);
  try {
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    assert.deepEqual(names, [...EXPECTED_TOOLS].sort());
  } finally {
    await client.close();
  }
});

test("tv_health_check returns a structured result even with no chart running", async () => {
  const transport = new StdioClientTransport({ command: "node", args: [SERVER] });
  const client = new Client({ name: "test", version: "0.0.0" });
  await client.connect(transport);
  try {
    const res = await client.callTool({ name: "tv_health_check", arguments: {} });
    const text = res.content?.[0]?.text || "";
    const parsed = JSON.parse(text);
    // No TradingView in CI: must report not-connected rather than crash.
    assert.equal(typeof parsed.cdp_connected, "boolean");
  } finally {
    await client.close();
  }
});
