// Seven-degree Engine22 read-only snapshot touch overlay preview.
// Isolated research adapter: no mutation, persistence, trading permission, or runtime import.
import { replayFibTouchHistoryV1 } from "./replayFibTouchHistoryV1.js";
import { FIB_TOUCH_DEGREES_V1 } from "./reduceFibTouchesV1.js";

export function previewSevenDegreeTouchSnapshotV1({degreeModels={},observationsByDegree={}}={}){
 const degrees={};
 for(const degree of FIB_TOUCH_DEGREES_V1){
   const source=degreeModels?.[degree];
   const levels=Array.isArray(source?.levels)?source.levels:[];
   const obs=observationsByDegree?.[degree];
   degrees[degree]={
     available:Boolean(source),
     activeWave:source?.activeWave??null,
     levels:levels.map(level=>{
       const touch=replayFibTouchHistoryV1({
         level:{...level,degree,countId:source.countId??level.countId,
           modelKey:source.modelKey??level.modelKey,
           seriesId:source.seriesId??level.seriesId,
           priceBasis:source.priceBasis??level.priceBasis,
           direction:source.direction??level.direction,
           originAt:source.originAt??level.originAt},
         observations:Array.isArray(obs)?obs:[],
       });
       return {...level,touchResearch:touch};
     }),
   };
 }
 return {schema:"engine22.touchSnapshotResearch.v1",shadowOnly:true,
   noExecution:true,sourcePromotionAuthorized:false,degrees};
}
