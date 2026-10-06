import test from "node:test";
import assert from "node:assert/strict";
import { fetchEngine3DiagnosticBars } from "../logic/engine3/fetchEngine3DiagnosticBars.js";
import { deriveCandleCompletionTruth } from "../logic/engine3/candleCompletionTruth.js";

test("native 1m and 5m requests preserve the exact timeframe", async () => {
  const urls = [];
  const fetchJson = async (url) => {
    urls.push(new URL(url));
    return { ok: true, json: { bars: [{ time: 100, close: 1 }] } };
  };
  await fetchEngine3DiagnosticBars({ timeframe: "1m", coreBase: "http://core", fetchJson });
  await fetchEngine3DiagnosticBars({ timeframe: "5m", coreBase: "http://core", fetchJson });
  assert.equal(urls[0].searchParams.get("timeframe"), "1m");
  assert.equal(urls[1].searchParams.get("timeframe"), "5m");
  assert.equal(urls[0].searchParams.get("limit"), "120");
});

test("unsupported 3m fails closed without calling transport", async () => {
  let called = false;
  const result = await fetchEngine3DiagnosticBars({
    timeframe: "3m",
    coreBase: "http://core",
    fetchJson: async () => { called = true; },
  });
  assert.equal(called, false);
  assert.equal(result.ok, false);
  assert.equal(result.reasonCode, "UNSUPPORTED_DIAGNOSTIC_TIMEFRAME");
});

test("1m and 5m use second bar timestamps and millisecond evaluation", () => {
  const start = 1_700_000_000;
  const one = deriveCandleCompletionTruth({ bars: [{ time: start }], timeframe: "1m", evaluationTimeMs: start * 1000 + 60_000 });
  const five = deriveCandleCompletionTruth({ bars: [{ time: start }], timeframe: "5m", evaluationTimeMs: start * 1000 + 300_000 });
  assert.equal(one.latestBarStartTimeMs, start * 1000);
  assert.equal(one.latestBarCompletionState, "COMPLETED");
  assert.equal(five.latestExpectedCloseTimeMs, start * 1000 + 300_000);
  assert.equal(five.latestBarCompletionState, "COMPLETED");
});
