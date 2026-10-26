import { CONTRACT_VERSION,AUTHORITY } from '../contracts/priceActionFib.v1.js';
import { adaptEngine22Micro } from './adaptEngine22Micro.js';
export function evaluatePriceActionFib(input={}) {
 const result=adaptEngine22Micro(input);
 const base={schema:CONTRACT_VERSION,degree:'micro',mode:'READ_ONLY',authority:AUTHORITY,available:false,state:'UNAVAILABLE',workingWave:null,ownerModelIdentity:null,lastMeaningfulLevel:null,nextObjective:null,nextReferenceLevel:null,confirmation:'UNCONFIRMED',evidence:null,reasonCodes:result.reasonCodes,noPermissionCreated:true,noSizingCreated:true,noExecution:true,noJournalWrite:true};
 if(!result.available)return base;
 const {owner,candles,observationTime}=result;
 const from=Date.parse('2026-10-21T16:00:00Z');
 const eligibleCandles=candles.filter(c=>Date.parse(c.startTime)>=from);
 if(!eligibleCandles.length)return {...base,ownerModelIdentity:owner.modelIdentity,workingWave:{activeWave:owner.activeWave,direction:owner.direction,stage:owner.stage},reasonCodes:['POST_OWNER_CANDLE_EVIDENCE_UNAVAILABLE']};
 const touched=owner.levels.flatMap(l=>{const hit=eligibleCandles.find(c=>c.low<=l.price&&c.high>=l.price);return hit?[{key:l.key,price:l.price,observedAt:hit.endTime,source:'ES_COMPLETED_10M_OHLC',provisional:true}]:[]});
 const last=touched.length?touched[touched.length-1]:null;
 const close=eligibleCandles.at(-1).close;
 const reference=owner.levels.find(l=>l.price<close)??null;
 return {...base,available:true,state:last?'UNCONFIRMED_TOUCH':'AWAITING_REACTION',workingWave:{activeWave:owner.activeWave,direction:owner.direction,stage:owner.stage,confirmationStatus:owner.confirmationStatus},ownerModelIdentity:owner.modelIdentity,lastMeaningfulLevel:last,nextReferenceLevel:reference?{key:reference.key,price:reference.price,provisional:true}:null,evidence:{source:result.source,observedAt:observationTime,lastCompletedCandleEnd:eligibleCandles.at(-1).endTime,completedCandles:eligibleCandles.length,verifiedTouchCount:touched.length},reasonCodes:last?['TOUCH_IS_NOT_WAVE_COMPLETION','OWNER_CONFIRMATION_NOT_PUBLISHED','ALL_OWNER_LEVELS_PROVISIONAL']:['NO_QUALIFIED_LEVEL_TOUCH','ALL_OWNER_LEVELS_PROVISIONAL']};
}