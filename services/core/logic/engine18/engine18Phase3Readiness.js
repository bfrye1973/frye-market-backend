// Engine 18 Gate 1 Phase 3 — isolated synthetic-only readiness supervisor.
// Does not open a live socket or authorize historical market-data collection.
// Control events contain only allowlisted nonsecret values; market frames remain exact.
import {randomUUID} from 'node:crypto';
import {Engine18BufferedRecorder} from './engine18BufferedRecorder.js';

const CODE=/^[A-Z][A-Z0-9_]{0,47}$/;
const SAFE_ID=/^[A-Za-z0-9_.:-]{1,128}$/;
const COMMIT=/^[a-f0-9]{7,40}$/i;
const NANO=/^\d+$/;
function safe(value,re,label='invalid field'){
 if(typeof value!=='string'||!re.test(value))throw Error(label);
 return value;
}
function safeJSON(obj){return JSON.stringify(obj);}
export function getSafeStartupMetadata({
 softwareVersion,gitCommit,provider='IRONBEAM_V2',apiVersion='v2',
 physicalContract='XCME:ES.Z26',contractMapping='XCME:ES.Z26',
 clockSource='UNVERIFIED',clockConfiguration='UNVERIFIED'
}={}){
 return Object.freeze({
  schema:'engine18.recorder.startup.v1',
  softwareVersion:safe(softwareVersion,SAFE_ID,'software version required'),
  gitCommit:safe(gitCommit,COMMIT,'git commit required'),
  provider:safe(provider,SAFE_ID),apiVersion:safe(apiVersion,SAFE_ID),
  physicalContract:safe(physicalContract,SAFE_ID),
  contractMapping:safe(contractMapping,SAFE_ID),
  clockSource:safe(clockSource,SAFE_ID),clockConfiguration:safe(clockConfiguration,SAFE_ID)
 });
}
export function snapshotFrameAtReceipt(message){
 if(typeof message==='string'||(typeof Blob!=='undefined'&&message instanceof Blob))return message;
 if(message instanceof ArrayBuffer)return Buffer.from(new Uint8Array(message));
 if(ArrayBuffer.isView(message))return Buffer.from(new Uint8Array(message.buffer,message.byteOffset,message.byteLength));
 throw Error('unsupported WebSocket frame; recorder must fail closed');
}
export async function getExactBinary(message){
 if(typeof message==='string')return {raw:message,rawEncoding:'utf8'};
 if(Buffer.isBuffer(message))return {raw:Buffer.from(message),rawEncoding:'base64'};
 if(message instanceof ArrayBuffer)return {raw:Buffer.from(new Uint8Array(message)),rawEncoding:'base64'};
 if(ArrayBuffer.isView(message))return {raw:Buffer.from(new Uint8Array(message.buffer,message.byteOffset,message.byteLength)),rawEncoding:'base64'};
 if(typeof Blob!=='undefined'&&message instanceof Blob){
  return {raw:Buffer.from(await message.arrayBuffer()),rawEncoding:'base64'};
 }
 throw Error('unsupported WebSocket frame; recorder must fail closed');
}
export function validateClockSample(sample){
 if(!sample || sample.verified!==true)return Object.freeze({schema:'engine18.clock.sample.v1',quality:'UNVERIFIED',source:'UNVERIFIED',offsetNs:null,uncertaintyNs:null});
 const source=safe(sample.source,SAFE_ID,'trusted time source required');
 if(!['CHRONY','PTP','NTP_AUDITED'].includes(source))throw Error('unsupported trusted clock source');
 if(typeof sample.offsetNs!=='string'||! /^-?\d+$/.test(sample.offsetNs)||
   typeof sample.uncertaintyNs!=='string'||!NANO.test(sample.uncertaintyNs))throw Error('invalid verified clock offset');
 return Object.freeze({schema:'engine18.clock.sample.v1',quality:'VERIFIED',source,
  offsetNs:sample.offsetNs,uncertaintyNs:sample.uncertaintyNs});
}
/**
 * One supervisor per synthetic recording process. Open socket generations are
 * increasing, not reused; ID + runId provide global identity.
 * Every public method enqueues synchronously to preserve call order.
 * No source frame parsing or event loop disk work on the caller's stack.
 */
