// Engine 18 Gate1 Phase2 buffering: OFFLINE SYNTHETIC ONLY.
// Promise resolves only after fsync + high-watermark commit. No silent drops.
import {Engine18RawRecorder} from './gate1RawRecorder.js';
import {statfsSync} from 'node:fs';
export class Engine18BufferedRecorder {
 constructor({root,clock,maxQueued=4096,maxQueueBytes=32*1024*1024,batchSize=256,flushDelayMs=2}={}){
  if(!Number.isSafeInteger(maxQueued)||maxQueued<1||!Number.isSafeInteger(maxQueueBytes)||maxQueueBytes<256||
     !Number.isSafeInteger(batchSize)||batchSize<1||!Number.isInteger(flushDelayMs)||flushDelayMs<0)throw Error('invalid queue bounds');
  this.writer=new Engine18RawRecorder({root,clock,provider:'SYNTHETIC'});
  this.maxQueued=maxQueued;this.maxQueueBytes=maxQueueBytes;this.batchSize=batchSize;this.flushDelayMs=flushDelayMs;
  this.pending=[];this.pendingBytes=0;this.received=0;this.recorded=0;this.rejected=0;
  this.failed=false;this.draining=false;this.closed=false;this.timer=null;this.lastReceiptWallNs=null;
 }
 offer(args){
  if(this.failed||this.closed)return Promise.reject(Error('recorder stopped'));
  // Receipt boundary. No async work or queue delay before capture.
  const receipt=this.writer.capture(args);
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
     batch.forEach((e,i)=>e.resolve(acknowledgments[i]));
    }catch{
     batch.forEach(e=>e.reject(Error('group commit failed; no acknowledgment')));
     this.fail('WRITE_FAILED');throw Error('group commit failed');
    }
   }
  }finally{this.draining=false;}
 }
 async close(){
  if(this.closed)return;
  if(this.timer!==null){clearTimeout(this.timer);this.timer=null;}
  while(this.draining)await new Promise(resolve=>setImmediate(resolve));
  if(this.failed)throw Error('cannot close failed recorder; recover and inspect GAP');
  await this.flush();
  await this.writer.closeStreaming();this.closed=true;
 }
 // Internal only: never expose this snapshot at an unauthenticated endpoint.
 health(){
  let diskFreeBytes=null,diskTotalBytes=null;
  try{const s=statfsSync(this.writer.root,{bigint:true});diskFreeBytes=String(s.bavail*s.bsize);diskTotalBytes=String(s.blocks*s.bsize);}catch{}
  return Object.freeze({schema:'engine18.buffered.health.v1',recordingActive:!this.closed&&!this.failed,
   received:this.received,recorded:this.recorded,unacknowledged:this.pending.length,rejected:this.rejected,
   gapCount:this.writer.gaps,bytesWritten:this.writer.bytes,lastReceivedWallNs:this.lastReceiptWallNs,
   diskFreeBytes,diskTotalBytes,clockOffsetStatus:'UNVERIFIED',reconnects:null,failedClosed:this.failed});
 }
}
