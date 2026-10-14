// Seven-degree Engine22 read-only snapshot touch overlay preview.
// Isolated research adapter: no mutation, persistence, trading permission, or runtime import.
import { replayFibTouchHistoryV1 } from "./replayFibTouchHistoryV1.js";
import { FIB_TOUCH_DEGREES_V1 } from "./reduceFibTouchesV1.js";

export function previewSevenDegreeTouchSnapshotV1({degreeModels={},observationsByDegree={},persistentResults=null}={}){
 const degrees={};
 for(const degree of FIB_TOUCH_DEGREES_V1){
   const source=degreeModels?.[degree];
   const levels=Array.isArray(source?.levels)?source.levels:[];
   const obs=observationsByDegree?.[degree];
   const durable=Array.isArray(persistentResults?.degrees?.[degree]) ? persistentResults.degrees[degree] : [];
   degrees[degree]={
     available:Boolean(source),
     activeWave:source?.activeWave??null,
     levels:levels.map((level,index)=>{
       const touch=replayFibTouchHistoryV1({
         level:{...level,degree,countId:source.countId??level.countId,
           modelKey:source.modelKey??level.modelKey,
           seriesId:source.seriesId??level.seriesId,
           priceBasis:source.priceBasis??level.priceBasis,
           direction:source.direction??level.direction,
           originAt:source.originAt??level.originAt},
         observations:Array.isArray(obs)?obs:[],
       });
       const persisted=durable[index]?.ok===true ? durable[index].result : null;
       const accepted=persisted?.identity===touch.identity && persisted?.status==="TOUCHED" &&
         typeof persisted.firstTouchedBarId==="string" && typeof persisted.firstTouchedAt==="string";
       return {...level,touchResearch:accepted ? {...touch,...persisted,persisted:true} : touch};
     }),
   };
 }
 return {schema:"engine22.touchSnapshotResearch.v1",shadowOnly:true,
   noExecution:true,sourcePromotionAuthorized:false,degrees};
}
