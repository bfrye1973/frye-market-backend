import test from "node:test";
import assert from "node:assert/strict";
import { validateHistoryQuery } from "../routes/engine2HistoricalFutures.js";
test("history requires explicit ES contract, not continuous root",()=>{
 assert.equal(validateHistoryQuery({symbol:"ES",timeframe:"10m",from:"2026-04-01",to:"2026-04-15"}).error,"EXPLICIT_CONTRACT_REQUIRED");
 assert.equal(validateHistoryQuery({symbol:"ESM6",timeframe:"10m",from:"2026-04-01",to:"2026-04-15"}).symbol,"ESM6");
});
test("history validates bounded dates, resolutions and output limits",()=>{
 assert.equal(validateHistoryQuery({symbol:"ESM6",timeframe:"10m",from:"2026-01-01",to:"2026-04-01"}).error,"MAX_31_DAYS_PER_REQUEST");
 assert.equal(validateHistoryQuery({symbol:"ESM6",timeframe:"10m",from:"bad",to:"2026-04-01"}).error,"INVALID_DATE_RANGE");
 assert.equal(validateHistoryQuery({symbol:"ESM6",timeframe:"3m",from:"2026-04-01",to:"2026-04-10"}).error,"UNSUPPORTED_TIMEFRAME");
 assert.equal(validateHistoryQuery({symbol:"ESM6",timeframe:"10m",from:"2026-04-01",to:"2026-04-10",limit:6000}).error,"LIMIT_OUT_OF_RANGE");
});
