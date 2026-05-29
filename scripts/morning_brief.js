#!/usr/bin/env node
// Standalone morning brief — runnable from cron without an MCP client.
//
// Example cron entry (08:00 daily, append to a log):
//   0 8 * * * cd /path/to/repo && node scripts/morning_brief.js >> ~/brief.log 2>&1

import { loadRules } from "../src/rules.js";
import { morningBrief } from "../src/brief.js";
import { closeClient } from "../src/cdp.js";

function line(item) {
  if (item.error) return `  ${item.symbol}: ERROR ${item.error}`;
  const reasons = item.reasons?.length ? ` — ${item.reasons.join(", ")}` : "";
  const level = item.key_level
    ? ` [H ${item.key_level.recent_high} / L ${item.key_level.recent_low}]`
    : "";
  return `  ${item.symbol} (${item.timeframe}): ${item.bias.toUpperCase()}${reasons}${level}`;
}

try {
  const rules = loadRules();
  const brief = await morningBrief(rules);
  console.log(`\n=== Morning brief ${brief.generated_at} — ${brief.strategy} ===`);
  for (const item of brief.items) console.log(line(item));
  console.log("");
} catch (err) {
  console.error("Morning brief failed:", err.message || err);
  process.exitCode = 1;
} finally {
  await closeClient();
}
