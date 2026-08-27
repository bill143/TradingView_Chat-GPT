#!/usr/bin/env node
// Import a Pine Script into rules.json: parse it, copy it into pine/, and fold
// its indicators + entries/exits into the strategy file.
//
// Usage: node scripts/import_pine.js path/to/strategy.pine

import fs from "node:fs";
import path from "node:path";

import { parsePine, mergePineIntoRules } from "../src/pine.js";
import { loadRules, normaliseRules, saveRules } from "../src/rules.js";
import { RULES_PATH } from "../src/config.js";

const input = process.argv[2];
if (!input) {
  console.error("Usage: node scripts/import_pine.js path/to/strategy.pine");
  process.exit(1);
}
if (!fs.existsSync(input)) {
  console.error(`File not found: ${input}`);
  process.exit(1);
}

const root = path.join(import.meta.dirname, "..");
const source = fs.readFileSync(input, "utf8");
const parsed = parsePine(source);

// Save a copy under pine/ for reference.
const slug = (parsed.name || path.basename(input, ".pine"))
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-+|-+$/g, "");
const dest = path.join(root, "pine", `${slug || "strategy"}.pine`);
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.copyFileSync(input, dest);

const existing = fs.existsSync(RULES_PATH) ? loadRules() : normaliseRules({});
const merged = normaliseRules(mergePineIntoRules(existing, parsed, dest));
saveRules(merged);

console.log(`Imported "${parsed.name || "(unnamed)"}" (${parsed.type}).`);
console.log(`  Indicators: ${parsed.indicators.map((i) => i.name).join(", ") || "none found"}`);
console.log(`  Entries: ${parsed.entries.length}, Exits: ${parsed.exits.length}`);
console.log(`  Pine saved to: ${dest}`);
console.log(`  rules.json updated at: ${RULES_PATH}`);
