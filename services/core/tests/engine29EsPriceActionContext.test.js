import test from "node:test";
import assert from "node:assert/strict";

import {
  buildEngine29EsPriceActionContext,
} from "../logic/engine29/structure/buildEsPriceActionContext.js";

function day(time, close, open = close - 2, high = close + 5, low = close - 5) {
  return { time, date: new Date(time).toISOString().slice(0, 10), open, high, low, close, volume: 1000 };
}

function anchorFromCloses(closes) {
  const start = Date.parse("2026-01-05T00:00:00Z");
  const bars = closes.map((close, i) =>
    day(start + i * 24 * 60 * 60 * 1000, close)
  );
  return {
    resolvedSymbol: "ESZ6",
    source: "FRYE_FUTURES_OHLC_PROVIDER",
    dailyPriceActionSource: {
      resolvedSymbol: "ESZ6",
      bars,
    },
  };
}

test("rising ES daily price action publishes green supportive state", () => {
  const closes = Array.from({ length: 45 }, (_, i) => 7000 + i * 8);
  const result = buildEngine29EsPriceActionContext(anchorFromCloses(closes), {
    now: Date.parse("2026-03-15T12:00:00Z"),
  });

  assert.equal(result.daily.available, true);
  assert.equal(result.daily.state, "UPTREND_SUPPORTIVE");
  assert.equal(result.daily.color, "GREEN");
  assert.equal(result.longTermStructuralAuthority, false);
});

test("falling ES daily price action publishes red downward pressure", () => {
  const closes = Array.from({ length: 45 }, (_, i) => 7600 - i * 8);
  const result = buildEngine29EsPriceActionContext(anchorFromCloses(closes), {
    now: Date.parse("2026-03-15T12:00:00Z"),
  });

  assert.equal(result.daily.state, "DOWNWARD_PRESSURE");
  assert.equal(result.daily.color, "RED");
});

test("mixed ES price action publishes yellow wait state", () => {
  const closes = Array.from({ length: 45 }, (_, i) =>
    7300 + (i % 2 === 0 ? 10 : -10)
  );
  const result = buildEngine29EsPriceActionContext(anchorFromCloses(closes), {
    now: Date.parse("2026-03-15T12:00:00Z"),
  });

  assert.equal(result.daily.state, "WAIT_CONSOLIDATING");
  assert.equal(result.daily.color, "YELLOW");
});

test("weekly lane is recent current-contract context only", () => {
  const closes = Array.from({ length: 120 }, (_, i) => 6900 + i * 5);
  const result = buildEngine29EsPriceActionContext(anchorFromCloses(closes), {
    now: Date.parse("2026-05-31T12:00:00Z"),
  });

  assert.equal(result.weekly.available, true);
  assert.equal(result.weekly.longTermStructuralAuthority, false);
  assert.match(result.weekly.historyScope, /NOT_CONTINUOUS_LONG_TERM_HISTORY/);
});
