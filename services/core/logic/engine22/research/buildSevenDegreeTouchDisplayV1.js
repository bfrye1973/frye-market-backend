// Engine22-owned seven-degree consumer packet. Additive, fail-closed.
// Takes only qualified, persisted touch observations from Engine22; never
// calculates or approves geometry, waves, ES price basis or account permissions.
import {FIB_TOUCH_DEGREES_V1} from "./reduceFibTouchesV1.js";

const str=v=>typeof v==="string"&&v.trim()?v.trim():null;
const num=v=>typeof v==="number"&&Number.isFinite(v)&&v>0?v:null;

export function buildSevenDegreeTouchDisplayV1({models={},touchSnapshot=null}={}){
 const degrees={};
 for(const degree of FIB_TOUCH_DEGREES_V1){
  const model=models?.[degree], read=touchSnapshot?.degrees?.[degree];
  const qualified=Boolean(model?.approved===true&&model?.provisional!==true&&
    str(model.countId)&&str(model.modelKey)&&str(model.seriesId)&&
    str(model.priceBasis)&&str(model.originAt)&&
    Array.isArray(model.levels));
  const levels=(Array.isArray(model?.levels)?model.levels:[]).map((level,index)=>{
   const original=read?.levels?.[index]?.touchResearch;
   const same=read?.levels?.[index]?.key===level.key &&
     read?.levels?.[index]?.price===level.price;
   const verified=qualified&&same&&original?.status==="TOUCHED"&&
     original?.persisted===true&&str(original.firstTouchedBarId)&&
     str(original.firstTouchedAt)&&num(level.price);
   return {key:str(level.key),label:str(level.label)||str(level.key),
     price:num(level.price),status:verified?"TOUCHED":"WATCH",
     firstTouchedAt:verified?original.firstTouchedAt:null,
     touchEvidence:verified?{sourceBarId:original.firstTouchedBarId,
       sourceTimestamp:original.firstTouchedAt,seriesId:model.seriesId,
       priceBasis:model.priceBasis,verified:true}:null,
     reasonCodes:verified?[]:[qualified?"TOUCH_NOT_PERSISTED_OR_UNVERIFIED":"MODEL_NOT_APPROVED"]};
  });
  degrees[degree]={available:qualified,activeWave:str(model?.activeWave),
   sourceCountId:str(model?.countId),modelKey:str(model?.modelKey),
   seriesId:str(model?.seriesId),priceBasis:str(model?.priceBasis),
   provisional:model?.provisional===true,levels,
   reasonCodes:qualified?[]:["MODEL_NOT_APPROVED_OR_IDENTITY_MISSING"]};
 }
 return {schema:"engine22.sevenDegreeTouchDisplay.v1",
   degreeOrder:[...FIB_TOUCH_DEGREES_V1],degrees,noExecution:true};
}
