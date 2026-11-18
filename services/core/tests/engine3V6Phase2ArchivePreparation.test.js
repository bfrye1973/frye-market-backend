import test from "node:test";
import assert from "node:assert/strict";
import {buildEngine3RawBarArchivePacket as build} from "../logic/engine3/v6/buildEngine3RawBarArchivePacket.js";
const now=Date.parse("2026-11-17T17:00:00Z");
const bar=(time,close)=>({time:Math.floor(time/1000),open:close,high:close+1,low:close-1,close});
test("archive preparation includes only completed bars and creates no recording",()=>{
 const r=build({evaluationTimeMs:now,bars1m:[
  bar(now-60000,100),bar(now,101)],bars5m:[
  bar(now-5*60000,100),bar(now-3*60000,102)],
  bars10m:[bar(now-10*60000,100),bar(now-2*60000,102)],
  engine26:{candidateId:"C",zoneId:"Z",entryZone:{low:99,high:101}}});
 assert.equal(r.ok,true);
 assert.equal(r.recordingActivated,false);
 assert.equal(r.packet.mode,"NOT_RECORDING");
 assert.equal(r.packet.completedBars["1m"].length,1);
 assert.equal(r.packet.completedBars["5m"].length,1);
 assert.equal(r.packet.completedBars["10m"].length,1);
 assert.equal(r.sha256.length,64);
});
test("future wave publication cannot contaminate historical archive",()=>{
 const r=build({evaluationTimeMs:now,engine22:{authorizedWorkingStructure:{
 publishedAt:new Date(now+60000).toISOString(),modelFingerprint:"a".repeat(64),
 degrees:{submicro:{direction:"DOWN"},micro:{direction:"DOWN"}}}}});
 assert.equal(r.packet.engine22,null);
 assert.equal(r.packet.engine22PublicationAsOfValid,false);
});
test("packet is deterministic and size bounded",()=>{
 const x={evaluationTimeMs:now,bars1m:[bar(now-60000,100)]};
 const a=build(x),b=build(x);
 assert.equal(a.sha256,b.sha256);
 assert.equal(a.dedupeKey,b.dedupeKey);
 assert.equal(build({...x,maxBytes:10}).reasonCode,"ARCHIVE_PACKET_SIZE_LIMIT");
 assert.equal(build({...x,symbol:"SPY"}).ok,false);
});
