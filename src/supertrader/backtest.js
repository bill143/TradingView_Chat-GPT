// Backtesting + composite fitness. A strategy is backtested bar-by-bar on an
// OHLC series; the resulting equity curve and trades are scored with the same
// composite fitness used by swarm-trader's AutoResearch loop:
//   score = 0.35*Sharpe + 0.25*Sortino + 0.20*Return + 0.10*WinRate + 0.10*ProfitFactor
// (each term squashed/clamped to keep the score bounded and comparable).

// Default assumes daily bars (~252 trading days/year). Pass periodsPerYear to
// annualise intraday or weekly series correctly.
const DEFAULT_PERIODS_PER_YEAR = 252;

/** Per-step simple returns from an equity curve. */
function returnsOf(curve) {
  const r = [];
  for (let i = 1; i < curve.length; i++) {
    if (curve[i - 1] > 0) r.push(curve[i] / curve[i - 1] - 1);
  }
  return r;
}

function mean(xs) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}
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
export function fitness(
  equityCurve,
  trades = [],
  { periodsPerYear = DEFAULT_PERIODS_PER_YEAR } = {}
) {
  const ann = Math.sqrt(periodsPerYear);
  const rets = returnsOf(equityCurve);
  const m = mean(rets);
  const sd = std(rets);
  const dsd = downsideStd(rets);
  const sharpe = sd > 0 ? (m / sd) * ann : 0;
  const sortino = dsd > 0 ? (m / dsd) * ann : 0;
  const totalReturn =
    equityCurve.length > 1 && equityCurve[0] > 0
      ? equityCurve[equityCurve.length - 1] / equityCurve[0] - 1
      : 0;

  const closed = trades.filter((t) => t.realized != null && t.realized !== 0);
  const wins = closed.filter((t) => t.realized > 0);
  const winRate = closed.length ? wins.length / closed.length : 0;
  const grossProfit = wins.reduce((a, t) => a + t.realized, 0);
  const grossLoss = -closed.filter((t) => t.realized < 0).reduce((a, t) => a + t.realized, 0);
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

  // Squash unbounded terms so the composite stays comparable across runs.
  const sq = (x, k) => Math.tanh(x / k); // -> (-1, 1)
  const score =
    0.35 * sq(sharpe, 2) +
    0.25 * sq(sortino, 2) +
    0.2 * Math.max(-1, Math.min(1, totalReturn)) +
    0.1 * (winRate * 2 - 1) +
    0.1 * sq(Number.isFinite(profitFactor) ? profitFactor - 1 : 3, 1.5);

  return {
    sharpe,
    sortino,
    totalReturn,
    winRate,
    profitFactor: Number.isFinite(profitFactor) ? profitFactor : null,
    trades: closed.length,
    score,
  };
}

/**
 * Backtest a single-symbol long/flat strategy over an OHLC series.
 * @param {Array<{open,high,low,close}>} series
 * @param {(ctx:{i, bar, closes}) => ('long'|'flat')} strategyFn
 * @param {object} [opts] { startCash, feePct }
 * @returns {{equityCurve, trades, finalEquity, fitness}}
 */
export function backtest(
  series,
  strategyFn,
  { startCash = 100000, feePct = 0, periodsPerYear = DEFAULT_PERIODS_PER_YEAR } = {}
) {
  let cash = startCash;
  let qty = 0;
  let avgPrice = 0;
  let entryTs = null;
  const equityCurve = [];
  const trades = [];
  const closes = [];
  // Decision carried from the prior bar, filled at THIS bar's open. The fill
  // price is unknown at decision time, so there is no look-ahead.
  let pending = "flat";

  for (let i = 0; i < series.length; i++) {
    const bar = series[i];
    const fillPrice = bar.open ?? bar.close;

    if (pending === "long" && qty === 0) {
      qty = Math.floor((cash * (1 - feePct)) / fillPrice);
      if (qty > 0) {
        cash -= qty * fillPrice * (1 + feePct);
        avgPrice = fillPrice;
        entryTs = i;
      }
    } else if (pending === "flat" && qty > 0) {
      const proceeds = qty * fillPrice * (1 - feePct);
      const realized = (fillPrice - avgPrice) * qty;
      cash += proceeds;
      trades.push({ entry: avgPrice, exit: fillPrice, qty, realized, entryTs, exitTs: i });
      qty = 0;
      avgPrice = 0;
      entryTs = null;
    }

    // Decide from data available up to and including this close; fills next bar.
    closes.push(bar.close);
    pending = strategyFn({ i, bar, closes });

    equityCurve.push(cash + qty * bar.close);
  }

  return {
    equityCurve,
    trades,
    finalEquity: equityCurve[equityCurve.length - 1] ?? startCash,
    fitness: fitness(equityCurve, trades, { periodsPerYear }),
  };
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
