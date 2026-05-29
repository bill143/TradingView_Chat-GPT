// Mapping between the short names people use in conversation and the full
// indicator names TradingView expects in its "Indicators" search box.
//
// When the agent applies a strategy it should use the full name on the right
// (e.g. "Relative Strength Index"), not the abbreviation.

export const INDICATOR_NAMES = {
  rsi: "Relative Strength Index",
  macd: "MACD",
  ema: "Moving Average Exponential",
  sma: "Moving Average Simple",
  ma: "Moving Average Simple",
  vwap: "VWAP",
  atr: "Average True Range",
  bb: "Bollinger Bands",
  "bollinger bands": "Bollinger Bands",
  stoch: "Stochastic",
  "stochastic rsi": "Stochastic RSI",
  obv: "On Balance Volume",
  adx: "Average Directional Index",
  ichimoku: "Ichimoku Cloud",
  supertrend: "SuperTrend",
  volume: "Volume",
};

/**
 * Normalise a user-supplied indicator name to the TradingView full name.
 * Unknown names are returned unchanged (TradingView search is fuzzy).
 */
export function resolveIndicatorName(name) {
  if (!name) return name;
  const key = String(name).trim().toLowerCase();
  return INDICATOR_NAMES[key] || name;
}

/**
 * Count distinct indicator instances in a rules object, matching how
 * TradingView counts them per chart (three EMAs of different lengths = 3).
 */
export function countIndicators(rules) {
  const ind = rules?.indicators;
  if (!ind) return 0;
  if (Array.isArray(ind)) return ind.length;
  // Object form: each key may hold a single config or an array of configs.
  let total = 0;
  for (const value of Object.values(ind)) {
    total += Array.isArray(value) ? value.length : 1;
  }
  return total;
}

// TradingView indicator-per-chart limits by plan.
export const PLAN_LIMITS = {
  free: 2,
  basic: 2,
  essential: 5,
  plus: 10,
  premium: 25,
  ultimate: 50,
};

export function smallestPlanFor(count) {
  if (count <= 2) return "basic";
  if (count <= 5) return "essential";
  if (count <= 10) return "plus";
  if (count <= 25) return "premium";
  return "ultimate";
}
