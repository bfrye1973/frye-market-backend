import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { buildCurrentWavelength } from "../logic/engine22/wave/buildCurrentWavelength.js";
import { buildAuthorizedWorkingStructureV1 } from "../logic/engine22/wave/buildAuthorizedWorkingStructureV1.js";
import { buildEngine22ChartAnchorsV1 } from "../logic/engine22/wave/buildEngine22ChartAnchorsV1.js";

test("read-only chart adapter keeps revision 5 and seven degree slots",()=>{
 const currentWavelength=buildCurrentWavelength({symbol:"ES",currentPrice:7558.25});
 const degreeStates={minor:{activeWave:"W5",direction:"UP"},intermediate:{activeWave:"W3",direction:"UP"},primary:{activeWave:"W5",direction:"UP"}};
 const authorizedWorkingStructure=buildAuthorizedWorkingStructureV1({currentWavelength,degreeStates});
 const packet=buildEngine22ChartAnchorsV1({currentWavelength,authorizedWorkingStructure,metadata:{degreeStates}});
 assert.equal(packet.schema,"engine22.chartAnchors.v1");
 assert.equal(packet.selectionRevision,5);
 assert.equal(Object.keys(packet.degrees).length,7);
 assert.equal(packet.chartCompatibility,"WITHHELD_PENDING_VERIFICATION");
 assert.equal(packet.historicalAsOfSupported,false);
 assert.equal(packet.noExecution,true);
 assert.equal(packet.plotAllowed,false);
 assert.equal(packet.degrees.micro.reviewBoundary.price,7814.75);
 assert.equal(packet.degrees.subminute.reviewBoundary.price,7895);
 assert.equal(packet.degrees.minute.reviewBoundary.price,7419.5);
 assert.equal(packet.degrees.minute.anchors[0].marketEventTimeUtc,"2026-07-30T19:00:00.000Z");
 assert.equal(packet.degrees.minute.anchors[1].marketEventTimeUtc,"2026-08-13T16:00:00.000Z");
 assert.equal(packet.degrees.submicro.scenarios.length,2);
 assert.equal(packet.degrees.subminute.fibGroups.length,2);
 assert.deepEqual(packet.degrees.subminute.fibGroups.map(g=>g.levels[0].price),[7683.5,7719.75]);
 assert.equal(packet.degrees.micro.anchors[2].price,7814.75);
 assert.equal(packet.degrees.submicro.scenarios[0].anchors[2].marketEventTimeUtc,null);
 assert.equal(packet.chartContractFingerprint,buildEngine22ChartAnchorsV1({currentWavelength,authorizedWorkingStructure,metadata:{degreeStates}}).chartContractFingerprint);
});
test("unavailable source never creates fabricated geometry",()=>{
 const packet=buildEngine22ChartAnchorsV1();
 assert.equal(packet.available,false);
 assert.equal(packet.degrees.micro.available,false);
 assert.equal(packet.chartCompatibility,"WITHHELD_PENDING_VERIFICATION");
 assert.equal(packet.plotAllowed,false);
});

test("rejects unauthenticated selection without plotting",()=>{
 const currentWavelength=buildCurrentWavelength({symbol:"ES"});
 const packet=buildEngine22ChartAnchorsV1({currentWavelength,authorizedWorkingStructure:{degrees:{micro:{available:true,sourcePath:"currentWavelength.degrees.micro.ownerMicroCDownOct31"}}}});
 assert.equal(packet.available,false);
 assert.equal(packet.degrees.micro.available,false);
});

