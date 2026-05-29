# Agent instructions — TradingView MCP

You are connected to a live **TradingView Desktop** chart through this MCP
server. You read the chart **at the data level** (real OHLC values from the
chart legend), not via screenshots.

## Tools

| Tool | What it does |
|------|--------------|
| `tv_health_check` | Confirm TradingView Desktop is reachable over CDP. Run this first. |
| `chart_set_symbol` | Switch the chart to a ticker, e.g. `BITSTAMP:BTCUSD`. |
| `chart_set_timeframe` | Change interval: `1,3,5,15,30,60,120,240,D,W,M`. |
| `chart_manage_indicator` | Add an indicator. Use **full names** ("Relative Strength Index", not "RSI"). |
| `chart_read` | Read active symbol + latest OHLC + indicator legend values. |
| `strategy_apply` | Apply the whole `rules.json` strategy to one symbol. |
| `morning_brief` | Walk the watchlist and return a bias + reasons + key levels per symbol. |
| `strategy_plan_check` | Count indicators and check against a TradingView plan's per-chart limit. |

## The strategy file

The user's strategy lives in `rules.json` (created from `rules.template.json`).
Read it before discussing strategy. Translate `morning_brief` output into plain
English — never dump raw JSON at the user.

## Honesty notes

- Indicator **removal** isn't supported via keyboard shortcuts; tell the user to
  remove it from the legend manually.
- The legend scrapers in `src/tradingview.js` target TradingView's current DOM.
  If reads come back empty, the UI likely changed and the selectors need
  updating — say so rather than inventing values.
