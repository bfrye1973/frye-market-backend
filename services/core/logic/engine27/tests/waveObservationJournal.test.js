import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {createWaveObservationJournal,projectWaveObservation} from "../waveObservation/createWaveObservationJournal.js";
const names=["submicro","micro","subminute","minute","minor","intermediate","primary"];
function snapshot(){
 const degrees={};
 for(let i=0;i<7;i++){
  const degree=names[i],parentDegree=names[i+1]??null;
  degrees[degree]={degree,available:true,selectionStatus:i<4?"OWNER_SELECTED_WORKING":"CANONICAL_DEGREE_STATE",
   sourcePath:"currentWavelength.degrees."+degree,modelVersion:"model."+degree+".v1",
   activeWave:["W5","W3","D","W2","W5","W3","W5"][i],
   direction:i===3?"DOWN":"UP",stage:"DEVELOPING",parentDegree,parentWave:i===0?"W3":i===1?"D":i===2?"W2":null,
   levels:[{key:"fib1",price:7770+i,status:"WATCH"}],review:{low:7600,high:7610},
   officialInvalidation:null};
 }
 return {symbol:"ES",now:"2026-10-28T15:40:00Z",strategies:{"intraday_scalp@10m":{
 engine22WaveStrategy:{authorizedWorkingStructure:{schema:"engine22.authorizedWorkingStructure.v1",
 mode:"READ_ONLY",status:"COMPLETE_WORKING_SELECTION",noExecution:true,noWaveTransition:true,
 modelFingerprint:"a".repeat(64),evidenceFingerprint:"b".repeat(64),publicationRevision:8,
 publishedAt:"2026-10-28T15:39:00Z",pointInTimeAsOfAvailable:false,degrees}}}}};
}
function withJournal(fn){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"e27-wave-"));
 try{fn(dir)}finally{fs.rmSync(dir,{recursive:true,force:true})}
}
const observe="2026-10-28T15:41:00Z";
test("initial publication records seven independent original events",()=>withJournal(root=>{
 const j=createWaveObservationJournal({root}),s=snapshot();
 assert.equal(j.append(s,{observedAt:observe}).stored,7);
 const events=j.readEvents();
 assert.equal(events.length,7);
 assert.equal(events[0].source.publicationTime,"2026-10-28T15:39:00Z");
 assert.equal(events[0].source.pointInTimeAsOfAvailable,false);
 assert.equal(events[0].wave.review.low,7600);
 assert.equal(events[0].wave.officialInvalidation,null);
 assert.equal(events[0].wave.approvedAt,null);
 assert.equal(events[0].physicalEsContract,null);
}));
test("refreshes and restart delivery are deduplicated",()=>withJournal(root=>{
 const s=snapshot(),j=createWaveObservationJournal({root});
 j.append(s,{observedAt:observe});
 assert.equal(j.append(s,{observedAt:"2026-10-28T15:42:00Z"}).duplicates,7);
 assert.equal(createWaveObservationJournal({root}).append(s,{observedAt:"2026-10-28T15:43:00Z"}).stored,0);
 assert.equal(j.readEvents().length,7);
}));
test("touch and structural changes append without rewriting original evidence",()=>withJournal(root=>{
 const j=createWaveObservationJournal({root}),s=snapshot();
 j.append(s,{observedAt:observe});
 const original=j.readEvents().find(x=>x.degree==="micro");
 s.strategies["intraday_scalp@10m"].engine22WaveStrategy.authorizedWorkingStructure.degrees.micro.levels[0].status="TOUCHED";
 assert.equal(j.append(s,{observedAt:"2026-10-28T15:44:00Z"}).stored,1);
 const micro=j.readEvents().filter(x=>x.degree==="micro");
 assert.equal(micro.length,2);
 assert.equal(micro[0].wave.levels[0].status,"WATCH");
 assert.equal(micro[1].wave.levels[0].status,"TOUCHED");
 assert.equal(micro[1].previousEventId,original.eventId);
}));
test("invalid and absent publisher fail closed",()=>withJournal(root=>{
 const j=createWaveObservationJournal({root}),s=snapshot();
 delete s.strategies["intraday_scalp@10m"].engine22WaveStrategy.authorizedWorkingStructure;
 assert.equal(j.append(s,{observedAt:observe}).ok,false);
 assert.equal(j.readEvents().length,0);
}));
test("invalid parent relation and missing clock fail closed",()=>withJournal(root=>{
 const j=createWaveObservationJournal({root}),s=snapshot();
 assert.equal(projectWaveObservation(s).reason,"OBSERVATION_TIME_REQUIRED");
 s.strategies["intraday_scalp@10m"].engine22WaveStrategy.authorizedWorkingStructure.degrees.micro.parentWave="C";
 assert.equal(j.append(s,{observedAt:observe}).ok,false);
 assert.equal(j.readEvents().length,0);
}));
test("market evidence missingness explicit, no invented physical contract",()=>withJournal(root=>{
 const j=createWaveObservationJournal({root}),s=snapshot();
 j.append(s,{observedAt:observe,physicalEsContract:"ESZ26"});
 assert.equal(j.readEvents()[0].physicalEsContract,"ESZ26");
 assert.equal(j.readEvents()[0].zoneContext,null);
}));

