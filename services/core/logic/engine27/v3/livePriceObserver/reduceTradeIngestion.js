// Pure read-only Micro trade ingestion. No timeouts, IO, journal writes, or order authority.
import {observeLiveEs} from "./observeLiveEs.js";
const MAX_IDS=256;
const iso=s=>typeof s==="string"&&Number.isFinite(Date.parse(s));
export const initialTradeIngestion=()=>({
 schema:"engine27.v3.tradeIngestionState.v1",status:"DISCONNECTED",
 contract:null,lastTradeAt:null,lastReceivedAt:null,previousObservation:null,
 lastManagerOutput:null,recentEventIds:[],priorTradeWatermark:null,gapCount:0,accepted:0,rejected:0,
 reasonCodes:["SOURCE_NOT_CONNECTED"],mode:"READ_ONLY_SHADOW"
});
export function reduceTradeIngestion(state=initialTradeIngestion(),action={}){
 const prev=state;
 if(action.type==="DISCONNECTED"||action.type==="RECONNECTING"||action.type==="STALE"){
  return {...prev,status:action.type,lastReceivedAt:null,previousObservation:null,
   lastManagerOutput:null,gapCount:prev.gapCount+1,reasonCodes:[action.reasonCode??(action.type==="STALE"?"SOURCE_STALE":"SOURCE_GAP")],
   // Deliberately DO NOT retain a current price across feed gaps.
   lastTradeAt:null};
 }
 if(action.type==="CONNECTED"){
  const contract=action.contract;
  if(typeof contract!=="string"||!/^ES[FGHJKMNQUVXZ][0-9]{1,2}$/.test(contract))
    return {...prev,status:"UNAVAILABLE",reasonCodes:["CONTRACT_IDENTITY_UNVERIFIED"]};
  return {...initialTradeIngestion(),status:"CONNECTED",contract,gapCount:prev.gapCount,
   // Preserve dedup/watermark across reconnect for the SAME futures contract.
   recentEventIds:prev.contract===contract?prev.recentEventIds:[],
   priorTradeWatermark:prev.contract===contract?prev.priorTradeWatermark:null,
   accepted:prev.accepted,rejected:prev.rejected,reasonCodes:[]};
 }
 if(action.type!=="TRADE")return prev;
 const event=action.event,at=action.receivedAt;
 if(prev.status!=="CONNECTED"&&prev.status!=="LIVE")return {...prev,rejected:prev.rejected+1,reasonCodes:["STREAM_NOT_CONNECTED"]};
 if(!iso(at)||event?.source!=="POLYGON_DIRECT_ES_TRADE"||event?.type!=="trade"||
    event?.resolvedSymbol!==prev.contract)return {...prev,rejected:prev.rejected+1,reasonCodes:["TRADE_SOURCE_OR_CONTRACT_MISMATCH"]};
 // Without a provider event sequence, identical legitimate fills may exist.
 // In that case never pretend that price/size/time is a unique trade identity.
 const id=event.eventId==null?null:String(event.eventId);
 const identity=id?prev.contract+":"+id:null;
 if(identity&&prev.recentEventIds.includes(identity))
   return {...prev,rejected:prev.rejected+1,reasonCodes:["DUPLICATE_PROVIDER_TRADE_ID"]};
 if((prev.lastTradeAt&&Date.parse(event.tradeTime)<Date.parse(prev.lastTradeAt))||
    (prev.priorTradeWatermark&&Date.parse(event.tradeTime)<Date.parse(prev.priorTradeWatermark)))
   return {...prev,rejected:prev.rejected+1,reasonCodes:["OUT_OF_ORDER_TRADE"]};
 if(prev.lastReceivedAt&&Date.parse(at)-Date.parse(prev.lastReceivedAt)>30000){
  return {...prev,status:"STALE",gapCount:prev.gapCount+1,previousObservation:null,lastManagerOutput:null,
   lastTradeAt:null,lastReceivedAt:null,rejected:prev.rejected+1,
   reasonCodes:["UNOBSERVED_TRADE_GAP_REQUIRES_RESET"]};
 }
 const observation=observeLiveEs({previous:prev.previousObservation,event,owner:action.owner,
   observedAt:at,expectedContract:prev.contract});
 if(observation.available!==true)return {...prev,rejected:prev.rejected+1,reasonCodes:observation.reasonCodes};
 const ids=identity?[...prev.recentEventIds,identity].slice(-MAX_IDS):prev.recentEventIds;
 return {...prev,status:"LIVE",previousObservation:observation,lastTradeAt:event.tradeTime,
   lastReceivedAt:at,recentEventIds:ids,priorTradeWatermark:event.tradeTime,accepted:prev.accepted+1,
   lastManagerOutput:action.managerOutput??null,reasonCodes:id?[]:["PROVIDER_SEQUENCE_UNAVAILABLE_NO_ID_DEDUP"]};
}
