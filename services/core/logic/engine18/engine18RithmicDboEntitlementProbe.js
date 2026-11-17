// Bounded Rithmic Test DBO entitlement probe. No persistence or trading.
import WebSocket from 'ws';
import {probeRithmicSystemInfo,encodeTickerPlantLogin,encodeDboTestRequest,
 decodeFields,classifyDboTestResponse,PROTOCOL_FIELDS,RITHMIC_TEST_ENDPOINT,
 verifyTestEnvironment} from './engine18RithmicTestProbe.js';

const templateOf=frame=>decodeFields(frame)[PROTOCOL_FIELDS.templateId]?.[0];
const rpSafe=x=>typeof x==='string'&&/^\d{1,6}$/.test(x)?x:'OTHER';
export async function probeRithmicDbo({env=process.env,WebSocketImpl=WebSocket,
 timeoutMs=15000,initialProbe=probeRithmicSystemInfo}={}){
 const {user,password}=verifyTestEnvironment(env);
 const symbol=env.RITHMIC_TEST_SYMBOL||'ESZ6',exchange=env.RITHMIC_TEST_EXCHANGE||'CME';
 // Validate vendor symbol/exchange before any network activity.
 encodeDboTestRequest({kind:'subscribe',symbol,exchange});
 encodeDboTestRequest({kind:'snapshot',symbol,exchange});
 if(!Number.isInteger(timeoutMs)||timeoutMs<1000||timeoutMs>20000)
  throw Error('invalid bounded test duration');
 const first=await initialProbe({env,WebSocketImpl,timeoutMs:Math.min(timeoutMs,8000)});
 if(!first.testAvailable)return {stage:'SYSTEM_INFO',authenticated:false,counts:null,
  reason:'TEST_SYSTEM_NOT_AVAILABLE',readOnly:true};
 let socket,timer,settled=false,resolveDone;
 const counts={ack:0,snapshot:0,updates:0,heartbeats:0,other:0,invalidFrames:0},
  codes=[],seen=new Set();
 const report=reason=>({stage:'DBO_ENTITLEMENT',authenticated:true,reason,
  counts:{...counts},codes:codes.slice(0,8),sawOrderUpdate:counts.updates>0,
  bookValid:false,snapshotComplete:false,readOnly:true});
 return await new Promise(resolve=>{
  resolveDone=reason=>{if(settled)return;settled=true;clearTimeout(timer);
   try{socket?.close()}catch{}try{socket?.terminate?.()}catch{}
   resolve(report(reason));};
  timer=setTimeout(()=>resolveDone('BOUNDED_TIMEOUT'),timeoutMs);
  try{socket=new WebSocketImpl(RITHMIC_TEST_ENDPOINT,{
   rejectUnauthorized:true,perMessageDeflate:false,maxPayload:1024*1024
  });}catch{return resolveDone('SOCKET_INITIALIZATION_FAILED');}
  socket.on('error',()=>resolveDone('SOCKET_ERROR'));
  socket.on('close',()=>resolveDone('CONNECTION_CLOSED'));
  socket.on('open',()=>{try{
    socket.send(encodeTickerPlantLogin({user,password}));
   }catch{resolveDone('LOGIN_SEND_FAILED');}});
  socket.on('message',data=>{
   if(settled)return;
   let fields,id;try{fields=decodeFields(data);id=fields[PROTOCOL_FIELDS.templateId]?.[0]}
   catch{counts.invalidFrames++;return resolveDone('MALFORMED_FRAME');}
   if(id===11){
    const raw=(fields[PROTOCOL_FIELDS.rpCode]||[]).map(v=>Buffer.isBuffer(v)?v.toString('utf8'):'');
    if(raw.length!==1||raw[0]!=='0'){
      for(const code of raw){if(codes.length<8)codes.push(rpSafe(code));}
      return resolveDone('LOGIN_REJECTED');
    }
    try{socket.send(encodeDboTestRequest({kind:'subscribe',symbol,exchange}));
      socket.send(encodeDboTestRequest({kind:'snapshot',symbol,exchange}));}
    catch{return resolveDone('DBO_SEND_FAILED');}
    return;
   }
   if(id===19||id===20){counts.heartbeats++;return;}
   if(id===116||id===118||id===160){
    const reply=classifyDboTestResponse(data);
    if(reply.kind==='SUBSCRIPTION_ACK')counts.ack++;
    else if(reply.kind==='SNAPSHOT')counts.snapshot++;
    else if(reply.kind==='UPDATE')counts.updates++;
    for(const code of reply.rpCodes){if(codes.length<8)codes.push(rpSafe(code));}
    if(counts.snapshot>0&&counts.updates>0)return resolveDone('SNAPSHOT_AND_UPDATES_OBSERVED');
    if(counts.ack>0&&codes.some(c=>c!=='0'))return resolveDone('DBO_RESPONSE_NONZERO');
   }else counts.other++;
   if(counts.ack+counts.snapshot+counts.updates+counts.other>3000)
    return resolveDone('FRAME_LIMIT_REACHED');
  });
 });
}
