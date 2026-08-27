// Thin wrapper around the Chrome DevTools Protocol (CDP).
//
// TradingView Desktop is an Electron app (Chromium under the hood). When it is
// launched with `--remote-debugging-port=9222`, it exposes a CDP endpoint that
// lets us attach to the running window and evaluate JavaScript in the page
// context. That is how we read the live chart "at the data level" rather than
// taking screenshots.

import CDP from "chrome-remote-interface";
import { CDP_HOST, CDP_PORT, TV_URL_MATCH } from "./config.js";

let cached = null;

/**
 * List the debuggable targets (windows/tabs) the running app exposes.
 */
export async function listTargets() {
  return CDP.List({ host: CDP_HOST, port: CDP_PORT });
}

/**
 * Pick the target that looks like the TradingView chart window.
 */
export async function findChartTarget() {
  const targets = await listTargets();
  const pages = targets.filter((t) => t.type === "page");
  const tv = pages.find((t) => TV_URL_MATCH.test(t.url || ""));
  return tv || pages[0] || null;
}

/**
 * Connect to the chart target and return a CDP client. The client is cached so
 * repeated tool calls reuse one socket; if the socket has dropped we reconnect.
 */
export async function getClient() {
  if (cached && !cached._closed) return cached;

  const target = await findChartTarget();
  if (!target) {
    throw new Error(
      `No debuggable TradingView window found on ${CDP_HOST}:${CDP_PORT}. ` +
        `Is TradingView Desktop running, launched with --remote-debugging-port=${CDP_PORT}? ` +
        `Use the scripts/launch_tv_debug_* helper.`
    );
  }

  const client = await CDP({ host: CDP_HOST, port: CDP_PORT, target });
  await client.Runtime.enable();
  await client.Page.enable();

  client._closed = false;
  client.on("disconnect", () => {
    client._closed = true;
    if (cached === client) cached = null;
  });

  cached = client;
  return client;
}

/**
 * Evaluate a JS expression inside the TradingView page and return the value.
 * `expression` should be an expression (it is wrapped so `await` works).
 */
export async function evaluate(expression) {
  const client = await getClient();
  const { result, exceptionDetails } = await client.Runtime.evaluate({
    expression: `(async () => { ${expression} })()`,
    awaitPromise: true,
    returnByValue: true,
  });
  if (exceptionDetails) {
    throw new Error(
      "In-page evaluation failed: " +
        (exceptionDetails.exception?.description || exceptionDetails.text)
    );
  }
  return result.value;
}

/**
 * Cheap liveness probe: can we reach CDP and is a TradingView window present?
 */
export async function healthCheck() {
  try {
    const target = await findChartTarget();
    if (!target) {
      return { cdp_connected: true, tradingview_window: false, target: null };
    }
    // Confirm we can actually evaluate inside the page.
    const title = await evaluate("return document.title;");
    return {
      cdp_connected: true,
      tradingview_window: true,
      target: { url: target.url, title },
    };
  } catch (err) {
    return { cdp_connected: false, tradingview_window: false, error: String(err.message || err) };
  }
}

// --- Keyboard input -------------------------------------------------------
// TradingView is driven largely by keyboard: type an interval to change the
// timeframe, type into the (mouse-opened) symbol/indicator search to filter.
// We synthesise those keystrokes via the CDP Input domain so the app behaves
// as if a human typed them. (Note: the "/" key opens SYMBOL search on this
// build, not the indicators dialog — that one is opened by mouse, below.)

const SPECIAL_KEYS = {
  Enter: { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" },
  Escape: { key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 },
  Backspace: { key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 },
  Tab: { key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 },
};

export async function pressKey(name) {
  const client = await getClient();
  const def = SPECIAL_KEYS[name];
  if (!def) throw new Error(`Unknown special key: ${name}`);
  await client.Input.dispatchKeyEvent({ type: "keyDown", ...def });
  await client.Input.dispatchKeyEvent({ type: "keyUp", ...def });
}

export async function typeString(str) {
  const client = await getClient();
  for (const ch of String(str)) {
    // IMPORTANT: only the `char` event may carry `text`. Chromium treats a
    // keyDown that *also* has `text` as itself producing input, so sending text
    // on both keyDown and char inserts every character TWICE ("RSI" -> "RRSSII").
    // That double-insertion was the root cause of the garbled symbols/searches
    // on TradingView Desktop 3.2.0. Keep keyDown/keyUp text-free (so the app's
    // keydown listeners still fire) and let `char` deliver the glyph once.
    await client.Input.dispatchKeyEvent({ type: "keyDown", key: ch });
    await client.Input.dispatchKeyEvent({ type: "char", key: ch, text: ch });
    await client.Input.dispatchKeyEvent({ type: "keyUp", key: ch });
  }
}

export function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// --- Mouse input ----------------------------------------------------------
// Some TradingView actions have no reliable keyboard path on this build (e.g.
// the "/" hotkey opens symbol search, NOT the indicators dialog). For those we
// click the real toolbar buttons / result rows. Coordinates come from the live
// element's bounding box, read in-page.

export async function clickAt(x, y) {
  const client = await getClient();
  await client.Input.dispatchMouseEvent({ type: "mouseMoved", x, y });
  await client.Input.dispatchMouseEvent({
    type: "mousePressed",
    x,
    y,
    button: "left",
    clickCount: 1,
  });
  await client.Input.dispatchMouseEvent({
    type: "mouseReleased",
    x,
    y,
    button: "left",
    clickCount: 1,
  });
}

/**
 * Click the centre of the first element matching `selector`. Returns false when
 * the selector isn't present, so callers can fall back or report honestly
 * rather than clicking blind coordinates.
 */
export async function click(selector) {
  const rect = await evaluate(
    `const el = document.querySelector(${JSON.stringify(selector)});
     if (!el) return null;
     const r = el.getBoundingClientRect();
     if (!r.width || !r.height) return null;
     return { x: r.x + r.width / 2, y: r.y + r.height / 2 };`
  );
  if (!rect) return false;
  await clickAt(rect.x, rect.y);
  return true;
}

export async function closeClient() {
  if (cached && !cached._closed) {
    try {
      await cached.close();
    } catch {
      /* ignore */
    }
  }
  cached = null;
}
