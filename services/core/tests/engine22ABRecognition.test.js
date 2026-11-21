import test from "node:test";
import assert from "node:assert/strict";
import {qualifyEngine22ABPivots,evaluateEngine22ABStructure,buildEngine22ABRecognitionShadow} from "../logic/engine22/recognition/buildWaveRecognitionShadow.js";
const b=(i,h,l,c)=>({sourceTimestamp:new Date(Date.UTC(2026,9,26,12,i*5)).toISOString(),sourceBarId:"ES-5m-"+i,
  timeframe:"5m",sourceVendor:"fixture",sourceSeriesId:"ES-CONTINUOUS-1",closed:true,open:c,high:h,low:l,close:c});
const bars=[b(0,10,8,9),b(1,11,9,10),b(2,14,10,12),b(3,12,9,10),b(4,11,8,9),b(5,12,7,10),b(6,13,9,11),b(7,14,10,12)];
const owner={degreeId:"MICRO",parentDegree:"SUBMINUTE",countId:null,modelVersion:"engine22.microCDownOwnerWatch.v1",ownerApprovalRef:"2026-10-25",activeWave:null,sequenceDirection:"DOWN",patternType:"ABC",anchors:{}};
test("closed-bar swings are candidates, never approved wave anchors",()=>{
 const result=qualifyEngine22ABPivots({bars,timeframe:"5m",expectedSource:{sourceVendor:"fixture",sourceSeriesId:"ES-CONTINUOUS-1"}});
 assert.equal(result.available,true);assert.ok(result.pivots.length>0);
 assert.ok(result.pivots.every(x=>x.ownerApproved===false&&x.waveCompletionConfirmed===false));
});
test("forming bars and missing/duplicate source identity fail closed",()=>{
 assert.equal(qualifyEngine22ABPivots({bars:[...bars.slice(0,3),{...bars[3],closed:false},...bars.slice(4)],timeframe:"5m"}).available,false);
 assert.equal(qualifyEngine22ABPivots({bars:[...bars.slice(0,4),{...bars[4],sourceBarId:bars[3].sourceBarId},...bars.slice(5)],timeframe:"5m"}).available,false);
 assert.equal(qualifyEngine22ABPivots({bars,timeframe:"10m"}).available,false);
});
test("source continuity mismatch fails closed",()=>{
 assert.equal(qualifyEngine22ABPivots({bars,timeframe:"5m",expectedSource:{sourceVendor:"OTHER",sourceSeriesId:"ES-CONTINUOUS-1"}}).available,false);
});
test("retains current working owner model and makes alternatives read-only",()=>{
 const r=buildEngine22ABRecognitionShadow({bars,timeframe:"5m",degree:"MICRO",ownerCount:owner,
 alternatives:[{patternType:"ABC",candidateKey:"alt1"},{patternType:"ABCDE",candidateKey:"alt2"}]});
 assert.equal(r.available,true);assert.equal(r.structure.workingCount.modelVersion,owner.modelVersion);
 assert.equal(r.structure.alternatives.length,2);assert.ok(r.structure.alternatives.every(x=>!x.activationAuthorized));
 assert.equal(r.publishAuthorized,false);assert.equal(r.noWaveCountMutation,true);
});
test("synthetic V3 baseline count cannot become an active owner",()=>{
 const pivots=qualifyEngine22ABPivots({bars,timeframe:"5m"});
 assert.equal(evaluateEngine22ABStructure({degree:"MICRO",ownerCount:{...owner,countId:"ES-V3-BASELINE-MICRO"},pivotEvidence:pivots}).available,false);
});
test("cannot override owner without correct degree/parent and direction",()=>{
 const pivots=qualifyEngine22ABPivots({bars,timeframe:"5m"});
 assert.equal(evaluateEngine22ABStructure({degree:"MICRO",ownerCount:{...owner,parentDegree:"MINUTE"},pivotEvidence:pivots}).available,false);
 assert.equal(evaluateEngine22ABStructure({degree:"MICRO",ownerCount:{...owner,sequenceDirection:"NONE"},pivotEvidence:pivots}).available,false);
});
test("does not change any input objects",()=>{
 const source={bars,ownerCount:owner,degree:"MICRO",timeframe:"5m"};
 const prior=structuredClone(source);
 buildEngine22ABRecognitionShadow(source);
 assert.deepEqual(source,prior);
});
