import assert from "node:assert/strict";
import { buildRollingChanges } from "../logic/engine25IntradayMacro.js";

const HOUR = 3600;
const now = 10 * 24 * HOUR;
const bars = [];

for (let t = now - 6 * 24 * HOUR; t <= now; t += 10 * 60) {
  const ageHours = (now - t) / HOUR;
  const close = 200 - ageHours * 0.1;
  bars.push({
    time: t,
    open: close,
    high: close,
    low: close,
    close,
  });
}

const sessionStart = now - 12 * HOUR;
const out = buildRollingChanges(bars, now, sessionStart);

for (const key of ["2h", "1d", "2d", "5d", "session"]) {
  assert.equal(Number.isFinite(out.changesPct[key]), true, key);
}

assert.ok(out.changesPct["2h"] > 0);
assert.ok(out.changesPct["1d"] > out.changesPct["2h"]);
assert.ok(out.changesPct["2d"] > out.changesPct["1d"]);
assert.ok(out.changesPct["5d"] > out.changesPct["2d"]);

console.log("engine25MacroTrendHorizons.test.js PASS");
