import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectNtpReply,probeEngine18Ntp,diagnoseEngine18ClockSeries} from '../logic/engine18/engine18NtpDiagnostic.js';
const OFFSET=2208988800;
function stamp(buffer,offset,ms){
 const sec=Math.floor(ms/1000);
 const fraction=Math.floor((ms%1000)*4294967296/1000);
 buffer.writeUInt32BE((sec+OFFSET)>>>0,offset);
 buffer.writeUInt32BE(fraction>>>0,offset+4);
}
test('NTP diagnostic validates origin, stratum, leap and conservative network-delay uncertainty',()=>{
 const sendWallMs=Date.parse('2026-11-16T16:00:00.000Z');
 const request=Buffer.alloc(48);request[0]=0x23;stamp(request,40,sendWallMs);
 const response=Buffer.alloc(48);response[0]=0x24;response[1]=2;
 response.writeUInt32BE(1,8);
 request.subarray(40,48).copy(response,24);
 stamp(response,16,sendWallMs-30000);
 stamp(response,32,sendWallMs+13);
 stamp(response,40,sendWallMs+15);
 const v=inspectNtpReply(response,{request,sendWallMs,receiveWallMs:sendWallMs+40});
 assert.ok(v);
 assert.equal(v.stratum,2);
 assert.equal(v.staleReference,false);
 const stale=Buffer.from(response);
 stamp(stale,16,sendWallMs-600000);
 assert.equal(inspectNtpReply(stale,{request,sendWallMs,receiveWallMs:sendWallMs+40}).staleReference,true);
 assert.ok(Math.abs(v.offsetMs+6)<0.01);
 assert.ok(v.uncertaintyMs>=19);
 assert.equal(v.referenceType,'REMOTE_NTP_DIAGNOSTIC');
 const altered=Buffer.from(response);altered[24]=0;
 assert.equal(inspectNtpReply(altered,{request,sendWallMs,receiveWallMs:sendWallMs+40}),null);
 const unsync=Buffer.from(response);unsync[0]=0xe4;
 assert.equal(inspectNtpReply(unsync,{request,sendWallMs,receiveWallMs:sendWallMs+40}),null);
});
test('NTP probe accepts only allowlisted hosts and never touches real source',async()=>{
 await assert.rejects(probeEngine18Ntp({host:'unknown.example'}),/restricted read-only/);
 await assert.rejects(probeEngine18Ntp({host:'time.google.com',port:444}),/restricted read-only/);
});

test('series rejects stale/lost servers and never verifies clock',async()=>{
 let iteration=0,now=Date.parse('2026-11-16T16:00:00Z'),n=1000000000n;
 const read=async()=>{
  iteration++;
  return {servers:iteration===2?[
   {host:'time.cloudflare.com',reachable:false,reason:'TIMEOUT_OR_BLOCKED'},
   {host:'time.google.com',reachable:true,offsetMs:20,uncertaintyMs:30,stratum:1}
  ]:[
   {host:'time.cloudflare.com',reachable:true,offsetMs:7,uncertaintyMs:13,stratum:3},
   {host:'time.google.com',reachable:true,offsetMs:17,uncertaintyMs:24,stratum:1}
  ]};
 };
 const wall=()=>now,mono=()=>n;
 const sleep=async()=>{now+=751;n+=750000000n;};
 const series=await diagnoseEngine18ClockSeries({samples:3,intervalMs:0,read,wall,mono,sleep});
 assert.equal(series.allSourcesResponded,false);
 assert.equal(series.meetsFiveMsAuthenticatedGate,false);
 assert.equal(series.clockQuality,'UNVERIFIED');
 assert.equal(series.recordingAuthorization,false);
 assert.equal(series.samples[1].sourceCount,1);
 assert.equal(series.samples[1].interSourceDisagreementMs,null);
 assert.equal(series.samples[0].interSourceDisagreementMs,10);
 assert.equal(series.samples[1].wallMinusMonotonicStepMs,1);
});
test('series detects wall-clock steps and refuses to promote timing to verified',async()=>{
 let now=Date.parse('2026-11-16T16:00:00Z'),n=1000000000n,count=0;
 const report={servers:[
  {host:'time.cloudflare.com',reachable:true,offsetMs:0.5,uncertaintyMs:0.2,stratum:3},
  {host:'time.google.com',reachable:true,offsetMs:0.6,uncertaintyMs:0.3,stratum:1}
 ]};
 const sample=await diagnoseEngine18ClockSeries({
  samples:3,intervalMs:0,read:async()=>{count++;return report;},
  wall:()=>now,mono:()=>n,sleep:async()=>{n+=1000000000n;now+=count===1?1200:1000;}
 });
 assert.ok(sample.maxAbsWallStepMs>=200);
 assert.equal(sample.meetsFiveMsAuthenticatedGate,false);
 assert.equal(sample.recordingAuthorization,false);
});
