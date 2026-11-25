import test from "node:test";
import assert from "node:assert/strict";
import {buildQqqKeyLevelsV1} from "../logic/engine27/crossMarket/buildQqqKeyLevelsV1.js";
const rows=[
["2026-10-13",744.20,738.83,743.57],
["2026-10-14",740.53,726.39,728.95],
["2026-10-15",729.43,715.44,728.00],
["2026-10-16",725.96,707.23,709.80],
["2026-10-19",724.55,716.57,718.36],
["2026-10-20",722.75,710.39,717.63],
["2026-10-21",727.95,719.71,725.20],
["2026-10-22",715.43,701.90,704.47],
["2026-10-23",709.30,701.16,704.40]
];
const bars=rows.map(([time,high,low,close])=>({time,high,low,close,completed:true}));
const run=(more={})=>buildQqqKeyLevelsV1({candles:bars,source:"QQQ_DAILY_OHLC_FIXTURE",asOf:"2026-10-24T12:00:00Z",...more});
test("QQQ daily OHLC discovers nearby support without manually seeded 700",()=>{
 const o=run();assert.equal(o.available,true);assert.equal(o.schema,"engine27.qqqKeyLevels.v1");
 assert.ok(o.levels.some(l=>l.type==="SUPPORT_CANDIDATE"&&l.low>=699&&l.high<=705));
 assert.equal(o.noExecution,true);
});
test("Missing feed or stale source fails closed, no inferred levels",()=>{
 assert.equal(run({source:null}).available,false);
 assert.equal(run({asOf:"2026-11-10T00:00:00Z"}).available,false);
 assert.equal(run({symbol:"VIX"}).available,false);
});
test("Does not mutate candles and never asserts price-based confirmation",()=>{
 const before=structuredClone(bars);const o=run();
 assert.deepEqual(bars,before);
 assert.ok(o.levels.every(l=>l.status==="WATCH"&&l.verifiedBreak===false));
});
