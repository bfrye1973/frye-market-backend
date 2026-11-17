// Rithmic Test ONLY. Minimal protobuf-wire handshake; no order plant, data recorder, or trading.
 // Field numbers and template IDs: R | Protocol API 0.90.0.0 vendor definitions.
import WebSocket from 'ws';
export const RITHMIC_TEST_ENDPOINT='wss://rituz00100.rithmic.com:443';
export const PROTOCOL_FIELDS=Object.freeze({templateId:154467,userMsg:132760,rpCode:132766,
 systemName:153628,templateVersion:153634,user:131003,password:130004,appName:130002,
 appVersion:131803,infraType:153621,heartbeatInterval:153633});
const uvar=n=>{if(!Number.isSafeInteger(n)||n<0)throw Error('invalid protobuf integer');
 const a=[];do{let b=n%128;n=Math.floor(n/128);a.push(n?b|128:b)}while(n);return Buffer.from(a)};
const put=(field,wire,payload)=>Buffer.concat([uvar(field*8+wire),payload]);
const str=(field,value)=>{const b=Buffer.from(value,'utf8');return put(field,2,Buffer.concat([uvar(b.length),b]))};
const num=(field,value)=>put(field,0,uvar(value));
export function encodeSystemInfoRequest(){return num(PROTOCOL_FIELDS.templateId,16)}
export function encodeTickerPlantLogin({user,password,systemName='Rithmic Test'}){
 if(!user||!password||systemName!=='Rithmic Test')throw Error('Rithmic Test credentials and fixed system required');
 return Buffer.concat([num(PROTOCOL_FIELDS.templateId,10),
 str(PROTOCOL_FIELDS.templateVersion,'5.55'),
 str(PROTOCOL_FIELDS.user,user),str(PROTOCOL_FIELDS.password,password),
 str(PROTOCOL_FIELDS.appName,'Frye Engine18 ReadOnly Test'),
 str(PROTOCOL_FIELDS.appVersion,'0.1.0'),
 str(PROTOCOL_FIELDS.systemName,systemName),num(PROTOCOL_FIELDS.infraType,1)]);
}
export function decodeFields(frame){
 const b=Buffer.from(frame);let i=0;const out={};let items=0;
 const readVar=()=>{let x=0,scale=1;for(let t=0;t<10;t++){
  if(i>=b.length)throw Error('truncated protobuf');const v=b[i++];
  x+=(v&127)*scale;if(!Number.isSafeInteger(x))throw Error('unsafe protobuf integer');
  if(!(v&128))return x;scale*=128;
 }throw Error('oversized protobuf integer')};
 if(b.length>1024*1024)throw Error('oversized vendor frame');
 while(i<b.length){if(++items>2048)throw Error('too many fields');
  const tag=readVar(),field=Math.floor(tag/8),wire=tag%8;if(!field)throw Error('invalid field');
  let value;
  if(wire===0)value=readVar();
  else if(wire===2){const n=readVar();if(n>b.length-i)throw Error('truncated length');value=b.subarray(i,i+n);i+=n;}
  else if(wire===1){if(i+8>b.length)throw Error('truncated fixed64');value=b.subarray(i,i+8);i+=8;}
  else if(wire===5){if(i+4>b.length)throw Error('truncated fixed32');value=b.subarray(i,i+4);i+=4;}
  else throw Error('unsupported protobuf wire type');
  (out[field]??=[]).push(value);
 }return out;
}
const strings=(o,k)=>(o[k]||[]).filter(Buffer.isBuffer).map(x=>x.toString('utf8'));
const value=(o,k)=>o[k]?.[0];
export function parseSystemInfo(frame){
 const f=decodeFields(frame),id=value(f,PROTOCOL_FIELDS.templateId);
 if(id!==17)throw Error('unexpected system-info template');
 const rpCodes=strings(f,PROTOCOL_FIELDS.rpCode);
 return Object.freeze({templateId:id,systems:rpCodes.length===1&&rpCodes[0]==='0'?strings(f,PROTOCOL_FIELDS.systemName):[],
  rpCodes});
}
export function parseLogin(frame){
 const f=decodeFields(frame),id=value(f,PROTOCOL_FIELDS.templateId);
 if(id!==11)throw Error('unexpected login template');
 const rpCodes=strings(f,PROTOCOL_FIELDS.rpCode);
 return Object.freeze({templateId:id,rpCodes,
  heartbeatIntervalPresent:Buffer.isBuffer(value(f,PROTOCOL_FIELDS.heartbeatInterval))});
}

// Read-only entitlement probes only: vendor v0.90.0.0 templates 115/117.
// A subscription acknowledgement does NOT prove a complete DBO snapshot or
// correct book reconstruction. Caller must separately establish snapshot boundaries.
export const DBO_TEMPLATES=Object.freeze({snapshotRequest:115,snapshotResponse:116,
 updatesRequest:117,updatesResponse:118,event:160});
