import test from "node:test";
import assert from "node:assert/strict";
import {ENGINE22_V3_DEGREES,ENGINE22_V3_PARENT,ENGINE22_V3_SCHEMA} from "../logic/engine22/v3/canonicalStructure.js";
import {projectEngine22V3ActiveWaveFibShadow as project} from "../logic/engine22/v3/projectActiveWaveFibShadow.js";
const TF={INTRADAY_SUBMICRO:"5m",MICRO:"10m",SUBMINUTE:"1h",MINUTE:"4h",
 MINOR:"1d",INTERMEDIATE:"1w",PRIMARY:"1mo"};
const date=i=>new Date(Date.UTC(2026,9,1+i)).toISOString();
const a=(price,i)=>({price,time:date(i),status:"CONFIRMED"});
const waveMarks=(direction="UP",offset=0)=>{
 const v=direction==="UP"?{
 W1_LOW:100,W1_HIGH:110,W2_LOW:105,W3_HIGH:125,W4_LOW:115,
 }:{
 W1_HIGH:300,W1_LOW:290,W2_HIGH:295,W3_LOW:275,W4_HIGH:285,
 };
 return Object.fromEntries(Object.entries(v).map(([key,price],i)=>
  [key,a(price+offset,i)]));
};
const fixture=(wave="W3",dir="UP",degree="MICRO",offset=0,option={})=>{
 const anchors=waveMarks(dir,offset);
 const canonical={
 schema:ENGINE22_V3_SCHEMA,symbol:"ES",noPermissionCreated:true,noExecution:true,
 degrees:Object.fromEntries(ENGINE22_V3_DEGREES.map((d,i)=>[d,{
   degreeId:d,countId:d+"-count",sequenceId:d+"-seq",
   parentDegree:ENGINE22_V3_PARENT[d],parentWave:"W3",
   activeWave:d===degree?wave:"W3",lifecycle:"DEVELOPING",
   sequenceDirection:dir,anchors:waveMarks(dir,d===degree?offset:offset+10+i),
   history:[],provenance:{source:"FIXTURE"},invalidation:{},fibModel:{},
 }]))};
 const p=option.prices || (dir==="UP"?[108,112,118,114]:[292,287,281,288]);
 const bars=p.map((price,i)=>({
  sourceTimestamp:date(i+5),sourceBarId:`${degree}:${i}`,
  timeframe:TF[degree],closed:true,
  high:price+1,low:price-1,close:price,
 }));
 const source={structuralEligible:true,coverageComplete:true,seriesId:degree+"-series",
  datasetVersion:"dataset-1",priceBasis:"CONTINUOUS_ADJUSTED",
  sourceCountId:degree+"-count",timeframe:TF[degree],bars};
 return {canonical,source,degree,anchors};
};
for(const dir of ["UP","DOWN"]){
 test(dir+" automatic independent W1–W5 wave-specific Fibonacci models",()=>{
  for(const wave of ["W1","W2","W3","W4","W5"]){
   const {canonical,source,degree}=fixture(wave,dir);
   const unchanged=structuredClone(canonical);
   const result=project({canonical,degree,source});
   assert.equal(result.available,true,`${dir} ${wave}: ${result.reasonCodes}`);
   assert.equal(result.activeWave,wave);
   assert.equal(result.modelType,wave==="W1"?"DEVELOPING_RANGE":
      ["W2","W4"].includes(wave)?"RETRACEMENT":"EXTENSION");
   assert.equal(result.provisional,wave==="W1");
   assert.ok(result.levels.length>=3);
   assert.equal(result.waveCompletionConfirmed,false);
   assert.equal(result.publishAuthorized,false);
   assert.equal(result.officialFibAuthorityChanged,false);
   assert.equal(result.noExecution,true);
   assert.deepEqual(canonical,unchanged);
   assert.ok(result.levels.every((l,i,arr)=>i===0||
     (["W2","W4"].includes(wave)? 
       (dir==="UP"?l.price<arr[i-1].price:l.price>arr[i-1].price):
       (dir==="UP"?l.price>arr[i-1].price:l.price<arr[i-1].price))));
  }
 });
}
test("verified bullish W2/W4 retracement and W3/W5 extension arithmetic",()=>{
 const expectations={
  W2:["r500",105],W3:["e1000",115],
  W4:["r500",115],W5:["e1000",125],
 };
 for(const [wave,[key,price]] of Object.entries(expectations)){
  const x=fixture(wave),out=project(x);
  assert.equal(out.levels.find(l=>l.key===key).price,price,wave);
 }
});
test("verified bearish W2/W4 retracement and W3/W5 extension arithmetic",()=>{
 const expectations={
  W2:["r500",295],W3:["e1000",285],
  W4:["r500",285],W5:["e1000",275],
 };
 for(const [wave,[key,price]] of Object.entries(expectations)){
  const x=fixture(wave,"DOWN"),out=project(x);
  assert.equal(out.levels.find(l=>l.key===key).price,price,wave);
 }
});
test("TOUCHED persists after rebound, but never completes or changes lifecycle",()=>{
 const f=fixture("W2","UP","MICRO",0,{prices:[108,104,109,109]});
 const before=structuredClone(f.canonical);
 const first=project(f);
 assert.equal(first.available,true);
 assert.equal(first.levels.find(l=>l.key==="r500").status,"TOUCHED");
 assert.equal(first.levels.find(l=>l.key==="r786").status,"WATCH");
 const latter=project({...f,source:{...f.source,bars:f.source.bars.slice(-3)},previous:first});
 assert.equal(latter.available,true);
 assert.equal(latter.levels.find(l=>l.key==="r500").status,"TOUCHED");
 assert.equal(latter.waveCompletionConfirmed,false);
 assert.equal(latter.publishAuthorized,false);
 assert.deepEqual(f.canonical,before);
});
test("W4 touch can survive a rebounding partial page when model identity matches",()=>{
 const f=fixture("W4","UP","MICRO",0,{prices:[122,117,123,123]});
 const a=project(f);
 assert.equal(a.levels.find(l=>l.key==="r382").status,"TOUCHED");
 const b=project({...f,source:{...f.source,bars:f.source.bars.slice(-3)},previous:a});
 assert.equal(b.levels.find(l=>l.key==="r382").status,"TOUCHED");
 const other=fixture("W4","UP","MICRO",0,{prices:[123,123,123]});
 other.source.datasetVersion="different";
 const c=project({...other,previous:a});
 assert.equal(c.levels.find(l=>l.key==="r382").status,"WATCH");
});
test("invalidated/recount/locked waves never create fresh models",()=>{
 for(const lifecycle of ["INVALIDATED","RECOUNT_REQUIRED","LOCKED"]){
  const f=fixture();
  f.canonical.degrees.MICRO.lifecycle=lifecycle;
  assert.equal(project(f).available,false);
 }
});
test("missing required anchors or invalid impulses fail closed instead of inventing prices",()=>{
 const f=fixture("W5");
 delete f.canonical.degrees.MICRO.anchors.W4_LOW;
 assert.equal(project(f).available,false);
 const g=fixture("W3");
 g.canonical.degrees.MICRO.anchors.W1_HIGH.price=99;
 assert.equal(project(g).available,false);
});
test("Engine11 absent/incomplete/incorrect-degree history stays unavailable",()=>{
 const f=fixture("W3");
 for(const source of [null,{...f.source,coverageComplete:false},
  {...f.source,structuralEligible:false},
  {...f.source,timeframe:"1w"},
  {...f.source,sourceCountId:"WRONG"}]){
  const r=project({...f,source});
  assert.equal(r.available,false);
  assert.equal(r.reasonCodes[0],"SOURCE_UNAVAILABLE");
 }
 assert.equal(project({...f,source:{...f.source,bars:f.source.bars.map(
  (bar,i)=>i===1?{...bar,closed:false}:bar)}}).available,false);
});
test("seven degrees are independent, including explicit missing weekly/monthly sources",()=>{
 const r=ENGINE22_V3_DEGREES.map((degree,i)=>{
   const f=fixture("W5",i%2?"DOWN":"UP",degree,i*1000);
   if(["INTERMEDIATE","PRIMARY"].includes(degree))f.source=null;
   return {degree,result:project(f)};
 });
 assert.equal(r.filter(x=>x.result.available).length,5);
 for(const x of r.slice(-2)){
  assert.equal(x.result.available,false);
  assert.equal(x.result.reasonCodes[0],"SOURCE_UNAVAILABLE");
 }
 assert.equal(new Set(r.slice(0,5).map(x=>x.result.modelKey)).size,5);
});
test("missing source history fails without changing approved anchor and legacy Fibonacci modules",async()=>{
 const f=fixture("W3");
 const state=structuredClone(f.canonical);
 assert.equal(project({...f,source:null}).available,false);
 assert.deepEqual(f.canonical,state);
 const fs=await import("node:fs");
 const shadow=fs.readFileSync(new URL("../logic/engine22/v3/projectActiveWaveFibShadow.js",import.meta.url),"utf8");
 assert.doesNotMatch(shadow,/writeFileSync|updateFile|merge_pull_request|brokerOrder/i);
});
