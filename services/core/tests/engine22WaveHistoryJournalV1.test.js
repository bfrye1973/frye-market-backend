import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,rmSync,readFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {buildCurrentWavelength} from "../logic/engine22/wave/buildCurrentWavelength.js";
import {buildAuthorizedWorkingStructureV1} from "../logic/engine22/wave/buildAuthorizedWorkingStructureV1.js";
import {buildWaveHistoryObservation,appendWaveHistoryObservation,readWaveHistory} from "../logic/engine22/history/waveHistoryJournalV1.js";
const states=()=>({minor:{activeWave:"W5",direction:"UP"},intermediate:{activeWave:"W3",direction:"UP"},primary:{activeWave:"W5",direction:"UP"}});
function fixture(){
 const currentWavelength=buildCurrentWavelength({symbol:"ES",currentPrice:7558.25});
 const degreeStates=states();
 const authorizedWorkingStructure=buildAuthorizedWorkingStructureV1({currentWavelength,degreeStates,publicationTime:"2026-10-31T20:00:00Z"});
 return {symbol:"ES",currentWavelength,degreeStates,authorizedWorkingStructure,sevenDegreeInvalidations:{degrees:{}}};
}
test("captures seven degrees and preserves both Submicro alternatives and Subminute Fib methods",()=>{
 const result=buildWaveHistoryObservation({strategy:fixture(),observedAt:"2026-10-31T20:05:00Z"});
 assert.equal(result.ok,true);
 assert.equal(Object.keys(result.content.degrees).length,7);
 assert.equal(result.content.selectionRevision,5);
 assert.ok(result.content.degrees.submicro.sourceModel.option1);
 assert.ok(result.content.degrees.submicro.sourceModel.option2);
 assert.equal(result.content.degrees.subminute.sourceModel.fibReferences.wick.levels.length,5);
 assert.equal(result.content.degrees.subminute.sourceModel.fibReferences.body.levels.length,5);
 assert.equal(result.content.noExecution,true);
});
test("records every changed publication, deduplicates identical state and verifies chain",()=>{
 const directory=mkdtempSync(join(tmpdir(),"engine22-history-"));
 try{
  const strategy=fixture();
  const a=buildWaveHistoryObservation({strategy,observedAt:"2026-10-31T20:05:00Z"});
  assert.equal(appendWaveHistoryObservation({directory,observation:a}).revision,1);
  assert.equal(appendWaveHistoryObservation({directory,observation:a}).status,"UNCHANGED");
  const revised=structuredClone(strategy);
  revised.currentWavelength.degrees.micro.ownerMicroCDownOct31.priorBEnding.price=7819.5;
  const b=buildWaveHistoryObservation({strategy:revised,observedAt:"2026-10-31T20:06:00Z"});
  assert.equal(appendWaveHistoryObservation({directory,observation:b}).revision,2);
  const events=readWaveHistory({directory});
  assert.equal(events.length,2);
  assert.equal(events[0].content.degrees.micro.sourceModel.priorBEnding.price,7814.75);
  assert.equal(events[1].content.degrees.micro.sourceModel.priorBEnding.price,7819.5);
  assert.equal(events[0].content.selectionRevision,5);
 }finally{rmSync(directory,{recursive:true,force:true});}
});
test("rejects missing authority and missing event time",()=>{
 assert.equal(buildWaveHistoryObservation({strategy:{},observedAt:"2026-10-31T20:05:00Z"}).ok,false);
 assert.equal(buildWaveHistoryObservation({strategy:fixture()}).reason,"OBSERVATION_TIME_REQUIRED");
});

test("actual strategy-card publication captures Engine22 automatically",()=>{
 const source=readFileSync(new URL("../jobs/buildStrategySnapshot.js",import.meta.url),"utf8");
 const publish=source.indexOf("result.strategies[s.strategyId] = {\n  ...strategy,\n  executionState,\n};");
 const capture=source.indexOf("const wave=result.strategies[s.strategyId]?.engine22WaveStrategy;",publish);
 assert.ok(publish>=0&&capture>publish);
 assert.match(source.slice(capture,capture+1600),/appendWaveHistoryObservation/);
 assert.match(source.slice(capture,capture+1600),/engine22WaveHistory/);
});
test("snapshot publication time alone does not create a duplicate history revision",()=>{
 const directory=mkdtempSync(join(tmpdir(),"engine22-history-dedupe-"));
 try{
  const a=fixture(),b=structuredClone(a);
  b.authorizedWorkingStructure.publishedAt="2026-10-31T20:10:00Z";
  assert.equal(appendWaveHistoryObservation({directory,observation:buildWaveHistoryObservation({strategy:a,observedAt:"2026-10-31T20:05:00Z"})}).status,"APPENDED");
  assert.equal(appendWaveHistoryObservation({directory,observation:buildWaveHistoryObservation({strategy:b,observedAt:"2026-10-31T20:10:00Z"})}).status,"UNCHANGED");
  assert.equal(readWaveHistory({directory}).length,1);
 }finally{rmSync(directory,{recursive:true,force:true});}
});
