// Morning brief: walk the watchlist, read each chart, and produce a plain,
// structured bias the agent can translate into English.
//
// The bias here is a transparent heuristic computed from whatever values we can
// actually read off the chart legend (last candle direction, RSI level, price
// vs. moving averages). It is intentionally simple and explainable — the agent
// layers the user's own bias_criteria narrative on top when it talks to them.

import { setSymbol, setTimeframe, readQuote, readIndicatorValues } from "./tradingview.js";

export function classify(quote, indicators) {
  const reasons = [];
  let score = 0;

  if (quote && quote.open != null && quote.close != null) {
    if (quote.close > quote.open) {
      score += 1;
      reasons.push("last candle closed up");
    } else if (quote.close < quote.open) {
      score -= 1;
      reasons.push("last candle closed down");
    }
  }

  for (const ind of indicators || []) {
    const title = (ind.title || "").toLowerCase();
    const v = ind.values?.[0];
    if (v == null) continue;
    if (title.includes("relative strength") || /\brsi\b/.test(title)) {
      if (v >= 55) { score += 1; reasons.push(`RSI ${v.toFixed(1)} (momentum up)`); }
      else if (v <= 45) { score -= 1; reasons.push(`RSI ${v.toFixed(1)} (momentum down)`); }
    }
    if ((title.includes("moving average") || /\bema\b|\bsma\b/.test(title)) && quote?.close != null) {
      if (quote.close > v) { score += 1; reasons.push(`price above ${ind.title}`); }
      else if (quote.close < v) { score -= 1; reasons.push(`price below ${ind.title}`); }
    }
  }

  let bias = "neutral";
  if (score >= 2) bias = "bullish";
  else if (score <= -2) bias = "bearish";

  return { bias, score, reasons };
}

/**
 * Build the brief for every symbol in the rules watchlist.
 * @param {object} rules normalised rules object
 */
export async function morningBrief(rules) {
  const tf = rules.default_timeframe;
  const results = [];

  for (const symbol of rules.watchlist) {
    try {
      await setSymbol(symbol);
      await setTimeframe(tf);
      const quote = await readQuote();
      const indicators = await readIndicatorValues();
      const { bias, score, reasons } = classify(quote, indicators);
      results.push({
        symbol,
        timeframe: tf,
        bias,
        score,
        reasons,
        quote,
        key_level: quote?.high != null && quote?.low != null
          ? { recent_high: quote.high, recent_low: quote.low }
          : null,
      });
    } catch (err) {
      results.push({ symbol, error: String(err.message || err) });
    }
  }

  return {
    generated_at: new Date().toISOString(),
    timeframe: tf,
    strategy: rules.strategy?.name || "Untitled",
    items: results,
  };
}
