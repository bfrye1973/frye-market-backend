// Engine18 diagnostic only: independently estimate host-to-NTP offset.
// No clock changes, live source, recording, credentials, or trade APIs.
// Network measurements NEVER promote clock quality to VERIFIED automatically.
import {createSocket} from 'node:dgram';
const EPOCH=2208988800n;
const ALLOWED=Object.freeze(['time.cloudflare.com','time.google.com']);
function ntpStamp(ms){
 const whole=BigInt(Math.floor(ms/1000))+EPOCH;
 const fraction=BigInt(Math.floor(((ms%1000+1000)%1000)*4294967296/1000));
 const b=Buffer.alloc(8);b.writeUInt32BE(Number(whole&0xffffffffn),0);
 b.writeUInt32BE(Number(fraction&0xffffffffn),4);
 return b;
}
function readStamp(buffer,offset){
 const seconds=BigInt(buffer.readUInt32BE(offset))-EPOCH;
 const fraction=buffer.readUInt32BE(offset+4);
 return Number(seconds)*1000+fraction*1000/4294967296;
}
export function inspectNtpReply(message,{request,sendWallMs,receiveWallMs}={}){
 if(!Buffer.isBuffer(message)||message.length<48||
   !Buffer.isBuffer(request)||request.length!==48||
   !Number.isFinite(sendWallMs)||!Number.isFinite(receiveWallMs))return null;
 const mode=message[0]&7,version=(message[0]>>>3)&7,leap=message[0]>>>6;
 const stratum=message[1];
 if(mode!==4||version<3||version>4||leap===3||stratum<1||stratum>15)return null;
 if(!message.subarray(24,32).equals(request.subarray(40,48)))return null;
 const t2=readStamp(message,32),t3=readStamp(message,40);
 const dispersionMs=message.readUInt32BE(8)*1000/65536;
 const offsetMs=((t2-sendWallMs)+(t3-receiveWallMs))/2;
 const delayMs=(receiveWallMs-sendWallMs)-(t3-t2);
 if(![t2,t3,dispersionMs,offsetMs,delayMs].every(Number.isFinite)||
    t3<t2||delayMs<0||delayMs>1000||dispersionMs>1000)return null;
 return Object.freeze({stratum,offsetMs:Math.round(offsetMs*1000)/1000,
  uncertaintyMs:Math.round((delayMs/2+dispersionMs)*1000)/1000,
  roundTripMs:Math.round(delayMs*1000)/1000,referenceType:'REMOTE_NTP_DIAGNOSTIC'});
}
export async function probeEngine18Ntp({host,timeoutMs=1800,port=123}={}){
 if(!ALLOWED.includes(host)||!Number.isInteger(timeoutMs)||timeoutMs<100||timeoutMs>3000||port!==123)
  throw Error('restricted read-only NTP probe options');
 const socket=createSocket('udp4'),request=Buffer.alloc(48);
 request[0]=0x23; // NTP v4 client
 const sendWallMs=Date.now();
 ntpStamp(sendWallMs).copy(request,40);
 const sendMono=process.hrtime.bigint();
 return await new Promise(resolve=>{
  let finished=false;
  const finish=result=>{
   if(finished)return;finished=true;clearTimeout(timer);
   try{socket.close();}catch{}
   resolve(result);
  };
  const timer=setTimeout(()=>finish({host,reachable:false,reason:'TIMEOUT_OR_BLOCKED'}),timeoutMs);
  socket.once('error',()=>finish({host,reachable:false,reason:'UDP_UNAVAILABLE'}));
  socket.once('message',message=>{
   const receiveMono=process.hrtime.bigint();
   const receiveWallMs=sendWallMs+Number(receiveMono-sendMono)/1e6;
   const sample=inspectNtpReply(message,{request,sendWallMs,receiveWallMs});
   if(!sample){finish({host,reachable:false,reason:'UNTRUSTED_NTP_REPLY'});return;}
   finish({host,reachable:true,...sample});
  });
  try{socket.send(request,port,host,err=>{if(err)finish({host,reachable:false,reason:'UDP_SEND_FAILED'});});}
  catch{finish({host,reachable:false,reason:'UDP_UNAVAILABLE'});}
 });
}
export async function diagnoseEngine18HostClock(){
 const servers=await Promise.all(ALLOWED.map(host=>probeEngine18Ntp({host})));
 const valid=servers.filter(s=>s.reachable);
 const dispersion=valid.length===2?Math.abs(valid[0].offsetMs-valid[1].offsetMs):null;
 return Object.freeze({schema:'engine18.ntpClockDiagnostic.v1',
  sampledAtUtc:new Date().toISOString(),servers,
  independentServerAgreementMs:dispersion,
  ntpMeasurementAvailable:valid.length>0,
  // NTP observations alone cannot establish verified exchange time.
  clockQuality:'UNVERIFIED',recordingAuthorization:false
 });
}


