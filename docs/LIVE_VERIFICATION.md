# Live verification (the Blockers, #1–#3)

Everything in this repo is unit-tested, but the code that actually drives
TradingView — the legend DOM scrapers and the keyboard flows — has only ever
run against a **fake** chart in CI. This guide validates it against a **real**
TradingView Desktop, which is the one thing a headless/cloud environment can't
do. Run it on the machine where TradingView Desktop is installed.

## What you're validating

1. **Legend selectors** — `readQuote`, `readIndicatorValues` return real numbers.
2. **Keyboard flows** — symbol switch, timeframe change, add-indicator (`/`).
3. **Symbol-switch confirmation** — the chart actually changed to what we asked.

## Steps

1. **Get the code and deps** (first time only):

   ```bash
   git clone https://github.com/bill143/TradingView_Chat-GPT.git
   cd TradingView_Chat-GPT
   npm install
   ```

   (If you already have it: `git pull` and `npm install`.)

2. **Launch TradingView with debugging on** (quits + relaunches it):
   - macOS: `scripts/launch_tv_debug_mac.sh`
   - Linux: `scripts/launch_tv_debug_linux.sh`
   - Windows: `scripts\launch_tv_debug.bat`

   Wait ~8 seconds for it to boot, and make sure a chart is showing.

3. **Confirm the connection:**

   ```bash
   npm run health
   ```

   You want `"cdp_connected": true` and `"tradingview_window": true`.

4. **Run the live verification:**

   ```bash
   npm run verify:live
   # or target a specific symbol/timeframe/indicator:
   node scripts/verify_live.js --symbol NASDAQ:AAPL --timeframe 60 --indicator "MACD"
   # machine-readable:
   node scripts/verify_live.js --json
   ```

5. **Read the result.** Each step prints `✓` pass, `!` warn, or `✗` fail:
   - `readQuote` **fail** or empty → the legend selectors need updating.
   - `setSymbol` **warn** (active symbol ≠ requested) → the search/Enter flow or
     timing (`TV_SETTLE_MS`) needs tuning.
   - `readIndicatorValues` empty after adding one → the `/` add-indicator flow or
     the legend selector is off.
   - `readCandles` **warn** (`available:false`) → expected; deep history isn't
     wired yet.

## Hand it to Claude Code to fix

On the same machine, open Claude Code in the repo and paste the prompt below. It
runs the harness, and fixes the selectors/timing against what the real chart
shows — committing on a branch and opening a PR.

```text
You're working in the TradingView_Chat-GPT MCP server repo. TradingView Desktop
is running on this machine with CDP debugging enabled (I already launched it with
scripts/launch_tv_debug_*). Your job is to validate and fix the live chart
interactions — the "Blockers" (#1–#3): the legend DOM selectors in
src/tradingview.js (readQuote, readIndicatorValues, getActiveSymbol) and the
keyboard flows (setSymbol, setTimeframe, manageIndicator) including timings.

Do this:
1. Run `npm run health` and confirm cdp_connected + tradingview_window are true.
   If not, stop and tell me what's wrong.
2. Run `node scripts/verify_live.js --json` and read the per-step results.
3. For every `fail`/`warn`, diagnose the cause against the LIVE page:
   - Use the CDP layer (src/cdp.js `evaluate`) to inspect the real DOM — find the
     actual selectors TradingView is using for the legend OHLC and indicator rows,
     and the right way to read the active symbol.
   - For keyboard flows that don't land, adjust the sequence and the sleep timings
     (SETTLE_MS in src/config.js / the per-step sleeps in src/tradingview.js).
   - Add symbol-switch confirmation/retry where setSymbol doesn't reliably land.
4. Re-run `node scripts/verify_live.js` until every step is `pass` (readCandles may
   stay `warn` — that's expected, deep history isn't wired).
5. Keep all existing unit tests green: `npm run check`. If you change read/parse
   logic, update or add tests using the fake-io harness (don't require a live
   chart in tests).
6. Work on a branch off main, commit with clear messages, and open a draft PR into
   main. Show me the before/after verify_live output in the PR body.

Be honest: if a selector only works on one chart type or TradingView build, say so
in a comment. Don't hard-code values you can't read.
```

When that PR's CI is green and you've eyeballed a couple of charts, the Blockers
are cleared and the whole app is verified end to end.
