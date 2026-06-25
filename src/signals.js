// Normalise indicator legend readings into a typed context, and evaluate
// structured strategy criteria against it.
//
// `bias_criteria` / `entry_rules` entries may be either:
//   - a plain-English string (narrative — kept, shown to the user, not scored)
//   - a structured object, e.g. { indicator: "rsi", op: ">=", value: 55 }
//                            or  { left: "close", op: ">", right: "ema:50" }
// Structured entries are evaluated against what we can actually read off the
// chart; references resolve to live values (close/open/high/low, rsi, atr, adx,
// macd[.line|.signal|.hist], ema:<len>/sma:<len>/ma:<len>) or numeric literals.

const num = (x) => (typeof x === "number" && !Number.isNaN(x) ? x : null);

export function classifyIndicator(title) {
  const t = (title || "").toLowerCase();
  if (t.includes("relative strength") || /\brsi\b/.test(t)) return "rsi";
  if (t.includes("macd")) return "macd";
  if (t.includes("average true range") || /\batr\b/.test(t)) return "atr";
  if (t.includes("average directional") || /\badx\b/.test(t)) return "adx";
  if (t.includes("moving average") || /\bema\b|\bsma\b|\bma\b/.test(t)) return "ma";
  if (t.includes("stochastic")) return "stoch";
  if (t.includes("bollinger")) return "bb";
  if (t.includes("vwap")) return "vwap";
  return "other";
}

export function lengthFromTitle(title) {
  const m = (title || "").match(/\b(\d{1,4})\b/);
  return m ? Number(m[1]) : null;
}

/**
 * Build a typed reading context from a quote + indicator legend array.
 */
export function buildContext(quote, indicators = []) {
  const ctx = {
    quote: quote || {},
    mas: [], // [{ length, value, title }]
    rsi: null,
    macd: null, // { line, signal, hist }
    atr: null,
    adx: null,
    readings: [],
  };

  for (const ind of Array.isArray(indicators) ? indicators : []) {
    const type = classifyIndicator(ind.title);
    const values = ind.values || [];
    const v = num(values[0]);
    const length = lengthFromTitle(ind.title);
    ctx.readings.push({ type, title: ind.title, values, length });

    if (type === "rsi" && v != null) ctx.rsi = v;
    else if (type === "atr" && v != null) ctx.atr = v;
    else if (type === "adx" && v != null) ctx.adx = v;
    else if (type === "macd")
      ctx.macd = { line: num(values[0]), signal: num(values[1]), hist: num(values[2]) };
    else if (type === "ma" && v != null) ctx.mas.push({ length, value: v, title: ind.title });
  }
  return ctx;
}

/**
 * Resolve a reference (string token or number) to a live value, or null.
 */
export function resolveRef(ctx, ref) {
  if (typeof ref === "number") return num(ref);
  if (ref == null) return null;
  const s = String(ref).toLowerCase().trim();
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  if (["close", "open", "high", "low"].includes(s)) return num(ctx.quote?.[s]);
  if (s === "rsi") return ctx.rsi;
  if (s === "atr") return ctx.atr;
  if (s === "adx") return ctx.adx;
  if (s === "macd" || s === "macd.line") return ctx.macd?.line ?? null;
  if (s === "macd.signal") return ctx.macd?.signal ?? null;
  if (s === "macd.hist") return ctx.macd?.hist ?? null;
  const ma = s.match(/^(?:ema|sma|ma):(\d+)$/);
  if (ma) {
    const found = ctx.mas.find((m) => m.length === Number(ma[1]));
    return found ? found.value : null;
  }
  return null;
}

const OPS = {
  ">": (a, b) => a > b,
  ">=": (a, b) => a >= b,
  "<": (a, b) => a < b,
  "<=": (a, b) => a <= b,
  "==": (a, b) => a === b,
  "!=": (a, b) => a !== b,
};

/**
 * Evaluate one criterion against the context.
 * @returns {{kind:string, status:string, text:string}}
 *   kind: "narrative" | "structured"
 *   status: "narrative" | "met" | "unmet" | "unknown"
 */
export function evaluateCriterion(ctx, criterion) {
  if (typeof criterion === "string") {
    return { kind: "narrative", status: "narrative", text: criterion };
  }
  if (!criterion || typeof criterion !== "object") {
    return { kind: "structured", status: "unknown", text: String(criterion) };
  }

  const left = criterion.left ?? criterion.indicator;
  const op = criterion.op;
  const right = criterion.right ?? criterion.value;
  const label = criterion.label || `${left} ${op} ${right}`;

  if (!OPS[op]) return { kind: "structured", status: "unknown", text: `${label} (bad op)` };

  const a = resolveRef(ctx, left);
  const b = resolveRef(ctx, right);
  if (a == null || b == null) {
    return { kind: "structured", status: "unknown", text: `${label} (no data)` };
  }
  return { kind: "structured", status: OPS[op](a, b) ? "met" : "unmet", text: label };
}

/**
 * Evaluate a list of criteria, returning per-entry results plus a count of
 * structured entries that were met.
 */
export function evaluateCriteria(ctx, list = []) {
  const results = (Array.isArray(list) ? list : []).map((c) => evaluateCriterion(ctx, c));
  const met = results.filter((r) => r.status === "met").length;
  return { results, met };
}
