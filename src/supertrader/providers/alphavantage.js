// Alpha Vantage data providers for the Super Trader engine.
//
// Two pluggable providers, both dependency-injected (pass `fetchImpl` in tests;
// defaults to the global fetch) and keyed by ALPHAVANTAGE_API_KEY so nothing
// here needs network or a key to be unit-tested:
//
//   - newsSentimentProvider  -> the sentimentSignal({ provider }) interface
//   - fetchDailySeries       -> OHLC history for the quant agent / backtest
//
// TradingView tickers carry an exchange prefix ("NASDAQ:AAPL"); Alpha Vantage
// wants the bare symbol, so we strip it.

const BASE_URL = "https://www.alphavantage.co/query";

/** "NASDAQ:AAPL" -> "AAPL"; "AAPL" -> "AAPL". */
export function bareSymbol(symbol) {
  return String(symbol || "")
    .split(":")
    .pop()
    .trim();
}

function requireKey(apiKey) {
  const key = apiKey ?? process.env.ALPHAVANTAGE_API_KEY;
  if (!key) throw new Error("ALPHAVANTAGE_API_KEY is not set");
  return key;
}

async function getJson(url, fetchImpl) {
  const f = fetchImpl ?? globalThis.fetch;
  if (typeof f !== "function") throw new Error("no fetch implementation available");
  const res = await f(url);
  if (!res.ok) throw new Error(`Alpha Vantage HTTP ${res.status}`);
  const json = await res.json();
  // Alpha Vantage returns 200 with a Note/Information body on rate-limit / bad key.
  if (json?.Note) throw new Error(`Alpha Vantage rate limited: ${json.Note}`);
  if (json?.Information) throw new Error(`Alpha Vantage: ${json.Information}`);
  if (json?.["Error Message"]) throw new Error(`Alpha Vantage: ${json["Error Message"]}`);
  return json;
}

// Alpha Vantage sentiment scores run roughly -0.35 (bearish) .. +0.35 (bullish);
// scale into the engine's -1..1 range and clamp.
const AV_SENTIMENT_FULL_SCALE = 0.35;

/**
 * Parse a NEWS_SENTIMENT payload into the engine's { score, reasons } shape.
 * Averages the ticker-specific sentiment across the feed; abstains (score 0)
 * when there is no coverage.
 * @returns {{score:number, reasons:string[], articles:number}}
 */
export function parseNewsSentiment(payload, symbol) {
  const want = bareSymbol(symbol).toUpperCase();
  const feed = Array.isArray(payload?.feed) ? payload.feed : [];
  const scores = [];
  for (const item of feed) {
    const ts = Array.isArray(item?.ticker_sentiment) ? item.ticker_sentiment : [];
    const match = ts.find((t) => String(t.ticker || "").toUpperCase() === want);
    const raw = match ? Number(match.ticker_sentiment_score) : NaN;
    if (Number.isFinite(raw)) scores.push(raw);
  }
  if (scores.length === 0) {
    return { score: 0, reasons: ["no recent news coverage"], articles: 0 };
  }
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  const score = Math.max(-1, Math.min(1, avg / AV_SENTIMENT_FULL_SCALE));
  const label = score > 0.4 ? "bullish" : score < -0.4 ? "bearish" : "mixed/neutral";
  return {
    score,
    reasons: [`${label} news (${scores.length} articles, avg ${avg.toFixed(3)})`],
    articles: scores.length,
  };
}

/**
 * Build a sentiment provider bound to a symbol-fetching closure, suitable for
 * `sentimentSignal({ provider })` / `decide({ sentimentProvider })`.
 * @returns {(symbol:string)=>Promise<{score:number, reasons:string[]}>}
 */
export function newsSentimentProvider({ apiKey, fetchImpl, limit = 50 } = {}) {
  return async (symbol) => {
    const key = requireKey(apiKey);
    const tickers = bareSymbol(symbol).toUpperCase();
    const url = `${BASE_URL}?function=NEWS_SENTIMENT&tickers=${encodeURIComponent(tickers)}&limit=${limit}&apikey=${encodeURIComponent(key)}`;
    const payload = await getJson(url, fetchImpl);
    return parseNewsSentiment(payload, symbol);
  };
}

/** Parse a TIME_SERIES_DAILY payload into oldest-first OHLC bars. */
export function parseDailySeries(payload) {
  const series = payload?.["Time Series (Daily)"];
  if (!series || typeof series !== "object") return [];
  return Object.keys(series)
    .sort() // ISO dates sort chronologically
    .map((date) => {
      const row = series[date];
      return {
        date,
        open: Number(row["1. open"]),
        high: Number(row["2. high"]),
        low: Number(row["3. low"]),
        close: Number(row["4. close"]),
        volume: Number(row["5. volume"]),
      };
    })
    .filter((b) => Number.isFinite(b.close));
}

/**
 * Fetch recent daily OHLC bars (oldest first) for a symbol.
 * @returns {Promise<Array<{date,open,high,low,close,volume}>>}
 */
export async function fetchDailySeries(symbol, { apiKey, fetchImpl, outputsize = "compact" } = {}) {
  const key = requireKey(apiKey);
  const sym = bareSymbol(symbol).toUpperCase();
  const url = `${BASE_URL}?function=TIME_SERIES_DAILY&symbol=${encodeURIComponent(sym)}&outputsize=${outputsize}&apikey=${encodeURIComponent(key)}`;
  const payload = await getJson(url, fetchImpl);
  return parseDailySeries(payload);
}
