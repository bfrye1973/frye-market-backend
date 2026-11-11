// Independent Engine 18 Ironbeam v2 recorder source. No chart, broker or trading APIs.
// Injection is mandatory for tests; production activation is gated by a separate
// private worker entrypoint and manager-approved operational evidence.
import {randomUUID} from 'node:crypto';
import {classifyIronbeamRawFrame} from './ironbeamV2RecorderAdapter.js';
const SUBS=Object.freeze(['quotes','depths','trades']);
const SYMBOL='XCME:ES.Z26';
const PROVIDER='https://demo.ironbeamapi.com';
const KEY=/^[A-Za-z0-9_.:-]{1,128}$/;
const safe=s=>typeof s==='string'&&KEY.test(s);
const textFrame=x=>typeof x==='string'?x:Buffer.isBuffer(x)||x instanceof Uint8Array?
 Buffer.from(x):x instanceof ArrayBuffer?Buffer.from(x):null;
export class Engine18IronbeamLiveRecorderSource{
 constructor({recorder,credentials,fetchImpl,WebSocketImpl,host=PROVIDER,
   retryMs=2000,maxRetryMs=60000,openTimeoutMs=6000,heartbeatTimeoutMs=30000,onAlert=()=>{},
   clockSampler=null}={}){
  if(!recorder||typeof recorder.offer!=='function'||typeof recorder.capture!=='function'||
   typeof recorder.offerCaptured!=='function'||typeof fetchImpl!=='function'||
   typeof WebSocketImpl!=='function'||host!==PROVIDER||
   !credentials||!['username','password','apiKey'].every(k=>typeof credentials[k]==='string'&&credentials[k].length))
   throw Error('isolated recorder, vendor v2 dependencies and private credentials required');
  if(!Number.isInteger(retryMs)||retryMs<1||!Number.isInteger(maxRetryMs)||maxRetryMs<retryMs||
   !Number.isInteger(openTimeoutMs)||openTimeoutMs<1||
   !Number.isInteger(heartbeatTimeoutMs)||heartbeatTimeoutMs<1||typeof onAlert!=='function')
   throw Error('invalid source supervision limits');
  this.recorder=recorder;this.credentials=credentials;this.fetchImpl=fetchImpl;
  this.WebSocketImpl=WebSocketImpl;this.onAlert=onAlert;
  this.retryMs=retryMs;this.maxRetryMs=maxRetryMs;this.openTimeoutMs=openTimeoutMs;
  this.heartbeatTimeoutMs=heartbeatTimeoutMs;
  this.clockSampler=clockSampler;this.current=null;this.generation=0;this.active=false;
  this.pending=new Set();this.timer=null;this.retries=0;this.frames=0;
  this.subscriptions=0;this.disconnections=0;this.alerts=0;this.sourceUncertain=false;
  this.lastFrameWallNs=null;this.lastErrorCode=null;this.connected=false;
  this.frameTypes={depth:0,quote:0,trade:0,unknown:0,malformed:0,other:0,binary:0};
  this.disconnectedAtMs=null;
 }
 alert(code){
  this.lastErrorCode=code;this.alerts++;
  try{this.onAlert(code);}catch{}
 }
 record(control,gen,details={}){
  // Control content must be allowlisted; never store vendor bearer token,
  // authenticated URL, response bodies or original error strings.
  const raw=JSON.stringify(details);
  return this.write({raw,rawEncoding:'utf8',msgClass:'control',
   statusCode:control,streamGeneration:gen});
 }
 write(entry,capturedReceipt=null){
  let result;
  try{result=capturedReceipt?this.recorder.offerCaptured(capturedReceipt):this.recorder.offer(entry);}
  catch{this.captureFailure();return Promise.reject(Error('RECORDER_WRITE_REJECTED'));}
  const promise=Promise.resolve(result).catch(()=>{
   this.captureFailure();throw Error('RECORDER_WRITE_REJECTED');
  });
  this.pending.add(promise);
  void promise.finally(()=>this.pending.delete(promise)).catch(()=>{});
  return promise;
 }
 captureFailure(){
  if(this.sourceUncertain)return;
  this.sourceUncertain=true;this.alert('RECORDER_CAPTURE_UNCERTAIN');
  try{this.recorder.fail?.('LIVE_CAPTURE_WRITE_FAILURE');}catch{}
  try{this.current?.socket?.close();}catch{}
 }
 async api(path,token,method='GET',body){
  const response=await this.fetchImpl(PROVIDER+path,{method,headers:{
   Accept:'application/json',...(body?{'Content-Type':'application/json'}:{}),
   ...(token?{Authorization:'Bearer '+token}:{})},
   ...(body?{body:JSON.stringify(body)}:{})});
  if(!response?.ok)throw Error('VENDOR_HTTP_REFUSED');
  const result=await response.json();
  if(result?.status==='ERROR')throw Error('VENDOR_REJECTED');
  return result;
 }
 async start(){if(this.active)throw Error('source already active');this.active=true;return this.connect();}
 async connect(){
  if(!this.active||this.sourceUncertain)return;
  const generation=++this.generation,connectionId=randomUUID(),source={generation,connectionId,socket:null,closed:false,gap:false,watchdog:null,lastMessageAt:Date.now()};
  this.connected=false;this.disconnectedAtMs=Date.now();
  this.current=source;
  let ws;
  try{
   const login=await this.api('/v2/auth',null,'POST',{
    username:this.credentials.username,password:this.credentials.password,apiKey:this.credentials.apiKey});
   if(!this.active||this.current!==source)return;
   if(typeof login?.token!=='string'||!login.token)throw Error('AUTH_MISSING');
   const stream=await this.api('/v2/stream/create',login.token);
   if(!this.active||this.current!==source)return;
   if(!safe(stream?.streamId))throw Error('UNSAFE_STREAM_ID');
   source.streamId=stream.streamId;
   const url='wss://demo.ironbeamapi.com/v2/stream/'+encodeURIComponent(stream.streamId)+
    '?token='+encodeURIComponent(login.token);
   ws=new this.WebSocketImpl(url);source.socket=ws;
   ws.addEventListener('message',event=>{
    if(!this.active||this.current!==source||source.closed||this.sourceUncertain)return;
    const raw=textFrame(event.data);
    if(raw===null){this.captureFailure();return;}
    this.frames++;source.lastMessageAt=Date.now();
    // Stamp and snapshot ORIGINAL bytes at the source boundary, BEFORE parsing.
    // Classification changes metadata only, never the raw frame or vendor time.
    let receipt,classified;
    try{
     receipt=this.recorder.capture({raw,rawEncoding:typeof raw==='string'?'utf8':'base64',
      msgClass:'unknown',statusCode:null,streamGeneration:generation});
     const shape=classifyIronbeamRawFrame(raw,{streamGeneration:generation});
     const kind=shape.diagnostic.kind;
     this.frameTypes[kind]===undefined?this.frameTypes.other++:this.frameTypes[kind]++;
     if(typeof raw!=='string')this.frameTypes.binary++;
     classified=Object.freeze({...receipt,
      msgClass:shape.capture.msgClass,statusCode:shape.capture.statusCode});
    }catch{this.captureFailure();return;}
    void this.write(null,classified)
     .then(ack=>{this.lastFrameWallNs=ack.receivedWallNs??null;},()=>{});
   });
   ws.addEventListener('error',()=>{void this.interrupt(source,'WS_ERROR');});
   ws.addEventListener('close',e=>{void this.interrupt(source,'DISCONNECTED',
    Number.isInteger(e?.code)?e.code:null);});
   await new Promise((resolve,reject)=>{
    let completed=false;const done=err=>{
     if(completed)return;completed=true;clearTimeout(timer);err?reject(err):resolve();};
    const timer=setTimeout(()=>done(Error('OPEN_TIMEOUT')),this.openTimeoutMs);
    ws.addEventListener('open',()=>done(),{once:true});
    ws.addEventListener('error',()=>done(Error('OPEN_FAILED')),{once:true});
    ws.addEventListener('close',()=>done(Error('CLOSED_BEFORE_OPEN')),{once:true});
   });
   if(this.current!==source||!this.active)return;
   await this.record(generation===1?'CONNECTED':'RECONNECT',generation,{connectionId,streamId:stream.streamId});
   for(const feedType of SUBS){
    if(!this.active||this.current!==source||source.closed)throw Error('SOURCE_CLOSED_BEFORE_SUBSCRIPTIONS');
    let status='FAILED';
    try{
     await this.api('/v2/market/'+feedType+'/subscribe/'+encodeURIComponent(stream.streamId)+
      '?symbols='+encodeURIComponent(SYMBOL),login.token);
     if(this.current!==source||source.closed)throw Error('SOURCE_CLOSED_DURING_SUBSCRIPTION');
     status='SUCCESS';
    }finally{
     await this.record('SUBSCRIPTION_ACK',generation,{connectionId,streamId:stream.streamId,
      feedType,physicalContract:SYMBOL,status});
    }
   }
   if(this.current!==source||!this.active||source.closed)return false;
   this.subscriptions+=SUBS.length;this.retries=0;this.connected=true;
   this.disconnectedAtMs=null;
   source.lastMessageAt=Date.now();
   source.watchdog=setInterval(()=>{
    if(!source.closed&&this.current===source&&this.active&&
       Date.now()-source.lastMessageAt>this.heartbeatTimeoutMs){
      this.alert('IRONBEAM_SOURCE_STALE');
      void this.interrupt(source,'HEARTBEAT_TIMEOUT');
    }
   },Math.max(5,Math.min(5000,this.heartbeatTimeoutMs)));
   source.watchdog.unref?.();
   return true;
  }catch{
   this.alert('IRONBEAM_CONNECTION_OR_SUBSCRIPTION_FAILED');
   if(this.current===source)await this.interrupt(source,'SOURCE_CONNECT_FAILED');
   return false;
  }
 }
 async interrupt(source,reason,closeCode=null){
  if(source.closed)return;
  source.closed=true;this.connected=false;this.disconnectedAtMs=Date.now();this.disconnections++;
  if(this.active&&!this.sourceUncertain)this.alert('IRONBEAM_SOURCE_INTERRUPTED');
  if(source.watchdog){clearInterval(source.watchdog);source.watchdog=null;}
  try{source.socket?.close();}catch{}
  const current=this.current===source;
  // Durably distinguish source interruption from a recorder crash.
  try{
   await this.record(reason==='WS_ERROR'?'WS_ERROR':'DISCONNECTED',source.generation,
    {connectionId:source.connectionId,reason,closeCode});
   if(!source.gap){
    source.gap=true;
    await this.record('FEED_GAP',source.generation,{
     connectionId:source.connectionId,reason:'SOURCE_COVERAGE_UNKNOWN',confirmedLoss:false});
   }
  }catch{this.captureFailure();}
  if(current&&this.active&&!this.sourceUncertain){
   const delay=Math.min(this.maxRetryMs,this.retryMs*2**Math.min(this.retries++,8));
   this.timer=setTimeout(()=>{this.timer=null;void this.connect();},delay);
  }
 }
 async stop(){
  this.active=false;
  if(this.timer){clearTimeout(this.timer);this.timer=null;}
  const source=this.current;this.current=null;
  if(source&&!source.closed){
   source.closed=true;this.connected=false;
   if(source.watchdog){clearInterval(source.watchdog);source.watchdog=null;}
   try{source.socket?.close();}catch{}
   await this.record('DISCONNECTED',source.generation,{
    connectionId:source.connectionId,reason:'OPERATOR_STOP',closeCode:1000});
  }
  await Promise.allSettled([...this.pending]);
 }
 health(){
  return Object.freeze({schema:'engine18.ironbeam.live.source.health.v1',
   active:this.active&&!this.sourceUncertain,connected:this.connected,
   disconnectedSinceMs:this.disconnectedAtMs,generation:this.generation,
   framesReceived:this.frames,subscriptionsAcknowledged:this.subscriptions,
   reconnects:Math.max(0,this.generation-1),disconnections:this.disconnections,
   lastFrameWallNs:this.lastFrameWallNs,lastErrorCode:this.lastErrorCode,
   alerts:this.alerts,captureUncertain:this.sourceUncertain,
   frameTypes:Object.freeze({...this.frameTypes}),
   feedSemantics:'UNVERIFIED',clockQuality:'UNVERIFIED'});
 }
}
