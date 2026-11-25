import test from "node:test";
import assert from "node:assert/strict";
import {compareEngine22V3ProtectedOutputs as compare,buildEngine22V3CompatibilityPreview,buildEngine22V3ContractProjection} from "../logic/engine22/v3/compareProtectedContracts.js";
const source=()=>({degreeStates:{minute:{activeWave:"W3"}},currentWavelength:{symbol:"ES"},
 microExecutionContext:{automationEligible:false},engine22Display:{degrees:{}},
 waveOpportunity:{},currentLifecycleState:{},activeFibModel:{},
 action:"WAIT",bias:"UP",tradeDecision:{permission:false}});
test("unchanged legacy contract is safe",()=>{
 const a=source();assert.equal(compare({legacy:a,candidate:structuredClone(a)}).pass,true);
});
test("display-only changes are visible, not accepted silently",()=>{
 const a=source(),b=structuredClone(a);b.engine22Display.degrees.submicro={active:true};
 const r=compare({legacy:a,candidate:b});
 assert.equal(r.pass,false);assert.equal(r.differences[0].key,"engine22Display");
});
test("execution-adjacent drift is also rejected",()=>{
 const a=source(),b=structuredClone(a);b.tradeDecision.permission=true;
 const r=compare({legacy:a,candidate:b});
 assert.deepEqual(r.protectedChanges,["tradeDecision"]);
});

test("legacy Micro consumer identity must never silently switch to larger V3 Micro",()=>{
 const a=source(),b=structuredClone(a);
 a.microExecutionContext={sourceCountId:"LEGACY-MICRO",activeWave:"W2",automationEligible:false};
 b.microExecutionContext={sourceCountId:"LARGER-MICRO",activeWave:"W5",automationEligible:false};
 const result=compare({legacy:a,candidate:b});
 assert.equal(result.pass,false);
 assert.ok(result.differences.some(x=>x.key==="microExecutionContext"));
});
test("downstream consumers cannot change during Engine22 shadow work",()=>{
 const a=source(),b=structuredClone(a);
 a.engine27Strategies={degree:"MICRO",countId:"old"};
 b.engine27Strategies={degree:"INTRADAY_SUBMICRO",countId:"new"};
 const r=compare({legacy:a,candidate:b});
 assert.equal(r.pass,false);
 assert.deepEqual(r.protectedChanges,["engine27Strategies"]);
});

test("seven-degree shadow sidecar leaves all legacy contracts byte-identical",()=>{
 const legacy=source();
 legacy.microExecutionContext={sourceCountId:"OLD-OPERATIONAL-MICRO",activeWave:"W2"};
 const before=structuredClone(legacy);
 const shadow={available:true,shadowOnly:true,degreeStates:{degrees:{
  intraday_submicro:{sourceCountId:"SUBMICRO-C"},
  micro:{sourceCountId:"NEW-MICRO-C"},
  subminute:{},minute:{},minor:{},intermediate:{},primary:{},
 }}};
 const preview=buildEngine22V3CompatibilityPreview({legacy,shadow});
 assert.equal(preview.available,true);
 assert.equal(preview.pass,false);
 assert.equal(preview.protectedContractsUnchanged,true);
 assert.equal(preview.mappingReady,false);
 assert.ok(preview.reasonCodes.includes("LEGACY_V3_PROJECTION_MAPPING_NOT_WIRED"));
 assert.equal(preview.publicationEligible,false);
 assert.equal(preview.candidate.microExecutionContext.sourceCountId,"OLD-OPERATIONAL-MICRO");
 assert.equal(preview.candidate.engine22V3Shadow.degreeStates.degrees.micro.sourceCountId,"NEW-MICRO-C");
 assert.equal(preview.candidate.engine22V3Shadow.degreeStates.degrees.intraday_submicro.sourceCountId,"SUBMICRO-C");
 const copy=structuredClone(preview.candidate);delete copy.engine22V3Shadow;
 assert.deepEqual(copy,legacy);
 assert.deepEqual(legacy,before);
});
test("compatibility preview rejects incomplete shadow and never fabricates mapping",()=>{
 assert.equal(buildEngine22V3CompatibilityPreview({legacy:source(),shadow:null}).available,false);
});

test("all seven independent V3 projections map to one identity per degree without legacy contract changes",()=>{
 const legacy=source(),degrees={};
 const names=["intraday_submicro","micro","subminute","minute","minor","intermediate","primary"];
 for(const [i,name] of names.entries())degrees[name]={sourceCountId:"V3-"+i,activeWave:"W3"};
 const shadow={available:true,shadowOnly:true,degreeStates:{degrees},
  currentWavelength:{degrees:Object.fromEntries(names.map(n=>[n,{sourceCountId:degrees[n].sourceCountId}]))},
  engine22Display:{degrees:Object.fromEntries(names.map(n=>[n,{degree:n}]))}};
 const result=buildEngine22V3CompatibilityPreview({legacy,shadow});
 assert.equal(result.mappingReady,true);
 assert.equal(result.protectedContractsUnchanged,true);
 assert.equal(result.pass,true);
 assert.equal(result.publicationEligible,false);
 assert.ok(result.reasonCodes.includes("V3_SHADOW_PROJECTIONS_MAPPED_NOT_LIVE_WIRED"));
 assert.deepEqual(Object.fromEntries(Object.entries(result.candidate).filter(([k])=>k!=="engine22V3Shadow")),legacy);
 shadow.currentWavelength.degrees.micro.sourceCountId="WRONG";
 const bad=buildEngine22V3CompatibilityPreview({legacy,shadow});
 assert.equal(bad.mappingReady,false);
 assert.equal(bad.pass,false);
});

test("seven degree compatible view has flat independent identities and does not publish timing authority",()=>{
 const names=["intraday_submicro","micro","subminute","minute","minor","intermediate","primary"];
 const states=Object.fromEntries(names.map((k,i)=>[k,{
  sourceCountId:"COUNT-"+i,sequenceId:"SEQ-"+i,activeWave:"W3",
  lifecycle:"DEVELOPING",parentDegree:null,parentWave:null,
  anchors:{W1_LOW:{price:7700+i,time:"2026-10-11 10:00",status:"CONFIRMED"}},
  invalidation:{},
 }]));
 const shadow={available:true,shadowOnly:true,
  degreeStates:{degrees:states},
  currentWavelength:{degrees:Object.fromEntries(names.map(k=>[k,{sourceCountId:states[k].sourceCountId,activeWave:"W3"}]))},
  engine22Display:{degrees:Object.fromEntries(names.map(k=>[k,{degree:k,rows:[]}]))}};
 const saved=structuredClone(shadow);
 const projected=buildEngine22V3ContractProjection({shadow});
 assert.equal(projected.available,true);
 assert.deepEqual(Object.keys(projected.degreeStates),names);
 assert.equal(projected.degreeStates.micro.sourceCountId,"COUNT-1");
 assert.equal(projected.degreeStates.intraday_submicro.sourceCountId,"COUNT-0");
 assert.equal(projected.degreeStates.micro.marks.W1_LOW.price,7701);
 assert.equal(projected.degreeStates.intraday_submicro.marks.W1_LOW.price,7700);
 assert.equal(projected.currentWavelength.degrees.micro.sourceCountId,"COUNT-1");
 assert.equal(projected.engine22Display.degreeOrder.length,7);
 assert.equal(projected.microExecutionContext,null);
 assert.equal(projected.publicationEligible,false);
 assert.deepEqual(shadow,saved);
 shadow.currentWavelength.degrees.micro.sourceCountId="OTHER";
 assert.equal(buildEngine22V3ContractProjection({shadow}).available,false);
});
