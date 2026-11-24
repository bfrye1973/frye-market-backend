import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeSystemInfoRequest,encodeTickerPlantLogin,decodeFields,parseSystemInfo,
 parseLogin,verifyTestEnvironment,probeRithmicTest,PROTOCOL_FIELDS,
 encodeDboTestRequest,classifyDboTestResponse,DBO_TEMPLATES} from
 '../logic/engine18/engine18RithmicTestProbe.js';
const v=n=>{const a=[];do{let b=n&127;n=Math.floor(n/128);a.push(n?b|128:b)}while(n);return Buffer.from(a)};
const field=(n,data)=>Buffer.concat([v(n*8+2),v(data.length),Buffer.from(data)]);
const int=(n,x)=>Buffer.concat([v(n*8),v(x)]);
test('protobuf handshake uses market data template only, no order plant',()=>{
 const a=decodeFields(encodeSystemInfoRequest());
 assert.equal(a[PROTOCOL_FIELDS.templateId][0],16);
 const b=decodeFields(encodeTickerPlantLogin({user:'demo',password:'not_logged'}));
 assert.equal(b[PROTOCOL_FIELDS.templateId][0],10);
 assert.equal(b[PROTOCOL_FIELDS.templateVersion][0].toString(),'5.55');
 assert.equal(b[PROTOCOL_FIELDS.infraType][0],1);
 assert.equal(b[PROTOCOL_FIELDS.systemName][0].toString(),'Rithmic Test');
 assert.equal(b[PROTOCOL_FIELDS.appName][0].toString(),'brfr:Frye Engine18 ReadOnly Test');
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

test('DBO read-only request messages use vendor template and explicit subscription type',()=>{
 const snapshot=decodeFields(encodeDboTestRequest({kind:'snapshot',symbol:'ESZ6',exchange:'CME'}));
 assert.equal(snapshot[PROTOCOL_FIELDS.templateId][0],115);
 assert.equal(snapshot[110100][0].toString(),'ESZ6');
 assert.equal(snapshot[110101][0].toString(),'CME');
 const update=decodeFields(encodeDboTestRequest({kind:'subscribe',symbol:'ESZ6',exchange:'CME'}));
 assert.equal(update[PROTOCOL_FIELDS.templateId][0],117);
 assert.equal(update[100000][0],1);
 assert.throws(()=>encodeDboTestRequest({kind:'place-order',symbol:'ESZ6',exchange:'CME'}),/unsupported/);
 assert.throws(()=>encodeDboTestRequest({kind:'subscribe',symbol:'',exchange:'CME'}),/symbol/);
});
test('DBO acknowledgements are not misrepresented as complete book',()=>{
 for(const [templateId,kind] of [[116,'SNAPSHOT'],[118,'SUBSCRIPTION_ACK'],[160,'UPDATE']]){
  const frame=Buffer.concat([int(PROTOCOL_FIELDS.templateId,templateId)]);
  const reply=classifyDboTestResponse(frame);
  assert.equal(reply.kind,kind);
  assert.equal(reply.snapshotComplete,false);
  assert.equal(reply.bookValid,false);
 }
 assert.equal(classifyDboTestResponse(Buffer.concat([int(PROTOCOL_FIELDS.templateId,10)])).recognized,false);
});

test('only a single zero response code establishes authentication',async()=>{
 const {EventEmitter}=await import('node:events');
 const sys=Buffer.concat([int(PROTOCOL_FIELDS.templateId,17),field(PROTOCOL_FIELDS.rpCode,'0'),
 field(PROTOCOL_FIELDS.systemName,'Rithmic Test')]);
 const rejected=Buffer.concat([int(PROTOCOL_FIELDS.templateId,11),field(PROTOCOL_FIELDS.rpCode,'100'),
 field(PROTOCOL_FIELDS.rpCode,'sensitive server response')]);
 let connections=0;
 class FakeWS extends EventEmitter{
  constructor(){super();this.n=connections++;queueMicrotask(()=>this.emit('open'))}
  send(){queueMicrotask(()=>this.emit('message',this.n===0?sys:rejected))}
  close(){}terminate(){}
 }
 const out=await probeRithmicTest({WebSocketImpl:FakeWS,env:{
  RITHMIC_TEST_CONNECT_ENABLED:'YES',RITHMIC_TEST_USER:'test',
  RITHMIC_TEST_PASSWORD:'not-a-real-password'},timeoutMs:1000});
 assert.equal(out.authenticated,false);
 assert.deepEqual(out.rpCodes,['100','REDACTED']);
 assert.equal(out.readOnly,true);
});
