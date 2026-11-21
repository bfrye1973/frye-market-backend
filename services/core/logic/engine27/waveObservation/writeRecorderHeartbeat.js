// Engine27 V6 durable worker heartbeat, no broker data, prices or secrets.
import fs from "node:fs";
import path from "node:path";
export function writeRecorderHeartbeat({root,status,cycleCount=0,lastErrorCode=null}={}){
 if(typeof root!=="string"||!root||!["STARTING","RUNNING","IDLE","STOPPING","STOPPED","FAILED"].includes(status))
  return {ok:false,reason:"INVALID_RECORDER_HEARTBEAT"};
 const file=path.join(root,"worker-status.json");
 const record={schema:"engine27.v6.recorderStatus.v1",status,updatedAt:new Date().toISOString(),
  pid:process.pid,cycleCount,lastErrorCode:lastErrorCode?String(lastErrorCode).slice(0,80):null};
 fs.mkdirSync(root,{recursive:true});
 const tmp=file+"."+process.pid+".tmp";
 const fd=fs.openSync(tmp,"w",0o600);
 try{fs.writeFileSync(fd,JSON.stringify(record)+"\n");fs.fsyncSync(fd)}
 finally{fs.closeSync(fd)}
 fs.renameSync(tmp,file);
 const dir=fs.openSync(root,"r");try{fs.fsyncSync(dir)}finally{fs.closeSync(dir)}
 return {ok:true};
}
