import {existsSync,readFileSync,realpathSync,statSync} from "node:fs";
import {resolve,sep} from "node:path";

// Fail closed if production is missing the owner-authorized persistent disk.
// /proc/self/mountinfo is read-only metadata; no Engine12 replay files are touched.
export function verifyEngine22HistoryMount({directory,mountPath="/var/data/replay",mountInfoPath="/proc/self/mountinfo"}={}){
 if(typeof directory!=="string"||!directory)return {ok:false,reason:"HISTORY_DIRECTORY_REQUIRED"};
 const mount=resolve(mountPath),target=resolve(directory);
 if(target===mount||!target.startsWith(mount+sep))
  return {ok:false,reason:"HISTORY_DIRECTORY_OUTSIDE_DEDICATED_SUBFOLDER"};
 if(!existsSync(mount))return {ok:false,reason:"PERSISTENT_MOUNT_MISSING"};
 let info;
 try{info=readFileSync(mountInfoPath,"utf8");}
 catch{return {ok:false,reason:"PERSISTENT_MOUNT_UNVERIFIED"};}
 const mounted=info.split("\n").some(line=>{
  const left=line.split(" - ")[0],fields=left?.split(" ");
  return fields?.length>4&&fields[4].replace(/\\040/g," ")===mount;
 });
 if(!mounted)return {ok:false,reason:"PERSISTENT_MOUNT_UNVERIFIED"};
 try{
  const actual=realpathSync(mount);
  if(!statSync(actual).isDirectory())return {ok:false,reason:"PERSISTENT_MOUNT_NOT_DIRECTORY"};
  if(existsSync(target)&&!realpathSync(target).startsWith(actual+sep))
   return {ok:false,reason:"HISTORY_DIRECTORY_SYMLINK_ESCAPE"};
 }catch{return {ok:false,reason:"PERSISTENT_MOUNT_UNVERIFIED"};}
 return {ok:true,mountPath:mount,directory:target};
}
