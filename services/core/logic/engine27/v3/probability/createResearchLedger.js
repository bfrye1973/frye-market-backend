// Local, Engine27-owned append-only research ledger. Never writes Engine12 Replay.
import fs from "node:fs";
import path from "node:path";
export function createResearchLedger({root="/var/data/replay/engine27/probability"}={}){
 const predictionFile=path.join(root,"predictions.ndjson");
 const outcomeFile=path.join(root,"outcomes.ndjson");
 const read=file=>fs.existsSync(file)?fs.readFileSync(file,"utf8").split("\n").filter(Boolean).map(x=>JSON.parse(x)):[];
 function append(file,entry,key){
  if(!entry||typeof entry[key]!=="string"||!entry[key])throw Error("INVALID_RESEARCH_RECORD");
  fs.mkdirSync(root,{recursive:true});
  if(read(file).some(x=>x[key]===entry[key]))return {stored:false,duplicate:true};
  // Serialize independent writer processes using an exclusive lock directory.
  // Fail closed on contention rather than risking duplicate or interleaved records.
  const lock=file+".lock";
  try{fs.mkdirSync(lock)}catch(e){
   if(e?.code==="EEXIST")throw Error("RESEARCH_LEDGER_WRITER_BUSY");
   throw e;
  }
  try{
   if(read(file).some(x=>x[key]===entry[key]))return {stored:false,duplicate:true};
   const fd=fs.openSync(file,"a");
   try{fs.writeSync(fd,JSON.stringify(entry)+"\\n");fs.fsyncSync(fd)}
   finally{fs.closeSync(fd)}
  }finally{fs.rmdirSync(lock)}

  return {stored:true,duplicate:false};
 }
 return Object.freeze({
  appendPrediction:entry=>{
   if(entry?.schema!=="engine27.v3.probabilityResearchSeed.v1"||entry?.noExecution!==true)throw Error("INVALID_PREDICTION");
   return append(predictionFile,entry,"id");
  },
  appendOutcome:entry=>{
   if(entry?.schema!=="engine27.v3.probabilityOutcome.v1"||entry?.available!==true)throw Error("INVALID_OUTCOME");
   const predictions=read(predictionFile);
   if(!predictions.some(x=>x.id===entry.predictionId))throw Error("UNKNOWN_PREDICTION");
   const key=entry.predictionId+"|"+entry.horizonMinutes;
   fs.mkdirSync(root,{recursive:true});
   if(read(outcomeFile).some(x=>x.predictionId+"|"+x.horizonMinutes===key))return {stored:false,duplicate:true};
   fs.appendFileSync(outcomeFile,JSON.stringify(entry)+"\n",{encoding:"utf8",flag:"a"});
   return {stored:true,duplicate:false};
  },
  readPredictions:()=>read(predictionFile),readOutcomes:()=>read(outcomeFile)
 });
}
