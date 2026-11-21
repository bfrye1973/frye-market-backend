import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {inspectSubmicroReplay,inventorySubmicroOct26} from "../waveObservation/inspectSubmicroHistory.js";
const snapshot=()=>({schema:"engine12.multiStrategyReplay.v1",replayContract:"CANONICAL_MULTI_STRATEGY_REPLAY",
 snapshotTime:"2026-10-26T15:00:00Z",strategies:{"intraday_scalp@10m":{engine22WaveStrategy:{
 currentWavelength:{degrees:{submicro:{activeWave:"C"}}}}}}});
test("Oct26 original Submicro count is not relabeled current W5",()=>{
 const result=inspectSubmicroReplay(JSON.stringify(snapshot()),{date:"2026-10-26"});
 assert.equal(result.canonical,true);assert.equal(result.originalWorkingPublication,null);
 assert.equal(result.legacySubmicroPresent,true);assert.equal(result.retrospectiveW5Applied,false);
});
test("published Submicro W5 only appears when archived packet actually contains it",()=>{
 const s=snapshot();s.strategies["intraday_scalp@10m"].engine22WaveStrategy.authorizedWorkingStructure={
 publishedAt:"2026-10-28T15:25:54Z",publicationId:null,degrees:{submicro:{
 available:true,activeWave:"W5",direction:"UP",modelVersion:"engine22.submicroFiveUpOct27OwnerWatch.v1",
 parentDegree:"micro",parentWave:"W3"}}};
 const result=inspectSubmicroReplay(JSON.stringify(s));assert.equal(result.originalWorkingPublication.activeWave,"W5");
 assert.equal(result.originalWorkingPublication.publicationId,null);
});
test("missing dates and invalid files fail closed",()=>{
 assert.equal(inspectSubmicroReplay("{").reason,"INVALID_JSON");
 assert.equal(inventorySubmicroOct26({dates:["2026-10-25"]}).ok,false);
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"e27-submicro-"));
 try{const day=path.join(root,"2026-10-27");fs.mkdirSync(day);
 fs.writeFileSync(path.join(day,"0100.json"),JSON.stringify(snapshot()));
 const result=inventorySubmicroOct26({root,dates:["2026-10-26","2026-10-27"]});
 assert.equal(result.days[0].reason,"DATE_NOT_FOUND");assert.equal(result.days[1].records.length,1);
 assert.equal(result.days[1].records[0].sourceHash.length,64);
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});
