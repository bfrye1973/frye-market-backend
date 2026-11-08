// Immutable evidence-missing disposition. Never claims a completed candle.
import fs from "node:fs";
import path from "node:path";
export function createMissingCandleDisposition({root}={}){
 const dir=path.join(root,"candle-evidence-dispositions");
 function append({sourceReplay,degree="micro",recordedAt}={}){
  if(!sourceReplay||!/^[a-f0-9]{64}$/.test(sourceReplay.sha256??"")||
   !["micro","submicro"].includes(degree)||!Number.isFinite(Date.parse(recordedAt??"")))
   return {ok:false,reason:"INVALID_MISSING_EVIDENCE_IDENTITY"};
  const body=JSON.stringify({schema:"engine27.v6.missingCandle.v1",sourceReplay,
   degree,status:"HISTORICAL_OHLC_UNAVAILABLE",timeframe:"10m",
   verified:false,bars:null,wickEvidenceVerified:false,
   fibCandleEvidenceVerified:false,completionCandleVerified:false,
   missingEvidence:["HISTORICAL_10M_OHLC_UNAVAILABLE"],recordedAt})+"\n";
  fs.mkdirSync(dir,{recursive:true});
  const file=path.join(dir,sourceReplay.sha256+"-"+degree+".json");
  const temp=file+"."+process.pid+".pending";
  let fd;
  try{
   fd=fs.openSync(temp,"wx");fs.writeFileSync(fd,body);fs.fsyncSync(fd);fs.closeSync(fd);fd=null;
   try{fs.linkSync(temp,file)}catch(e){if(e.code!=="EEXIST")throw e}
   const previous=JSON.parse(fs.readFileSync(file,"utf8"));
   if(previous.sourceReplay?.sha256!==sourceReplay.sha256||previous.degree!==degree||
     previous.status!=="HISTORICAL_OHLC_UNAVAILABLE")
    return {ok:false,reason:"IMMUTABLE_MISSING_EVIDENCE_CONFLICT"};
   const d=fs.openSync(dir,"r");try{fs.fsyncSync(d)}finally{fs.closeSync(d)}
   return {ok:true,disposition:previous.status};
  }finally{if(fd!=null)fs.closeSync(fd);try{fs.unlinkSync(temp)}catch(e){if(e.code!=="ENOENT")throw e}}
 }
 return {append};
}
