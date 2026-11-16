import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {buildCurrentWavelength} from "../logic/engine22/wave/buildCurrentWavelength.js";
import {applyOwnerPriceTouchesV1} from "../logic/engine22/wave/applyOwnerPriceTouchesV1.js";
import {buildEngine22WorkingWaveNodesV1} from "../logic/engine22/wave/buildEngine22WorkingWaveNodesV1.js";

const source=price=>buildCurrentWavelength({symbol:"ES",currentPrice:price,microBars5m:[]});
const micro=x=>x.degrees.micro.ownerMicroAbcDownNov16Research;
const minute=x=>x.degrees.minute.ownerMinuteW1FormingNov9Research;
const result=(price,opts={})=>applyOwnerPriceTouchesV1({
 currentWavelength:source(price),currentPrice:price,
 previousWavelength:opts.previous??null,bars10m:opts.bars10m??[],
 evaluationTimeMs:opts.at??Date.parse("2026-11-16T18:00:00Z"),
 storePath:opts.storePath??null,
});

test("owner Micro ABC anchors, independent older W5 and 77.50-point C extensions",()=>{
 const w=source(7500),m=micro(w);
 assert.equal(m.version,"engine22.ownerMicroAbcDownNov16Research.v1");
 assert.equal(m.activeWave,"C");
 assert.equal(m.direction,"DOWN");
 assert.equal(m.anchors.aHigh,7614.75);
 assert.equal(m.anchors.aHighLocalTime,"2026-11-15 16:40 AZ");
 assert.equal(m.anchors.aHighAtUtc,"2026-11-15T23:40:00Z");
 assert.equal(m.anchors.aLow,7537.25);
 assert.equal(m.anchors.aLowLocalTime,"2026-11-15 23:20 AZ");
 assert.equal(m.anchors.aLowAtUtc,"2026-11-16T06:20:00Z");
 assert.equal(m.anchors.bHigh,7570.75);
 assert.equal(m.anchors.bHighLocalTime,"2026-11-16 01:40 AZ");
 assert.equal(m.anchors.bHighAtUtc,"2026-11-16T08:40:00Z");
 assert.equal(m.aLength,77.5);
 assert.deepEqual(m.levels.map(l=>[l.label,l.price]),[
  ["0.618",7522.75],["1.000",7493.25],["1.272",7472.25],
  ["1.618",7445.25],["2.000",7415.75],["2.618",7367.75]]);
 assert.equal(m.anchors.cLow,null);
 assert.equal(m.completionConfirmed,false);
 assert.equal(m.noExecution,true);
 assert.equal(w.degrees.micro.ownerMicroW3Nov9ReclassifiedResearch.activeWave,"W5");
 const packet=buildEngine22WorkingWaveNodesV1({symbol:"ES",currentWavelength:w});
 assert.deepEqual(packet.degrees.micro.nodes.map(n=>[n.label,n.price,n.ownerArizonaTime]),[
  ["A starting high",7614.75,"2026-11-15 16:40 AZ"],
  ["A ending low",7537.25,"2026-11-15 23:20 AZ"],
  ["B ending high",7570.75,"2026-11-16 01:40 AZ"]]);
 assert(packet.degrees.micro.nodes.every(n=>n.noExecution&&n.waveCompletionConfirmed===false));
 assert.equal(packet.degrees.micro.nodes.some(n=>n.label==="C ending low / W1 start"),false);
 assert(packet.degrees.micro.models.some(n=>n.sourcePath.endsWith(".ownerMicroW3Nov9ReclassifiedResearch")&&!n.selectedForResearchDisplay));
});

test("Micro C and Minute W2 green-on-touch are isolated, post-origin and persist",()=>{
 const microStart=Date.parse("2026-11-16T08:40:00Z");
 const minuteStart=Date.parse("2026-11-11T15:00:00Z");
 const early=result(7000,{at:minuteStart-1000});
 assert(micro(early).levels.every(x=>x.status==="WATCH"));
 assert(minute(early).levels.every(x=>x.status==="WATCH"));
 const beforeMicro=result(7000,{at:microStart-1000});
 assert(micro(beforeMicro).levels.every(x=>x.status==="WATCH"));
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"engine22-micro-abc-minute-w2-"));
 try{
  const storePath=path.join(dir,"touch.json");
  const first=result(7500,{at:microStart+60000,storePath});
  assert.deepEqual(micro(first).levels.map(x=>x.status),
   ["TOUCHED","WATCH","WATCH","WATCH","WATCH","WATCH"]);
  assert.deepEqual(minute(first).levels.map(x=>x.status),
   ["TOUCHED","TOUCHED","WATCH","WATCH","WATCH","WATCH"]);
  assert.equal(micro(first).levels[0].touchEvidenceType,"ES_CURRENT_PRICE");
  assert.equal(minute(first).levels[0].touchEvidenceType,"ES_CURRENT_PRICE");
  const next=result(7450,{at:microStart+120000,storePath});
  assert.deepEqual(micro(next).levels.map(x=>x.status),
   ["TOUCHED","TOUCHED","TOUCHED","WATCH","WATCH","WATCH"]);
  assert.deepEqual(minute(next).levels.map(x=>x.status),
   ["TOUCHED","TOUCHED","TOUCHED","TOUCHED","WATCH","WATCH"]);
  const rebound=result(7580,{at:microStart+180000,storePath});
  assert.equal(micro(rebound).levels[2].status,"TOUCHED");
  assert.equal(minute(rebound).levels[3].status,"TOUCHED");
  const earlier=result(7570,{at:microStart+600000,
   bars10m:[{time:Math.floor((microStart-600000)/1000),low:7000,high:7600}]});
  assert(micro(earlier).levels.every(x=>x.status==="WATCH"),"no pre-B historical Micro touch");
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