test("changing optional market context alone does not generate new wave events",()=>withJournal(root=>{
 const j=createWaveObservationJournal({root}),s=snapshot();
 assert.equal(j.append(s,{observedAt:observe,marketEvidence:{price:7770}}).stored,7);
 assert.equal(j.append(s,{observedAt:"2026-10-28T15:42:00Z",marketEvidence:{price:7775}}).stored,0);
 assert.equal(j.readEvents().length,7);
}));
test("interrupted pending write fails closed instead of silently erasing evidence",()=>withJournal(root=>{
 const j=createWaveObservationJournal({root}),s=snapshot();
 fs.mkdirSync(j.storagePath,{recursive:true});
 fs.writeFileSync(path.join(j.storagePath,"interrupted.pending"),"incomplete");
 assert.equal(j.append(s,{observedAt:observe}).reason,"INCOMPLETE_PENDING_EVENT_REQUIRES_RECOVERY");
 assert.equal(j.readEvents().length,0);
}));

test("source Replay identity is preserved without fabricating original SHA",()=>withJournal(root=>{
 const j=createWaveObservationJournal({root}),s=snapshot();
 const sourceReplay={date:"2026-10-28",time:"0840",
   path:"/var/data/replay/es/2026-10-28/0840.json",
   sha256:"b".repeat(64),snapshotTimeUtc:"2026-10-28T15:40:00Z",
   hashBasis:"ORIGINAL_REPLAY_FILE_BYTES"};
 assert.equal(j.append(s,{observedAt:observe,sourceReplay}).stored,7);
 assert.deepEqual(j.readEvents()[0].sourceReplay,sourceReplay);
 assert.equal(j.append(s,{observedAt:"2026-10-28T15:42:00Z",sourceReplay}).stored,0);
}));
test("unverified Replay hash and inconsistent source path fail closed",()=>withJournal(root=>{
 const j=createWaveObservationJournal({root}),s=snapshot();
 const fake={date:"2026-10-28",time:"0840",
   path:"/var/data/replay/es/2026-10-28/0840.json",sha256:"b".repeat(64),
   snapshotTimeUtc:"2026-10-28T15:40:00Z",hashBasis:"RESERIALIZED_API_RESPONSE"};
 assert.equal(j.append(s,{observedAt:observe,sourceReplay:fake}).reason,"INVALID_OR_UNVERIFIED_REPLAY_IDENTITY");
 fake.hashBasis="ORIGINAL_REPLAY_FILE_BYTES";fake.path="/wrong/path";
 assert.equal(j.append(s,{observedAt:observe,sourceReplay:fake}).stored,0);
 assert.equal(j.readEvents().length,0);
}));
