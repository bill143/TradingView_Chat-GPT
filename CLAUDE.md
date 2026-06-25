# Agent instructions — TradingView MCP

You are connected to a live **TradingView Desktop** chart through this MCP
server. You read the chart **at the data level** (real OHLC values from the
chart legend), not via screenshots.

## Tools

| Tool                     | What it does                                                                      |
| ------------------------ | --------------------------------------------------------------------------------- |
| `tv_health_check`        | Confirm TradingView Desktop is reachable over CDP. Run this first.                |
| `chart_set_symbol`       | Switch the chart to a ticker, e.g. `BITSTAMP:BTCUSD`.                             |
| `chart_set_timeframe`    | Change interval: `1,3,5,15,30,60,120,240,D,W,M`.                                  |
| `chart_manage_indicator` | Add an indicator. Use **full names** ("Relative Strength Index", not "RSI").      |
| `chart_read`             | Read active symbol + latest OHLC + indicator legend values.                       |
| `chart_read_candles`     | Best-effort recent OHLC series (may be `available:false` — see honesty notes).    |
| `chart_list_indicators`  | List legend indicators so you can tell the user exactly which to remove.          |
| `strategy_apply`         | Apply the whole `rules.json` strategy to one symbol.                              |
| `morning_brief`          | Walk the watchlist and return a bias + reasons + key levels per symbol.           |
| `strategy_plan_check`    | Count indicators and check against a TradingView plan's per-chart limit.          |
| `pine_summary`           | Parse a Pine Script (inline / path / `strategy.pine_script_path`) into its rules. |

## The strategy file

The user's strategy lives in `rules.json` (created from `rules.template.json`).
Read it before discussing strategy. Translate `morning_brief` output into plain
English — never dump raw JSON at the user.

`bias_criteria` entries may be plain-English strings (narrative, shown to the
user) **or** structured objects that are actually evaluated against the chart,
e.g. `{ "indicator": "rsi", "op": ">=", "value": 55 }` or
`{ "left": "close", "op": ">", "right": "ema:50" }`. References resolve to live
values: `close/open/high/low`, `rsi`, `atr`, `adx`, `macd[.line|.signal|.hist]`,
`ema:<len>`/`sma:<len>`. `morning_brief` reports which structured criteria were
met under each item's `criteria`.

To import a Pine Script: `node scripts/import_pine.js path/to/strategy.pine`
folds its indicators + entries/exits into `rules.json`, or use `pine_summary`
to just inspect one.

## Honesty notes

- Indicator **removal** isn't supported via keyboard shortcuts; use
  `chart_list_indicators` to identify them and tell the user to remove from the
  legend manually.
- `chart_manage_indicator` adds an indicator with its **default** inputs. A
  requested `length`/params are reported back (`requested_params`,
  `params_applied:false`) but must be set in the indicator's settings dialog.
- `chart_read_candles` is best-effort: TradingView Desktop doesn't expose its
  data model, so it may return `available:false`. Only the latest bar
  (`chart_read`) is reliably available — don't invent history.
- The legend scrapers in `src/tradingview.js` target TradingView's current DOM.
  If reads come back empty, the UI likely changed and the selectors need
  updating — say so rather than inventing values.
