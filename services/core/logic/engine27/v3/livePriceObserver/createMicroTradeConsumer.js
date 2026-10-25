// In-memory consumer; caller supplies ONE shared stream and snapshots.
// It never opens a Polygon connection and never writes trades/orders/files.
// SSE transport, reconnection policy and production source access belong to a separately reviewed runner.
import {initialTradeIngestion,reduceTradeIngestion} from "./reduceTradeIngestion.js";
import {buildMicroIntelligenceV3} from "../manager/buildMicroIntelligenceV3.js";
export function createMicroTradeConsumer({readInputs,onObservation=()=>{}}={}){
 if(typeof readInputs!=="function"||typeof onObservation!=="function")
   throw new TypeError("READ_ONLY_SOURCE_CALLBACKS_REQUIRED");
 let state=initialTradeIngestion();
 return Object.freeze({
  getState:()=>structuredClone(state),
  connect:contract=>{state=reduceTradeIngestion(state,{type:"CONNECTED",contract});return state.status},
  disconnect:(reasonCode="SOURCE_DISCONNECTED")=>{state=reduceTradeIngestion(state,{type:"DISCONNECTED",reasonCode});return state.status},
  reconnect:()=>{state=reduceTradeIngestion(state,{type:"RECONNECTING",reasonCode:"SOURCE_RECONNECTING"});return state.status},
  stale:()=>{state=reduceTradeIngestion(state,{type:"STALE",reasonCode:"SOURCE_STALE"});return state.status},
  ingest:(event,receivedAt)=>{
   const source=readInputs();
   if(!source?.snapshot||typeof receivedAt!=="string")return {accepted:false,reasonCodes:["CANONICAL_INPUTS_MISSING"]};
   const owner=source.snapshot?.strategies?.["intraday_scalp@10m"]?.engine22WaveStrategy?.currentWavelength?.degrees?.micro?.ownerMicroCDown;
   // Reject/observe first; do not run Manager for duplicate, stale or invalid input.
   const previousObservation=state.previousObservation;
   const result=reduceTradeIngestion(state,{type:"TRADE",event,receivedAt,owner});
   const accepted=result.accepted>state.accepted;
   state=result;
   if(!accepted)return {accepted:false,reasonCodes:state.reasonCodes};
   const intelligence=buildMicroIntelligenceV3({...source,evaluatedAt:receivedAt,
     livePriceEvent:event,liveObservedAt:receivedAt,expectedEsContract:state.contract,
     previousLiveObservation:previousObservation});
   // Persist only bounded telemetry, not the huge six-module snapshots or private Journal.
   // The caller gets the result synchronously and may choose an approved storage policy.
   onObservation(intelligence);
   return {accepted:true,intelligence,reasonCodes:state.reasonCodes};
  }
 });
}
