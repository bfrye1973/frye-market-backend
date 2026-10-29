// Engine27 V6: immutable, source-qualified supplemental 10m wave evidence.
// Distinct from structural event journal, so market context never creates false wave events.
import fs from "node:fs";
import path from "node:path";
import {createHash} from "node:crypto";
const sha=x=>createHash("sha256").update(x).digest("hex");
export function createWaveEvidenceArchive({root="/var/data/replay/engine27/wave-observations",maxRecordBytes=262144,maxArchiveBytes=512*1024*1024}={}){
 const dir=path.join(root,"candle-evidence");
 if(!Number.isInteger(maxArchiveBytes)||maxArchiveBytes<1||maxArchiveBytes>2*1024*1024*1024)
  throw Error("INVALID_EVIDENCE_ARCHIVE_BUDGET");
 function append(evidence){
  if(evidence?.ok!==true||!evidence.sourceReplay?.sha256||
    !/^[a-f0-9]{64}$/.test(evidence.sourceReplay.sha256)||
    !/^(micro|submicro|subminute|minute|minor|intermediate|primary)$/.test(evidence.degree??""))
   return {ok:false,reason:"UNVERIFIED_WAVE_EVIDENCE"};
  const primary=evidence.wickDetection;
  if(["micro","submicro"].includes(evidence.degree)&&
    (primary?.primary!=="10m"||primary.primaryAvailable!==true||
     evidence.candleStudies?.["10m"]?.available!==true))
   return {ok:false,reason:"COMPLETED_10M_PRIMARY_REQUIRED"};
  const record={schema:"engine27.v6.waveCandleEvidence.v1",degree:evidence.degree,
   sourceReplay:evidence.sourceReplay,sourceSnapshotTime:evidence.sourceSnapshotTime,
   wave:evidence.wave,wickDetection:primary,candleStudies:evidence.candleStudies,
   negotiatedZone:evidence.negotiatedZone,missingEvidence:evidence.missingEvidence,
   physicalReplayContract:null,completionConfirmed:false,noExecution:true,noWaveAuthority:true};
  const body=Buffer.from(JSON.stringify(record)+"\n");
  if(body.length>maxRecordBytes)return {ok:false,reason:"EVIDENCE_RECORD_TOO_LARGE"};
  const key=sha(JSON.stringify({degree:record.degree,source:record.sourceReplay.sha256,
   model:record.wave.modelVersion,primaryClose:primary?.primaryCandle?.candleClosedAt??null}));
  const file=path.join(dir,key+".json");fs.mkdirSync(dir,{recursive:true});
  const currentBytes=fs.readdirSync(dir).filter(name=>/^[a-f0-9]{64}\\.json$/.test(name))
   .reduce((sum,name)=>sum+fs.statSync(path.join(dir,name)).size,0);
  if(!fs.existsSync(file)&&currentBytes+body.length>maxArchiveBytes)
   return {ok:false,reason:"EVIDENCE_ARCHIVE_STORAGE_BUDGET_EXCEEDED",currentBytes,maxArchiveBytes};
  const tmp=file+"."+process.pid+".pending";let fd;
  try{
   fd=fs.openSync(tmp,"wx");fs.writeFileSync(fd,body);fs.fsyncSync(fd);fs.closeSync(fd);fd=null;
   try{fs.linkSync(tmp,file)}catch(e){if(e?.code!=="EEXIST")throw e}
   const existing=fs.readFileSync(file);
   if(!existing.equals(body))return {ok:false,reason:"EVIDENCE_IMMUTABILITY_CONFLICT"};
   const d=fs.openSync(dir,"r");try{fs.fsyncSync(d)}finally{fs.closeSync(d)}
   return {ok:true,key,stored:true,path:file};
  }finally{if(fd!=null)fs.closeSync(fd);try{fs.unlinkSync(tmp)}catch(e){if(e?.code!=="ENOENT")throw e}}
 }
 return Object.freeze({append,storagePath:dir});
}