export class Engine18SyntheticReadinessSupervisor{
 constructor({root,clock,metadata,clockSampler=null,maxQueued=4096,batchSize=128,flushDelayMs=0}={}){
  if(!clock||typeof clock.wallNs!=='function'||typeof clock.monoNs!=='function')throw Error('clock required');
  this.clock=clock;this.meta=getSafeStartupMetadata(metadata);
  if(clockSampler!==null&&typeof clockSampler!=='function')throw Error('clock sampler must be a function');
  this.clockSampler=clockSampler;
  this.writer=new Engine18BufferedRecorder({root,clock,maxQueued,batchSize,flushDelayMs});
  this.generation=0;this.sockets=new Map();this.sourceGapMarked=new Set();this.deferredOpen=new Set();this.chain=Promise.resolve();this.failed=false;this.started=false;this.sampleCount=0;this.clockTimer=null;
 }
 enqueue(fn){
  const p=this.chain.then(fn);
  this.chain=p.catch(()=>{this.failed=true;this.writer.fail('SUPERVISOR_IO_FAILED');});
  return p;
 }
 async start(){
  if(this.started)throw Error('already started');
  this.started=true;
  return this.enqueue(()=>this.controlRecord('RECORDER_METADATA',0,this.meta));
 }
 snapshotReceipt(){
  // Stamping is synchronous at the event callback boundary and is run-scoped.
  const receivedWallNs=String(this.clock.wallNs()),receivedMonoNs=String(this.clock.monoNs());
  if(!NANO.test(receivedWallNs)||!NANO.test(receivedMonoNs))throw Error('invalid source receipt clocks');
  const receiptDate=new Date(Number(BigInt(receivedWallNs)/1000000n));
  if(!Number.isFinite(receiptDate.getTime()))throw Error('invalid source receipt date');
  return {receivedWallNs,receivedMonoNs,receiptDate};
 }
 async controlRecord(statusCode,streamGeneration,data={},stamp=this.snapshotReceipt()){
  if(!CODE.test(statusCode)||!Number.isSafeInteger(streamGeneration)||streamGeneration<0)throw Error('invalid safe control');
  const payload=safeJSON(data);
  return this.writer.offerCaptured(Object.freeze({...stamp,msgClass:'control',statusCode,streamGeneration,raw:payload,rawEncoding:'utf8'}));
 }
 open({connectionId=randomUUID(),deferConnected=false}={}){
  if(!this.started||this.failed)throw Error('supervisor unavailable');
  safe(connectionId,SAFE_ID,'invalid connection id');
  if([...this.sockets.values()].some(x=>x.connectionId===connectionId))throw Error('connection id already used');
  const stamp=this.snapshotReceipt(),generation=++this.generation;
  const socket=Object.freeze({generation,connectionId,runId:this.writer.writer.runId});
  this.sockets.set(generation,socket);
  if(deferConnected===true){
   this.deferredOpen.add(generation);
   return {socket,ack:Promise.resolve({reserved:true})};
  }
  const status=generation===1?'CONNECTED':'RECONNECT';
  const ack=this.enqueue(()=>this.controlRecord(status,generation,{connectionId,reason:'CONNECTION_OPEN'},stamp));
  return {socket,ack};
 }
 confirmOpen(socket){
  const known=this.validateSocket(socket);
  if(!this.deferredOpen.delete(known.generation))throw Error('socket was not awaiting OPEN confirmation');
  const stamp=this.snapshotReceipt();
  const status=known.generation===1?'CONNECTED':'RECONNECT';
  return this.enqueue(()=>this.controlRecord(status,known.generation,{
   connectionId:known.connectionId,reason:'WEBSOCKET_OPEN_CONFIRMED'
  },stamp));
 }
 socketEvent(socket,event,{reason='UNSPECIFIED',closeCode=null}={}){
  const known=this.validateSocket(socket);
  if(!['DISCONNECTED','WS_ERROR'].includes(event))throw Error('invalid socket event');
  const detail=safe(reason,CODE,'unsafe disconnect reason');
  if(closeCode!==null&&(!Number.isInteger(closeCode)||closeCode<1000||closeCode>4999))throw Error('invalid websocket close code');
  const stamp=this.snapshotReceipt();
  // Distinguish transport error from recorder crash GAP. Source coverage is
  // UNKNOWN from interruption until a verified complete reseed.
  const uncertain=event==='WS_ERROR'||(event==='DISCONNECTED'&&closeCode!==1000);
  const firstGap=uncertain&&!this.sourceGapMarked.has(known.connectionId);
  if(firstGap)this.sourceGapMarked.add(known.connectionId);
  return this.enqueue(async()=>{
   const ack=await this.controlRecord(event,known.generation,{connectionId:known.connectionId,reason:detail,closeCode},stamp);
   if(firstGap)await this.controlRecord('FEED_GAP',known.generation,{
    connectionId:known.connectionId,reason:'SOURCE_COVERAGE_UNKNOWN',fromReceiptWallNs:stamp.receivedWallNs,
    confirmedLoss:false
   },stamp);
   return ack;
  });
 }
 subscription(socket,{feedType,physicalContract='XCME:ES.Z26',streamId,status}={}){
  const known=this.validateSocket(socket);
  if(!['depths','quotes','trades'].includes(feedType))throw Error('invalid feed type');
  safe(physicalContract,SAFE_ID,'invalid physical contract');
  // Stream ID is kept for replay correlation; reject tokens/URL/query strings.
  safe(streamId,SAFE_ID,'unsafe stream ID');
  if(!['SUCCESS','FAILED'].includes(status))throw Error('invalid subscription status');
  const stamp=this.snapshotReceipt();
  return this.enqueue(()=>this.controlRecord('SUBSCRIPTION_ACK',known.generation,{
   feedType,physicalContract,streamId,status,connectionId:known.connectionId
  },stamp));
 }
 validateSocket(socket){
  const known=this.sockets.get(socket?.generation);
  if(!known||known.connectionId!==socket.connectionId||known.runId!==socket.runId)throw Error('unknown connection generation');
  return known;
 }
 frame(socket,data){
  const known=this.validateSocket(socket);
  const stamp=this.snapshotReceipt(); // stamp BEFORE Blob reading/decoding/queue
  const snapshot=snapshotFrameAtReceipt(data); // clone mutable byte views immediately
  return this.enqueue(async()=>{
   const {raw,rawEncoding}=await getExactBinary(snapshot);
   const encodedRaw=rawEncoding==='base64'?raw.toString('base64'):raw;
   return this.writer.offerCaptured(Object.freeze({...stamp,raw:encodedRaw,rawEncoding,
    msgClass:'unknown',statusCode:null,streamGeneration:known.generation}));
  });
 }
 clockSample(){
  const stamp=this.snapshotReceipt();
  return this.enqueue(async()=>{
   let sample=null;
   try{sample=this.clockSampler?await this.clockSampler():null;}catch{}
   const result=validateClockSample(sample);
   await this.controlRecord('CLOCK_SAMPLE',0,result,stamp);
   this.sampleCount++;return result;
  });
 }
 startClockMonitoring({intervalMs=60000}={}){
  if(!this.started||this.failed||this.clockTimer)throw Error('clock monitor unavailable');
  if(!Number.isInteger(intervalMs)||intervalMs<1||intervalMs>3600000)throw Error('invalid clock monitoring interval');
  this.clockTimer=setInterval(()=>{void this.clockSample().catch(()=>{});},intervalMs);
  this.clockTimer.unref?.();
 }
 stopClockMonitoring(){if(this.clockTimer){clearInterval(this.clockTimer);this.clockTimer=null;}}
 async close(){this.stopClockMonitoring();await this.chain;if(this.failed)throw Error('failed recorder cannot cleanly stop');await this.writer.close();}
 health(){return Object.freeze({...this.writer.health(),generationCount:this.generation,clockSamples:this.sampleCount});}
}
