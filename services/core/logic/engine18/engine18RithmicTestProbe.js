// Rithmic Test ONLY. Minimal protobuf-wire handshake; no order plant, data recorder, or trading.
 // Field numbers and template IDs: R | Protocol API 0.90.0.0 vendor definitions.
import WebSocket from 'ws';
export const RITHMIC_TEST_ENDPOINT='wss://rituz00100.rithmic.com:443';
export const PROTOCOL_FIELDS=Object.freeze({templateId:154467,userMsg:132760,rpCode:132766,
 systemName:153628,user:131003,password:130004,appName:130002,
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
 return Object.freeze({templateId:id,systems:strings(f,PROTOCOL_FIELDS.systemName),
  rpCodes:strings(f,PROTOCOL_FIELDS.rpCode)});
}
export function parseLogin(frame){
 const f=decodeFields(frame),id=value(f,PROTOCOL_FIELDS.templateId);
 if(id!==11)throw Error('unexpected login template');
 const rpCodes=strings(f,PROTOCOL_FIELDS.rpCode);
 return Object.freeze({templateId:id,rpCodes,
  heartbeatIntervalBytes:value(f,PROTOCOL_FIELDS.heartbeatInterval)?.length||0});
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
export async function probeRithmicTest({env=process.env,WebSocketImpl=WebSocket,timeoutMs=8000}={}){
 const creds=verifyTestEnvironment(env);
 if(!Number.isInteger(timeoutMs)||timeoutMs<1000||timeoutMs>30000)throw Error('invalid timeout');
 const system=await exchange({WebSocketImpl,url:RITHMIC_TEST_ENDPOINT,
  request:encodeSystemInfoRequest(),decode:parseSystemInfo,timeoutMs});
 if(!system.systems.includes('Rithmic Test'))return {stage:'SYSTEM_INFO',testAvailable:false,
  rpCodes:system.rpCodes,systemsCount:system.systems.length,readOnly:true};
 const login=await exchange({WebSocketImpl,url:RITHMIC_TEST_ENDPOINT,
  request:encodeTickerPlantLogin(creds),decode:parseLogin,timeoutMs});
 return {stage:'LOGIN',testAvailable:true,rpCodes:login.rpCodes,
  readOnly:true,dbSnapshotVerified:false,dbUpdatesVerified:false};
}
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
 probeRithmicTest().then(x=>{process.stdout.write(JSON.stringify(x)+'\n')},
  ()=>{process.stderr.write('RITHMIC_TEST_PROBE_FAILED (sanitized)\n');process.exitCode=1});
}
