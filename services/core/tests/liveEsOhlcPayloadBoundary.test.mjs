// P0 LIVE ES OHLC request-boundary regression. Static code invariant only;
// real provider/production candle availability requires separate verification.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const source = readFileSync(new URL("../routes/futuresOhlc.js", import.meta.url), "utf8");
test("Massive historical aggregate limit bounded to 5000 instead of 50000", () => {
  assert.match(source, /url\.searchParams\.set\("limit", "5000"\)/);
  assert.doesNotMatch(source, /url\.searchParams\.set\("limit", "50000"\)/);
});
test("retains canonical ES root resolver and existing response bar shape", () => {
  assert.match(source, /resolveFuturesContract\(requestedSymbol\)/);
  assert.match(source, /normFuturesAgg/);
  assert.match(source, /return res\.json\(bars\)/);
});
