import test from "node:test";
import assert from "node:assert/strict";
import {buildEngine22StructuralContext} from "../logic/engine3/buildEngine22StructuralContext.js";
const degrees={};
for(const degree of ["submicro","micro","subminute","minute","minor","intermediate","primary"]){
 degrees[degree]={degree,available:true,activeWave:"W3",direction:"DOWN",selectionStatus:"OWNER_SELECTED_WORKING",
  modelVersion:"v1",sourcePath:"canonical",parentDegree:null,parentWave:null};
}
degrees.submicro.parentDegree="micro";degrees.submicro.parentWave=degrees.micro.activeWave;
degrees.micro.parentDegree="subminute";degrees.micro.parentWave=degrees.subminute.activeWave;
degrees.subminute.parentDegree="minute";degrees.subminute.parentWave=degrees.minute.activeWave;
function snapshot(){return {symbol:"ES",strategies:{"intraday_scalp@10m":{engine22WaveStrategy:{authorizedWorkingStructure:{
 schema:"engine22.authorizedWorkingStructure.v1",mode:"READ_ONLY",status:"COMPLETE_WORKING_SELECTION",
 noExecution:true,noWaveTransition:true,modelFingerprint:"a".repeat(64),publicationRevision:7,
 publishedAt:"2026-11-17T16:27:00Z",degrees:structuredClone(degrees)
}}}}};}
const context=(s,control)=>buildEngine22StructuralContext({snapshot:s,priceActionControl:{controlState:control}});
test("same-side seller and buyer alignment is read-only",()=>{
 const s=snapshot();
 let d=context(s,"SELLERS_CONTROL");
 assert.equal(d.alignmentState,"FULL_BEARISH_ALIGNMENT");
 assert.equal(d.submicroWave,"W3");assert.equal(d.microDirection,"DOWN");
 assert.equal(d.canonicalDirectionAuthority,false);assert.equal(d.qualificationAuthority,false);
 s.strategies["intraday_scalp@10m"].engine22WaveStrategy.authorizedWorkingStructure.degrees.submicro.direction="UP";
 s.strategies["intraday_scalp@10m"].engine22WaveStrategy.authorizedWorkingStructure.degrees.micro.direction="UP";
 d=context(s,"BUYERS_CONTROL");assert.equal(d.alignmentState,"FULL_BULLISH_ALIGNMENT");
});
test("as-of prevents future publications and optional stale policy",()=>{
 const s=snapshot();
 const future=context(s,"SELLERS_CONTROL");
 assert.equal(future.asOfVerified,false);
 const early=buildEngine22StructuralContext({snapshot:s,priceActionControl:{controlState:"SELLERS_CONTROL"},
   evaluationTimeMs:Date.parse("2026-11-17T16:26:00Z")});
 assert.equal(early.available,false);
 assert.equal(early.sourceReasonCode,"ENGINE22_PUBLICATION_AFTER_EVALUATION");
 const valid=buildEngine22StructuralContext({snapshot:s,priceActionControl:{controlState:"SELLERS_CONTROL"},
   evaluationTimeMs:Date.parse("2026-11-17T16:28:00Z"),maxPublicationAgeMs:600000});
 assert.equal(valid.alignmentState,"FULL_BEARISH_ALIGNMENT");
 assert.equal(valid.asOfVerified,true);
 const stale=buildEngine22StructuralContext({snapshot:s,priceActionControl:{controlState:"SELLERS_CONTROL"},
   evaluationTimeMs:Date.parse("2026-11-17T17:00:00Z"),maxPublicationAgeMs:600000});
 assert.equal(stale.alignmentState,"NO_STRUCTURAL_CONTEXT");
 assert.equal(stale.sourceReasonCode,"ENGINE22_PUBLICATION_OLDER_THAN_POLICY");
});
test("one-sided, opposed, missing and unresolved cases fail closed",()=>{
 const s=snapshot(),pub=s.strategies["intraday_scalp@10m"].engine22WaveStrategy.authorizedWorkingStructure;
 pub.degrees.micro.direction="NEUTRAL";
 assert.equal(context(s,"SELLERS_CONTROL").alignmentState,"PARTIAL_ALIGNMENT");
 pub.degrees.micro.direction="UP";
 assert.equal(context(s,"SELLERS_CONTROL").alignmentState,"CONFLICT");
 for(const state of ["CONTESTED","ABSORPTION","NO_CONTROL"]){
  assert.equal(context(s,state).alignmentState,"NO_STRUCTURAL_CONTEXT");
 }
 pub.degrees.micro.selectionStatus="RESEARCH_ONLY";
 const d=context(s,"SELLERS_CONTROL");
 assert.equal(d.available,false);assert.equal(d.alignmentState,"NO_STRUCTURAL_CONTEXT");
 assert.equal(context(null,"SELLERS_CONTROL").alignmentState,"NO_STRUCTURAL_CONTEXT");
});
