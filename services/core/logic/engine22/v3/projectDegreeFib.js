// Engine22 V3 — pure Fibonacci projection from the approved canonical degree.
// Never hardcode price anchors or infer missing endpoints.
import {validateEngine22V3Canonical,ENGINE22_V3_DEGREES} from "./canonicalStructure.js";
const RATIOS=Object.freeze([["e1000",1],["e1272",1.272],["e1382",1.382],["e1500",1.5],["e1618",1.618],["e2000",2]]);
const okAnchor=a=>a && typeof a.price==="number" && Number.isFinite(a.price) &&
 a.price>0 && typeof a.time==="string" && a.time.trim() &&
 !["UNKNOWN","INVALIDATED","RECOUNT_REQUIRED"].includes(a.status);
const roundTick=(value,tick)=>Math.round(value/tick)*tick;
export function projectEngine22V3DegreeFib({canonical=null,degree=null,tickSize=0.25}={}){
 const v=validateEngine22V3Canonical(canonical);
 if(!v.ok)return {available:false,reasonCodes:["CANONICAL_INVALID",...v.errors],levels:[]};
 if(!ENGINE22_V3_DEGREES.includes(degree))return {available:false,reasonCodes:["UNKNOWN_DEGREE"],levels:[]};
 if(!Number.isFinite(tickSize)||tickSize<=0)return {available:false,reasonCodes:["INVALID_TICK_SIZE"],levels:[]};
 const state=canonical.degrees[degree], marks=state.anchors;
 const w1Low=marks.W1_LOW,w1High=marks.W1_HIGH,w2Low=marks.W2_LOW;
 if(![w1Low,w1High,w2Low].every(okAnchor))return {
  available:false,reasonCodes:["W1_W2_ANCHORS_INCOMPLETE"],levels:[],
  sourceCountId:state.countId,degree,
 };
 const range=w1High.price-w1Low.price;
 if(range<=0||w2Low.price>w1High.price)return {
  available:false,reasonCodes:["INCONSISTENT_BULLISH_ANCHORS"],levels:[],
  sourceCountId:state.countId,degree,
 };
 return {
  available:true,degree,sourceCountId:state.countId,sequenceId:state.sequenceId,
  sourceAnchorTimes:{w1Low:w1Low.time,w1High:w1High.time,w2Low:w2Low.time},
  wave1Length:range,projectionBase:w2Low.price,
  provisional:[w1Low,w1High,w2Low].some(a=>!["CONFIRMED","LOCKED"].includes(a.status)),
  levels:RATIOS.map(([key,ratio])=>({
   key,ratio,price:Number(roundTick(w2Low.price+range*ratio,tickSize).toFixed(8)),status:"WATCH"
  })),
  noPermissionCreated:true,noExecution:true
 };
}