test("Fib touch evidence is copied without upgrading owner observations",()=>{
 const cw=buildCurrentWavelength({symbol:"ES",currentPrice:7558.25});
 const d={minor:{activeWave:"W5",direction:"UP"},intermediate:{activeWave:"W3",direction:"UP"},primary:{activeWave:"W5",direction:"UP"}};
 const observed=cw.degrees.submicro.submicroCompare.option1.levels[0];
 assert.equal(observed.touchEvidenceType,"OWNER_CHART_OBSERVATION");
 const selected=buildAuthorizedWorkingStructureV1({currentWavelength:cw,degreeStates:d});
 const packet=buildEngine22ChartAnchorsV1({currentWavelength:cw,authorizedWorkingStructure:selected,metadata:{degreeStates:d}});
 const copied=packet.degrees.submicro.scenarios[0].fibGroups[0].levels[0];
 assert.equal(copied.touchEvidenceType,"OWNER_CHART_OBSERVATION");
 assert.equal(copied.touchEvidence.verified,false);
 assert.equal(packet.degrees.submicro.scenarios[1].fibGroups[0].levels[0].touchEvidenceType??null,null);
 assert.equal(packet.degrees.submicro.scenarios[0].anchors[2].marketEventTimeUtc,null);
 assert.equal(packet.degrees.subminute.anchors[3].marketEventTimeUtc,null);
 assert.equal(packet.degrees.subminute.anchors[3].timestampStatus,"UNVERIFIED");
 assert.equal(packet.degrees.subminute.officialInvalidation,null);
});
test("selection version mismatch fails closed for affected degree",()=>{
 const cw=buildCurrentWavelength({symbol:"ES"});
 const d={minor:{activeWave:"W5"},intermediate:{activeWave:"W3"},primary:{activeWave:"W5"}};
 const selected=buildAuthorizedWorkingStructureV1({currentWavelength:cw,degreeStates:d});
 const changed=structuredClone(cw);
 changed.degrees.micro.ownerMicroCDownOct31.version="UNAPPROVED_VERSION";
 const packet=buildEngine22ChartAnchorsV1({currentWavelength:changed,authorizedWorkingStructure:selected,metadata:{degreeStates:d}});
 assert.equal(packet.degrees.micro.available,false);
 assert.ok(packet.degrees.micro.missingEvidence.includes("CURRENT_AUTHORIZED_MODEL_UNAVAILABLE"));
 assert.equal(packet.plotAllowed,false);
});

test("strategy wrapper reuses sibling authority and provides unavailable fallback",()=>{
 const code=readFileSync(new URL("../logic/engine22/wave/buildEngine22WaveStrategy.js",import.meta.url),"utf8");
 assert.match(code,/authorizedWorkingStructure: chartAuthorized/);
 assert.match(code,/sevenDegreeInvalidations: chartInvalidations/);
 assert.match(code,/chartAnchors: buildEngine22ChartAnchorsV1\(\)/);
 assert.match(code,/const chartAnchors = buildEngine22ChartAnchorsV1/);
});

test("adapter preserves exact sibling publication identity and all source Fibonacci levels",()=>{
 const cw=buildCurrentWavelength({symbol:"ES",currentPrice:7558.25});
 const ds={minor:{activeWave:"W5",direction:"UP"},intermediate:{activeWave:"W3",direction:"UP"},primary:{activeWave:"W5",direction:"UP"}};
 const authorized=buildAuthorizedWorkingStructureV1({currentWavelength:cw,degreeStates:ds});
 const p=buildEngine22ChartAnchorsV1({currentWavelength:cw,authorizedWorkingStructure:authorized,metadata:{degreeStates:ds}});
 assert.equal(p.modelFingerprint,authorized.modelFingerprint);
 assert.equal(p.evidenceFingerprint,authorized.evidenceFingerprint);
 assert.equal(p.selectionApprovalReference,authorized.selectionApprovalReference);
 assert.equal(p.selectionRevision,authorized.publicationRevision);
 for(const degree of ["micro","minute","minor","intermediate","primary"]){
   assert.deepEqual(p.degrees[degree].fibGroups[0].levels,authorized.degrees[degree].levels);
 }
 assert.deepEqual(p.degrees.subminute.fibGroups[0].levels,cw.degrees.subminute.ownerSubminuteCDownOct31.fibReferences.wick.levels);
 assert.deepEqual(p.degrees.subminute.fibGroups[1].levels,cw.degrees.subminute.ownerSubminuteCDownOct31.fibReferences.body.levels);
 assert.deepEqual(p.degrees.submicro.scenarios[0].fibGroups[0].levels,cw.degrees.submicro.submicroCompare.option1.levels);
 assert.deepEqual(p.degrees.submicro.scenarios[1].fibGroups[0].levels,cw.degrees.submicro.submicroCompare.option2.levels);
 assert.equal(p.degrees.micro.officialInvalidation,null);
 assert.equal(p.degrees.subminute.officialInvalidation,null);
 assert.equal(p.plotAllowed,false);
});
