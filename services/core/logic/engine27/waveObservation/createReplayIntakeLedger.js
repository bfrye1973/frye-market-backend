// Engine27 V6 isolated durable Replay intake receipts. NO production activation.
// One immutable receipt per original YYYY-MM-DD/HHMM; never silently replace source evidence.
import fs from "node:fs";
import path from "node:path";
import {verifyReplayIntakeReceipt} from "./planReplayIntake.js";
const safeDate=x=>typeof x==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(x);
const safeTime=x=>typeof x==="string"&&/^([01]\d|2[0-3])[0-5]\d$/.test(x);
export function createReplayIntakeLedger({root="/var/data/replay/engine27/wave-observations"}={}){
 const base=path.join(root,"replay-intake-receipts");
 function targetFor(date,time){
  if(!safeDate(date)||!safeTime(time))throw Error("INVALID_REPLAY_RECEIPT_KEY");
  return path.join(base,date,time+".json");
 }
 function processedFor(date){
  if(!safeDate(date))throw Error("INVALID_REPLAY_RECEIPT_DATE");
  const folder=path.join(base,date);
  if(!fs.existsSync(folder))return [];
  return fs.readdirSync(folder).filter(x=>/^([01]\d|2[0-3])[0-5]\d\.json$/.test(x))
   .map(x=>date+"/"+x.slice(0,4)).sort();
 }
 function acknowledge({item,sourceReplay,writeResult,acknowledgedAt}={}){
  const verification=verifyReplayIntakeReceipt({item,sourceReplay,writeResult});
  if(!verification.acknowledged)return {ok:false,reason:verification.reason};
  if(typeof acknowledgedAt!=="string"||!Number.isFinite(Date.parse(acknowledgedAt)))
   return {ok:false,reason:"INVALID_RECEIPT_TIME"};
  const target=targetFor(item.date,item.time),folder=path.dirname(target);
  fs.mkdirSync(folder,{recursive:true});
  const receipt={schema:"engine27.v6.replayIntakeReceipt.v1",key:item.key,
   sourceReplayPath:item.sourceReplayPath,sourceReplaySha256:verification.sha256,
   originalReplayBytesVerified:true,sevenDegreeJournalAck:true,acknowledgedAt};
  const contents=JSON.stringify(receipt)+"\n";
  const pending=target+"."+process.pid+".pending";
  let fd;
  try{
   fd=fs.openSync(pending,"wx");
   fs.writeFileSync(fd,contents);fs.fsyncSync(fd);fs.closeSync(fd);fd=null;
   try{fs.linkSync(pending,target);}
   catch(e){if(e?.code!=="EEXIST")throw e;}
   const stored=JSON.parse(fs.readFileSync(target,"utf8"));
   if(stored.key!==receipt.key||stored.sourceReplaySha256!==receipt.sourceReplaySha256||
      stored.sourceReplayPath!==receipt.sourceReplayPath||stored.sevenDegreeJournalAck!==true)
    return {ok:false,reason:"REPLAY_RECEIPT_IDENTITY_CONFLICT"};
   const folderFd=fs.openSync(folder,"r");
   try{fs.fsyncSync(folderFd);}finally{fs.closeSync(folderFd);}
   return {ok:true,duplicate:stored.acknowledgedAt!==acknowledgedAt,
    key:item.key,sourceReplaySha256:receipt.sourceReplaySha256};
  }finally{
   if(fd!==undefined&&fd!==null)fs.closeSync(fd);
   try{fs.unlinkSync(pending);}catch(e){if(e?.code!=="ENOENT")throw e;}
  }
 }
 function acknowledgeLegacyWithoutPublication({item,sourceReplay,acknowledgedAt}={}){
  if(!item||sourceReplay?.date!==item.date||sourceReplay?.time!==item.time||
     sourceReplay?.path!==item.sourceReplayPath||
     sourceReplay?.hashBasis!=="ORIGINAL_REPLAY_FILE_BYTES"||
     !/^[a-f0-9]{64}$/.test(sourceReplay?.sha256??"")||
     typeof acknowledgedAt!=="string"||!Number.isFinite(Date.parse(acknowledgedAt)))
    return {ok:false,reason:"UNVERIFIED_LEGACY_SOURCE_IDENTITY"};
  const target=targetFor(item.date,item.time),folder=path.dirname(target);
  fs.mkdirSync(folder,{recursive:true});
  const payload={schema:"engine27.v6.replayIntakeReceipt.v1",key:item.key,
   sourceReplayPath:item.sourceReplayPath,sourceReplaySha256:sourceReplay.sha256,
   originalReplayBytesVerified:true,sevenDegreeJournalAck:false,
   disposition:"SKIPPED_NO_ORIGINAL_AUTHORIZED_PUBLICATION",acknowledgedAt};
  const body=JSON.stringify(payload)+"\n",tmp=target+"."+process.pid+".pending";
  let fd;
  try{
   fd=fs.openSync(tmp,"wx");fs.writeFileSync(fd,body);fs.fsyncSync(fd);fs.closeSync(fd);fd=null;
   try{fs.linkSync(tmp,target)}catch(e){if(e?.code!=="EEXIST")throw e}
   const prior=JSON.parse(fs.readFileSync(target,"utf8"));
   if(prior.key!==item.key||prior.sourceReplaySha256!==sourceReplay.sha256||
      prior.disposition!==payload.disposition||prior.sourceReplayPath!==payload.sourceReplayPath)
    return {ok:false,reason:"LEGACY_REPLAY_RECEIPT_CONFLICT"};
   const d=fs.openSync(folder,"r");try{fs.fsyncSync(d)}finally{fs.closeSync(d)}
   return {ok:true,skipped:true,key:item.key};
  }finally{
   if(fd!=null)fs.closeSync(fd);
   try{fs.unlinkSync(tmp)}catch(e){if(e?.code!=="ENOENT")throw e}
  }
 }
 return Object.freeze({processedFor,acknowledge,acknowledgeLegacyWithoutPublication,storagePath:base});
}
