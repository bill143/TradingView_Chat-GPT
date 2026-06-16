# Super Trader — integration plan

Goal: fold the strongest *patterns* from five public AI-trading repos into this
TradingView MCP server, as an MIT-clean Node module that plugs into the chart
reads we already have. We borrow **architecture and discipline**, not code, so
there is no license contamination and no pretence of inherited "alpha".

## What we take from where

| Source repo | License | What we borrow (pattern, not code) | Where it lands |
|---|---|---|---|
| **zhound420/swarm-trader** | MIT | Multi-agent swarm → Portfolio-Manager aggregation → **code-enforced risk rails agents can't override** → execution → benchmarking. AutoResearch fitness function. | `signals.js`, `portfolio.js`, `risk.js`, `backtest.js`, `orchestrator.js` |
| **AI4Finance/FinGPT** | MIT | Sentiment/news signal as a first-class input. | `signals.js` → `sentimentSignal` (pluggable provider; offline stub by default) |
| **Drakkar-Software/OctoBot** | **GPL-3.0** | *Design only* (studied, never linked/copied): paper-broker + backtest separation, exchange-style order interface. Kept as an isolated interface so this repo stays MIT. | `broker.js` (clean-room `PaperBroker`) |
| **HKUDS/AI-Trader** | mixed | Signals carry agent identity + reasons (auditability), advisory mode. | signal shape across the engine |
| chatgpt-trading-bot | unclear | **Dropped** — SEO/marketing-grade, nothing additive, provenance risk. | — |

## Architecture

```
chart_read / OHLC series
        │
        ▼
  Signal agents  ── technical (chart legend)  ┐
                 ── quant (OHLC momentum)      ├─►  Portfolio Manager
                 ── sentiment (FinGPT, plug)  ┘     (weighted aggregation)
                                                          │
                                                          ▼
                                              proposed order (size by confidence)
                                                          │
                                                          ▼
                                       Risk manager  (11 hard rules, non-overridable)
                                                          │
                                              approve / adjust / reject
                                                          │
                                                          ▼
                                       PaperBroker (offline sim) ── status / P&L
                                                          │
                                              backtest.js ──► fitness score
```

## Non-negotiable principles (from swarm-trader)

1. **Risk is code, not prompt.** No agent/LLM output can bypass `risk.js`.
2. **Paper / simulation first.** `PaperBroker` is the only execution path here; a
   live adapter is a future drop-in behind the same interface.
3. **Every signal is auditable.** Each carries `agent`, `confidence`, `reasons`.
4. **Honesty.** Signals are heuristic and the sentiment agent is a stub until a
   real FinGPT/provider is wired. This is a disciplined *platform*, not proven edge.

## Modules

- `src/supertrader/config.js` — defaults + merge of `rules.json.supertrader` block.
- `src/supertrader/signals.js` — agent interface + technical/quant/sentiment agents.
- `src/supertrader/portfolio.js` — signal aggregation + confidence-scaled sizing.
- `src/supertrader/risk.js` — code-enforced risk rails (`evaluateOrder`).
- `src/supertrader/broker.js` — clean-room `PaperBroker` (Alpaca-style interface).
- `src/supertrader/backtest.js` — bar-by-bar backtest + composite fitness.
- `src/supertrader/orchestrator.js` — wires signals → PM → risk → broker.

## MCP tools added

- `supertrader_decide` — live advisory decision for one symbol (technical + sentiment + risk check).
- `supertrader_run` — same across the `rules.json` watchlist.
- `supertrader_risk_check` — run a proposed order through the risk rails.
- `supertrader_backtest` — backtest an OHLC series and return the fitness score.
- `supertrader_paper_status` — current paper-trading account + positions.

## Testing

`node --test` (built-in, no new deps). Deterministic, fully offline: risk rules,
aggregation, sizing, paper broker fills/P&L, backtest fitness, and an end-to-end
orchestrator decision. `npm test` must pass.
</invoke>
