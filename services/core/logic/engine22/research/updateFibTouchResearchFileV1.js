// Research-only persistence adapter. No production wiring and no default disk path.
// Caller MUST explicitly supply path; this module never creates wave/Fib authority.
import fs from "node:fs";
import path from "node:path";
import { replayFibTouchHistoryV1 } from "./replayFibTouchHistoryV1.js";
const validPath = value => typeof value === "string" && path.isAbsolute(value) && value.length>2;
export function updateFibTouchResearchFileV1({filePath,level,observations=[]}={}) {
  if(!validPath(filePath)) return {ok:false,reason:"EXPLICIT_ABSOLUTE_RESEARCH_PATH_REQUIRED"};
  const same=(a,b)=>a&&b&&a.identity&&a.identity===b.identity;
  let old=null;
  if(fs.existsSync(filePath)){
    try {old=JSON.parse(fs.readFileSync(filePath,"utf8"));} catch {
      return {ok:false,reason:"EXISTING_STATE_INVALID_NO_OVERWRITE"};
    }
    if(old.schema!=="engine22.fibTouchResearchStore.v1")
      return {ok:false,reason:"EXISTING_STATE_SCHEMA_MISMATCH"};
  }
  const candidate=replayFibTouchHistoryV1({level,observations});
  if(!candidate.identity) return {ok:false,reason:"MODEL_IDENTITY_MISSING"};
  const previous=old?.states?.[candidate.identity];
  const preserved=same(previous,candidate)&&previous.status==="TOUCHED"
    ? {...previous,evaluatedBars:candidate.evaluatedBars}
    : candidate;
  const next={schema:"engine22.fibTouchResearchStore.v1",
    states:{...(old?.states||{}),[candidate.identity]:preserved}};
  fs.mkdirSync(path.dirname(filePath),{recursive:true});
  const tmp=filePath+".tmp";
  fs.writeFileSync(tmp,JSON.stringify(next));
  fs.renameSync(tmp,filePath);
  return {ok:true,result:preserved,recordCount:Object.keys(next.states).length};
}
