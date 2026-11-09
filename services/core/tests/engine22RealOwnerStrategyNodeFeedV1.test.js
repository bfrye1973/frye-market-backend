import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,rmSync,readFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {buildCurrentWavelength} from "../logic/engine22/wave/buildCurrentWavelength.js";
import {buildAuthorizedWorkingStructureV1} from "../logic/engine22/wave/buildAuthorizedWorkingStructureV1.js";
import {buildWaveHistoryObservation,appendWaveHistoryObservation} from "../logic/engine22/history/waveHistoryJournalV1.js";
import {collectExistingOwnerNodesV1} from "../logic/engine22/history/collectExistingOwnerNodesV1.js";
import {pageEngine22NodeHistory,latestEngine22NodeHistory} from "../logic/engine22/history/chartNodeHistoryFeedV1.js";
const degreeStates={minor:{activeWave:"W5",direction:"UP"},intermediate:{activeWave:"W3",direction:"UP"},primary:{activeWave:"W5",direction:"UP"}};
test("actual Engine22 selected seven-degree publication feeds the existing Engine2 node API",()=>{
 const d=mkdtempSync(join(tmpdir(),"e22-source-live-integration-"));
 try{
  const currentWavelength=buildCurrentWavelength({symbol:"ES",currentPrice:7558.25});
  const authorizedWorkingStructure=buildAuthorizedWorkingStructureV1({currentWavelength,degreeStates,publicationTime:"2026-11-08T21:25:00Z"});
  const strategy={symbol:"ES",currentWavelength,degreeStates,authorizedWorkingStructure,sevenDegreeInvalidations:{degrees:{}}};
  const observation=buildWaveHistoryObservation({strategy,observedAt:"2026-11-08T21:30:00Z"});
  assert.equal(observation.ok,true);
  assert.equal(observation.content.selectionRevision,6);
  const nodeEvents=collectExistingOwnerNodesV1({directory:d,publishedAt:observation.observedAt});
  assert.ok(nodeEvents.length>0);
  const result=appendWaveHistoryObservation({directory:d,observation,nodeEvents});
  assert.equal(result.status,"APPENDED");
  const page=pageEngine22NodeHistory({directory:d,afterRevision:0,limit:50});
  assert.equal(page.records.length,nodeEvents.length);
  assert.equal(latestEngine22NodeHistory({directory:d}).records.length,nodeEvents.length);
  assert.ok(page.records.every(r=>r.plotAllowed===false),"unverified ES bases must not plot");
  for(const degree of ["primary","intermediate","minor","minute","subminute","micro","submicro"]){
   assert.ok(page.records.some(r=>r.degree===degree),"historical source includes "+degree);
  }
 }finally{rmSync(d,{recursive:true,force:true});}
});
test("production Strategy snapshot integration supplies nodeEvents to journal, behind explicit release flag",()=>{
 const source=readFileSync(new URL("../jobs/buildStrategySnapshot.js",import.meta.url),"utf8");
 assert.match(source,/ENGINE22_WAVE_HISTORY_ENABLED==="true"/);
 assert.match(source,/const originalSourceEvents=collectExistingOwnerNodesV1\\(/);
 assert.match(source,/const publishedWorkingEvents=collectPublishedWorkingNodeEventsV1\\(/);
 assert.match(source,/const nodeEvents=\\[\\.\\.\\.originalSourceEvents,\\.\\.\\.publishedWorkingEvents\\]/);
 assert.match(source,/appendWaveHistoryObservation\(\{directory,observation,nodeEvents\}\)/);
});
