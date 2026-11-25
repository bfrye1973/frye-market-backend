// Engine22 V3: structural cross-degree maturity evidence. No predictions,
// execution permission, or mutation of parent counts. Read-only observation.
import {ENGINE22_V3_DEGREES,ENGINE22_V3_PARENT,validateEngine22V3Canonical} from "./canonicalStructure.js";
const mat=s=>["COMPLETION_CANDIDATE","CONFIRMED"].includes(s);
export function buildEngine22V3CrossDegreeWatch({canonical=null}={}){
  const check=validateEngine22V3Canonical(canonical);
  if(!check.ok)return {available:false,reasonCodes:check.errors,alerts:[]};
  const alerts=[];
  for(const degree of ENGINE22_V3_DEGREES){
    const parentDegree=ENGINE22_V3_PARENT[degree];
    if(!parentDegree)continue;
    const child=canonical.degrees[degree],parent=canonical.degrees[parentDegree];
    if(!mat(child.lifecycle)||!["W3","W5"].includes(parent.activeWave))continue;
    alerts.push({
      kind:"PARENT_WAVE_MATURITY_REVIEW",
      degree:parentDegree,
      sourceDegree:degree,
      sourceCountId:child.countId,
      parentCountId:parent.countId,
      sourceLifecycle:child.lifecycle,
      parentActiveWave:parent.activeWave,
      confidence:"UNSCORED",
      status:"WATCH_ONLY",
      reasonCodes:["CHILD_COMPLETION_EVIDENCE","PARENT_WAVE_REVIEW_NOT_CONFIRMATION"],
      requiresParentStructuralConfirmation:true,
      noPermissionCreated:true,noExecution:true,
    });
  }
  return {available:true,alerts,noPermissionCreated:true,noExecution:true};
}
