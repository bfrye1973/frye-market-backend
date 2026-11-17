import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const source=fs.readFileSync(new URL("../jobs/buildStrategySnapshot.js",import.meta.url),"utf8");
test("Phase2 publishes separate diagnostic and persists frozen activation with v6 only",()=>{
 assert.match(source,/engine3V6Phase2Evidence\s*=\s*buildEngine3V6Phase2Evidence\(/);
 assert.match(source,/engine3V6Phase2Evidence\s*=\s*\n\s*engine3V6Phase2Evidence/);
 assert.match(source,/phase2ActivationRun:\s*engine3V6Phase2Evidence\.activationRun/);
 assert.match(source,/phase2ReactionAnchor:\s*engine3V6Phase2Evidence\.reactionAnchor/);
 assert.match(source,/UNCERTAINTY_WINDOW_BARS_HAVE_ZERO_ESTABLISHMENT_AUTHORITY/);
 assert.match(source,/PHASE2_POST_ACTIVATION_EVIDENCE_REQUIRED/);
 const p=source.indexOf("const engine3V6Phase2Evidence =");
 const v5=source.indexOf("patchedConfluence.context.reaction.engine3V5 =");
 const handoff=source.indexOf("const engine3Strategy1Handoff =");
 assert.ok(v5>=0&&p>v5&&handoff>p);
 assert.doesNotMatch(source.slice(handoff,handoff+600),/engine3V6Phase2Evidence/);
});
test("Phase2 never reuses Engine26 candidateLifecycleStartTime as authorization",()=>{
 const fragment=source.slice(source.indexOf("const engine3V6Phase2Evidence ="),
  source.indexOf("patchedConfluence.context.reaction.engine3V6Shadow =",source.indexOf("const engine3V6Phase2Evidence =")));
 assert.match(fragment,/engine3AuthorizationStartedAt/);
 assert.doesNotMatch(fragment,/candidateLifecycleStartTime/);
});
