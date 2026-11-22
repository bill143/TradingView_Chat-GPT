// Clean-room paper-trading broker. Alpaca/CCXT-style interface so a live adapter
// can later replace it behind the same methods. Fully in-memory + JSON
// persistable, deterministic, no network — this is the only execution path the
// Super Trader has. (Interface inspired by OctoBot's design; no GPL code copied.)

import fs from "node:fs";

export class PaperBroker {
  constructor({
    cash = 100000,
    positions = {},
    realizedPnL = 0,
    realizedPnLToday = 0,
    realizedPnLWeek = 0,
    dayStartEquity = null,
    weekStartEquity = null,
    history = [],
  } = {}) {
    this.cash = cash;
    this.positions = positions; // symbol -> { qty, avgPrice, sector }
    this.realizedPnL = realizedPnL; // lifetime realised
    this.realizedPnLToday = realizedPnLToday; // since dayStartEquity baseline
    this.realizedPnLWeek = realizedPnLWeek; // since weekStartEquity baseline
    // Baseline equity for the loss breakers includes pre-existing positions
    // (at avg price), not just cash, so thresholds aren't understated.
    const baseEquity =
      cash + Object.values(positions).reduce((s, p) => s + (p.qty || 0) * (p.avgPrice || 0), 0);
    this.dayStartEquity = dayStartEquity ?? baseEquity;
    this.weekStartEquity = weekStartEquity ?? baseEquity;
    this.history = history;
  }

  /** Account snapshot. `prices` (symbol->price) marks positions to market. */
  getAccount(prices = {}) {
    return {
      cash: this.cash,
      equity: this.equity(prices),
      positions: this.getPositions(),
      realizedPnL: this.realizedPnL,
    };
  }

  getPositions() {
    return Object.entries(this.positions)
      .filter(([, p]) => p.qty !== 0)
      .map(([symbol, p]) => ({ symbol, ...p }));
  }

  /** Mark-to-market equity = cash + sum(position qty * price). */
  equity(prices = {}) {
    let eq = this.cash;
    for (const [sym, p] of Object.entries(this.positions)) {
      const px = prices[sym] ?? p.avgPrice;
      eq += p.qty * px;
    }
    return eq;
  }

  /** State object in the shape risk.evaluateOrder expects. */
  riskState(prices = {}) {
    return {
      equity: this.equity(prices),
      cash: this.cash,
      dayStartEquity: this.dayStartEquity,
      weekStartEquity: this.weekStartEquity,
      realizedPnLToday: this.realizedPnLToday,
      realizedPnLWeek: this.realizedPnLWeek,
      positions: this.positions,
    };
  }

  /**
   * Fill a (market) order immediately at `order.price`. Returns the fill record.
   * Supports long entries/adds, and sells that reduce/close (or open a short).
   */
  submitOrder(order) {
    const { symbol, side, qty, price, sector = null } = order;
    if (!(qty > 0) || !(price > 0)) throw new Error("order needs positive qty and price");
    const signed = side === "buy" ? qty : -qty;
    const pos = this.positions[symbol] || { qty: 0, avgPrice: 0, sector };
    const newQty = pos.qty + signed;
    let realized = 0;

    const reducing = pos.qty !== 0 && Math.sign(signed) !== Math.sign(pos.qty);
    if (reducing) {
      // Realise P&L on the closed portion.
      const closedQty = Math.min(Math.abs(signed), Math.abs(pos.qty));
      realized = (price - pos.avgPrice) * closedQty * Math.sign(pos.qty);
      this.realizedPnL += realized;
      this.realizedPnLToday += realized;
      this.realizedPnLWeek += realized;
    }

    // Update average price only when increasing exposure in the current direction.
    let avgPrice = pos.avgPrice;
    if (pos.qty === 0 || Math.sign(signed) === Math.sign(pos.qty)) {
      const totalCost = pos.avgPrice * Math.abs(pos.qty) + price * Math.abs(signed);
      avgPrice = Math.abs(newQty) > 0 ? totalCost / Math.abs(newQty) : price;
    } else if (Math.sign(newQty) !== Math.sign(pos.qty) && newQty !== 0) {
      // Flipped through zero into a new direction: cost basis resets to fill.
      avgPrice = price;
    }

    this.cash -= signed * price; // buying spends cash, selling adds it
    if (newQty === 0) delete this.positions[symbol];
    else this.positions[symbol] = { qty: newQty, avgPrice, sector: pos.sector ?? sector };

    const fill = { symbol, side, qty, price, realized, ts: new Date().toISOString() };
    this.history.push(fill);
    return fill;
  }

  /** Reset the daily breaker baseline (call at session start). */
  rollDay(prices = {}) {
    this.dayStartEquity = this.equity(prices);
    this.realizedPnLToday = 0;
  }
  rollWeek(prices = {}) {
    this.weekStartEquity = this.equity(prices);
    this.realizedPnLWeek = 0;
  }

  toJSON() {
    return {
      cash: this.cash,
      positions: this.positions,
      realizedPnL: this.realizedPnL,
      realizedPnLToday: this.realizedPnLToday,
      realizedPnLWeek: this.realizedPnLWeek,
      dayStartEquity: this.dayStartEquity,
      weekStartEquity: this.weekStartEquity,
      history: this.history,
    };
  }

  save(path) {
    fs.writeFileSync(path, JSON.stringify(this.toJSON(), null, 2) + "\n");
  }

  static load(path) {
    if (!fs.existsSync(path)) return new PaperBroker();
    return new PaperBroker(JSON.parse(fs.readFileSync(path, "utf8")));
  }
}
