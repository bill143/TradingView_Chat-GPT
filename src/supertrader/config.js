// Super Trader configuration: defaults plus a merge of any `supertrader` block
// the user adds to rules.json. Everything here is tunable; the risk defaults are
// deliberately conservative (modelled on swarm-trader's swing-trade rails).

export const DEFAULT_RISK = {
  maxPositionPct: 0.08,      // max notional of a single position / equity
  maxTotalExposurePct: 1.0,  // sum of all position notional / equity
  maxOpenPositions: 10,
  requireStopLoss: true,     // reject risk-increasing orders with no stop
  minStopDistancePct: 0.001, // stop must be at least this far from entry
  maxStopDistancePct: 0.15,  // ...and no further (caps per-trade risk)
  dailyLossLimitPct: 0.02,   // circuit breaker on realised P&L since day start
  weeklyLossLimitPct: 0.05,  // circuit breaker on realised P&L since week start
  cashReservePct: 0.05,      // always keep at least this fraction in cash
  maxSectorPct: 0.30,        // optional: max notional per sector / equity
};

// How much each agent's vote counts when the Portfolio Manager aggregates.
export const DEFAULT_WEIGHTS = {
  technical: 0.5,
  quant: 0.3,
  sentiment: 0.2,
};

// Sizing + stop/target defaults used when ATR isn't available.
export const DEFAULT_SIZING = {
  baseRiskPct: 0.01,   // risk ~1% of equity per trade (entry→stop distance)
  stopLossPct: 0.07,   // fallback stop distance if no ATR
  takeProfitR: 2.0,    // target = R-multiple of the stop distance
  atrStopMult: 2.0,    // stop = atrStopMult * ATR when ATR is readable
  minConfidence: 0.15, // below this aggregate confidence => hold
};

/**
 * Build an effective config by layering a user override on top of the defaults.
 * @param {object} [override] e.g. rules.supertrader
 */
export function buildConfig(override = {}) {
  return {
    risk: { ...DEFAULT_RISK, ...(override.risk || {}) },
    weights: { ...DEFAULT_WEIGHTS, ...(override.weights || {}) },
    sizing: { ...DEFAULT_SIZING, ...(override.sizing || {}) },
  };
}
