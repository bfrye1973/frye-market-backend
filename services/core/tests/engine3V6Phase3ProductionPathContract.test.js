import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const source=readFileSync(new URL("../jobs/buildStrategySnapshot.js",import.meta.url),"utf8");
test("production snapshot checks source readiness before v6 and emits trace after reducer",()=>{
 const reducer=source.indexOf("const engine3V6Shadow = buildEngine3V6Phase1Shadow(");
 const trace=source.indexOf("const engine3V6ResearchTrace = buildEngine3V6ResearchTrace(");
 const readiness=source.indexOf("const engine3V6AuthorizationReadiness = inspectEngine26AuthorizationContract(");
 const handoff=source.indexOf("const engine3Strategy1Handoff =");
 assert.ok(readiness>=0&&reducer>readiness&&trace>reducer&&handoff>trace);
 assert.match(source,/patchedConfluence.context.reaction.engine3V6ResearchTrace\s*=/);
 assert.match(source,/patchedConfluence.context.reaction.engine3V6AuthorizationReadiness\s*=/);
});
test("Phase3 research outputs do not feed canonical Engine3, Engine4 or Engine6",()=>{
 const reducer=source.indexOf("const engine3V6Shadow = buildEngine3V6Phase1Shadow(");
 const trace=source.indexOf("const engine3V6ResearchTrace = buildEngine3V6ResearchTrace(");
 const handoff=source.indexOf("const engine3Strategy1Handoff =",trace);
 assert.ok(reducer>=0&&trace>reducer&&handoff>trace);
 const reducerEnd=source.indexOf("  });",reducer);
 assert.ok(reducerEnd>reducer&&reducerEnd<trace);
 const reducerInputs=source.slice(reducer,reducerEnd+5);
 assert.doesNotMatch(reducerInputs,/engine3V6ResearchTrace|engine3V6AuthorizationReadiness/);
 const handoffInputs=source.slice(handoff,handoff+650);
 assert.doesNotMatch(handoffInputs,/engine3V6ResearchTrace|engine3V6AuthorizationReadiness|phase2Causal/);
});
test("Phase3 preparation never calls or schedules a raw packet writer in production",()=>{
 assert.doesNotMatch(source,/saveEngine3RawBarArchivePacket|writeEngine3RawBarArchivePacket|archiveEngine3RawBarPacket/);
});

test("Phase2 shadow uses only accepted Engine26 authoritative timestamp",()=>{
 const started=source.indexOf("const engine3V6AuthorizationReadiness =");
 const authority=source.indexOf("const authoritativeV6Activation =",started);
 const args=source.indexOf("const activationArgsV6 =",authority);
 assert.ok(started>=0&&authority>started&&args>authority);
 const checked=source.slice(authority,args+750);
 assert.match(checked,/status==="AUTHORITATIVE_TIMESTAMP_VALID"/);
 assert.match(checked,/authorizedStartedAt:authoritativeV6Activation/);
 assert.match(checked,/phase2ActivationRun\?\.source==="ENGINE26_AUTHORIZED"/);
 assert.doesNotMatch(checked,/authorizedStartedAt:\s*engine26ReactionHandoff\?\.engine3AuthorizationStartedAt/);
});
