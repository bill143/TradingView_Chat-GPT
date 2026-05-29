#!/usr/bin/env node
// Standalone CDP health check — confirms TradingView Desktop is reachable.

import { healthCheck, closeClient } from "../src/cdp.js";

try {
  const result = await healthCheck();
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.cdp_connected && result.tradingview_window ? 0 : 1;
} finally {
  await closeClient();
}
