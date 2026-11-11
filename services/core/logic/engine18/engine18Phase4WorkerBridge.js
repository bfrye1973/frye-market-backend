// Parent-side IPC to a separately supervised synthetic recorder process.
// No Ironbeam websocket, chart API, broker, licensed data, or public endpoints.
import {fork} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createEngine18ReceiptClock} from './engine18ReceiptClock.js';

const CHILD=fileURLToPath(new URL('./engine18Phase4SyntheticWorker.js',import.meta.url));
function quantile(a,q){
 if(!a.length)return null;
 const s=[...a].sort((x,y)=>x-y);return s[Math.min(s.length-1,Math.ceil(q*s.length)-1)];
}
export class Engine18SyntheticWorkerBridge{
 constructor({root,maxInflight=256,onFailure=()=>{},syntheticSlowDiskMs=0}={}){
  if(!root||!root.startsWith('/tmp/')||!Number.isSafeInteger(maxInflight)||maxInflight<1)
   throw Error('synthetic root and bounded IPC required');
  if(!Number.isInteger(syntheticSlowDiskMs)||syntheticSlowDiskMs<0||syntheticSlowDiskMs>100)throw Error('invalid synthetic disk delay');
  this.syntheticSlowDiskMs=syntheticSlowDiskMs;
  this.root=root;this.maxInflight=maxInflight;this.onFailure=onFailure;
  this.pending=new Map();this.child=null;this.nextId=1;this.failed=false;
  this.accepted=0;this.acked=0;this.rejected=0;this.latencyUs=[];this.closed=false;
  this.clock=createEngine18ReceiptClock();this.ipcQueuedSignals=0;this.ipcSendErrors=0;
 }
 async start(){
  if(this.child)throw Error('already started');
  const child=fork(CHILD,[],{
   env:{ENGINE18_SYNTHETIC_WORKER:'1',ENGINE18_SYNTHETIC_SLOW_DISK_MS:String(this.syntheticSlowDiskMs)},
   stdio:['ignore','ignore','ignore','ipc']
  });this.child=child;
  child.on('message',message=>{
   if(message?.type==='ACK'){
    const p=this.pending.get(message.id);
    if(p){this.pending.delete(message.id);this.acked++;p.resolve(message.seq);}
   }
   if(message?.type==='FAILED')this.fail('CHILD_RECORDING_FAILED');
  });
  child.once('exit',()=>{if(!this.closed)this.fail('WORKER_EXITED');});
  await new Promise((resolve,reject)=>{
   const timeout=setTimeout(()=>reject(Error('worker startup timeout')),10000);
   child.once('exit',()=>{clearTimeout(timeout);reject(Error('worker exited before READY'));});
   const handler=m=>{
    if(m?.type==='READY'){clearTimeout(timeout);child.off('message',handler);resolve();}
    if(m?.type==='FAILED'){clearTimeout(timeout);child.off('message',handler);reject(Error('worker startup failed'));}
   };
   child.on('message',handler);
   child.send({type:'INIT',root:this.root},err=>{if(err){child.off('message',handler);reject(Error('worker IPC init failed'));}});
  });
 }
 fail(reason){
  if(this.failed)return;
  this.failed=true;this.failureReason=reason;
  for(const pending of this.pending.values())pending.reject(Error('unacknowledged after recorder failure'));
  this.pending.clear();
  try{this.child?.send({type:'FAIL'});}catch{}
  try{this.onFailure(reason);}catch{}
 }
 submit(raw,{streamGeneration=0,msgClass='unknown',statusCode=null}={}){
  const start=process.hrtime.bigint();
  if(this.failed||this.closed||!this.child)return Promise.reject(Error('recorder unavailable'));
  let encoded,rawEncoding;
  if(typeof raw==='string'){encoded=raw;rawEncoding='utf8';}
  else if(Buffer.isBuffer(raw)||raw instanceof Uint8Array){
   encoded=Buffer.from(raw).toString('base64');rawEncoding='base64';
  }else{return Promise.reject(Error('unsupported synthetic IPC frame'));}
  if(this.pending.size>=this.maxInflight){
   this.rejected++;this.fail('IPC_OVERFLOW');
   return Promise.reject(Error('IPC overflow; recorder failed closed'));
  }
  const stamp=this.clock.capture();
  const {receivedWallNs,receivedMonoNs,rawHostWallObservedNs,receiptTimeSource,receiptPrecision,clockQuality}=stamp;
  const id=this.nextId++;
  const receipt={raw:encoded,rawEncoding,msgClass,statusCode,streamGeneration,receivedWallNs,receivedMonoNs,
   receiptClockSource:receiptTimeSource,receiptPrecision,clockQuality,rawHostWallObservedNs};
  this.accepted++;
  const result=new Promise((resolve,reject)=>this.pending.set(id,{resolve,reject}));
  // Caller is never blocked on file/disk/backup operations; IPC is asynchronous.
  try{
   const acceptedByIPC=this.child.send({type:'FRAME',id,receipt},err=>{
    if(err){this.ipcSendErrors++;this.fail('IPC_SEND_ERROR');}
   });
   // Node child.send(false) means the IPC channel is queued above its
   // threshold, NOT that the frame was dropped. Count pressure and await ACK.
   // In-flight bound remains the independent fail-closed limit.
   if(!acceptedByIPC)this.ipcQueuedSignals++;
  }catch{this.fail('IPC_EXCEPTION');}
  this.latencyUs.push(Number(process.hrtime.bigint()-start)/1000);
  if(this.latencyUs.length>10000)this.latencyUs.shift();
  return result;
 }
 health(){
  return Object.freeze({schema:'engine18.workerBridge.health.v1',active:!this.failed&&!this.closed,
   accepted:this.accepted,acked:this.acked,inflight:this.pending.size,rejected:this.rejected,
   callbackUsP95:quantile(this.latencyUs,.95),callbackUsP99:quantile(this.latencyUs,.99),
   ipcQueuedSignals:this.ipcQueuedSignals,ipcSendErrors:this.ipcSendErrors,
   receiptClock:this.clock.diagnostics(),clockQuality:'UNVERIFIED',failure:this.failureReason??null});
 }
 async close(){
  if(!this.child||this.closed)return;
  if(this.failed){
   const child=this.child;
   if(child.exitCode===null&&child.signalCode===null){
    const exited=new Promise(resolve=>child.once('exit',resolve));
    child.kill('SIGKILL');await exited;
   }
   this.closed=true;return;
  }
  if(this.pending.size)await Promise.allSettled([...this.pending.values()].map(p=>
   new Promise((resolve)=>{const old=p.resolve;p.resolve=x=>{old(x);resolve();};const reject=p.reject;p.reject=e=>{reject(e);resolve();};})));
  await new Promise((resolve,reject)=>{
   const child=this.child;
   const timer=setTimeout(()=>{this.fail('SHUTDOWN_TIMEOUT');reject(Error('worker shutdown timeout'));},15000);
   const handler=m=>{if(m?.type==='CLOSED'){clearTimeout(timer);child.off('message',handler);this.closed=true;resolve();}};
   child.on('message',handler);
   child.send({type:'CLOSE'},err=>{if(err){clearTimeout(timer);reject(Error('worker close IPC failed'));}});
  });
  this.child.disconnect();
 }
}
