#!/usr/bin/env node
// Create rules.json from the template if it doesn't already exist.
//
// Usage: npm run init   (or: node scripts/init_rules.js [--force])

import fs from "node:fs";
import path from "node:path";

const root = path.join(import.meta.dirname, "..");
const template = path.join(root, "rules.template.json");
const target = process.env.TV_RULES_PATH || path.join(root, "rules.json");
const force = process.argv.includes("--force");

if (!fs.existsSync(template)) {
  console.error(`Template not found at ${template}.`);
  process.exit(1);
}

if (fs.existsSync(target) && !force) {
  console.log(`rules.json already exists at ${target} — leaving it untouched.`);
  console.log("Pass --force to overwrite it with the template.");
  process.exit(0);
}

fs.copyFileSync(template, target);
console.log(`Created ${target} from the template.`);
console.log("Edit it to describe your watchlist, indicators, and strategy.");
