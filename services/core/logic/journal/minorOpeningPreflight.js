// Engine 10 — read-only exactly-once eligibility for the verified MINOR fill.
// The canonical ingestRealBrokerFill path must perform the actual duplicate check again.
import {classifyRealCampaignAtEntry} from "./realAccountClassification.js";
const norm=x=>String(x??"").trim();
export function preflightMinorOpening(trades=[],fill={}){
 const expected={brokerAccountLabel:"SCHWAB_5671",brokerTransactionId:"134209487262",fillTime:"2026-10-22T13:42:18Z",futuresContractCode:"MESZ26",positionEffect:"OPENING",direction:"LONG",side:"BUY",quantity:1,fillPrice:7730.25};
 for(const [key,value] of Object.entries(expected)){
  const actual=key==="fillPrice"||key==="quantity"?Number(fill[key]):norm(fill[key]);
  if(actual!==value)return {ok:false,action:"BLOCK",reason:"VERIFIED_FILL_MISMATCH",field:key};
 }
 const classification=classifyRealCampaignAtEntry({brokerAccountLabel:fill.brokerAccountLabel,entryTime:fill.fillTime});
 if(!classification.ok||classification.classification!=="MINOR")return {ok:false,action:"BLOCK",reason:"INVALID_MINOR_CLASSIFICATION"};
 const matches=trades.filter(t=>t.accountMode==="REAL"&&(t.events||[]).some(e=>norm(e.brokerTransactionId)===expected.brokerTransactionId));
 if(matches.length)return {ok:true,action:"ALREADY_RECORDED",matchedTradeIds:matches.map(t=>t.tradeId)};
 return {ok:true,action:"ELIGIBLE_FOR_CANONICAL_INGESTION",performanceGroup:"MINOR",readOnly:true};
}
