// Rithmic TEST-only conformance ORDER_PLANT login. No trading message templates exist.
// Isolated process; no imports from Engine 8 or live trade/recorder services.
import WebSocket from 'ws';
import {encodeSystemInfoRequest,parseSystemInfo,decodeFields,PROTOCOL_FIELDS,
 RITHMIC_TEST_ENDPOINT,verifyTestEnvironment} from './engine18RithmicTestProbe.js';
export const CONFORMANCE_APP_NAME='brfr:Frye Engine18 ReadOnly Test';
const uvar=n=>{const arr=[];do{let b=n%128;n=Math.floor(n/128);arr.push(n?b|128:b);}while(n);return Buffer.from(arr)};
const fld=(n,b)=>Buffer.concat([uvar(n*8+2),uvar(b.length),b]);
const st=(n,s)=>fld(n,Buffer.from(s,'utf8'));
const nu=(n,v)=>Buffer.concat([uvar(n*8),uvar(v)]);
export function encodeConformanceLogin({user,password}={}){
 if(typeof user!=='string'||!user||typeof password!=='string'||!password)throw Error('private Test credentials required');
 return Buffer.concat([
  nu(PROTOCOL_FIELDS.templateId,10),st(153634,'5.55'),
  st(PROTOCOL_FIELDS.user,user),st(PROTOCOL_FIELDS.password,password),
  st(PROTOCOL_FIELDS.appName,CONFORMANCE_APP_NAME),
  st(PROTOCOL_FIELDS.appVersion,'0.1.0'),
  st(PROTOCOL_FIELDS.systemName,'Rithmic Test'),
  nu(PROTOCOL_FIELDS.infraType,2) // ORDER_PLANT, login-only
 ]);
}
export function encodeConformanceHeartbeat(){
 const ms=Date.now(),ssboe=Math.floor(ms/1000),usecs=(ms%1000)*1000;
 return Buffer.concat([nu(PROTOCOL_FIELDS.templateId,18),nu(150100,ssboe),nu(150101,usecs)]);
}
const rpCode=fields=>(fields[PROTOCOL_FIELDS.rpCode]||[]).map(x=>Buffer.isBuffer(x)?x.toString('utf8'):null);
export function parseConformanceLogin(frame){
 const f=decodeFields(frame);
 if(f[PROTOCOL_FIELDS.templateId]?.[0]!==11)throw Error('unexpected login response');
 const codes=rpCode(f);
 let heartbeatSec=null;
 const raw=f[PROTOCOL_FIELDS.heartbeatInterval]?.[0];
 if(Buffer.isBuffer(raw)&&raw.length===8){
  const n=raw.readDoubleLE(0);
  if(Number.isFinite(n)&&n>0&&n<=300)heartbeatSec=n;
 }
 return {accepted:codes.length===1&&codes[0]==='0',heartbeatSec};
}
export async function runConformance({env=process.env,WebSocketImpl=WebSocket,
 maxRunMs=2*60*60*1000,onStatus=()=>{}}={}){
 const {user,password}=verifyTestEnvironment(env);
 if(env.RITHMIC_TEST_CONFORMANCE_LOGIN_ENABLED!=='YES')throw Error('conformance mode disabled');
 if(!Number.isSafeInteger(maxRunMs)||maxRunMs<60000||maxRunMs>4*60*60*1000)
  throw Error('invalid finite conformance deadline');
 const deadline=Date.now()+maxRunMs;
 const state={phase:'SYSTEM_DISCOVERY',plant:'ORDER_PLANT',authenticated:false,
  connected:false,connectedSince:null,heartbeatResponses:0,stopReason:null};
 let info,order,heartbeatTimer,hardStop;
 const shutdown=reason=>{state.stopReason=reason;state.connected=false;state.phase='STOPPED';
  clearInterval(heartbeatTimer);clearTimeout(hardStop);
  try{order?.close()}catch{}try{order?.terminate?.()}catch{}
  try{info?.close()}catch{}try{info?.terminate?.()}catch{}
  onStatus({...state});};
 const safeSocket=()=>new WebSocketImpl(RITHMIC_TEST_ENDPOINT,{
  rejectUnauthorized:true,perMessageDeflate:false,maxPayload:1024*1024
 });
 try {
  return await new Promise(resolve=>{
   let completed=false,loginTimer;
   const finish=(reason)=>{if(completed)return;completed=true;clearTimeout(loginTimer);
    shutdown(reason);resolve({...state});};
   hardStop=setTimeout(()=>finish('MAX_CONFORMANCE_SESSION_REACHED'),maxRunMs);
   loginTimer=setTimeout(()=>finish('AUTHENTICATION_TIMEOUT'),20000);
   try{info=safeSocket()}catch{return finish('SYSTEM_SOCKET_FAILED')}
   info.on('error',()=>finish('SYSTEM_SOCKET_ERROR'));
   info.on('close',()=>{if(!order)finish('SYSTEM_SOCKET_CLOSED')});
   info.on('open',()=>{try{info.send(encodeSystemInfoRequest())}catch{finish('SYSTEM_SEND_FAILED')}});
   info.on('message',buffer=>{
    let parsed;try{parsed=parseSystemInfo(buffer)}catch{return finish('SYSTEM_RESPONSE_INVALID')}
    if(!parsed.systems.includes('Rithmic Test'))return finish('TEST_SYSTEM_NOT_AVAILABLE');
    info.close();info.removeAllListeners();info=null;
    state.phase='ORDER_PLANT_AUTHENTICATING';onStatus({...state});
    try{order=safeSocket()}catch{return finish('ORDER_SOCKET_FAILED')}
    order.on('error',()=>finish('ORDER_SOCKET_ERROR'));
    order.on('close',()=>finish('ORDER_SOCKET_CLOSED'));
    order.on('open',()=>{try{order.send(encodeConformanceLogin({user,password}))}catch{finish('ORDER_LOGIN_SEND_FAILED')}});
    order.on('message',bytes=>{
     let f,id;try{f=decodeFields(bytes);id=f[PROTOCOL_FIELDS.templateId]?.[0]}catch{return finish('ORDER_FRAME_INVALID')}
     if(id===11){
      if(state.authenticated)return finish('DUPLICATE_LOGIN_RESPONSE');
      let result;try{result=parseConformanceLogin(bytes)}catch{return finish('ORDER_LOGIN_INVALID')}
      if(!result.accepted)return finish('ORDER_LOGIN_REJECTED');
      state.authenticated=true;state.connected=true;state.connectedSince=new Date().toISOString();
      state.phase='CONNECTED';clearTimeout(loginTimer);onStatus({...state});
      const seconds=result.heartbeatSec||10;
      const interval=Math.max(1000,Math.min(30000,Math.floor(seconds*1000*0.65)));
      heartbeatTimer=setInterval(()=>{if(Date.now()>=deadline)return finish('MAX_CONFORMANCE_SESSION_REACHED');
       if(!state.connected)return finish('CONNECTION_NOT_HEALTHY');
       try{order.send(encodeConformanceHeartbeat())}catch{finish('HEARTBEAT_SEND_FAILED')}
      },interval);
     }else if(id===19) {
      const codes=rpCode(f);
      if(codes.length&&!(codes.length===1&&codes[0]==='0'))return finish('HEARTBEAT_REJECTED');
      state.heartbeatResponses++;onStatus({...state});
     }
     // Other order-plant inbound messages are ignored. NO order, cancel or modify sends.
    });
   });
  });
 }finally {clearInterval(heartbeatTimer);clearTimeout(hardStop);}
}
