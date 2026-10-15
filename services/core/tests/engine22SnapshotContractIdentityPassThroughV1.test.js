import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const src=fs.readFileSync(new URL("../jobs/buildStrategySnapshot.js",import.meta.url),"utf8");
test("same-response debug contract is requested only for ES 10m",()=>{
 assert.match(src,/if \(symbol === "ES" && tf === "10m"\) u\.searchParams\.set\("debug", "1"\)/);
 assert.match(src,/resolvedContract: symbol === "ES" && tf === "10m"/);
 assert.match(src,/candlePriceBasis: symbol === "ES" && tf === "10m"/);
});
test("resolved contract and raw price basis reach Engine22 without guessing",()=>{
 assert.match(src,/engine22TouchResolvedContract:\s*marketMeter\?\.layers\?\.emaPosture\?\.tenMinute\?\.resolvedContract \|\| null/);
 assert.match(src,/engine22TouchPriceBasis:\s*marketMeter\?\.layers\?\.emaPosture\?\.tenMinute\?\.candlePriceBasis \|\| null/);
});

test("missing or unverified OHLC price basis does not become RAW_UNADJUSTED_CONTRACT",()=>{
 assert.match(src,/r\?\.json\?\.priceBasis === "RAW_UNADJUSTED_CONTRACT"/);
 assert.match(src,/r\?\.json\?\.priceBasisVerified === true/);
 assert.match(src,/r\?\.json\?\.priceBasisSeriesId === r\.json\.resolvedSymbol/);
 assert.doesNotMatch(src,/typeof r\?\.json\?\.resolvedSymbol === "string"\s*\? "RAW_UNADJUSTED_CONTRACT"/);
});
