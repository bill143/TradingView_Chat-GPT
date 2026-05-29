// Load and lightly validate the user's strategy file (rules.json).

import fs from "node:fs";
import { RULES_PATH } from "./config.js";

const VALID_TIMEFRAMES = new Set([
  "1", "3", "5", "15", "30", "45",
  "60", "120", "180", "240",
  "D", "W", "M",
]);

export function loadRules(rulesPath = RULES_PATH) {
  if (!fs.existsSync(rulesPath)) {
    throw new Error(
      `No strategy file found at ${rulesPath}. ` +
        `Copy rules.template.json to rules.json and fill it in.`
    );
  }
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(rulesPath, "utf8"));
  } catch (err) {
    throw new Error(`rules.json is not valid JSON: ${err.message}`);
  }
  return normaliseRules(parsed);
}

export function normaliseRules(rules) {
  const out = { ...rules };
  out.watchlist = Array.isArray(rules.watchlist) ? rules.watchlist : [];
  out.default_timeframe = VALID_TIMEFRAMES.has(rules.default_timeframe)
    ? rules.default_timeframe
    : "D";
  out.indicators = rules.indicators || {};
  out.bias_criteria = rules.bias_criteria || { bullish: [], bearish: [], neutral: [] };
  out.entry_rules = rules.entry_rules || { long: [], short: [] };
  out.exit_rules = Array.isArray(rules.exit_rules) ? rules.exit_rules : [];
  out.risk_rules = Array.isArray(rules.risk_rules) ? rules.risk_rules : [];
  out.strategy = rules.strategy || { name: "Untitled", source: "unknown" };
  return out;
}

export function saveRules(rules, rulesPath = RULES_PATH) {
  fs.writeFileSync(rulesPath, JSON.stringify(rules, null, 2) + "\n");
}
