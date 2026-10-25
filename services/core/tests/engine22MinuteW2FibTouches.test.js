import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {buildCurrentWavelength} from "../logic/engine22/wave/buildCurrentWavelength.js";
import {applyOwnerPriceTouchesV1} from "../logic/engine22/wave/applyOwnerPriceTouchesV1.js";
const date=Date.parse("2026-10-25T17:00:00Z");
const model=price=>buildCurrentWavelength({symbol:"ES",currentPrice:price,microBars5m:[]});
const apply=(price,previous,storePath,bars=[],when=date)=>
 applyOwnerPriceTouchesV1({currentWavelength:model(price),previousWavelength:previous,
 currentPrice:price,bars10m:bars,evaluationTimeMs:when,storePath});
test("Minute W2 touches are based on downside ES prices and are persistent, not fabricated",()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"minute-w2-touch-"));
 const file=path.join(dir,"touches.json");
 try {
  const first=apply(7672.5,null,file);
  const levels=first.degrees.minute.ownerMinuteW2Retracement.levels;
  assert.deepEqual(levels.map(l=>l.status),["TOUCHED","TOUCHED","WATCH","WATCH","WATCH","WATCH"]);
  assert.deepEqual(levels.map(l=>l.price),[7793.25,7721.75,7664.25,7606.5,7524.25,7419.5]);
  assert.equal(levels[0].touchEvidenceType,"ES_CURRENT_PRICE");
  assert.equal(levels[0].touchEvidence.verified,false);
  assert.equal(first.degrees.minute.ownerLargerCDownScenario.version,"engine22.largerCorrectionCDownWatch.v1");
  const next=apply(7800,first,file,[],date+600000);
  assert.equal(next.degrees.minute.ownerMinuteW2Retracement.levels[0].status,"TOUCHED");
  assert.equal(next.degrees.minute.ownerMinuteW2Retracement.levels[2].status,"WATCH");
  const persisted=apply(7800,null,file,[],date+1200000);
  assert.equal(persisted.degrees.minute.ownerMinuteW2Retracement.levels[1].status,"TOUCHED");
  assert.equal(persisted.degrees.minute.ownerMinuteW2Retracement.levels[2].status,"WATCH");
 } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
test("completed ES 10m lows may confirm a Minute W2 touch without using forming bars",()=>{
 const old=Math.floor((date-1200000)/1000);
 const raw=[{time:old,high:7800,low:7660,close:7672},
   {time:Math.floor(date/1000),high:7800,low:7410,close:7672}];
 const read=apply(7700,null,null,raw);
 const levels=read.degrees.minute.ownerMinuteW2Retracement.levels;
 assert.equal(levels[2].status,"TOUCHED");
 assert.equal(levels[2].touchEvidenceType,"ES_10M_COMPLETED_OHLC");
 assert.equal(levels[2].touchEvidence.verified,true);
 assert.equal(levels[5].status,"WATCH");
});
test("no Minute model or no current evidence cannot invent a touch",()=>{
 const initial=model(null);
 const result=applyOwnerPriceTouchesV1({currentWavelength:initial,currentPrice:null,bars10m:[],
 evaluationTimeMs:date,storePath:null});
 assert.ok(result.degrees.minute.ownerMinuteW2Retracement.levels.every(l=>l.status==="WATCH"));
});
