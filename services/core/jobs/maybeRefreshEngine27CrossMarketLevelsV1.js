// Refresh on the SAME Render service/disk as strategy snapshots.
// Uses an atomic lock to avoid overlapping GitHub-driven snapshots.
// Explicit opt-in only; failures cannot block existing trading snapshots.
import fs from "node:fs/promises";
import path from "node:path";
import {persistEngine27CrossMarketLevelsV1} from "./persistEngine27CrossMarketLevelsV1.js";
export async function maybeRefreshEngine27CrossMarketLevelsV1({
 filePath=null,apiKey=null,now=new Date(),fetchBars=undefined,
 minimumAgeMs=6*3600000
}={}){
 if(typeof filePath!=="string"||!path.isAbsolute(filePath)||!apiKey)
  return {state:"DISABLED_OR_UNCONFIGURED"};
 const lock=filePath+".refresh-lock";
 let handle;
 try{
  const stat=await fs.stat(filePath).catch(()=>null);
  if(stat&&now.getTime()-stat.mtimeMs<minimumAgeMs)return {state:"CURRENT",filePath};
  await fs.mkdir(path.dirname(filePath),{recursive:true});
  try{handle=await fs.open(lock,"wx");}
  catch(e){
   if(e?.code==="EEXIST")return {state:"REFRESH_ALREADY_RUNNING"};
   return {state:"LOCK_UNAVAILABLE"};
  }
  // Never delete a lock we did not acquire. A stale lock needs operator review.
  const outcome=await persistEngine27CrossMarketLevelsV1({filePath,apiKey,now,fetchBars});
  return outcome.written?{state:"REFRESHED",availability:outcome.availability}:{state:"REFRESH_NOT_AVAILABLE",reason:outcome.reason};
 }catch{
  return {state:"REFRESH_FAILED"};
 }finally{
  if(handle){await handle.close().catch(()=>{});await fs.rm(lock,{force:true}).catch(()=>{});}
 }
}
