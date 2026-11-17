// Isolated durable continuity cache for a previously VERIFIED Engine10 PAPER lock.
// Not an alternate source of execution/lifecycle truth. Expiry is enforced by adapter.
import fs from "node:fs";
import path from "node:path";
const fileDefault=()=>process.env.ENGINE3_ENGINE10_VERIFIED_LOCK_FILE||
  "/var/data/replay/engine3/engine3-engine10-verified-paper-lock-es.json";
function valid(x){
 return x?.source==="ENGINE10_JOURNAL"&&x?.symbol==="ES"&&
  x?.strategyId==="intraday_scalp@10m"&&typeof x.tradeId==="string"&&
  x.tradeId.length>0&&["LONG","SHORT"].includes(x.lockedTradeDirection)&&
  Number.isFinite(x.verifiedAtMs)&&Number.isFinite(x.remainingQty)&&x.remainingQty>0;
}
export function loadVerifiedEngine10PaperLock({filePath=fileDefault()}={}){
 try{
  if(!fs.existsSync(filePath))return {found:false,lock:null,reasonCode:"NO_VERIFIED_LOCK"};
  const lock=JSON.parse(fs.readFileSync(filePath,"utf8"))?.lock;
  return valid(lock)?{found:true,lock,reasonCode:"VERIFIED_LOCK_FOUND"}:
    {found:false,lock:null,reasonCode:"VERIFIED_LOCK_INVALID"};
 }catch{return {found:false,lock:null,reasonCode:"VERIFIED_LOCK_READ_FAILED"};}
}
export function saveVerifiedEngine10PaperLock({result,filePath=fileDefault()}={}){
 if(result?.lifecycleVerified!==true||result?.openTradeActive!==true||
    result?.fallbackFromVerified===true||!valid(result))
   return {saved:false,reasonCode:"NOT_FRESH_VERIFIED_ENGINE10_LOCK"};
 try{
  const old=loadVerifiedEngine10PaperLock({filePath});
  if(old.found&&old.lock.verifiedAtMs>result.verifiedAtMs)
    return {saved:false,reasonCode:"VERIFIED_LOCK_REWIND_REJECTED"};
  fs.mkdirSync(path.dirname(filePath),{recursive:true});
  const temporary=filePath+"."+process.pid+"."+result.verifiedAtMs+".tmp";
  try{
   fs.writeFileSync(temporary,JSON.stringify({lock:result}),{flag:"wx",encoding:"utf8"});
   fs.renameSync(temporary,filePath);
  }finally{if(fs.existsSync(temporary))fs.unlinkSync(temporary);}
  return {saved:true,reasonCode:"VERIFIED_LOCK_SAVED"};
 }catch{return {saved:false,reasonCode:"VERIFIED_LOCK_SAVE_FAILED"};}
}
export function clearVerifiedEngine10PaperLock({filePath=fileDefault()}={}){
 try{if(fs.existsSync(filePath))fs.unlinkSync(filePath);
   return {cleared:true,reasonCode:"VERIFIED_LOCK_CLEARED"};
 }catch{return {cleared:false,reasonCode:"VERIFIED_LOCK_CLEAR_FAILED"};}
}
