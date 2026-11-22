// Offline tests for the Alpha Vantage providers. A fake fetch returns canned
// payloads — no network, no API key.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  bareSymbol,
  parseNewsSentiment,
  parseDailySeries,
  newsSentimentProvider,
  fetchDailySeries,
} from "../src/supertrader/providers/alphavantage.js";

const okFetch = (json) => async () => ({ ok: true, json: async () => json });

test("bareSymbol strips the exchange prefix", () => {
  assert.equal(bareSymbol("NASDAQ:AAPL"), "AAPL");
  assert.equal(bareSymbol("AAPL"), "AAPL");
  assert.equal(bareSymbol("BINANCE:BTCUSDT"), "BTCUSDT");
});

test("parseNewsSentiment averages ticker-specific scores and scales to -1..1", () => {
  const payload = {
    feed: [
      { ticker_sentiment: [{ ticker: "AAPL", ticker_sentiment_score: "0.35" }] },
      { ticker_sentiment: [{ ticker: "AAPL", ticker_sentiment_score: "0.35" }] },
      { ticker_sentiment: [{ ticker: "MSFT", ticker_sentiment_score: "-0.9" }] }, // ignored
    ],
  };
  const out = parseNewsSentiment(payload, "NASDAQ:AAPL");
  assert.equal(out.articles, 2);
  assert.ok(Math.abs(out.score - 1) < 1e-9); // 0.35 / 0.35 full-scale, clamped
  assert.ok(out.reasons[0].includes("bullish"));
});

test("parseNewsSentiment abstains with no coverage", () => {
  const out = parseNewsSentiment({ feed: [] }, "AAPL");
  assert.equal(out.score, 0);
  assert.equal(out.articles, 0);
});

test("newsSentimentProvider plugs into the sentiment signal shape", async () => {
  const provider = newsSentimentProvider({
    apiKey: "demo",
    fetchImpl: okFetch({
      feed: [{ ticker_sentiment: [{ ticker: "AAPL", ticker_sentiment_score: "-0.2" }] }],
    }),
  });
  const out = await provider("NASDAQ:AAPL");
  assert.ok(out.score < 0 && out.score >= -1);
  assert.ok(Array.isArray(out.reasons));
});

test("rate-limit / bad-key responses throw rather than returning garbage", async () => {
  const provider = newsSentimentProvider({
    apiKey: "demo",
    fetchImpl: okFetch({ Note: "Thank you for using Alpha Vantage! ... rate limit" }),
  });
  await assert.rejects(() => provider("AAPL"), /rate limited/);
});

test("parseDailySeries returns oldest-first OHLC bars", () => {
  const payload = {
    "Time Series (Daily)": {
      "2026-01-03": {
        "1. open": "3",
        "2. high": "4",
        "3. low": "2",
        "4. close": "3.5",
        "5. volume": "10",
      },
      "2026-01-02": {
        "1. open": "2",
        "2. high": "3",
        "3. low": "1",
        "4. close": "2.5",
        "5. volume": "20",
      },
    },
  };
  const bars = parseDailySeries(payload);
  assert.equal(bars.length, 2);
  assert.equal(bars[0].date, "2026-01-02"); // oldest first
  assert.equal(bars[1].close, 3.5);
});

test("fetchDailySeries requires an API key", async () => {
  const saved = process.env.ALPHAVANTAGE_API_KEY;
  delete process.env.ALPHAVANTAGE_API_KEY;
  try {
    await assert.rejects(() => fetchDailySeries("AAPL", { fetchImpl: okFetch({}) }), /API_KEY/);
  } finally {
    if (saved !== undefined) process.env.ALPHAVANTAGE_API_KEY = saved;
  }
});

test("fetchDailySeries returns parsed bars with an injected fetch", async () => {
  const bars = await fetchDailySeries("NASDAQ:AAPL", {
    apiKey: "demo",
    fetchImpl: okFetch({
      "Time Series (Daily)": {
        "2026-02-02": {
          "1. open": "1",
          "2. high": "2",
          "3. low": "1",
          "4. close": "1.5",
          "5. volume": "5",
        },
      },
    }),
  });
  assert.equal(bars.length, 1);
  assert.equal(bars[0].open, 1);
});
