import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectNtpReply,probeEngine18Ntp} from '../logic/engine18/engine18NtpDiagnostic.js';
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
 stamp(response,32,sendWallMs+13);
 stamp(response,40,sendWallMs+15);
 const v=inspectNtpReply(response,{request,sendWallMs,receiveWallMs:sendWallMs+40});
 assert.ok(v);
 assert.equal(v.stratum,2);
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
