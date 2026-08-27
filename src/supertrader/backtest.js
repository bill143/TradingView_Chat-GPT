// Backtesting + composite fitness. A strategy is backtested bar-by-bar on an
// OHLC series; the resulting equity curve and trades are scored with the same
// composite fitness used by swarm-trader's AutoResearch loop:
//   score = 0.35*Sharpe + 0.25*Sortino + 0.20*Return + 0.10*WinRate + 0.10*ProfitFactor
// (each term squashed/clamped to keep the score bounded and comparable).

const ANNUALISATION = Math.sqrt(252);

/** Per-step simple returns from an equity curve. */
function returnsOf(curve) {
  const r = [];
  for (let i = 1; i < curve.length; i++) {
    if (curve[i - 1] > 0) r.push(curve[i] / curve[i - 1] - 1);
  }
  return r;
}

function mean(xs) { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0; }
function std(xs) {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
}
function downsideStd(xs) {
  const neg = xs.filter((x) => x < 0);
  if (neg.length < 1) return 0;
  return Math.sqrt(neg.reduce((a, b) => a + b * b, 0) / neg.length);
}

/** Compute the metric bundle + composite score from an equity curve and trades. */
export function fitness(equityCurve, trades = []) {
  const rets = returnsOf(equityCurve);
  const m = mean(rets);
  const sd = std(rets);
  const dsd = downsideStd(rets);
  const sharpe = sd > 0 ? (m / sd) * ANNUALISATION : 0;
  const sortino = dsd > 0 ? (m / dsd) * ANNUALISATION : 0;
  const totalReturn = equityCurve.length > 1 && equityCurve[0] > 0
    ? equityCurve[equityCurve.length - 1] / equityCurve[0] - 1
    : 0;

  const closed = trades.filter((t) => t.realized != null && t.realized !== 0);
  const wins = closed.filter((t) => t.realized > 0);
  const winRate = closed.length ? wins.length / closed.length : 0;
  const grossProfit = wins.reduce((a, t) => a + t.realized, 0);
  const grossLoss = -closed.filter((t) => t.realized < 0).reduce((a, t) => a + t.realized, 0);
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? Infinity : 0);

  // Squash unbounded terms so the composite stays comparable across runs.
  const sq = (x, k) => Math.tanh(x / k); // -> (-1, 1)
  const score =
    0.35 * sq(sharpe, 2) +
    0.25 * sq(sortino, 2) +
    0.20 * Math.max(-1, Math.min(1, totalReturn)) +
    0.10 * (winRate * 2 - 1) +
    0.10 * sq(Number.isFinite(profitFactor) ? profitFactor - 1 : 3, 1.5);

  return {
    sharpe, sortino, totalReturn, winRate,
    profitFactor: Number.isFinite(profitFactor) ? profitFactor : null,
    trades: closed.length, score,
  };
}

/**
 * Backtest a single-symbol long/flat strategy over an OHLC series.
 * @param {Array<{open,high,low,close}>} series
 * @param {(ctx:{i, bar, closes}) => ('long'|'flat')} strategyFn
 * @param {object} [opts] { startCash, feePct }
 * @returns {{equityCurve, trades, finalEquity, fitness}}
 */
export function backtest(series, strategyFn, { startCash = 100000, feePct = 0 } = {}) {
  let cash = startCash;
  let qty = 0;
  let avgPrice = 0;
  const equityCurve = [];
  const trades = [];
  const closes = [];

  for (let i = 0; i < series.length; i++) {
    const bar = series[i];
    closes.push(bar.close);
    const want = strategyFn({ i, bar, closes });

    if (want === "long" && qty === 0) {
      qty = Math.floor((cash * (1 - feePct)) / bar.close);
      if (qty > 0) { cash -= qty * bar.close * (1 + feePct); avgPrice = bar.close; }
    } else if (want === "flat" && qty > 0) {
      const proceeds = qty * bar.close * (1 - feePct);
      const realized = (bar.close - avgPrice) * qty;
      cash += proceeds;
      trades.push({ exit: bar.close, qty, realized, ts: i });
      qty = 0; avgPrice = 0;
    }
    equityCurve.push(cash + qty * bar.close);
  }

  return { equityCurve, trades, finalEquity: equityCurve[equityCurve.length - 1] ?? startCash, fitness: fitness(equityCurve, trades) };
}

/** Default reference strategy: long when fast SMA > slow SMA, else flat. */
export function smaCrossStrategy(fast = 10, slow = 30) {
  const sma = (xs, n) => (xs.length < n ? null : xs.slice(-n).reduce((a, b) => a + b, 0) / n);
  return ({ closes }) => {
    const f = sma(closes, fast);
    const s = sma(closes, slow);
    if (f == null || s == null) return "flat";
    return f > s ? "long" : "flat";
  };
}
