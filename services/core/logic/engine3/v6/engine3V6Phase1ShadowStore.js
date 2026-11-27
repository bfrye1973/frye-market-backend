// Isolated shadow-only persistence. NEVER shares/writes Engine3 v5 state files.
// Consumers must never use this record for Engine4, Engine6 or execution.
import fs from "node:fs";
import path from "node:path";
const defaultFile=()=>process.env.ENGINE3_V6_SHADOW_STATE_FILE||
  "/var/data/replay/engine3/engine3-v6-phase1-shadow-es.json";
const neutral=()=>({schema:"engine3.v6.phase1.shadow.v1",mode:"SHADOW_READ_ONLY",
  canonicalDirection:"NEUTRAL",candidateId:null,zoneId:null,reactionAnchor:null,
  establishedAtMs:null,lastEvaluatedAtMs:null,convictionState:"NEUTRAL"});
function valid(state){
 return state?.schema==="engine3.v6.phase1.shadow.v1"&&
 state?.mode==="SHADOW_READ_ONLY"&&
 ["LONG","SHORT","NEUTRAL"].includes(state?.canonicalDirection)&&
 (state?.candidateId===null||typeof state?.candidateId==="string")&&
 (state?.lastEvaluatedAtMs===null||
   (typeof state?.lastEvaluatedAtMs==="number"&&Number.isFinite(state.lastEvaluatedAtMs)));
}
export function loadEngine3V6Phase1ShadowState({filePath=defaultFile()}={}){
 try{
  if(!fs.existsSync(filePath))return {ok:true,found:false,state:neutral(),reasonCode:"NO_SHADOW_STATE"};
  const p=JSON.parse(fs.readFileSync(filePath,"utf8"));
  if(!valid(p?.state))return {ok:false,found:false,state:neutral(),reasonCode:"INVALID_SHADOW_STATE"};
  return {ok:true,found:true,state:p.state,reasonCode:"SHADOW_STATE_LOADED"};
 }catch{
  return {ok:false,found:false,state:neutral(),reasonCode:"SHADOW_STATE_READ_FAILED"};
 }
}
export function saveEngine3V6Phase1ShadowState({state,filePath=defaultFile()}={}){
 if(!valid(state)||state?.authoritativeDownstream===true||state?.noPermissionCreated!==true)
   return {saved:false,reasonCode:"SHADOW_STATE_NOT_SAFE"};
 try{
  const previous=loadEngine3V6Phase1ShadowState({filePath});
  if(previous.found&&Number.isFinite(previous.state.lastEvaluatedAtMs)&&
     (!Number.isFinite(state.lastEvaluatedAtMs)||
      state.lastEvaluatedAtMs<=previous.state.lastEvaluatedAtMs))
    return {saved:false,reasonCode:"SHADOW_STATE_NONMONOTONIC"};
  fs.mkdirSync(path.dirname(filePath),{recursive:true});
  const tmp=filePath+"."+process.pid+".tmp";
  try{
   fs.writeFileSync(tmp,JSON.stringify({state}),{encoding:"utf8",flag:"wx"});
   fs.renameSync(tmp,filePath);
  }finally{if(fs.existsSync(tmp))fs.unlinkSync(tmp);}
  return {saved:true,reasonCode:"SHADOW_STATE_SAVED"};
 }catch{
  return {saved:false,reasonCode:"SHADOW_STATE_WRITE_FAILED"};
 }
}
