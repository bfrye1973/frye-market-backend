import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {encodeConformanceLogin,encodeConformanceHeartbeat,
 parseConformanceLogin,runConformance,CONFORMANCE_APP_NAME}
 from '../logic/engine18/engine18RithmicConformanceTest.js';
import {decodeFields,PROTOCOL_FIELDS} from '../logic/engine18/engine18RithmicTestProbe.js';
const v=n=>{const b=[];do{const k=n%128;n=Math.floor(n/128);b.push(n?k|128:k)}while(n);return Buffer.from(b)};
const number=(n,x)=>Buffer.concat([v(n*8),v(x)]);
const string=(n,x)=>{const b=Buffer.from(x);return Buffer.concat([v(n*8+2),v(b.length),b])};
const frame=(id,other=[])=>Buffer.concat([number(PROTOCOL_FIELDS.templateId,id),...other]);
test('exact brfr prefix and order plant ONLY, no trade templates',()=>{
 assert.equal(CONFORMANCE_APP_NAME,'brfr:Frye Engine18 ReadOnly Test');
 const f=decodeFields(encodeConformanceLogin({user:'demo',password:'dummy'}));
 assert.equal(f[PROTOCOL_FIELDS.templateId][0],10);
 assert.equal(f[PROTOCOL_FIELDS.infraType][0],2);
 assert.equal(f[PROTOCOL_FIELDS.appName][0].toString(),CONFORMANCE_APP_NAME);
 assert.equal(f[PROTOCOL_FIELDS.templateVersion][0].toString(),'5.55');
 assert.equal(decodeFields(encodeConformanceHeartbeat())[PROTOCOL_FIELDS.templateId][0],18);
 assert.throws(()=>encodeConformanceLogin({user:'demo'}),/credentials/);
});
test('single code zero accepted; heartbeat interval is fixed64 double',()=>{
 const seconds=Buffer.alloc(8);seconds.writeDoubleLE(15,0);
 const good=frame(11,[string(PROTOCOL_FIELDS.rpCode,'0'),
  Buffer.concat([v(PROTOCOL_FIELDS.heartbeatInterval*8+1),seconds])]);
 assert.deepEqual(parseConformanceLogin(good),{accepted:true,heartbeatSec:15});
 assert.equal(parseConformanceLogin(frame(11,[string(PROTOCOL_FIELDS.rpCode,'12')])).accepted,false);
});
test('fails closed when conformance opt-in missing',async()=>{
 await assert.rejects(runConformance({env:{}}),/disabled|credentials/);
});
test('system info then order login with no order messages; disconnect fails closed',async()=>{
 let sockets=0;const sent=[];
 class FakeWS extends EventEmitter{
  constructor(){super();this.n=sockets++;queueMicrotask(()=>this.emit('open'))}
  send(msg){const f=decodeFields(msg);const id=f[PROTOCOL_FIELDS.templateId][0];sent.push({sock:this.n,id});
   if(this.n===0&&id===16)queueMicrotask(()=>this.emit('message',frame(17,[
    string(PROTOCOL_FIELDS.rpCode,'0'),string(PROTOCOL_FIELDS.systemName,'Rithmic Test')])));
   if(this.n===1&&id===10)queueMicrotask(()=>{this.emit('message',frame(11,[string(PROTOCOL_FIELDS.rpCode,'0')]));this.emit('close')});
  }
  close(){}terminate(){}
 }
 const states=[];
 const result=await runConformance({WebSocketImpl:FakeWS,
  env:{RITHMIC_TEST_CONNECT_ENABLED:'YES',RITHMIC_TEST_CONFORMANCE_LOGIN_ENABLED:'YES',
   RITHMIC_TEST_USER:'sample',RITHMIC_TEST_PASSWORD:'only-test'},
  maxRunMs:60000,onStatus:x=>states.push(x)});
 assert.equal(sockets,2);assert.deepEqual(sent,[{sock:0,id:16},{sock:1,id:10}]);
 assert.ok(states.some(x=>x.phase==='CONNECTED'));
 assert.equal(result.stopReason,'ORDER_SOCKET_CLOSED');assert.equal(result.connected,false);
});
