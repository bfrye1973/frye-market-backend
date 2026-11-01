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
});
