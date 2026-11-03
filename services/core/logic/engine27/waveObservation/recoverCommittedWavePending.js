// Conservative journal crash-recovery audit. Never delete uncertain data.
// Only removes orphan temporary files when an identical committed target exists.
import fs from "node:fs";
import path from "node:path";
export function recoverCommittedWavePending({root}={}){
 if(typeof root!=="string"||!root)return {ok:false,reason:"INVALID_JOURNAL_ROOT"};
 const directory=path.join(root,"events");
 if(!fs.existsSync(directory))return {ok:true,recovered:0,blocked:0};
 let recovered=0,blocked=0;
 for(const name of fs.readdirSync(directory).filter(x=>x.endsWith(".pending"))){
  const pending=path.join(directory,name),target=pending.slice(0,-8);
  if(!/^\d{13}-[a-f0-9]{64}\.json\.pending$/.test(name)||
    !fs.existsSync(target)||fs.lstatSync(pending).isSymbolicLink()||
    fs.lstatSync(target).isSymbolicLink()){blocked++;continue;}
  const p=fs.readFileSync(pending),t=fs.readFileSync(target);
  if(!p.equals(t)){blocked++;continue;}
  const event=JSON.parse(t.toString("utf8"));
  if(!event?.eventId||!name.includes(event.eventId)){blocked++;continue;}
  fs.unlinkSync(pending);recovered++;
 }
 if(recovered){const fd=fs.openSync(directory,"r");try{fs.fsyncSync(fd)}finally{fs.closeSync(fd)}}
 return {ok:blocked===0,recovered,blocked,reason:blocked?"UNCERTAIN_PENDING_EVENT_REQUIRES_MANUAL_REVIEW":null};
}
