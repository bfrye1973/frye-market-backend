// Read-only bounded Engine12 replay scanner. No writes, no historical engine reruns.
import fs from "node:fs";
import path from "node:path";
import {extractReplayResearchSeed} from "./extractReplayResearchSeed.js";
export function readCanonicalReplayWindow({root="/var/data/replay/es",date,contractBySnapshot=null,maxFiles=500}={}){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date??"")||!Number.isInteger(maxFiles)||maxFiles<1||maxFiles>500)
  return {ok:false,reason:"INVALID_READ_WINDOW"};
 const day=path.join(root,date);
 if(!fs.existsSync(day))return {ok:false,reason:"REPLAY_DATE_NOT_FOUND",date};
 const names=fs.readdirSync(day).filter(n=>/^\d{4}\.json$/.test(n)).sort().slice(0,maxFiles);
 const seeds=[],rejected=[];
 for(const name of names){
  const file=path.join(day,name);
  try{
   const replay=JSON.parse(fs.readFileSync(file,"utf8"));
   // Exact contract identity must be independently verified. Never infer it from ES root.
   const exactContract=typeof contractBySnapshot==="function"?contractBySnapshot(replay,file):null;
   const seed=extractReplayResearchSeed(replay,{resolvedContract:exactContract,sourcePath:file});
   if(seed.available===false)rejected.push({file:name,reasons:seed.reasons});
   else seeds.push(seed);
  }catch{rejected.push({file:name,reasons:["REPLAY_READ_OR_PARSE_FAILED"]})}
 }
 return {schema:"engine27.v3.replayResearchScan.v1",ok:true,date,scanned:names.length,
  seeds,rejected,readOnly:true,historicalEnginesRerun:false,
  historicalForecastsGenerated:false,noExecution:true};
}
