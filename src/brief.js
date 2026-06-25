// Morning brief: walk the watchlist, read each chart, and produce a plain,
// structured bias the agent can translate into English.
//
// The bias is a transparent heuristic computed from whatever values we can
// actually read off the chart legend (candle direction, RSI, price vs. moving
// averages, MACD histogram) plus any *structured* bias_criteria the user
// defined. It stays simple and explainable — the agent layers the user's
// narrative on top when it talks to them.

import {
  setSymbol,
  setTimeframe,
  readQuote,
  readIndicatorValues,
  defaultIO,
} from "./tradingview.js";
import { buildContext, evaluateCriteria } from "./signals.js";

/**
 * @param {object} quote latest OHLC
 * @param {Array}  indicators legend readings
 * @param {object} [rules] optional rules — its bias_criteria is evaluated too
 */
export function classify(quote, indicators, rules = null) {
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

  const ctx = buildContext(quote, indicators);

  if (ctx.rsi != null) {
    if (ctx.rsi >= 55) {
      score += 1;
      reasons.push(`RSI ${ctx.rsi.toFixed(1)} (momentum up)`);
    } else if (ctx.rsi <= 45) {
      score -= 1;
      reasons.push(`RSI ${ctx.rsi.toFixed(1)} (momentum down)`);
    }
  }

  if (quote?.close != null) {
    for (const ma of ctx.mas) {
      if (quote.close > ma.value) {
        score += 1;
        reasons.push(`price above ${ma.title}`);
      } else if (quote.close < ma.value) {
        score -= 1;
        reasons.push(`price below ${ma.title}`);
      }
    }
  }

  if (ctx.macd) {
    const hist = ctx.macd.hist;
    const dir =
      hist != null
        ? hist
        : ctx.macd.line != null && ctx.macd.signal != null
          ? ctx.macd.line - ctx.macd.signal
          : null;
    if (dir != null && dir > 0) {
      score += 1;
      reasons.push("MACD histogram positive");
    } else if (dir != null && dir < 0) {
      score -= 1;
      reasons.push("MACD histogram negative");
    }
  }

  // Trend-strength context (ADX) and volatility (ATR) are reported, not voted:
  // they qualify a move rather than point a direction.
  const context = {};
  if (ctx.adx != null) {
    context.adx = ctx.adx;
    context.trend_strength = ctx.adx >= 25 ? "strong" : ctx.adx >= 20 ? "developing" : "weak";
  }
  if (ctx.atr != null) context.atr = ctx.atr;

  // Evaluate the user's structured bias_criteria, if any.
  let criteria = null;
  if (rules?.bias_criteria) {
    const bull = evaluateCriteria(ctx, rules.bias_criteria.bullish);
    const bear = evaluateCriteria(ctx, rules.bias_criteria.bearish);
    score += bull.met;
    score -= bear.met;
    for (const r of bull.results)
      if (r.status === "met") reasons.push(`bullish criterion met: ${r.text}`);
    for (const r of bear.results)
      if (r.status === "met") reasons.push(`bearish criterion met: ${r.text}`);
    criteria = { bullish: bull.results, bearish: bear.results };
  }

  let bias = "neutral";
  if (score >= 2) bias = "bullish";
  else if (score <= -2) bias = "bearish";

  return { bias, score, reasons, context, criteria };
}

/**
 * Build the brief for every symbol in the rules watchlist.
 * @param {object} rules normalised rules object
 */
export async function morningBrief(rules, io = defaultIO) {
  const tf = rules.default_timeframe;
  const results = [];

  for (const symbol of rules.watchlist) {
    try {
      await setSymbol(symbol, io);
      await setTimeframe(tf, io);
      const quote = await readQuote(io);
      const indicators = await readIndicatorValues(io);
      const { bias, score, reasons, context, criteria } = classify(quote, indicators, rules);
      results.push({
        symbol,
        timeframe: tf,
        bias,
        score,
        reasons,
        context,
        criteria,
        quote,
        key_level:
          quote?.high != null && quote?.low != null
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
