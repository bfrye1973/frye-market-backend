// Engine 18 Gate1 Phase2 buffering: OFFLINE SYNTHETIC ONLY.
// Promise resolves only after fsync + high-watermark commit. No silent drops.
import {Engine18RawRecorder} from './gate1RawRecorder.js';
import {statfsSync} from 'node:fs';
export class Engine18BufferedRecorder {
 constructor({root,clock,maxQueued=4096,maxQueueBytes=32*1024*1024,batchSize=256,flushDelayMs=2,testFault=null,writer=null}={}){
  if(!Number.isSafeInteger(maxQueued)||maxQueued<1||!Number.isSafeInteger(maxQueueBytes)||maxQueueBytes<256||
     !Number.isSafeInteger(batchSize)||batchSize<1||!Number.isInteger(flushDelayMs)||flushDelayMs<0)throw Error('invalid queue bounds');
  this.writer=writer??new Engine18RawRecorder({root,clock,provider:'SYNTHETIC',testFault});
  this.maxQueued=maxQueued;this.maxQueueBytes=maxQueueBytes;this.batchSize=batchSize;this.flushDelayMs=flushDelayMs;
  this.pending=[];this.pendingBytes=0;this.received=0;this.recorded=0;this.rejected=0;
  this.failed=false;this.draining=false;this.closed=false;this.closing=false;this.timer=null;this.lastReceiptWallNs=null;this.reconnects=0;
 }
 static async openBounded(options={}){
  const writer=await Engine18RawRecorder.openBounded(options);
  try{return new Engine18BufferedRecorder({...options,writer});}
  catch(e){writer.releaseLock();throw e;}
 }
 capture(args){
  if(this.failed||this.closed||this.closing)throw Error('recorder stopped');
  return this.writer.capture(args);
 }
 offer(args){try{return this.offerCaptured(this.capture(args));}catch(e){return Promise.reject(e);}}
 offerCaptured(receipt){
  if(this.failed||this.closed||this.closing)return Promise.reject(Error('recorder stopped'));
  // The receipt was already timestamped at the source boundary.
  if(!receipt||typeof receipt.raw!=='string'||typeof receipt.receivedWallNs!=='string'||typeof receipt.receivedMonoNs!=='string')return Promise.reject(Error('invalid pre-captured receipt'));
  this.received++;this.lastReceiptWallNs=receipt.receivedWallNs;
  const bytes=Buffer.byteLength(receipt.raw,'utf8')+384;
  if(this.pending.length>=this.maxQueued||this.pendingBytes+bytes>this.maxQueueBytes){
   this.rejected++;this.fail('BACKPRESSURE');
   return Promise.reject(Error('recorder backpressure; no acknowledgment issued'));
  }
  return new Promise((resolve,reject)=>{
   this.pending.push({receipt,bytes,resolve,reject});this.pendingBytes+=bytes;
   if(this.pending.length>=this.batchSize)this.schedule(true);
   else this.schedule(false);
  });
 }
 onReconnect(){this.reconnects++;}
 fail(reason){
  if(this.failed)return;
  this.failed=true;this.failureReason=reason;
  if(this.timer!==null){clearTimeout(this.timer);this.timer=null;}
  // All pending events are unacknowledged, even if bytes exist after a partial write.
  for(const e of this.pending)e.reject(Error('recorder failed closed'));
  this.pending=[];this.pendingBytes=0;
  this.writer.faulted=true; // prevents writing an untruthful clean STOP.
 }
 schedule(immediate){
  if(this.draining)return;
  if(this.timer!==null){if(!immediate)return;clearTimeout(this.timer);this.timer=null;}
  this.timer=setTimeout(()=>{this.timer=null;void this.flush().catch(()=>{});},immediate?0:this.flushDelayMs);
 }
 async flush(){
  if(this.failed)throw Error('recorder failed closed');
  if(this.draining)return;
  this.draining=true;
  try{
   while(this.pending.length){
    const batch=this.pending.splice(0,this.batchSize);
    const bytes=batch.reduce((n,e)=>n+e.bytes,0);this.pendingBytes-=bytes;
    try{
     const acknowledgments=await this.writer.appendBatch(batch.map(x=>x.receipt));
     if(this.failed)throw Error('recorder failed while committing');
     this.recorded+=batch.length;
     batch.forEach((e,i)=>e.resolve({...acknowledgments[i],receivedMonoNs:e.receipt.receivedMonoNs,receivedWallNs:e.receipt.receivedWallNs}));
    }catch{
     batch.forEach(e=>e.reject(Error('group commit failed; no acknowledgment')));
     this.fail('WRITE_FAILED');throw Error('group commit failed');
    }
   }
  }finally{this.draining=false;}
 }
 async close(){
  if(this.closed)return;
  if(this.closing)throw Error('recorder shutdown already in progress');
  this.closing=true;
  if(this.timer!==null){clearTimeout(this.timer);this.timer=null;}
  while(this.draining)await new Promise(resolve=>setImmediate(resolve));
  if(this.failed)throw Error('cannot close failed recorder; recover and inspect GAP');
  try{await this.flush();await this.writer.closeStreaming();this.closed=true;}
  catch{this.failed=true;this.writer.faulted=true;throw Error('recorder close failed; recovery required');}
 }
 // Internal only: never expose this snapshot at an unauthenticated endpoint.
 health(){
  let diskFreeBytes=null,diskTotalBytes=null;
  try{const s=statfsSync(this.writer.root,{bigint:true});diskFreeBytes=String(s.bavail*s.bsize);diskTotalBytes=String(s.blocks*s.bsize);}catch{}
  return Object.freeze({schema:'engine18.buffered.health.v1',recordingActive:!this.closed&&!this.failed,
   received:this.received,recorded:this.recorded,unacknowledged:this.pending.length,rejected:this.rejected,
   gapCount:this.writer.gaps,bytesWritten:this.writer.bytes,lastReceivedWallNs:this.lastReceiptWallNs,
   diskFreeBytes,diskTotalBytes,clockOffsetStatus:'UNVERIFIED',reconnects:this.reconnects,failedClosed:this.failed});
 }
}
