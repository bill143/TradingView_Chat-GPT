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
    async evaluate(expr) {
      actions.push({ op: "evaluate" });
      if (expr.includes("return document.title.trim();")) return state.symbol;
      if (expr.includes("out.open = nums[0]")) return state.quote;
      if (expr.includes("const sources =")) return state.indicators;
      throw new Error("FakeIO: unrecognised evaluate expression");
    },
  };

  // Convenience accessors for assertions.
  io.typed = () => actions.filter((a) => a.op === "type").map((a) => a.text);
  io.keys = () => actions.filter((a) => a.op === "key").map((a) => a.key);
  return io;
}
