import { OWNER_VERSION } from '../contracts/priceActionFib.v1.js';
const positive = n => typeof n === 'number' && Number.isFinite(n) && n > 0;
const fail = code => ({available:false,reasonCodes:[code],owner:null,candles:[],observationTime:null});
export function adaptEngine22Micro({snapshot=null,esBars10m=null,evaluatedAt=null,sourceSymbol='ES',maxAgeMs=3600000}={}) {
 if(snapshot?.symbol!=='ES'||sourceSymbol!=='ES')return fail('ES_SOURCE_IDENTITY_MISMATCH');
 const owner=snapshot?.strategies?.['intraday_scalp@10m']?.engine22WaveStrategy?.currentWavelength?.degrees?.micro?.ownerMicroCDown;
 if(owner?.version!==OWNER_VERSION||owner?.activeWave!=='C'||owner?.direction!=='DOWN'||owner?.parentDegree!=='subminute')return fail('CURRENT_MICRO_OWNER_UNAVAILABLE');
 if(!positive(owner.waveA?.high)||!positive(owner.waveA?.low)||!positive(owner.waveB?.high)||owner.waveA.high<=owner.waveA.low)return fail('MICRO_OWNER_ANCHORS_INVALID');
 if(!Array.isArray(owner.levels)||!owner.levels.length||!owner.levels.every(l=>typeof l?.key==='string'&&/^e\d+$/.test(l.key)&&positive(l.price)&&l.provisional===true))return fail('OWNER_FIB_LADDER_INVALID');
 if(new Set(owner.levels.map(l=>l.key)).size!==owner.levels.length||owner.levels.some((l,i)=>i>0&&l.price>=owner.levels[i-1].price))return fail('OWNER_FIB_ORDER_INVALID');
 const now=Date.parse(evaluatedAt??snapshot?.now??snapshot?.ts??'');
 if(!Number.isFinite(now)||!Number.isFinite(maxAgeMs)||maxAgeMs<=0)return fail('EVALUATION_TIME_INVALID');
 if(!Array.isArray(esBars10m)||!esBars10m.length)return fail('ES_COMPLETED_CANDLES_UNAVAILABLE');
 let previous=-Infinity;const candles=[];
 for(const b of esBars10m){
  const start=typeof b?.time==='number'&&Number.isSafeInteger(b.time)&&b.time>0?b.time*1000:NaN;
  if(!Number.isFinite(start)||start<=previous||start+600000>now||![b.open,b.high,b.low,b.close].every(positive)||b.low>b.high||b.open<b.low||b.open>b.high||b.close<b.low||b.close>b.high)return fail('INVALID_OR_UNFINISHED_ES_CANDLES');
  previous=start;candles.push({startTime:new Date(start).toISOString(),endTime:new Date(start+600000).toISOString(),open:b.open,high:b.high,low:b.low,close:b.close});
 }
 if(now-(previous+600000)>maxAgeMs)return fail('STALE_ES_COMPLETED_CANDLES');
 const modelIdentity=JSON.stringify([owner.version,owner.waveA.high,owner.waveA.low,owner.waveB.high,owner.levels.map(l=>[l.key,l.price])]);
 return {available:true,reasonCodes:[],owner:{version:owner.version,degree:'micro',activeWave:owner.activeWave,direction:owner.direction,parentDegree:owner.parentDegree,parentWave:owner.parentWave,stage:owner.stage,confirmationStatus:owner.confirmationStatus,modelIdentity,levels:owner.levels.map(l=>({key:l.key,price:l.price,status:l.status,provisional:l.provisional,touchEvidenceAvailable:l.touchEvidenceAvailable===true,touchEvidenceType:l.touchEvidenceType??null,touchedAt:l.touchedAt??null}))},candles,observationTime:new Date(now).toISOString(),source:'ENGINE22_OWNER_AND_ES_COMPLETED_10M_OHLC'};
}