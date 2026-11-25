import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {buildCurrentWavelength} from "../logic/engine22/wave/buildCurrentWavelength.js";
import {applyOwnerPriceTouchesV1} from "../logic/engine22/wave/applyOwnerPriceTouchesV1.js";
import {buildEngine22WorkingWaveNodesV1} from "../logic/engine22/wave/buildEngine22WorkingWaveNodesV1.js";
const wave=()=>buildCurrentWavelength({symbol:"ES",currentPrice:7471.5,microBars5m:[]});
const subject=w=>w.degrees.subminute.ownerSubminuteAbcDownNov16Research;
test("Nov16 owner Subminute ABC inputs and C-down Fibonacci targets are exact",()=>{
 const m=subject(wave());
 assert.equal(m.version,"engine22.ownerSubminuteAbcDownNov16Research.v1");
 assert.equal(m.selectionStatus,"RESEARCH_ONLY");
 assert.equal(m.activeWave,"C");assert.equal(m.direction,"DOWN");
 assert.equal(m.anchors.aHigh,7675.75);
 assert.equal(m.anchors.aHighLocalTime,"2026-11-12 09:00 AZ");
 assert.equal(m.anchors.aHighAtUtc,"2026-11-12T16:00:00Z");
 assert.equal(m.anchors.aLow,7516);
 assert.equal(m.anchors.aLowLocalTime,"2026-11-13 08:00 AZ");
 assert.equal(m.anchors.aLowAtUtc,"2026-11-13T15:00:00Z");
 assert.equal(m.anchors.bHigh,7614);
 assert.equal(m.anchors.bHighLocalTime,"2026-11-15 16:30 AZ");
 assert.equal(m.anchors.bHighAtUtc,"2026-11-15T23:30:00Z");
 assert.equal(m.anchors.cLow,null);
 assert.equal(m.aLength,159.75);
 assert.deepEqual(m.levels.map(l=>[l.label,l.price]),[
  ["0.618",7515.25],["1.000",7454.25],["1.272",7410.75],
  ["1.618",7355.50],["2.000",7294.50],["2.618",7195.75]
 ]);
 assert(m.levels.every(l=>l.status==="WATCH"&&l.provisional));
 assert.equal(m.noExecution,true);
 const n=buildEngine22WorkingWaveNodesV1({symbol:"ES",currentWavelength:wave()});
 assert.deepEqual(n.degrees.subminute.nodes.map(x=>x.ownerArizonaTime),[
  "2026-11-12 09:00 AZ","2026-11-13 08:00 AZ","2026-11-15 16:30 AZ"
 ]);
 assert.equal(n.degrees.subminute.nodes.length,3);
});
test("new Subminute C touches occur after B high and persist without changing old count",()=>{
 const before=applyOwnerPriceTouchesV1({currentWavelength:wave(),currentPrice:7000,
   evaluationTimeMs:Date.parse("2026-11-15T23:29:00Z")});
 assert(subject(before).levels.every(l=>l.status==="WATCH"));
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"engine22-subminute-nov16-"));
 try{
 const storePath=path.join(dir,"touches.json");
 const t=Date.parse("2026-11-16T17:00:00Z");
 const hit=applyOwnerPriceTouchesV1({currentWavelength:wave(),currentPrice:7471.5,
   evaluationTimeMs:t,storePath});
 assert.deepEqual(subject(hit).levels.map(l=>l.status),
   ["TOUCHED","WATCH","WATCH","WATCH","WATCH","WATCH"]);
 assert.equal(subject(hit).levels[0].touchEvidenceType,"ES_CURRENT_PRICE");
 const retained=applyOwnerPriceTouchesV1({currentWavelength:wave(),currentPrice:7560,
   evaluationTimeMs:t+600000,storePath});
 assert.equal(subject(retained).levels[0].status,"TOUCHED");
 const preBBar=applyOwnerPriceTouchesV1({currentWavelength:wave(),currentPrice:7614,
   evaluationTimeMs:t,
   bars10m:[{time:Math.floor(Date.parse("2026-11-15T23:20:00Z")/1000),low:7000,high:7620}]});
 assert(subject(preBBar).levels.every(l=>l.status==="WATCH"),
  "pre-B candle must never trigger new Subminute C");
 assert.equal(hit.degrees.subminute.ownerSubminuteW1FormingNov9Research.version,
   "engine22.subminuteW1FormingNov9Research.v1");
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
