// Signal agents. Each agent inspects whatever data it is given and emits a
// uniform, auditable signal so the Portfolio Manager can aggregate votes.
//
// Signal shape:
//   { agent, symbol, direction: 'long'|'short'|'flat', confidence: 0..1,
//     score: number, reasons: string[] }
//
// Patterns borrowed: per-agent identity + reasons (HKUDS/AI-Trader), a swarm of
// specialist agents feeding one aggregator (zhound420/swarm-trader), sentiment
// as a first-class input (AI4Finance/FinGPT).

/** Map a raw bounded score in [-maxScore, maxScore] to direction + confidence. */
function scoreToSignal(agent, symbol, score, maxScore, reasons) {
  const norm = maxScore > 0 ? Math.max(-1, Math.min(1, score / maxScore)) : 0;
  let direction = "flat";
  if (norm > 0) direction = "long";
  else if (norm < 0) direction = "short";
  return { agent, symbol, direction, confidence: Math.abs(norm), score, reasons };
}

/**
 * Technical agent — reads the chart legend (the `chart_read` shape:
 * { symbol, quote, indicators }). Mirrors the heuristic in brief.js so the live
 * morning-brief view and the trader speak the same language.
 */
export function technicalSignal(chart) {
  const symbol = chart?.symbol?.symbol || chart?.symbol || "?";
  const quote = chart?.quote;
  const indicators = chart?.indicators || [];
  const reasons = [];
  let score = 0;
  let max = 0;

  if (quote && quote.open != null && quote.close != null) {
    max += 1;
    if (quote.close > quote.open) { score += 1; reasons.push("last candle closed up"); }
    else if (quote.close < quote.open) { score -= 1; reasons.push("last candle closed down"); }
  }

  for (const ind of indicators) {
    const title = (ind.title || "").toLowerCase();
    const v = ind.values?.[0];
    if (v == null) continue;
    if (title.includes("relative strength") || /\brsi\b/.test(title)) {
      max += 1;
      if (v >= 55) { score += 1; reasons.push(`RSI ${v.toFixed(1)} (momentum up)`); }
      else if (v <= 45) { score -= 1; reasons.push(`RSI ${v.toFixed(1)} (momentum down)`); }
    }
    if ((title.includes("moving average") || /\bema\b|\bsma\b/.test(title)) && quote?.close != null) {
      max += 1;
      if (quote.close > v) { score += 1; reasons.push(`price above ${ind.title}`); }
      else if (quote.close < v) { score -= 1; reasons.push(`price below ${ind.title}`); }
    }
  }

  return scoreToSignal("technical", symbol, score, max || 1, reasons);
}

/** Simple moving average of the last `n` closes. */
function sma(closes, n) {
  if (closes.length < n) return null;
  let s = 0;
  for (let i = closes.length - n; i < closes.length; i++) s += closes[i];
  return s / n;
}

/**
 * Quant agent — momentum/trend over an OHLC series (array of {open,high,low,close}).
 * Votes long when price > SMA and the SMA is rising; confidence scales with the
 * gap to the SMA. Needs history, so it abstains on a single bar.
 */
export function quantSignal(symbol, series, { fast = 10, slow = 30 } = {}) {
  const closes = (series || []).map((b) => b.close).filter((c) => c != null);
  if (closes.length < slow + 1) {
    return scoreToSignal("quant", symbol, 0, 1, ["insufficient history"]);
  }
  const last = closes[closes.length - 1];
  const fastMa = sma(closes, fast);
  const slowMa = sma(closes, slow);
  const prevSlowMa = sma(closes.slice(0, -1), slow);
  const reasons = [];
  let score = 0;
  const max = 2;

  if (fastMa > slowMa) { score += 1; reasons.push(`fast MA ${fast} above slow MA ${slow}`); }
  else if (fastMa < slowMa) { score -= 1; reasons.push(`fast MA ${fast} below slow MA ${slow}`); }

  if (prevSlowMa != null) {
    if (slowMa > prevSlowMa) { score += 0.5; reasons.push("trend rising"); }
    else if (slowMa < prevSlowMa) { score -= 0.5; reasons.push("trend falling"); }
  }

  // Distance of price from the slow MA adds conviction (bounded contribution).
  const gap = slowMa ? (last - slowMa) / slowMa : 0;
  score += Math.max(-0.5, Math.min(0.5, gap * 10));

  return scoreToSignal("quant", symbol, score, max, reasons);
}

/**
 * Sentiment agent — FinGPT-style input. By default it abstains (offline, no
 * network). Wire a real provider by passing `provider(symbol) -> { score: -1..1,
 * reasons?: string[] }` (e.g. a FinGPT/news-sentiment service).
 */
export async function sentimentSignal(symbol, { provider } = {}) {
  if (typeof provider !== "function") {
    return scoreToSignal("sentiment", symbol, 0, 1, ["no sentiment provider configured (stub)"]);
  }
  try {
    const out = await provider(symbol);
    const raw = Math.max(-1, Math.min(1, Number(out?.score) || 0));
    const reasons = Array.isArray(out?.reasons) && out.reasons.length
      ? out.reasons
      : [`sentiment score ${raw.toFixed(2)}`];
    return scoreToSignal("sentiment", symbol, raw, 1, reasons);
  } catch (err) {
    return scoreToSignal("sentiment", symbol, 0, 1, [`sentiment provider error: ${err.message}`]);
  }
}

/**
 * Gather all available agent signals for a symbol. Any input may be omitted;
 * the corresponding agent simply abstains.
 */
export async function gatherSignals({ chart, series, symbol, sentimentProvider } = {}) {
  const sym = symbol || chart?.symbol?.symbol || chart?.symbol || "?";
  const signals = [];
  if (chart) signals.push(technicalSignal(chart));
  if (series && series.length) signals.push(quantSignal(sym, series));
  signals.push(await sentimentSignal(sym, { provider: sentimentProvider }));
  return signals;
}
