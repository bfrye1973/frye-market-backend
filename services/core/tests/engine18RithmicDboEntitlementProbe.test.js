import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {probeRithmicDbo} from '../logic/engine18/engine18RithmicDboEntitlementProbe.js';
import {PROTOCOL_FIELDS,decodeFields} from '../logic/engine18/engine18RithmicTestProbe.js';
const varint=x=>{let out=[];do{let b=x%128;x=Math.floor(x/128);out.push(x?b|128:b)}while(x);return Buffer.from(out)};
const int=(k,x)=>Buffer.concat([varint(k*8),varint(x)]);
const str=(k,x)=>{let b=Buffer.from(x);return Buffer.concat([varint(k*8+2),varint(b.length),b])};
const frame=(id,code)=>Buffer.concat([int(PROTOCOL_FIELDS.templateId,id),
 ...(code===undefined?[]:[str(PROTOCOL_FIELDS.rpCode,code)])]);
const env={RITHMIC_TEST_CONNECT_ENABLED:'YES',RITHMIC_TEST_USER:'synthetic',
 RITHMIC_TEST_PASSWORD:'fake-only'};
test('reject disabled probe before any socket',async()=>{
 await assert.rejects(probeRithmicDbo({env:{},initialProbe:async()=>{throw Error('unexpected')}}),
  /disabled/);
});
test('DBO requests are read-only and count only vendor-confirmed frames',async()=>{
 let sockets=0,sent=[];
 class FakeWS extends EventEmitter{
  constructor(){super();sockets++;queueMicrotask(()=>this.emit('open'))}
  send(v){let f=decodeFields(v);sent.push(f[PROTOCOL_FIELDS.templateId][0]);
   if(sent.length===1)queueMicrotask(()=>this.emit('message',frame(11,'0')));
   if(sent.length===3)queueMicrotask(()=>{this.emit('message',frame(118,'0'));
    this.emit('message',frame(116,'0'));this.emit('message',frame(160));});}
  close(){}terminate(){}
 }
 const result=await probeRithmicDbo({env,WebSocketImpl:FakeWS,timeoutMs:1000,
  initialProbe:async()=>({testAvailable:true})});
 assert.equal(sockets,1);
 assert.deepEqual(sent,[10,117,115]);
 assert.equal(result.counts.ack,1);assert.equal(result.counts.snapshot,1);
 assert.equal(result.counts.updates,1);assert.equal(result.bookValid,false);
 assert.equal(result.snapshotComplete,false);
});
test('nonzero vendor reply stays safe and fails without book acceptance',async()=>{
 let sent=0;
 class FakeWS extends EventEmitter{
  constructor(){super();queueMicrotask(()=>this.emit('open'))}
  send(){if(++sent===1)queueMicrotask(()=>this.emit('message',frame(11,'0')));
   if(sent===3)queueMicrotask(()=>this.emit('message',frame(118,'99')));}
  close(){}terminate(){}
 }
 const r=await probeRithmicDbo({env,WebSocketImpl:FakeWS,timeoutMs:1000,
  initialProbe:async()=>({testAvailable:true})});
 assert.equal(r.reason,'DBO_RESPONSE_NONZERO');assert.deepEqual(r.codes,['99']);
 assert.equal(r.sawOrderUpdate,false);
});
