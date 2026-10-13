import test from "node:test";
import assert from "node:assert/strict";
import {ENGINE22_V3_SCHEMA,ENGINE22_V3_DEGREES,ENGINE22_V3_PARENT} from "../logic/engine22/v3/canonicalStructure.js";
import {buildEngine22V3ShadowSnapshot} from "../logic/engine22/v3/buildShadowSnapshot.js";
import {buildEngine22V3ContractProjection} from "../logic/engine22/v3/compareProtectedContracts.js";
const tf={INTRADAY_SUBMICRO:"5m",MICRO:"10m",SUBMINUTE:"1h",
 MINUTE:"4h",MINOR:"1d",INTERMEDIATE:"1w",PRIMARY:"1mo"};
const stamp=i=>new Date(Date.UTC(2026,9,1,0,i*5)).toISOString();
const mark=(price,i)=>({price,time:stamp(i),status:"CONFIRMED"});
const canonical=()=>({
 schema:ENGINE22_V3_SCHEMA,symbol:"ES",sourceTimestamp:stamp(20),
 noPermissionCreated:true,noExecution:true,
 degrees:Object.fromEntries(ENGINE22_V3_DEGREES.map((d,i)=>[d,{
  degreeId:d,parentDegree:ENGINE22_V3_PARENT[d],parentWave:null,
  countId:d+"-count",sequenceId:d+"-seq",
  activeWave:"W3",sequenceDirection:"UP",lifecycle:"DEVELOPING",
  anchors:{W1_LOW:mark(100+i*100,0),W1_HIGH:mark(110+i*100,1),
   W2_LOW:mark(105+i*100,2)},
  history:[],provenance:{source:"TEST"},invalidation:{},fibModel:{},
 }])),
});
const bars=d=>[108,111,116,114,112,117,115].map((price,i)=>({
 sourceTimestamp:stamp(i+3),sourceBarId:d+"-"+i,timeframe:tf[d],
 high:price+1,low:price-1,close:price,closed:true,
 time:Date.parse(stamp(i+3))/1000,
}));
const source=(d)=>({structuralEligible:true,coverageComplete:true,
 sourceCountId:d+"-count",seriesId:d+"-series",datasetVersion:"1",
 priceBasis:"CONTINUOUS_ADJUSTED",timeframe:tf[d],bars:bars(d)});
test("single V3 shadow loop has seven independent card read models and leaves official view untouched",()=>{
 const c=canonical(),unchanged=structuredClone(c);
 const sources=Object.fromEntries(ENGINE22_V3_DEGREES.slice(0,5).map(d=>[d,source(d)]));
 const evidence=Object.fromEntries(ENGINE22_V3_DEGREES.slice(0,5).map(d=>[tf[d],bars(d)]));
 const result=buildEngine22V3ShadowSnapshot({
  canonical:c,sourceByDegree:sources,barsByTf:evidence,
  evaluationTimeMs:Date.UTC(2026,10,1),
 });
 assert.equal(result.available,true);
 assert.equal(result.v3LiveShadow.shadowOnly,true);
 assert.equal(result.v3LiveShadow.publishAuthorized,false);
 assert.equal(Object.keys(result.v3LiveShadow.degrees).length,7);
 for(const degree of ENGINE22_V3_DEGREES.slice(0,5)){
  const card=result.v3LiveShadow.degrees[degree.toLowerCase()];
  assert.equal(card.degree,degree);
  assert.equal(card.dataStatus,"SHADOW_READY",degree);
  assert.equal(card.activeWave,"W3");
  assert.equal(card.sourceTimeframe,tf[degree]);
  assert.equal(card.fibonacci.modelType,"EXTENSION");
  assert.equal(card.levels.length,5);
  assert.equal(card.officialFibAuthorityChanged,false);
  assert.equal(card.anchorPromotionAllowed,false);
  assert.equal(card.noExecution,true);
  assert.ok(card.swingHighCount>0,degree);
 }
 for(const degree of ["INTERMEDIATE","PRIMARY"]){
  const card=result.v3LiveShadow.degrees[degree.toLowerCase()];
  assert.equal(card.dataStatus,"INSUFFICIENT_HISTORY");
  assert.equal(card.levels.length,0);
  assert.equal(card.fibonacci.available,false);
 }
 assert.deepEqual(c,unchanged);
 assert.equal(result.degreeStates.degrees.micro.activeWave,"W3");
 assert.equal(result.currentWavelength.degrees.micro.fibModel.available,true);
 assert.equal(result.engine22Display.degrees.micro.noExecution,true);
});
test("node evidence alone never authorizes shadow Fibonacci",()=>{
 const c=canonical();
 const out=buildEngine22V3ShadowSnapshot({canonical:c,barsByTf:{"10m":bars("MICRO")},
  evaluationTimeMs:Date.UTC(2026,10,1)});
 const card=out.v3LiveShadow.degrees.micro;
 assert.equal(card.nodeEvidenceAvailable,true);
 assert.equal(card.dataStatus,"INSUFFICIENT_HISTORY");
 assert.equal(card.levels.length,0);
 assert.equal(card.activeWave,c.degrees.MICRO.activeWave);
});
test("wrong-degree provenance fails independently and no wave candidate becomes confirmation",()=>{
 const c=canonical(),s=source("MICRO");s.sourceCountId="SUBMINUTE-count";
 const out=buildEngine22V3ShadowSnapshot({canonical:c,
  sourceByDegree:{MICRO:s,SUBMINUTE:source("SUBMINUTE")}});
 assert.equal(out.v3LiveShadow.degrees.micro.dataStatus,"INSUFFICIENT_HISTORY");
 assert.equal(out.v3LiveShadow.degrees.subminute.dataStatus,"SHADOW_READY");
 assert.equal(out.v3LiveShadow.degrees.micro.lifecycle,"DEVELOPING");
 assert.equal(out.v3LiveShadow.degrees.micro.lifecycleReplay,null);
});
test("shadow touch may be TOUCHED, but canonical lifecycle never advances on Fib alone",()=>{
 const c=canonical(),original=structuredClone(c);
 const out=buildEngine22V3ShadowSnapshot({canonical:c,
  sourceByDegree:{MICRO:source("MICRO")}});
 assert.equal(out.v3LiveShadow.degrees.micro.fibonacci.waveCompletionConfirmed,false);
 assert.equal(out.v3LiveShadow.degrees.micro.lifecycle,"DEVELOPING");
 assert.deepEqual(c,original);
});

test("existing V3 compatibility projection forwards seven-degree sidecar without replacing legacy fields",()=>{
 const c=canonical();
 const shadow=buildEngine22V3ShadowSnapshot({canonical:c,sourceByDegree:{MICRO:source("MICRO")}});
 const projected=buildEngine22V3ContractProjection({shadow});
 assert.equal(projected.available,true);
 assert.equal(projected.v3LiveShadow.shadowOnly,true);
 assert.equal(Object.keys(projected.v3LiveShadow.degrees).length,7);
 assert.equal(projected.v3LiveShadow.degrees.micro.dataStatus,"SHADOW_READY");
 assert.equal(projected.v3LiveShadow.degrees.primary.dataStatus,"INSUFFICIENT_HISTORY");
 assert.equal(projected.engine22Display.version,"engine22Display.v3");
 assert.equal(projected.publicationEligible,false);
 assert.equal(projected.noExecution,true);
});
