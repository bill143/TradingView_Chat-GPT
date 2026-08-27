# Contributing

Thanks for helping improve the TradingView MCP server.

## Setup

```bash
npm install
```

Requires Node.js 20+ (see `.nvmrc`).

## Workflow

1. Branch off `main`.
2. Make your change.
3. Run the full local gate before pushing:
   ```bash
   npm run check    # lint + prettier --check + syntax check + tests
   ```
   Or individually:
   ```bash
   npm run lint           # ESLint
   npm run format         # Prettier (writes changes)
   npm run format:check   # Prettier (verify only)
   npm test               # Node test runner
   ```
4. Open a **draft pull request into `main`**. CI runs the same gate on Node 20
   and 22; get it green before marking the PR ready.

## Testing the chart-driving layer

The code that drives TradingView (`src/tradingview.js`, `src/brief.js`) takes an
injectable `io` object — the CDP interface — as its last argument, defaulting to
the real connection. Tests pass a **fake `io`** (`test/helpers/fake-io.js`) that
records keystrokes and serves canned chart data, so the logic is covered without
a running TradingView. Prefer extending that harness over reaching for the real
CDP layer in tests.

## Style

- ES modules, Node 20+ syntax.
- Formatting is owned by Prettier (`.prettierrc.json`) — don't hand-format.
- Keep the honesty notes accurate: if a TradingView interaction is unverified or
  fragile, say so in comments and in `CLAUDE.md`.
