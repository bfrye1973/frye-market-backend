import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const source=readFileSync(new URL("../jobs/buildStrategySnapshot.js",import.meta.url),"utf8");
test("production assembly passes only Engine10 OPEN PAPER resolution to existing v5 lock",()=>{
 assert.match(source,/resolveEngine10OpenPaperDirection\(\{\s*trades:\s*engine26OpenPaperTrades/);
 assert.match(source,/buildEngine3V5Shadow\(\{\s*openTradeActive:\s*engine3OpenPaperLock\.openTradeActive,/);
 assert.match(source,/lockedTradeDirection:\s*engine3OpenPaperLock\.lockedTradeDirection/);
});
