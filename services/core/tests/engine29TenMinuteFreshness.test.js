import test from "node:test";
import assert from "node:assert/strict";
import { evaluateFreshness, ENGINE29_FRESHNESS_DEFAULTS } from "../logic/engine29/data/validateFreshness.js";

test("10m source freshness uses Engine29 intraday—not daily—budget on weekdays", () => {
 const now=Date.parse("2026-11-23T18:00:00Z");
 const latestTime=now-20*60*60*1000;
 const live=evaluateFreshness({latestTime,timeframe:"10m",now});
 const daily=evaluateFreshness({latestTime,timeframe:"1D",now});
 assert.equal(live.maxAgeMs,ENGINE29_FRESHNESS_DEFAULTS.THIRTY_MIN_MAX_AGE_MS);
 assert.equal(live.stale,true);
 assert.equal(live.reason,"AGE_EXCEEDED");
 assert.equal(daily.stale,false);
});
test("10m source inherits existing Engine29 intraday weekend policy", () => {
 const now=Date.parse("2026-11-22T18:00:00Z");
 const live=evaluateFreshness({latestTime:now-20*60*60*1000,timeframe:"10m",now});
 assert.equal(live.maxAgeMs,ENGINE29_FRESHNESS_DEFAULTS.WEEKEND_THIRTY_MIN_MAX_AGE_MS);
 assert.equal(live.stale,false);
});