// Multiple wall/monotonic receipt pairs, with fail-closed observations.
// This is evidence of stability and clock steps, NOT clock acceptance.
export async function diagnoseEngine18ClockSeries({samples=5,intervalMs=750,read=diagnoseEngine18HostClock,
 wall=()=>Date.now(),mono=()=>process.hrtime.bigint(),sleep=ms=>new Promise(r=>setTimeout(r,ms))}={}){
 if(!Number.isInteger(samples)||samples<2||samples>12||
    !Number.isInteger(intervalMs)||intervalMs<0||intervalMs>10000)
   throw Error('invalid bounded clock diagnostic');
 const series=[];let prior=null;
 for(let i=0;i<samples;i++){
  const wallBefore=wall(),monoBefore=mono();
  const report=await read();
  const wallAfter=wall(),monoAfter=mono();
  const elapsedMonoMs=Number(monoAfter-monoBefore)/1e6;
  const receiptStepMs=prior===null?null:
   (wallBefore-prior.wallAfter)-Number(monoBefore-prior.monoAfter)/1e6;
  const hosts=report?.servers||[];
  const ready=hosts.length===2&&hosts.every(x=>x.reachable===true);
  const sourceDifferenceMs=ready?Math.abs(hosts[0].offsetMs-hosts[1].offsetMs):null;
  const estimatedHostErrorLowerBoundMs=ready?
   Math.max(...hosts.map(x=>Math.max(0,Math.abs(x.offsetMs)-x.uncertaintyMs))):null;
  series.push({
   sample:i+1,atUtc:new Date(wallAfter).toISOString(),
   sourceCount:hosts.filter(x=>x.reachable===true).length,
   sources:hosts.map(x=>({host:x.host,reachable:x.reachable===true,
    offsetMs:Number.isFinite(x.offsetMs)?x.offsetMs:null,
    uncertaintyMs:Number.isFinite(x.uncertaintyMs)?x.uncertaintyMs:null,
    stratum:Number.isInteger(x.stratum)?x.stratum:null,
    reason:x.reachable?'OBSERVED':x.reason||'UNAVAILABLE'})),
   interSourceDisagreementMs:sourceDifferenceMs,
   // Conservative reporting: uncertainty is not proof, even when low.
   estimatedHostErrorLowerBoundMs,
   wallMinusMonotonicStepMs:Number.isFinite(receiptStepMs)?receiptStepMs:null,
   receiptElapsedMonotonicMs:elapsedMonoMs,
   leapStatus:'UNAUTHENTICATED_REMOTE_HEADER_ONLY',
   clockQuality:'UNVERIFIED'
  });
  prior={wallAfter,monoAfter};
  if(i<samples-1)await sleep(intervalMs);
 }
 const largestDisagreementMs=Math.max(0,...series.map(x=>x.interSourceDisagreementMs??0));
 const maxAbsWallStepMs=Math.max(0,...series.map(x=>Math.abs(x.wallMinusMonotonicStepMs??0)));
 return Object.freeze({
  schema:'engine18.clockSeries.v1',samples:series,
  largestDisagreementMs,maxAbsWallStepMs,
  allSourcesResponded:series.every(x=>x.sourceCount===2),
  clockQuality:'UNVERIFIED',authenticatedClockQualityAvailable:false,
  meetsFiveMsAuthenticatedGate:false,recordingAuthorization:false
 });
}
