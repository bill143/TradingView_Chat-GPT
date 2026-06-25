// A small, dependency-free Pine Script (v4/v5) extractor.
//
// This is NOT a full Pine interpreter — it pulls the parts we can map onto a
// rules.json strategy: the script name/type, the indicators it references, and
// its entry/exit/alert lines. The goal is to summarise an existing script so
// the agent can confirm it with the user and apply the indicators to a chart.
//
// Comments and string literals are stripped first so we don't match Pine tokens
// that appear inside them.

const INDICATOR_FUNCS = {
  ema: "Moving Average Exponential",
  sma: "Moving Average Simple",
  wma: "Moving Average Weighted",
  vwma: "VWMA",
  vwap: "VWAP",
  rsi: "Relative Strength Index",
  macd: "MACD",
  atr: "Average True Range",
  adx: "Average Directional Index",
  cci: "CCI",
  mfi: "Money Flow Index",
  obv: "On Balance Volume",
  stoch: "Stochastic",
  bb: "Bollinger Bands",
  supertrend: "SuperTrend",
};

/** Remove // line comments and string literals, preserving line count. */
function stripNoise(src) {
  return String(src)
    .replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, '""') // strings -> empty
    .replace(/\/\/[^\n]*/g, ""); // line comments
}

function firstStringArg(line) {
  const m = String(line).match(/["']([^"']+)["']/);
  return m ? m[1] : null;
}

/**
 * Parse a Pine script into a structured summary.
 * @param {string} source raw .pine text
 */
export function parsePine(source) {
  const raw = String(source || "");
  const clean = stripNoise(raw);

  // Declaration: indicator(...) / strategy(...) / study(...)
  const decl = clean.match(/\b(strategy|indicator|study)\s*\(/);
  const type = decl ? (decl[1] === "strategy" ? "strategy" : "indicator") : "unknown";

  // Name is the first string literal in the declaration call — read it from the
  // ORIGINAL source so the string survived stripping.
  let name = null;
  if (decl) {
    const declRaw = raw.slice(raw.search(/\b(strategy|indicator|study)\s*\(/));
    name = firstStringArg(declRaw);
  }

  // Indicators: ta.<fn>( or bare <fn>( (Pine v4). Dedup by mapped name + length.
  const indicators = [];
  const seen = new Set();
  const fnNames = Object.keys(INDICATOR_FUNCS).join("|");
  const re = new RegExp(`(?:ta\\.)?\\b(${fnNames})\\s*\\(([^)]*)\\)`, "g");
  let m;
  while ((m = re.exec(clean)) !== null) {
    const fn = m[1].toLowerCase();
    const args = m[2]
      .split(",")
      .map((a) => a.trim())
      .filter(Boolean);
    // Heuristic: the length param is the first integer-looking argument.
    const lengthArg = args.find((a) => /^\d+$/.test(a));
    const length = lengthArg ? Number(lengthArg) : null;
    const key = `${fn}:${length ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    indicators.push({ fn, name: INDICATOR_FUNCS[fn], length, args });
  }

  // Entries / exits / alerts — detect on the cleaned lines (so we don't match
  // tokens in comments/strings) but keep the ORIGINAL line text for review.
  const cleanLines = clean.split("\n");
  const rawLines = raw.split("\n");
  const entries = [];
  const exits = [];
  const alerts = [];
  for (let i = 0; i < cleanLines.length; i++) {
    const t = cleanLines[i].trim();
    if (!t) continue;
    const original = (rawLines[i] ?? cleanLines[i]).trim();
    if (/\bstrategy\.entry\s*\(/.test(t)) entries.push(original);
    else if (/\bstrategy\.(close|exit)\s*\(/.test(t)) exits.push(original);
    if (/\balertcondition\s*\(|\balert\s*\(/.test(t)) alerts.push(original);
  }

  return { name, type, indicators, entries, exits, alerts };
}

/**
 * Fold a parsed Pine summary into a rules object's indicators + strategy
 * metadata. Returns a NEW rules object; does not mutate the input.
 */
export function mergePineIntoRules(rules, parsed, pinePath = null) {
  const indicators = {};
  for (const ind of parsed.indicators) {
    const cfg = ind.length != null ? { length: ind.length } : {};
    if (!indicators[ind.fn]) indicators[ind.fn] = [];
    indicators[ind.fn].push(cfg);
  }
  return {
    ...rules,
    strategy: {
      ...(rules.strategy || {}),
      name: parsed.name || rules.strategy?.name || "Imported Pine strategy",
      source: "pine-import",
      pine_script_path: pinePath,
    },
    indicators,
    entry_rules: {
      long: parsed.entries,
      short: [],
    },
    exit_rules: parsed.exits,
  };
}
