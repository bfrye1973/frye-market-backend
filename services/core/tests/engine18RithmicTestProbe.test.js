import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeSystemInfoRequest,encodeTickerPlantLogin,decodeFields,parseSystemInfo,
 parseLogin,verifyTestEnvironment,probeRithmicTest,PROTOCOL_FIELDS} from
 '../logic/engine18/engine18RithmicTestProbe.js';
const v=n=>{const a=[];do{let b=n&127;n=Math.floor(n/128);a.push(n?b|128:b)}while(n);return Buffer.from(a)};
const field=(n,data)=>Buffer.concat([v(n*8+2),v(data.length),Buffer.from(data)]);
const int=(n,x)=>Buffer.concat([v(n*8),v(x)]);
test('protobuf handshake uses market data template only, no order plant',()=>{
 const a=decodeFields(encodeSystemInfoRequest());
 assert.equal(a[PROTOCOL_FIELDS.templateId][0],16);
 const b=decodeFields(encodeTickerPlantLogin({user:'demo',password:'not_logged'}));
 assert.equal(b[PROTOCOL_FIELDS.templateId][0],10);
 assert.equal(b[PROTOCOL_FIELDS.infraType][0],1);
 assert.equal(b[PROTOCOL_FIELDS.systemName][0].toString(),'Rithmic Test');
});
test('decode actual field identifiers and reject malformed input',()=>{
 const sys=Buffer.concat([int(PROTOCOL_FIELDS.templateId,17),field(PROTOCOL_FIELDS.rpCode,'0'),
 field(PROTOCOL_FIELDS.systemName,'Rithmic Test')]);
 assert.deepEqual(parseSystemInfo(sys).systems,['Rithmic Test']);
 assert.deepEqual(parseSystemInfo(sys).rpCodes,['0']);
 const log=Buffer.concat([int(PROTOCOL_FIELDS.templateId,11),field(PROTOCOL_FIELDS.rpCode,'0')]);
 assert.deepEqual(parseLogin(log).rpCodes,['0']);
 assert.throws(()=>decodeFields(Buffer.from([0x82])),/truncated/);
 assert.throws(()=>parseLogin(sys),/unexpected/);
});
test('fail closed: no network without explicit flag and credentials',()=>{
 assert.throws(()=>verifyTestEnvironment({}),/disabled/);
 assert.throws(()=>verifyTestEnvironment({RITHMIC_TEST_CONNECT_ENABLED:'YES'}),/credentials/);
 assert.throws(()=>verifyTestEnvironment({RITHMIC_TEST_CONNECT_ENABLED:'YES',
 RITHMIC_TEST_USER:'a',RITHMIC_TEST_PASSWORD:'b',
 RITHMIC_TEST_ENDPOINT:'wss:\/\/evil.example'}),/override/);
});
test('opt-in probe uses separate info and ticker-plant sockets and sanitized responses',async()=>{
 const frames=[
 Buffer.concat([int(PROTOCOL_FIELDS.templateId,17),
  field(PROTOCOL_FIELDS.systemName,'Rithmic Test'),field(PROTOCOL_FIELDS.rpCode,'0')]),
 Buffer.concat([int(PROTOCOL_FIELDS.templateId,11),field(PROTOCOL_FIELDS.rpCode,'0')])
 ];
 let sockets=0, sent=[];
 const {EventEmitter}=await import('node:events');
 class FakeWS extends EventEmitter{
  constructor(){super();this.num=sockets++;queueMicrotask(()=>this.emit('open'))}
  send(msg){sent.push(msg);queueMicrotask(()=>this.emit('message',frames[this.num]))}
  close(){}terminate(){}
 }
 const r=await probeRithmicTest({WebSocketImpl:FakeWS,env:{
  RITHMIC_TEST_CONNECT_ENABLED:'YES',RITHMIC_TEST_USER:'demo',
  RITHMIC_TEST_PASSWORD:'fake'},timeoutMs:1000});
 assert.equal(r.stage,'LOGIN');assert.equal(r.dbSnapshotVerified,false);
 assert.equal(sockets,2);assert.equal(sent.length,2);
 assert.equal(decodeFields(sent[1])[PROTOCOL_FIELDS.infraType][0],1);
});
