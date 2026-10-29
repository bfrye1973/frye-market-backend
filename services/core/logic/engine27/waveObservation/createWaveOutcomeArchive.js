// Engine27 V6 durable future outcomes: separate append-only immutable research facts.
// Pending horizons may be re-evaluated without rewriting an original outcome.
import fs from "node:fs";
import path from "node:path";
import {createHash} from "node:crypto";
const sha=x=>createHash("sha256").update(x).digest("hex");
export function createWaveOutcomeArchive({root="/var/data/replay/engine27/wave-observations"}={}){
 const dir=path.join(root,"outcomes");
 function append({evidenceKey,study,recordedAt}={}){
  if(!/^[a-f0-9]{64}$/.test(evidenceKey??"")||study?.ok!==true||
    typeof recordedAt!=="string"||!Number.isFinite(Date.parse(recordedAt)))
   return {ok:false,reason:"INVALID_OUTCOME_PROVENANCE"};
  const horizonRecords=[];
  for(const [horizon,value] of Object.entries(study.horizons??{})){
   if(!["10m","30m","60m"].includes(horizon)||value?.status==="PENDING")continue;
   if(!["QUALIFIED_SAME_CONTRACT","CONTRACT_CONTINUITY_UNVERIFIED","OUTCOME_MISSING"].includes(value?.status))
    return {ok:false,reason:"INVALID_OUTCOME_STATUS"};
   horizonRecords.push({horizon,...value});
  }
  if(!horizonRecords.length)return {ok:true,stored:0,pending:true};
  fs.mkdirSync(dir,{recursive:true});
  let stored=0;
  for(const v of horizonRecords){
   // Missing remains eligible for future recovery; never freeze unavailable data as final.
   if(v.status==="OUTCOME_MISSING")continue;
   const record={schema:"engine27.v6.waveOutcome.v1",evidenceKey,
    eventClosedAt:study.eventClosedAt,eventPrice:study.eventPrice,
    horizon:v.horizon,result:v,recordedAt,
    noTradingAuthority:true,noWaveAuthority:true};
   const content=Buffer.from(JSON.stringify(record)+"\n");
   const key=sha(JSON.stringify({evidenceKey,horizon:v.horizon,targetAt:v.targetAt,observedAt:v.observedAt,
    status:v.status,close:v.observedClose}));
   const target=path.join(dir,key+".json"),pending=target+"."+process.pid+".pending";
   let fd;
   try{
    fd=fs.openSync(pending,"wx");fs.writeFileSync(fd,content);fs.fsyncSync(fd);fs.closeSync(fd);fd=null;
    try{fs.linkSync(pending,target)}catch(e){if(e?.code!=="EEXIST")throw e}
    if(!fs.readFileSync(target).equals(content))return {ok:false,reason:"OUTCOME_IMMUTABILITY_CONFLICT",stored};
    stored++;
   }finally{if(fd!=null)fs.closeSync(fd);try{fs.unlinkSync(pending)}catch(e){if(e?.code!=="ENOENT")throw e}}
  }
  const d=fs.openSync(dir,"r");try{fs.fsyncSync(d)}finally{fs.closeSync(d)}
  return {ok:true,stored};
 }
 return Object.freeze({append,storagePath:dir});
}
