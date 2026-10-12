import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import {fileURLToPath} from "node:url";
import {buildEngine22V3OwnerBootstrap} from "../logic/engine22/v3/buildOwnerBootstrap.js";
import {buildEngine22V3ShadowSnapshot} from "../logic/engine22/v3/buildShadowSnapshot.js";
import {buildEngine22V3ContractProjection,buildEngine22V3CompatibilityPreview} from "../logic/engine22/v3/compareProtectedContracts.js";
const source=()=>JSON.parse(fs.readFileSync(fileURLToPath(new URL("../data/waves/active/active-wave-state-es.json",import.meta.url)),"utf8"));
test("actual manual ES source and owner anchors publish seven isolated V3 shadow degrees",()=>{
 const raw=source(),original=structuredClone(raw);
 const initialized=buildEngine22V3OwnerBootstrap({activeWaveState:raw});
 assert.equal(initialized.available,true,JSON.stringify(initialized.reasonCodes));
 assert.equal(initialized.canonical.degrees.MICRO.anchors.W4_LOW.price,7782.75);
 assert.equal(initialized.canonical.degrees.INTRADAY_SUBMICRO.anchors.W2_LOW.price,7826.25);
 const shadow=buildEngine22V3ShadowSnapshot({canonical:initialized.canonical});
 assert.equal(shadow.available,true,JSON.stringify(shadow.reasonCodes));
 const projection=buildEngine22V3ContractProjection({shadow});
 assert.equal(projection.available,true,JSON.stringify(projection.reasonCodes));
 assert.equal(Object.keys(projection.degreeStates).length,7);
 assert.equal(projection.degreeStates.micro.activeWave,"W5");
 assert.equal(projection.degreeStates.intraday_submicro.activeWave,"W3");
 assert.notEqual(projection.degreeStates.micro.sourceCountId,projection.degreeStates.intraday_submicro.sourceCountId);
 assert.equal(projection.publicationEligible,false);
 assert.deepEqual(raw,original);
});

test("snapshot pipeline wires manual canonical bootstrap to existing Engine22 builder in shadow only",()=>{
 const builder=fs.readFileSync(fileURLToPath(new URL("../jobs/buildStrategySnapshot.js",import.meta.url)),"utf8");
 const wave=fs.readFileSync(fileURLToPath(new URL("../logic/engine22/wave/buildEngine22WaveStrategy.js",import.meta.url)),"utf8");
 assert.match(builder,/getActiveWaveStateMeta\(\{symbol:"ES"\}\)/);
 assert.match(builder,/buildEngine22V3OwnerBootstrap\(/);
 assert.match(builder,/engine22V3Canonical:\s*engine22V3Bootstrap\?\.available === true\s*\? engine22V3Bootstrap\.canonical : null/);
 assert.match(wave,/buildEngine22V3ShadowSnapshot\(\{canonical:input\.engine22V3Canonical\}\)/);
 assert.match(wave,/engine22V3Projection:/);
 assert.match(wave,/engine22V3Shadow,/);
 assert.match(wave,/degreeStates:\s*publishedDegreeStates,/);
 assert.match(wave,/microExecutionContext,/);
});

test("real ES V3 bootstrap preserves original consumer payload during shadow comparison",()=>{
 const canonical=buildEngine22V3OwnerBootstrap({activeWaveState:source()});
 assert.equal(canonical.available,true);
 const shadow=buildEngine22V3ShadowSnapshot({canonical:canonical.canonical});
 const legacy={
  degreeStates:{micro:{activeWave:"W2",sourceCountId:"LEGACY-MICRO"},minute:{activeWave:"W3"}},
  currentWavelength:{degrees:{micro:{microSequence:{activeWave:"W2"}}}},
  engine22Display:{degreeOrder:["micro","subminute","minute","minor","intermediate","primary"]},
  microExecutionContext:{sourceCountId:"LEGACY-MICRO",automationEligible:false},
  waveOpportunity:{readiness:"WATCH"},currentLifecycleState:{key:"UNCHANGED"},
  tradeDecision:{allowLongEntry:false},action:"WAIT",bias:"NEUTRAL",
 };
 const before=structuredClone(legacy);
 const preview=buildEngine22V3CompatibilityPreview({legacy,shadow});
 assert.equal(preview.available,true);
 assert.equal(preview.protectedContractsUnchanged,true);
 assert.equal(preview.mappingReady,true);
 assert.equal(preview.candidate.microExecutionContext.sourceCountId,"LEGACY-MICRO");
 assert.notEqual(shadow.degreeStates.degrees.micro.sourceCountId,
  shadow.degreeStates.degrees.intraday_submicro.sourceCountId);
 const retained=structuredClone(preview.candidate);
 delete retained.engine22V3Shadow;
 assert.deepEqual(retained,before);
 assert.deepEqual(legacy,before);
 assert.equal(preview.publicationEligible,false);
});

test("V3 canonical source reaches wave builder rather than scalp opportunity",()=>{
 const code=fs.readFileSync(fileURLToPath(new URL("../jobs/buildStrategySnapshot.js",import.meta.url)),"utf8");
 const scalp=code.slice(code.indexOf("engine22Scalp = computeEngine22ScalpOpportunity({"),code.indexOf("engine22WaveStrategy = buildEngine22WaveStrategy({"));
 const wave=code.slice(code.indexOf("engine22WaveStrategy = buildEngine22WaveStrategy({"),code.indexOf("engine22WaveStrategy = buildEngine22WaveStrategy({")+450);
 assert.doesNotMatch(scalp,/engine22V3Canonical:/);
 assert.match(wave,/engine22V3Canonical:\s*engine22V3Bootstrap\?\.available === true/);
});
