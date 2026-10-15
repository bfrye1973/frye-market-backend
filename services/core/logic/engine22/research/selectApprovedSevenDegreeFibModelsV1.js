// Engine22: derive only explicitly approved, source-qualified active Fibonacci
// models from existing canonical degree publications. Never fill missing model
// identity/contract/basis from a legacy fallback or a current ES quote.
import {FIB_TOUCH_DEGREES_V1} from "./reduceFibTouchesV1.js";
const text=x=>typeof x==="string"&&x.trim()?x.trim():null;
const number=x=>typeof x==="number"&&Number.isFinite(x)&&x>0?x:null;
export function selectApprovedSevenDegreeFibModelsV1({degreeStates={},resolvedContract=null,priceBasis=null}={}){
 const models={},reasons={},missingFieldsByDegree={};
 for(const degree of FIB_TOUCH_DEGREES_V1){
  const state=degreeStates?.[degree];
  const fib=state?.activeFibModel;
  const approval=fib?.approved===true && fib?.active===true &&
    fib?.provisional!==true && fib?.watchOnly!==true;
  const countId=text(fib?.sourceCountId)||text(state?.sourceCountId);
  const modelKey=text(fib?.modelKey),seriesId=text(fib?.seriesId);
  const basis=text(fib?.priceBasis),originAt=text(fib?.modelOriginTime);
  const direction=text(fib?.direction);
  const raw=fib?.levels;
  const levels=Array.isArray(raw)?raw:
    raw&&typeof raw==="object"?Object.entries(raw).map(([key,price])=>({key,label:key,price})):[];
  const normalized=levels.map(x=>({key:text(x.key),label:text(x.label)||text(x.key),price:number(x.price)}))
   .filter(x=>x.key&&x.price!==null);
  const missing=[
    ...(!approval?["explicitApproval"]:[]),
    ...(!countId?["countId"]:[]),
    ...(!modelKey?["modelKey"]:[]),
    ...(!seriesId?["seriesId"]:[]),
    ...(!basis?["priceBasis"]:[]),
    ...(!originAt?["modelOriginTime"]:[]),
    ...(!["UP","DOWN"].includes(direction)?["direction"]:[]),
    ...(!normalized.length?["levels"]:[]),
    ...(seriesId&&resolvedContract&&seriesId!==resolvedContract?["sourceContractMismatch"]:[]),
    ...(basis&&priceBasis&&basis!==priceBasis?["sourcePriceBasisMismatch"]:[]),
    ...(!resolvedContract?["resolvedContract"]:[]),
    ...(!priceBasis?["verifiedCandlePriceBasis"]:[]),
  ];
  if(missing.length){
   missingFieldsByDegree[degree]=missing;
   reasons[degree]=!approval?"MODEL_NOT_APPROVED":
     "MODEL_IDENTITY_OR_SOURCE_INCOMPATIBLE";
   continue;
  }
  models[degree]={approved:true,provisional:false,activeWave:state.activeWave,
   countId,modelKey,seriesId,priceBasis:basis,originAt,direction,levels:normalized};
 }
 return {models,reasons,missingFieldsByDegree,degreeOrder:[...FIB_TOUCH_DEGREES_V1]};
}
