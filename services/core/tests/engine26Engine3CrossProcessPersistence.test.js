// Offline Engine26 -> Engine3 cross-process persistence proof.
// Uses temporary local files only. Does not touch Render, Replay or real trading.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {fileURLToPath} from "node:url";
import {inspectEngine26AuthorizationContract} from "../logic/engine3/v6/inspectEngine26AuthorizationContract.js";

const moduleUrl=new URL("../logic/engine26/engine3AuthorizationClock.js",import.meta.url).href;
const root=path.dirname(fileURLToPath(import.meta.url));
const start="2026-11-18T13:00:00.000Z";
const sha=b=>createHash("sha256").update(b).digest("hex");
function isolated(){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"e26-e3-process-restart-"));
 return {dir,filePath:path.join(dir,"engine3-authorization-clock.json")};
}
function invoke(filePath,sourceAsOf,{authorized=true,candidateId="C1",zoneId="Z1",persist=true}={}){
 const script=`import {resolveEngine3AuthorizationClock as resolve} from ${JSON.stringify(moduleUrl)};
 const out=resolve({symbol:"ES",strategyId:"intraday_scalp@10m",
 candidateId:${JSON.stringify(candidateId)},zoneId:${JSON.stringify(zoneId)},
 sourceAsOf:${JSON.stringify(sourceAsOf)},authorized:${JSON.stringify(authorized)},
 persist:${JSON.stringify(persist)},filePath:process.env.CLOCK_TEST_PATH});
 console.log(JSON.stringify(out));`;
 const p=spawnSync(process.execPath,["--input-type=module","--eval",script],{
   cwd:root,env:{...process.env,CLOCK_TEST_PATH:filePath},encoding:"utf8",timeout:10000
 });
 assert.equal(p.status,0,p.stderr||p.stdout);
 return JSON.parse(p.stdout.trim());
}
function accepted(clock,at="2026-11-18T13:01:00.000Z"){
 return inspectEngine26AuthorizationContract({
  handoff:{candidateId:"C1",zoneId:"Z1",authorizeEngine3Evaluation:true,
   terminalLifecycle:false,...clock},
  candidate:{candidateId:"C1",zoneId:"Z1"},
  normalizedZoneInput:{eligible:true,identity:{candidateId:"C1",zoneId:"Z1"}},
  evaluationTimeMs:Date.parse(at)});
}
test("Engine26 clock byte and SHA survive isolated node-process restart; Engine3 reads only healthy source",()=>{
 const {dir,filePath}=isolated();
 try{
  const first=invoke(filePath,start);
  assert.equal(first.engine3AuthorizationSourceReady,true);
  assert.equal(first.engine3AuthorizationPersisted,true);
  const bytes=fs.readFileSync(filePath);
  const before=sha(bytes);
  assert.equal(accepted(first).status,"AUTHORITATIVE_TIMESTAMP_VALID");
  // Represents a new worker/process opening the existing store. The process
  // starts READ ONLY, so its first action cannot silently overwrite evidence.
  const reopened=invoke(filePath,start,{persist:false});
  assert.equal(reopened.engine3AuthorizationPersisted,false);
  assert.equal(reopened.engine3AuthorizationSourceReady,false);
  assert.equal(sha(fs.readFileSync(filePath)),before);
  assert.deepEqual(fs.readFileSync(filePath),bytes);
  assert.equal(accepted(reopened).authoritativeTimestampMs,null);
  const next=invoke(filePath,"2026-11-18T13:01:00.000Z");
  assert.equal(next.engine3AuthorizationStartedAt,start);
  assert.equal(next.engine3AuthorizationContinuous,true);
  assert.equal(next.engine3AuthorizationPersisted,true);
  assert.equal(accepted(next).status,"AUTHORITATIVE_TIMESTAMP_VALID");
  assert.equal(JSON.parse(fs.readFileSync(filePath,"utf8")).records["ES::intraday_scalp@10m"].sourceAsOf,"2026-11-18T13:01:00.000Z");
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
test("restart with corrupted prior state never overwrites it or gives Engine3 authority",()=>{
 const {dir,filePath}=isolated();
 try{
  invoke(filePath,start);
  fs.writeFileSync(filePath,"{invalid", "utf8");
  const badHash=sha(fs.readFileSync(filePath));
  const result=invoke(filePath,"2026-11-18T13:01:00.000Z");
  assert.equal(result.engine3AuthorizationSourceReady,false);
  assert.equal(result.engine3AuthorizationStorageHealthy,false);
  assert.equal(result.engine3AuthorizationPersisted,false);
  assert.equal(sha(fs.readFileSync(filePath)),badHash);
  assert.equal(accepted(result).authoritativeTimestampMs,null);
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
test("cross-process historical replay cannot rewind durable head or elevate timestamp",()=>{
 const {dir,filePath}=isolated();
 try{
  invoke(filePath,"2026-11-18T14:00:00.000Z");
  const before=sha(fs.readFileSync(filePath));
  const historical=invoke(filePath,"2026-11-18T13:30:00.000Z");
  assert.equal(historical.engine3AuthorizationPersistenceMode,"READ_ONLY_HISTORICAL");
  assert.equal(historical.engine3AuthorizationPersisted,false);
  assert.equal(historical.engine3AuthorizationSourceReady,false);
  assert.equal(sha(fs.readFileSync(filePath)),before);
  assert.equal(accepted(historical,"2026-11-18T14:01:00.000Z").authoritativeTimestampMs,null);
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});

test("Engine26 honors explicit persistent-path environment override in a fresh process",()=>{
 const {dir,filePath}=isolated();
 try{
  const script=`import {DEFAULT_ENGINE3_AUTHORIZATION_CLOCK_PATH as selected} from ${JSON.stringify(moduleUrl)};
  console.log(JSON.stringify({selected}));`;
  const p=spawnSync(process.execPath,["--input-type=module","--eval",script],{
   cwd:root,encoding:"utf8",timeout:10000,
   env:{...process.env,ENGINE26_PERSISTENT_STATE_ROOT:path.join(dir,"wrong-root"),
    ENGINE26_ENGINE3_AUTHORIZATION_CLOCK_PATH:filePath}
  });
  assert.equal(p.status,0,p.stderr||p.stdout);
  assert.equal(JSON.parse(p.stdout.trim()).selected,filePath);
  assert.equal(fs.existsSync(filePath),false,"import alone never writes state");
  assert.equal(fs.existsSync(path.join(dir,"wrong-root")),false);
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
test("Engine26 cross-process candidate and zone transitions reset authorization start",()=>{
 const {dir,filePath}=isolated();
 try{
  invoke(filePath,start);
  const next=invoke(filePath,"2026-11-18T13:01:00.000Z",{candidateId:"C2"});
  assert.equal(next.engine3AuthorizationStartedAt,"2026-11-18T13:01:00.000Z");
  assert.equal(next.engine3AuthorizationContinuous,false);
  const changedZone=invoke(filePath,"2026-11-18T13:02:00.000Z",{candidateId:"C2",zoneId:"Z2"});
  assert.equal(changedZone.engine3AuthorizationStartedAt,"2026-11-18T13:02:00.000Z");
  assert.equal(changedZone.engine3AuthorizationContinuous,false);
  const terminal=invoke(filePath,"2026-11-18T13:03:00.000Z",{authorized:false,candidateId:"C2",zoneId:"Z2"});
  assert.equal(terminal.engine3AuthorizationStartedAt,null);
  assert.equal(terminal.engine3AuthorizationPersisted,true);
  const fresh=invoke(filePath,"2026-11-18T13:04:00.000Z",{candidateId:"C2",zoneId:"Z2"});
  assert.equal(fresh.engine3AuthorizationStartedAt,"2026-11-18T13:04:00.000Z");
  assert.equal(fresh.engine3AuthorizationContinuous,false);
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
