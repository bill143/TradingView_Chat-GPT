# TradingView_Chat-GPT

[![CI](https://github.com/bill143/TradingView_Chat-GPT/actions/workflows/ci.yml/badge.svg)](https://github.com/bill143/TradingView_Chat-GPT/actions/workflows/ci.yml)

An [MCP](https://modelcontextprotocol.io) server that lets an AI agent (Codex,
Claude, etc.) read and drive a **live TradingView Desktop chart at the data
level** — real OHLC values off the chart, not screenshots or image recognition.

You talk to your agent in plain English; it reads your actual price data.

## How it works

TradingView Desktop is an Electron (Chromium) app. Launched with
`--remote-debugging-port`, it exposes the **Chrome DevTools Protocol (CDP)**.
This server attaches over CDP, evaluates JavaScript in the page to read the
chart legend, and synthesises keystrokes to switch symbols, change timeframes,
and add indicators — exactly as a human would.

```
your agent  ──MCP/stdio──▶  src/server.js  ──CDP:9222──▶  TradingView Desktop
```

## Setup

1. **Install** TradingView Desktop from <https://www.tradingview.com/desktop/>
   and Node.js 20+.
2. **Install deps:**
   ```bash
   npm install
   ```
3. **Launch TradingView with debugging enabled** (quits and relaunches it):
   - macOS: `scripts/launch_tv_debug_mac.sh`
   - Linux: `scripts/launch_tv_debug_linux.sh`
   - Windows: `scripts\launch_tv_debug.bat`
4. **Verify the connection:**
   ```bash
   npm run health
   ```
5. **Create your strategy file** from the template (won't overwrite an existing
   one):
   ```bash
   npm run init   # writes rules.json — then edit it
   ```
6. **Wire it into your MCP client.** Point the client at `src/server.js`, e.g.
   for Codex (`~/.codex/config.toml`):
   ```toml
   [mcp_servers.tradingview]
   command = "node"
   args = ["/absolute/path/to/this/repo/src/server.js"]
   ```

> **Security note:** `--remote-debugging-port` opens a local debugging endpoint
> any process on your machine can attach to. It binds to `127.0.0.1` only — keep
> it that way, and don't expose port 9222 beyond localhost.

## Tools

`tv_health_check`, `chart_set_symbol`, `chart_set_timeframe`,
`chart_manage_indicator`, `chart_read`, `chart_read_candles`,
`chart_list_indicators`, `strategy_apply`, `morning_brief`,
`strategy_plan_check`, `pine_summary`. See [CLAUDE.md](./CLAUDE.md) for details.

### Strategy criteria & Pine import

`bias_criteria` in `rules.json` accepts plain-English strings **or** structured
conditions that are evaluated live, e.g.
`{ "indicator": "rsi", "op": ">=", "value": 55 }` or
`{ "left": "close", "op": ">", "right": "ema:50" }`. `morning_brief` reports
which were met.

Import an existing Pine Script into your strategy:

```bash
node scripts/import_pine.js path/to/strategy.pine
```

### Super Trader (multi-agent engine)

A multi-agent decision engine layered on the chart reads above. Signal agents
(technical / quant / sentiment) feed a Portfolio Manager that aggregates and
sizes a proposed trade, which then passes through **code-enforced risk rails**
that no agent can override. Execution is advisory by default and only ever
touches a local paper-trading account.

- `supertrader_decide` — decide for one symbol (advisory).
- `supertrader_run` — decide across the whole `rules.json` watchlist.
- `supertrader_risk_check` — run a proposed order through the risk rails.
- `supertrader_backtest` — backtest an OHLC series and return a fitness score.
- `supertrader_paper_status` — current paper account, positions, and P&L.

Tune it with an optional `supertrader` block in `rules.json` (`risk`, `weights`,
`sizing`). Architecture and provenance: [docs/INTEGRATION_PLAN.md](./docs/INTEGRATION_PLAN.md).
Run the test suite with `npm test`.

## Daily brief

`scripts/morning_brief.js` runs the watchlist analysis without an MCP client.
Install it as a daily 08:00 cron job (idempotent — safe to re-run):

```bash
scripts/install_cron.sh            # 08:00 local time, logs to ~/brief.log
scripts/install_cron.sh 7          # use a different hour (24h)
scripts/install_cron.sh --uninstall
```

View results with `tail -f ~/brief.log`. Your machine must be awake with
TradingView running (CDP enabled) at that time for the brief to produce data.

On **Windows**, use Task Scheduler to run
`node scripts\morning_brief.js` daily instead.

## Configuration

Environment variables: `TV_CDP_HOST`, `TV_CDP_PORT` (default 9222),
`TV_RULES_PATH`, `TV_SETTLE_MS`.

## Development & testing

Tests use Node's built-in runner and don't require a running TradingView: the
chart-driving layer (`src/tradingview.js`, `src/brief.js`) takes an injectable
CDP `io` object, and tests pass a fake one (`test/helpers/fake-io.js`) that
records keystrokes and serves canned chart data.

```bash
npm run lint           # ESLint
npm run format         # Prettier (writes)
npm test               # test suite
npm run check          # lint + format check + syntax check + tests (the CI gate)
```

CI runs the same gate on Node 20 and 22 via GitHub Actions
(`.github/workflows/ci.yml`). See [CONTRIBUTING.md](./CONTRIBUTING.md) for the
full workflow.

### Verifying against a real chart

The driving layer is unit-tested against a fake chart. To validate it against a
**live** TradingView Desktop (selectors + keyboard flows), launch the debug app
and run:

```bash
npm run verify:live
```

See [docs/LIVE_VERIFICATION.md](./docs/LIVE_VERIFICATION.md) for the full
checklist and a ready-to-paste prompt for fixing whatever the live chart
reveals.

## Caveats

- The legend scrapers target TradingView's current DOM; UI changes may require
  updating selectors in `src/tradingview.js`.
- Indicator removal isn't scriptable via keyboard shortcuts — remove from the
  legend manually.

## License

MIT
