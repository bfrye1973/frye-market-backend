// Engine27 read-only interpretation of canonical Engine1 ES institutional/negotiated source.
// Uses exact same file as /api/v1/es-smz-levels. No manual zone creation or inferred prices.
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
const __dirname=path.dirname(fileURLToPath(import.meta.url));
export const ES_SMZ_FILE=path.resolve(__dirname,"../../data/es-smz-manual-structures.json");
const finite=n=>typeof n==="number"&&Number.isFinite(n);
export function readEngine27EsInstitutionalContextV1({filePath=ES_SMZ_FILE}={}){
 const base={schema:"engine27.esInstitutionalContext.v1",symbol:"ES",mode:"READ_ONLY",
 available:false,institutionalParents:[],negotiatedZones:[],reasonCodes:[],
 noPermissionCreated:true,noExecution:true,noJournalWrite:true};
 let json;
 try{json=JSON.parse(fs.readFileSync(filePath,"utf8"));}
 catch{return {...base,reasonCodes:["ENGINE1_ES_SMZ_SOURCE_UNAVAILABLE"]};}
 if(!Array.isArray(json?.structures))return {...base,reasonCodes:["ENGINE1_ES_SMZ_INVALID_FORMAT"]};
 const parents=[],negotiated=[];
 for(const s of json.structures){
  const range=s?.displayPriceRange??s?.priceRange??s?.manualRange;
  if(!Array.isArray(range)||range.length!==2)continue;
  const a=Number(range[0]),b=Number(range[1]);
  if(!finite(a)||!finite(b)||a===b)continue;
  const id=typeof s?.structureKey==="string"?s.structureKey:null;
  const isNegotiated=s?.isNegotiated===true||String(id??"").includes("|NEG|")||
   String(s?.notes??"").toUpperCase().includes("NEGOTIATED");
  const item={id,upper:Math.max(a,b),lower:Math.min(a,b),midline:(a+b)/2,
   source:"ENGINE1_ES_MANUAL_SMZ",status:s?.status??"active",
   role:isNegotiated?"NEGOTIATED":"INSTITUTIONAL_PARENT"};
  (isNegotiated?negotiated:parents).push(item);
 }
 return {...base,available:true,institutionalParents:parents,negotiatedZones:negotiated,
  reasonCodes:parents.length+negotiated.length?[]:["ENGINE1_ES_SMZ_NO_VALID_STRUCTURES"]};
}
