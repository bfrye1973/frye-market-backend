// Private read-only end-of-trial verification. Never exposes ES prices,
// token-bearing URLs, or raw vendor packets in summary output.
// The independently pinned last sequence MUST come from operator-authorized
// external evidence, not this same S3 inventory or an inferred local file.
import {createHash} from 'node:crypto';
import {scanEngine18ReplayBounded} from './engine18BoundedReplayScan.js';
import {classifyIronbeamRawFrame} from './ironbeamV2RecorderAdapter.js';

async function fingerprint(root){
 const h=createHash('sha256');
 const counts={depth:0,quote:0,trade:0,unknown:0,malformed:0,binary:0,
  recorderGaps:0,sourceGaps:0,connections:0,subscriptions:0,sourceErrors:0};
 const scan=await scanEngine18ReplayBounded(root,{onRecord:e=>{
  h.update(JSON.stringify(e)+'\n');
  if(e.msgClass==='control'){
   if(e.statusCode==='GAP')counts.recorderGaps++;
   else if(e.statusCode==='FEED_GAP')counts.sourceGaps++;
   else if(e.statusCode==='CONNECTED'||e.statusCode==='RECONNECT')counts.connections++;
   else if(e.statusCode==='SUBSCRIPTION_ACK')counts.subscriptions++;
   else if(e.statusCode==='WS_ERROR'||e.statusCode==='DISCONNECTED')counts.sourceErrors++;
   return;
  }
  const raw=e.rawEncoding==='base64'?Buffer.from(e.raw,'base64'):e.raw;
  if(e.rawEncoding==='base64')counts.binary++;
  const kind=classifyIronbeamRawFrame(raw).diagnostic.kind;
  if(Object.hasOwn(counts,kind))counts[kind]++;else counts.unknown++;
 }});
 return {sha256:h.digest('hex'),counts,scan};
}
export async function verifyEngine18ControlledTrial({
 recorderRoot,restoredRoot,remoteCoordinator,independentLastSeq
}={}){
 if(typeof recorderRoot!=='string'||typeof restoredRoot!=='string'||
    !remoteCoordinator||typeof remoteCoordinator.restore!=='function'||
    !Number.isSafeInteger(independentLastSeq)||independentLastSeq<1)
  throw Error('private source, verified backup, empty restore and independent pin required');
 const original=await fingerprint(recorderRoot);
 if(original.scan.lastSeq!==independentLastSeq)
  throw Error('local recording differs from independently pinned lastSeq');
 const restored=await remoteCoordinator.restore({
  destination:restoredRoot,expectedLastSeq:independentLastSeq
 });
 const mirror=await fingerprint(restoredRoot);
 if(mirror.sha256!==original.sha256||mirror.scan.records!==original.scan.records||
    restored.lastSeq!==independentLastSeq)
  throw Error('restored recording differs from original deterministic replay');
 return Object.freeze({
  schema:'engine18.controlledTrial.verification.v1',readOnly:true,
  byteIdenticalReplay:true,independentLastSeq,
  originalSha256:original.sha256,restoredSha256:mirror.sha256,
  archivedBytes:original.scan.compressedBytes,recordCount:original.scan.records,
  ...original.counts,
  vendorDepthSemantics:'UNVERIFIED',exchangeClockQuality:'UNVERIFIED'
 });
}
