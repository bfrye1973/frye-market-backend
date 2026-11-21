// Engine27 V6 original-byte Replay adapter. Read-only. Do not reconstruct bytes from HTTP JSON.
import fs from "node:fs";
import path from "node:path";
const DATE=/^\d{4}-\d{2}-\d{2}$/;
const TIME=/^([01]\d|2[0-3])[0-5]\d$/;
export function createOriginalReplayFileReader({replayRoot="/var/data/replay/es",maxBytes=8*1024*1024}={}){
 const base=path.resolve(replayRoot);
 if(!Number.isInteger(maxBytes)||maxBytes<=0||maxBytes>32*1024*1024)throw Error("INVALID_REPLAY_BYTE_LIMIT");
 return async item=>{
  if(!DATE.test(item?.date??"")||!TIME.test(item?.time??"")||
    item?.sourceReplayPath!=="/var/data/replay/es/"+item.date+"/"+item.time+".json"||
    item?.key!==item.date+"/"+item.time)
   throw Error("UNTRUSTED_REPLAY_PATH");
  const directory=path.join(base,item.date);
  const filename=path.join(directory,item.time+".json");
  // Reject symlinks at both directory and file; do not read outside archive root.
  if(!fs.statSync(base).isDirectory()||fs.lstatSync(directory).isSymbolicLink()||
    !fs.statSync(directory).isDirectory()||fs.lstatSync(filename).isSymbolicLink())
   throw Error("UNSAFE_REPLAY_FILE");
  const fd=fs.openSync(filename,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
  try{
   const stat=fs.fstatSync(fd);
   if(!stat.isFile()||stat.size<1||stat.size>maxBytes)throw Error("REPLAY_FILE_SIZE_UNSAFE");
   const bytes=Buffer.alloc(stat.size);
   let offset=0;
   while(offset<bytes.length){
    const n=fs.readSync(fd,bytes,offset,bytes.length-offset,offset);
    if(!n)throw Error("INCOMPLETE_REPLAY_FILE_READ");
    offset+=n;
   }
   if(fs.fstatSync(fd).size!==stat.size)throw Error("REPLAY_FILE_MUTATED_DURING_READ");
   return {bytes};
  }finally{fs.closeSync(fd);}
 };
}
