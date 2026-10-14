// Explicit opt-in research persistence only. No production storage defaults.
import path from "node:path";
import {updateFibTouchResearchFileV1} from "./updateFibTouchResearchFileV1.js";
import {FIB_TOUCH_DEGREES_V1} from "./reduceFibTouchesV1.js";
export function persistSevenDegreeTouchPreviewV1({rootPath=null,degreeModels={},observationsByDegree={}}={}) {
 const result={schema:"engine22.touchPersistenceResearch.v1",shadowOnly:true,degrees:{}};
 if(typeof rootPath!=="string"||!path.isAbsolute(rootPath)){
  return {...result,enabled:false,reason:"EXPLICIT_ABSOLUTE_RESEARCH_PATH_REQUIRED"};
 }
 for(const degree of FIB_TOUCH_DEGREES_V1){
  const model=degreeModels?.[degree];
  const levels=Array.isArray(model?.levels)?model.levels:[];
  result.degrees[degree]=levels.map(level=>{
   const observation=Array.isArray(observationsByDegree?.[degree])?observationsByDegree[degree]:[];
   const required={...level,degree,countId:model?.countId,modelKey:model?.modelKey,
     seriesId:model?.seriesId,priceBasis:model?.priceBasis,direction:model?.direction,
     originAt:model?.originAt};
   // One isolated per-degree store; model/count revisions are keyed inside.
   return updateFibTouchResearchFileV1({filePath:path.join(rootPath,degree+".json"),
     level:required,observations:observation});
  });
 }
 return {...result,enabled:true};
}
