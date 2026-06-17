import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { normaliseRules, loadRules, saveRules } from "../src/rules.js";

test("normaliseRules fills sensible defaults for a sparse object", () => {
  const r = normaliseRules({});
  assert.deepEqual(r.watchlist, []);
  assert.equal(r.default_timeframe, "D");
  assert.deepEqual(r.indicators, {});
  assert.deepEqual(r.exit_rules, []);
  assert.deepEqual(r.risk_rules, []);
  assert.equal(r.strategy.name, "Untitled");
});

test("normaliseRules rejects an invalid timeframe and falls back to D", () => {
  assert.equal(normaliseRules({ default_timeframe: "999" }).default_timeframe, "D");
  assert.equal(normaliseRules({ default_timeframe: "15" }).default_timeframe, "15");
  assert.equal(normaliseRules({ default_timeframe: "W" }).default_timeframe, "W");
});

test("the shipped rules.template.json is valid and normalises cleanly", () => {
  const tmplPath = path.join(import.meta.dirname, "..", "rules.template.json");
  const tmpl = JSON.parse(fs.readFileSync(tmplPath, "utf8"));
  const r = normaliseRules(tmpl);
  assert.ok(Array.isArray(r.watchlist) && r.watchlist.length > 0);
  assert.ok(r.indicators.ema);
});

test("loadRules throws a clear error when the file is missing", () => {
  const missing = path.join(os.tmpdir(), `nope-${Date.now()}.json`);
  assert.throws(() => loadRules(missing), /No strategy file found/);
});

test("saveRules then loadRules round-trips", () => {
  const tmp = path.join(os.tmpdir(), `rules-${Date.now()}.json`);
  const original = normaliseRules({ watchlist: ["NASDAQ:AAPL"], default_timeframe: "60" });
  saveRules(original, tmp);
  const loaded = loadRules(tmp);
  assert.deepEqual(loaded.watchlist, ["NASDAQ:AAPL"]);
  assert.equal(loaded.default_timeframe, "60");
  fs.unlinkSync(tmp);
});

test("loadRules throws on malformed JSON", () => {
  const tmp = path.join(os.tmpdir(), `bad-${Date.now()}.json`);
  fs.writeFileSync(tmp, "{ not valid json");
  assert.throws(() => loadRules(tmp), /not valid JSON/);
  fs.unlinkSync(tmp);
});
