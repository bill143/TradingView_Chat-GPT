// Orchestrator: the swarm decision loop. Gathers agent signals, lets the
// Portfolio Manager aggregate + size a proposal, then puts that proposal through
// the code-enforced risk rails. Optionally executes the approved order on a
// (paper) broker. This is the single place signals → PM → risk → execution meet.

import { gatherSignals } from "./signals.js";
import { aggregateSignals, proposeOrder, readAtr } from "./portfolio.js";
import { evaluateOrder } from "./risk.js";
import { buildConfig } from "./config.js";

/**
 * Make a decision for one symbol. Pure w.r.t. inputs; does NOT execute unless a
 * `broker` is supplied and `execute` is true.
 *
 * @param {object} args
 * @param {object} [args.chart]    chart_read shape { symbol, quote, indicators }
 * @param {Array}  [args.series]   OHLC history for the quant agent / ATR fallback
 * @param {string} [args.symbol]
 * @param {number} args.equity     account equity for sizing
 * @param {object} args.state      risk state (e.g. broker.riskState())
 * @param {object} [args.config]   from buildConfig()
 * @param {Function} [args.sentimentProvider]
 * @param {string} [args.sector]
 * @returns {Promise<object>} decision
 */
export async function decide({ chart, series, symbol, equity, state, config, sentimentProvider, sector }) {
  const cfg = config || buildConfig();
  const sym = symbol || chart?.symbol?.symbol || chart?.symbol || "?";
  const price = chart?.quote?.close ?? series?.[series.length - 1]?.close ?? null;

  const signals = await gatherSignals({ chart, series, symbol: sym, sentimentProvider });
  const consensus = aggregateSignals(signals, cfg.weights);
  const atr = chart ? readAtr(chart) : null;

  const proposed = proposeOrder({
    symbol: sym, consensus, price, atr, equity, sizing: cfg.sizing, sector,
  });

  let risk = null;
  let action = "hold";
  if (proposed) {
    risk = evaluateOrder(proposed, state, cfg.risk);
    action = risk.approved ? (proposed.side === "buy" ? "buy" : "sell") : "rejected";
  } else {
    action = consensus.direction === "flat" ? "hold" : "hold (below confidence threshold)";
  }

  return {
    symbol: sym, price, action,
    consensus,
    signals,
    proposedOrder: risk?.approved ? risk.order : proposed,
    risk,
  };
}

/**
 * Decide for one symbol and, if approved, execute on the supplied broker.
 * @returns {Promise<{decision, fill}>}
 */
export async function decideAndTrade(args) {
  const { broker } = args;
  const prices = args.chart?.quote?.close ? { [args.symbol || args.chart?.symbol?.symbol]: args.chart.quote.close } : {};
  const state = args.state || broker.riskState(prices);
  const equity = args.equity ?? broker.equity(prices);
  const decision = await decide({ ...args, equity, state });
  let fill = null;
  if (broker && decision.risk?.approved) {
    fill = broker.submitOrder(decision.risk.order);
  }
  return { decision, fill };
}

/**
 * Run a watchlist via an injected chart reader (keeps this testable + offline).
 * @param {string[]} symbols
 * @param {(symbol:string)=>Promise<object>} readChart returns chart_read shape
 */
export async function runWatchlist(symbols, readChart, opts = {}) {
  const out = [];
  for (const symbol of symbols) {
    try {
      const chart = await readChart(symbol);
      out.push(await decide({ ...opts, chart, symbol }));
    } catch (err) {
      out.push({ symbol, error: String(err.message || err) });
    }
  }
  return out;
}