export function encodeDboTestRequest({kind,symbol,exchange}){
 if(kind!=='snapshot'&&kind!=='subscribe')throw Error('unsupported read-only DBO action');
 if(typeof symbol!=='string'||!/^[A-Z0-9.]{2,24}$/.test(symbol))
  throw Error('explicit vendor symbol required');
 if(typeof exchange!=='string'||!/^[A-Z0-9.]{2,16}$/.test(exchange))
  throw Error('explicit vendor exchange required');
 const parts=[num(PROTOCOL_FIELDS.templateId,kind==='snapshot'?
  DBO_TEMPLATES.snapshotRequest:DBO_TEMPLATES.updatesRequest)];
 if(kind==='subscribe')parts.push(num(100000,1)); // RequestDepthByOrderUpdates.SUBSCRIBE
 parts.push(str(110100,symbol),str(110101,exchange));
 return Buffer.concat(parts);
}
export function classifyDboTestResponse(frame){
 const f=decodeFields(frame),templateId=value(f,PROTOCOL_FIELDS.templateId);
 if(![116,118,160].includes(templateId))return {recognized:false,templateId};
 return {recognized:true,templateId,kind:templateId===116?'SNAPSHOT':
  templateId===118?'SUBSCRIPTION_ACK':'UPDATE',
  rpCodes:strings(f,PROTOCOL_FIELDS.rpCode),
  // Snapshot frame count/order completeness remains UNKNOWN until observed
  snapshotComplete:false,bookValid:false};
}

export function verifyTestEnvironment(env){
 if(env.RITHMIC_TEST_CONNECT_ENABLED!=='YES')throw Error('Rithmic network connection disabled');
 if(!env.RITHMIC_TEST_USER||!env.RITHMIC_TEST_PASSWORD)throw Error('missing Rithmic Test credentials');
 if(env.RITHMIC_TEST_SYSTEM_NAME&&env.RITHMIC_TEST_SYSTEM_NAME!=='Rithmic Test')
  throw Error('only Rithmic Test is permitted');
 if(env.RITHMIC_TEST_ENDPOINT&&env.RITHMIC_TEST_ENDPOINT!==RITHMIC_TEST_ENDPOINT)
  throw Error('endpoint override prohibited');
 return {user:env.RITHMIC_TEST_USER,password:env.RITHMIC_TEST_PASSWORD};
}
async function exchange({WebSocketImpl,url,request,decode,timeoutMs}){
 const ws=new WebSocketImpl(url,{rejectUnauthorized:true,perMessageDeflate:false});
 let timer;
 try{return await new Promise((resolve,reject)=>{
  let settled=false;
  const finish=(err,val)=>{if(settled)return;settled=true;clearTimeout(timer);err?reject(err):resolve(val)};
  timer=setTimeout(()=>finish(Error('Rithmic Test handshake timeout')),timeoutMs);
  ws.once('error',()=>finish(Error('Rithmic Test WebSocket error')));
  ws.once('close',()=>finish(Error('Rithmic Test WebSocket closed before response')));
  ws.once('open',()=>{try{ws.send(request)}catch{finish(Error('Rithmic Test request send failed'))}});
  ws.once('message',data=>{try{finish(null,decode(data))}catch{finish(Error('Rithmic Test invalid response'))}});
 })}finally{clearTimeout(timer);try{ws.close()}catch{}try{ws.terminate?.()}catch{}}
}
export async function probeRithmicSystemInfo({env=process.env,WebSocketImpl=WebSocket,timeoutMs=8000}={}){
 verifyTestEnvironment(env);
 if(!Number.isInteger(timeoutMs)||timeoutMs<1000||timeoutMs>30000)throw Error('invalid timeout');
 const system=await exchange({WebSocketImpl,url:RITHMIC_TEST_ENDPOINT,
  request:encodeSystemInfoRequest(),decode:parseSystemInfo,timeoutMs});
 return {stage:'SYSTEM_INFO',testAvailable:system.systems.includes('Rithmic Test'),
  rpCodes:system.rpCodes,readOnly:true};
}
export async function probeRithmicTest({env=process.env,WebSocketImpl=WebSocket,timeoutMs=8000}={}){
 const creds=verifyTestEnvironment(env);
 if(!Number.isInteger(timeoutMs)||timeoutMs<1000||timeoutMs>30000)throw Error('invalid timeout');
 const system=await exchange({WebSocketImpl,url:RITHMIC_TEST_ENDPOINT,
  request:encodeSystemInfoRequest(),decode:parseSystemInfo,timeoutMs});
 if(!system.systems.includes('Rithmic Test'))return {stage:'SYSTEM_INFO',testAvailable:false,
  rpCodes:system.rpCodes,systemsCount:system.systems.length,readOnly:true};
 const login=await exchange({WebSocketImpl,url:RITHMIC_TEST_ENDPOINT,
  request:encodeTickerPlantLogin(creds),decode:parseLogin,timeoutMs});
 return {stage:'LOGIN',testAvailable:true,authenticated:login.rpCodes.length===1&&login.rpCodes[0]==='0',
  rpCodes:login.rpCodes.map((v,i)=>i===0?v:'REDACTED'),readOnly:true,dbSnapshotVerified:false,dbUpdatesVerified:false};
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
 probeRithmicTest().then(x=>{process.stdout.write(JSON.stringify(x)+'\n')},
  ()=>{process.stderr.write('RITHMIC_TEST_PROBE_FAILED (sanitized)\n');process.exitCode=1});
}
