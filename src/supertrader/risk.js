// Code-enforced risk rails. This is the non-negotiable layer from
// zhound420/swarm-trader: no signal, LLM, or Portfolio-Manager proposal can
// bypass it. Given a proposed order and the current account state, it returns a
// decision that either approves the order (possibly with a reduced quantity) or
// rejects it, always with explicit reasons.
//
// `state` shape:
//   { equity, cash, dayStartEquity, weekStartEquity,
//     realizedPnLToday, realizedPnLWeek,
//     positions: { [symbol]: { qty, avgPrice, sector } } }
//
// `order` shape (from portfolio.proposeOrder):
//   { symbol, side: 'buy'|'sell', qty, price, stop, target, sector }

function notional(pos, price) {
  return Math.abs((pos?.qty || 0) * (price ?? pos?.avgPrice ?? 0));
}

function totalExposure(state, priceFor = () => null) {
  let sum = 0;
  for (const [sym, pos] of Object.entries(state.positions || {})) {
    sum += notional(pos, priceFor(sym) ?? pos.avgPrice);
  }
  return sum;
}

/**
 * Evaluate a proposed order against every hard rule.
 * @returns {{approved, adjustedQty, violations:string[], reason, order}}
 */
export function evaluateOrder(order, state, risk) {
  const violations = [];
  const equity = state.equity;
  const pos = state.positions?.[order.symbol];

  // A "sell" that only reduces/closes an existing long is always risk-reducing.
  const isReducing =
    order.side === "sell" && pos && pos.qty > 0;

  if (!isReducing) {
    // --- Circuit breakers (block all new risk) -------------------------------
    if (state.realizedPnLToday <= -risk.dailyLossLimitPct * state.dayStartEquity) {
      violations.push(
        `daily loss circuit breaker tripped (${(risk.dailyLossLimitPct * 100).toFixed(1)}%)`
      );
    }
    if (state.realizedPnLWeek <= -risk.weeklyLossLimitPct * state.weekStartEquity) {
      violations.push(
        `weekly loss circuit breaker tripped (${(risk.weeklyLossLimitPct * 100).toFixed(1)}%)`
      );
    }

    // --- Mandatory, sane stop loss ------------------------------------------
    if (risk.requireStopLoss) {
      if (order.stop == null) {
        violations.push("missing mandatory stop loss");
      } else {
        const valid =
          order.side === "buy" ? order.stop < order.price : order.stop > order.price;
        if (!valid) {
          violations.push("stop loss is on the wrong side of entry");
        } else {
          const dist = Math.abs(order.price - order.stop) / order.price;
          if (dist < risk.minStopDistancePct) violations.push("stop too tight");
          if (dist > risk.maxStopDistancePct) violations.push("stop too wide (per-trade risk too high)");
        }
      }
    }

    // --- Max open positions --------------------------------------------------
    const openCount = Object.values(state.positions || {}).filter((p) => p.qty !== 0).length;
    const isNewSymbol = !pos || pos.qty === 0;
    if (isNewSymbol && openCount >= risk.maxOpenPositions) {
      violations.push(`max open positions reached (${risk.maxOpenPositions})`);
    }

    // Hard blocks above can't be fixed by trimming size — stop here if any.
    if (violations.length) {
      return { approved: false, adjustedQty: 0, violations, reason: violations[0], order };
    }

    // --- Quantity caps (these trim size rather than hard-block) --------------
    const caps = [];

    // Per-position notional cap.
    const maxPosNotional = risk.maxPositionPct * equity;
    const existing = notional(pos, order.price);
    caps.push(("posCap"), Math.floor(Math.max(0, maxPosNotional - existing) / order.price));

    // Total exposure cap.
    const room = risk.maxTotalExposurePct * equity - totalExposure(state, () => order.price);
    caps.push(("expCap"), Math.floor(Math.max(0, room) / order.price));

    // Cash reserve cap (only buys consume cash in this sim).
    if (order.side === "buy") {
      const spendable = state.cash - risk.cashReservePct * equity;
      caps.push(("cashCap"), Math.floor(Math.max(0, spendable) / order.price));
    }

    // Per-sector cap (optional).
    if (order.sector && risk.maxSectorPct != null) {
      const maxSectorNotional = risk.maxSectorPct * equity;
      let sectorNotional = 0;
      for (const p of Object.values(state.positions || {})) {
        if (p.sector === order.sector) sectorNotional += notional(p, order.price);
      }
      caps.push(("sectorCap"), Math.floor(Math.max(0, maxSectorNotional - sectorNotional) / order.price));
    }

    // caps is [label, value, label, value, ...]; reduce to the binding limit.
    let adjustedQty = order.qty;
    for (let i = 1; i < caps.length; i += 2) {
      adjustedQty = Math.min(adjustedQty, caps[i]);
    }

    if (adjustedQty <= 0) {
      // Identify which cap bound it to zero for a useful reason.
      let label = "position/exposure/cash limits";
      for (let i = 0; i < caps.length; i += 2) {
        if (caps[i + 1] <= 0) { label = String(caps[i]); break; }
      }
      return {
        approved: false,
        adjustedQty: 0,
        violations: [`blocked by ${label}`],
        reason: `blocked by ${label}`,
        order,
      };
    }

    const trimmed = adjustedQty < order.qty;
    return {
      approved: true,
      adjustedQty,
      violations: trimmed ? [`quantity trimmed ${order.qty} -> ${adjustedQty} by risk caps`] : [],
      reason: trimmed ? "approved (size trimmed to fit risk caps)" : "approved",
      order: { ...order, qty: adjustedQty },
    };
  }

  // Risk-reducing sell: cap to the position size, always allowed.
  const adjustedQty = Math.min(order.qty, pos.qty);
  return {
    approved: true,
    adjustedQty,
    violations: [],
    reason: "approved (risk-reducing)",
    order: { ...order, qty: adjustedQty },
  };
}
