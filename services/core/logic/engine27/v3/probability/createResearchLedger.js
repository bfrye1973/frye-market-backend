// Engine27-only append-only research prototype; never writes Engine12 Replay.
// Exclusive writer lock + fsync. A stale lock fails closed pending operator recovery.
import fs from "node:fs";
import path from "node:path";
export function createResearchLedger({root="/var/data/replay/engine27/probability"}={}){
 const predictionFile=path.join(root,"predictions.ndjson");
 const outcomeFile=path.join(root,"outcomes.ndjson");
 const read=file=>fs.existsSync(file)?fs.readFileSync(file,"utf8").split("\n").filter(Boolean).map(x=>JSON.parse(x)):[];
 function append(file,entry,identity){
  fs.mkdirSync(root,{recursive:true});
  const lock=file+".lock";
  try{fs.mkdirSync(lock)}catch(e){
   if(e?.code==="EEXIST")throw Error("RESEARCH_LEDGER_WRITER_BUSY");
   throw e;
  }
  try{
   const key=identity(entry);
   if(read(file).some(x=>identity(x)===key))return {stored:false,duplicate:true};
   const fd=fs.openSync(file,"a");
   try{fs.writeSync(fd,JSON.stringify(entry)+"\n");fs.fsyncSync(fd)}
   finally{fs.closeSync(fd)}
   return {stored:true,duplicate:false};
  }finally{fs.rmdirSync(lock)}
 }
 return Object.freeze({
  appendPrediction:entry=>{
   if(entry?.schema!=="engine27.v3.probabilityResearchSeed.v1"||
      entry?.noExecution!==true||typeof entry.id!=="string"||!entry.id)throw Error("INVALID_PREDICTION");
   return append(predictionFile,entry,x=>x.id);
  },
  appendOutcome:entry=>{
   if(entry?.schema!=="engine27.v3.probabilityOutcome.v1"||entry?.available!==true||
      typeof entry.predictionId!=="string"||!Number.isInteger(entry.horizonMinutes))
    throw Error("INVALID_OUTCOME");
   if(!read(predictionFile).some(x=>x.id===entry.predictionId))throw Error("UNKNOWN_PREDICTION");
   return append(outcomeFile,entry,x=>x.predictionId+"|"+x.horizonMinutes);
  },
  readPredictions:()=>read(predictionFile),readOutcomes:()=>read(outcomeFile)
 });
}
