import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const source=readFileSync(new URL("../jobs/buildStrategySnapshot.js",import.meta.url),"utf8");
test("production snapshot emits Phase3 trace only after v6 reducer and before downstream v5 handoff",()=>{
 const reducer=source.indexOf("const engine3V6Shadow = buildEngine3V6Phase1Shadow(");
 const trace=source.indexOf("const engine3V6ResearchTrace = buildEngine3V6ResearchTrace(");
 const readiness=source.indexOf("const engine3V6AuthorizationReadiness = inspectEngine26AuthorizationContract(");
 const handoff=source.indexOf("const engine3Strategy1Handoff =");
 assert.ok(reducer>=0&&readiness>reducer&&trace>readiness&&handoff>trace);
 assert.match(source,/patchedConfluence.context.reaction.engine3V6ResearchTrace\s*=/);
 assert.match(source,/patchedConfluence.context.reaction.engine3V6AuthorizationReadiness\s*=/);
});
test("Phase3 research outputs do not feed canonical Engine3, Engine4 or Engine6",()=>{
 const reducer=source.indexOf("const engine3V6Shadow = buildEngine3V6Phase1Shadow(");
 const trace=source.indexOf("const engine3V6ResearchTrace = buildEngine3V6ResearchTrace(");
 const handoff=source.indexOf("const engine3Strategy1Handoff =",trace);
 assert.ok(reducer>=0&&trace>reducer&&handoff>trace);
 const reducerInputs=source.slice(reducer,trace);
 assert.doesNotMatch(reducerInputs,/engine3V6ResearchTrace|engine3V6AuthorizationReadiness/);
 const handoffInputs=source.slice(handoff,handoff+650);
 assert.doesNotMatch(handoffInputs,/engine3V6ResearchTrace|engine3V6AuthorizationReadiness|phase2Causal/);
});
test("Phase3 preparation never calls or schedules a raw packet writer in production",()=>{
 assert.doesNotMatch(source,/saveEngine3RawBarArchivePacket|writeEngine3RawBarArchivePacket|archiveEngine3RawBarPacket/);
});
