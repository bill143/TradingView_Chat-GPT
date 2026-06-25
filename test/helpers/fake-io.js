// A fake CDP I/O surface for testing the chart-driving logic without a real
// TradingView. It records every keystroke/key press and serves canned data for
// the three read expressions (active symbol, quote, indicator legend).
//
// Reads are routed by a unique marker in each expression so we don't couple the
// fake to the exact selector strings.

export function createFakeIO({ symbol = "BITSTAMP:BTCUSD", quote = null, indicators = [] } = {}) {
  const actions = [];
  const state = { symbol, quote, indicators };

  const io = {
    actions,
    state,
    async typeString(str) {
      actions.push({ op: "type", text: String(str) });
    },
    async pressKey(name) {
      actions.push({ op: "key", key: name });
    },
    async sleep() {
      // No real waiting in tests.
    },
    async click(selector) {
      actions.push({ op: "click", selector });
      return true;
    },
    async clickAt(x, y) {
      actions.push({ op: "clickAt", x, y });
    },
    async evaluate(expr) {
      actions.push({ op: "evaluate" });
      // Route by the stable marker each read expression carries, so the fake
      // stays decoupled from the exact (build-specific) selector strings.
      if (expr.includes("/*MARK:active*/")) return state.symbol;
      if (expr.includes("/*MARK:quote*/")) return state.quote;
      if (expr.includes("/*MARK:indicators*/")) return state.indicators;
      // Indicator result-row coordinate lookup: no DOM in tests, so report
      // "not found" and the caller simply skips the click.
      if (expr.includes("/*MARK:clickresult*/")) return null;
      throw new Error("FakeIO: unrecognised evaluate expression");
    },
  };

  // Convenience accessors for assertions.
  io.typed = () => actions.filter((a) => a.op === "type").map((a) => a.text);
  io.keys = () => actions.filter((a) => a.op === "key").map((a) => a.key);
  io.clicks = () => actions.filter((a) => a.op === "click").map((a) => a.selector);
  return io;
}
