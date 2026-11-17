import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const source=readFileSync(new URL("../jobs/buildStrategySnapshot.js",import.meta.url),"utf8");
test("production assembly passes only Engine10 OPEN PAPER resolution to existing v5 lock",()=>{
 assert.match(source,/resolveEngine10OpenPaperDirection\(\{\s*trades:\s*engine26OpenPaperTrades/);
 assert.match(source,/readSucceeded:\s*engine26OpenPaperTradesReadSucceeded/);
 assert.match(source,/engine3OpenPaperLockDiagnostic\s*=/);
 assert.match(source,/buildEngine3V5Shadow\(\{\s*openTradeActive:\s*engine3OpenPaperLock\.openTradeActive,/);
 assert.match(source,/lockedTradeDirection:\s*engine3OpenPaperLock\.lockedTradeDirection/);
});

test("v6 shadow is published beside, never in place of, canonical v5",()=>{
 const v5=source.indexOf("patchedConfluence.context.reaction.engine3V5 =");
 const v6=source.indexOf("patchedConfluence.context.reaction.engine3V6Shadow =");
 const handoff=source.indexOf("const engine3Strategy1Handoff =");
 assert.ok(v5>=0&&v6>v5&&handoff>v6);
 assert.match(source,/loadEngine3V6Phase1ShadowState\(\)/);
 assert.ok(source.includes("saveEngine3V6Phase1ShadowState({state:{") ||
  source.includes("saveEngine3V6Phase1ShadowState({ state: engine3V6Shadow })"));
 const segment=source.slice(handoff,handoff+500);
 assert.doesNotMatch(segment,/engine3V6Shadow/);
});
