import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const source=fs.readFileSync(new URL("../jobs/buildStrategySnapshot.js",import.meta.url),"utf8");
test("Phase2 consumes post-activation control before v6 shadow reducer",()=>{
 const p=source.indexOf("const phase2Filter = buildEngine3V6Phase2Evidence");
 const c=source.indexOf("const phase2Causal = buildEngine3V6CausalControl");
 const v=source.indexOf("const engine3V6Shadow = buildEngine3V6Phase1Shadow");
 const handoff=source.indexOf("const engine3Strategy1Handoff =");
 assert.ok(p>=0&&c>p&&v>c&&handoff>v);
 assert.ok(source.includes("causalControl:phase2Causal"));
 assert.ok(source.includes("phase2Evidence:engine3V6Phase2Evidence"));
 assert.ok(source.includes("phase2AnchorDirection:"));
 assert.ok(source.includes("phase2ActivationRun:"));
 assert.ok(source.includes("phase2ReactionAnchor:"));
 assert.ok(source.includes("engine3V6Shadow.invalidatedNow"));
 assert.ok(source.includes("patchedConfluence.context.reaction.engine3V6Phase2Evidence ="));
 assert.doesNotMatch(source.slice(handoff,handoff+600),/phase2Causal|engine3V6Phase2Evidence/);
});
test("Phase2 uses only Engine26 owned authorization timestamp",()=>{
 const readiness=source.indexOf("const engine3V6AuthorizationReadiness =");
 const p=source.indexOf("const activationArgsV6 =",readiness);
 const c=source.indexOf("const phase2Filter =",p);
 const region=source.slice(readiness,c);
 assert.ok(region.includes("inspectEngine26AuthorizationContract"));
 assert.ok(region.includes("authoritativeV6Activation"));
 assert.ok(region.includes('status==="AUTHORITATIVE_TIMESTAMP_VALID"'));
 assert.ok(!region.includes("candidateLifecycleStartTime"));
});

test("production snapshot publishes exact control geometry source and Engine26 immutability evidence",()=>{
 const sourceAt=source.indexOf("patchedConfluence.context.reaction.engine3V6Phase2Evidence =");
 assert.ok(sourceAt>=0);
 const excerpt=source.slice(sourceAt,sourceAt+1100);
 for(const property of ["controlGeometrySource:phase2Causal.controlGeometrySource",
  "engine26Zone:phase2Causal.engine26Zone",
  "engine3ControlLens:phase2Causal.engine3ControlLens",
  "controlGeometryEligible:phase2Causal.controlGeometryEligible"]){
  assert.ok(excerpt.includes(property),property);
 }
 const handoff=source.indexOf("const engine3Strategy1Handoff =");
 assert.ok(handoff>sourceAt);
 assert.doesNotMatch(source.slice(handoff,handoff+600),/engine3ControlLens|phase2Causal/);
});

test("held direction supplies frozen reaction-site identity to FIRST causal-control pass",()=>{
 const start=source.indexOf("const phase2Filter = buildEngine3V6Phase2Evidence");
 const end=source.indexOf("const phase2Causal = buildEngine3V6CausalControl",start);
 assert.ok(start>=0&&end>start);
 const first=source.slice(start,end);
 assert.match(first,/observedDirection:priorDirectional\?priorV6Direction:"NEUTRAL"/);
 assert.match(first,/priorReactionSite:priorDirectional/);
 assert.match(first,/priorAnchorDirection:priorDirectional/);
 assert.match(first,/priorReactionAnchor:priorDirectional/);
});
