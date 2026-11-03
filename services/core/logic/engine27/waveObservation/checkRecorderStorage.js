// Engine27 V6 P0-C: combined research-disk pressure preflight, no deletions.
import fs from "node:fs";
import path from "node:path";
export function checkRecorderStorage({root="/var/data/replay/engine27/wave-observations",
 diskMount="/var/data/replay",maxRootBytes=1024*1024*1024,minFreeBytes=2*1024*1024*1024}={}){
 if(!Number.isSafeInteger(maxRootBytes)||maxRootBytes<1024||
    !Number.isSafeInteger(minFreeBytes)||minFreeBytes<0)
  return {ok:false,reason:"INVALID_STORAGE_POLICY"};
 try{
  if(!fs.existsSync(diskMount)||!fs.statSync(diskMount).isDirectory())
   return {ok:false,reason:"PERSISTENT_DISK_UNAVAILABLE"};
  let used=0,entries=0;
  function walk(dir,depth){
   if(depth>7)throw Error("RESEARCH_DIRECTORY_DEPTH_EXCEEDED");
   if(!fs.existsSync(dir))return;
   for(const entry of fs.readdirSync(dir,{withFileTypes:true})){
    const full=path.join(dir,entry.name);
    if(entry.isSymbolicLink())throw Error("UNSAFE_RESEARCH_SYMLINK");
    entries++;
    if(entries>100000)throw Error("RESEARCH_DIRECTORY_ENTRY_LIMIT");
    if(entry.isDirectory())walk(full,depth+1);
    else if(entry.isFile())used+=fs.statSync(full).size;
   }
  }
  walk(root,0);
  const stat=fs.statfsSync(diskMount),free=Number(stat.bavail)*Number(stat.bsize);
  if(!Number.isFinite(free))return {ok:false,reason:"FREE_SPACE_UNVERIFIED"};
  return {ok:used<maxRootBytes&&free>=minFreeBytes,
   reason:used>=maxRootBytes?"RESEARCH_ROOT_BUDGET_EXCEEDED":
    free<minFreeBytes?"PERSISTENT_DISK_LOW_FREE_SPACE":null,
   rootBytes:used,freeBytes:free,maxRootBytes,minFreeBytes};
 }catch(e){return {ok:false,reason:"STORAGE_PREFLIGHT_FAILED",errorClass:e?.message??"UNKNOWN"}}
}
