import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,rmSync,readFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {buildCurrentWavelength} from "../logic/engine22/wave/buildCurrentWavelength.js";
import {buildAuthorizedWorkingStructureV1} from "../logic/engine22/wave/buildAuthorizedWorkingStructureV1.js";
import {buildEngine22ChartAnchorsV1} from "../logic/engine22/wave/buildEngine22ChartAnchorsV1.js";
import {buildWaveHistoryObservation,appendWaveHistoryObservation,pageWaveHistory} from "../logic/engine22/history/waveHistoryJournalV1.js";
import {exportWaveHistoryWorkbook} from "../logic/engine22/history/exportWaveHistoryWorkbookV1.js";

test("Engine22 selected model reaches chart and permanent Excel history without recalculation",()=>{
 const directory=mkdtempSync(join(tmpdir(),"e22-combined-"));
 try{
  const currentWavelength=buildCurrentWavelength({symbol:"ES",currentPrice:7558.25});
  const degreeStates={minor:{activeWave:"W5",direction:"UP"},intermediate:{activeWave:"W3",direction:"UP"},primary:{activeWave:"W5",direction:"UP"}};
  const authorizedWorkingStructure=buildAuthorizedWorkingStructureV1({currentWavelength,degreeStates,publicationTime:"2026-10-31T20:00:00Z"});
  const sevenDegreeInvalidations={degrees:{}};
  const strategy={symbol:"ES",currentWavelength,degreeStates,authorizedWorkingStructure,sevenDegreeInvalidations};
  const chart=buildEngine22ChartAnchorsV1({currentWavelength,authorizedWorkingStructure,sevenDegreeInvalidations,metadata:{degreeStates}});
  assert.equal(chart.selectionRevision,5);
  assert.equal(Object.keys(chart.degrees).length,7);
  assert.equal(chart.degrees.submicro.scenarios.length,2);
  assert.equal(chart.degrees.subminute.fibGroups.length,2);
  assert.equal(chart.modelFingerprint,authorizedWorkingStructure.modelFingerprint);
  assert.equal(chart.plotAllowed,false);
  assert.equal(chart.ownerResearchChart.anchors.length,24);
  assert.deepEqual(Object.keys(chart.ownerResearchChart.fibByDegree),["submicro","micro","subminute","minute","minor","intermediate","primary"]);
  assert.equal(chart.ownerResearchChart.anchors.find(a=>a.id==="OWNER_MICRO_B_HIGH").price,7819.5);
  assert.equal(chart.ownerResearchChart.anchors.find(a=>a.id==="OWNER_PRIMARY_W1_START_LOW").price,3200);
  assert.equal(chart.ownerResearchChart.fibByDegree.subminute.fibGroups.length,2);
  assert.equal(chart.ownerResearchChart.fibByDegree.submicro.scenarios.length,2);
  assert.equal(chart.ownerResearchChart.verifiedPriceBasis,false);
  assert.equal(chart.ownerResearchChart.requiresSeparateResearchDisplayAuthorization,true);
  assert.equal(chart.degrees.micro.anchors.find(a=>a.anchorId==="B_HIGH").price,7814.75);
  const observation=buildWaveHistoryObservation({strategy,observedAt:"2026-10-31T20:05:00Z"});
  assert.equal(observation.ok,true);
  assert.equal(appendWaveHistoryObservation({directory,observation}).revision,1);
  const workbook=exportWaveHistoryWorkbook({directory});
  assert.ok(readFileSync(workbook.path).length>1000);
  assert.equal(pageWaveHistory({directory}).items.length,1);
  assert.deepEqual(pageWaveHistory({directory}).items[0].content.degrees.subminute.sourceModel.fibReferences.wick.levels,chart.degrees.subminute.fibGroups[0].levels);
  assert.deepEqual(pageWaveHistory({directory}).items[0].content.degrees.submicro.sourceModel.option2.levels,chart.degrees.submicro.scenarios[1].fibGroups[0].levels);
 }finally{rmSync(directory,{recursive:true,force:true});}
});
