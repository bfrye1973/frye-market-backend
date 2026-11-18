import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const snapshot=readFileSync(new URL("../jobs/buildStrategySnapshot.js",import.meta.url),"utf8");
test("Engine 3 source shadow is explicitly OFF by default",()=>{
 assert.match(snapshot,/ENGINE3_SOURCE_EVIDENCE_SHADOW_ENABLED === "1"/);
 assert.match(snapshot,/if\(includeSourceEvidence===true&&tf==="10m"\)u\.searchParams\.set\("evidence","1"\)/);
 assert.match(snapshot,/includeSourceEvidence:engine3SourceEvidenceEnabled/);
});
test("the 1m,5m,10m receipts are separate and can never confer authority",()=>{
 assert.match(snapshot,/"1m":engine3DiagnosticBars\?\.oneMinute\?\.engine11SourceEvidence/);
 assert.match(snapshot,/"5m":engine3DiagnosticBars\?\.fiveMinute\?\.engine11SourceEvidence/);
 assert.match(snapshot,/"10m":tenMinuteSourceEvidence/);
 assert.match(snapshot,/sourceEvidenceVerified:false,engine3ConsumptionAttested:false/);
 assert.match(snapshot,/calibrationAdmissible:false,recordingActivated:false,writerInvoked:false/);
});
test("new 10m receipt sidecar is not fed into market calculation",()=>{
 assert.match(snapshot,/delete emaPosture\.tenMinute\.engine11SourceEvidence/);
 assert.match(snapshot,/result\.engine3SourceEvidenceShadow=/);
});
