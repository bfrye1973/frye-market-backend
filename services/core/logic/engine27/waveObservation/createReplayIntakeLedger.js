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
 return Object.freeze({processedFor,acknowledge,storagePath:base});
}
