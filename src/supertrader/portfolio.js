// Portfolio Manager: aggregate the swarm's signals into one consensus, then
// turn that consensus into a concretely-sized proposed order. Sizing is by
// confidence and risk budget; the hard caps live in risk.js (sizing here is a
// *proposal*, risk.js has final say). Pattern from zhound420/swarm-trader.

/**
 * Aggregate agent signals into a single weighted consensus.
 * Long counts positive, short negative; abstaining (flat) agents contribute 0.
 * @returns {{direction, confidence, net, weightUsed, breakdown}}
 */
export function aggregateSignals(signals, weights = {}) {
  let net = 0;
  let weightUsed = 0;
  const breakdown = [];
  for (const s of signals || []) {
    const w = weights[s.agent] ?? 0;
    if (w <= 0) continue;
    const dir = s.direction === "long" ? 1 : s.direction === "short" ? -1 : 0;
    const contribution = w * dir * s.confidence;
    net += contribution;
    // Only agents that actually vote (not flat) count toward the normalising
    // weight, so abstentions neither help nor dampen the consensus.
    if (dir !== 0) weightUsed += w;
    breakdown.push({ agent: s.agent, weight: w, direction: s.direction, confidence: s.confidence, contribution });
  }
  // Normalise by the weight that actually voted so abstentions don't dampen.
  const norm = weightUsed > 0 ? net / weightUsed : 0;
  let direction = "flat";
  if (norm > 0) direction = "long";
  else if (norm < 0) direction = "short";
  return { direction, confidence: Math.abs(norm), net: norm, weightUsed, breakdown };
}

/**
 * Derive a stop price for a proposed entry, preferring ATR when readable.
 * @returns {number|null}
 */
export function deriveStop(direction, price, { atr, sizing }) {
  if (!price || direction === "flat") return null;
  let distance;
  if (atr != null && atr > 0) distance = sizing.atrStopMult * atr;
  else distance = sizing.stopLossPct * price;
  return direction === "long" ? price - distance : price + distance;
}

/** Pull the ATR value out of a chart_read indicator legend, if present. */
export function readAtr(chart) {
  for (const ind of chart?.indicators || []) {
    const title = (ind.title || "").toLowerCase();
    if (title.includes("average true range") || /\batr\b/.test(title)) {
      const v = ind.values?.[0];
      if (v != null) return v;
    }
  }
  return null;
}

/**
 * Build a confidence-scaled proposed order from a consensus.
 * Risk-budget sizing: qty so that (entry - stop) * qty ≈ baseRiskPct * equity,
 * scaled by aggregate confidence. Returns null if consensus is too weak.
 * @returns {object|null} { symbol, side, qty, price, stop, target, sector }
 */
export function proposeOrder({ symbol, consensus, price, atr, equity, sizing, sector }) {
  if (!price || price <= 0 || equity <= 0) return null;
  if (consensus.direction === "flat") return null;
  if (consensus.confidence < sizing.minConfidence) return null;

  const stop = deriveStop(consensus.direction, price, { atr, sizing });
  if (stop == null) return null;
  const riskPerShare = Math.abs(price - stop);
  if (riskPerShare <= 0) return null;

  const riskBudget = sizing.baseRiskPct * equity * consensus.confidence;
  const qty = Math.floor(riskBudget / riskPerShare);
  if (qty <= 0) return null;

  const rDistance = riskPerShare * sizing.takeProfitR;
  const target = consensus.direction === "long" ? price + rDistance : price - rDistance;

  return {
    symbol,
    side: consensus.direction === "long" ? "buy" : "sell",
    qty,
    price,
    stop,
    target,
    sector: sector || null,
  };
}
