import { hash,instant,requireTruth } from '../rawCandles/identity.js';
import { freeze } from '../sourceObservationsV2/evidence.js';
import { selectResearchSession,researchFlags } from '../calendarEvidenceV1/registry.js';
import { buildSourceDataset } from '../sourceObservationsV2/dataset.js';
const durations={'5m':300000,'10m':600000,'1h':3600000,'4h':14400000};
export function researchIntervals({registry,tradingDate,timeframe,asOf}) {
 requireTruth(Object.hasOwn(durations,timeframe),'RESEARCH_INTRADAY_TIMEFRAME_REQUIRED');const selected=selectResearchSession(registry,tradingDate,asOf);
 if(selected.state==='UNAVAILABLE')return freeze({...selected,intervals:[],timeframe});
 const session=selected.session,lo=instant(session.openUtc),hi=instant(session.closeUtc),step=durations[timeframe],intervals=[];
 for(let start=lo;start<hi;start+=step){const end=Math.min(start+step,hi),mask=[];
  for(const s of session.segments){const a=Math.max(start,instant(s.from)),b=Math.min(end,instant(s.to));if(a<b)mask.push({...s,from:new Date(a).toISOString(),to:new Date(b).toISOString()});}
  const openMs=mask.filter(s=>s.state==='OPEN').reduce((total,s)=>total+instant(s.to)-instant(s.from),0);
  const identity={calendarVersion:selected.calendarVersion,alignmentPolicyVersion:'SESSION_OPEN_ELAPSED_UTC_RESEARCH.v1',tradingDate,timeframe,startUtc:new Date(start).toISOString(),endUtc:new Date(end).toISOString()};
  intervals.push({...identity,intervalCandidateId:'interval-candidate:v1:'+hash(identity),elapsedMs:end-start,openMs,mask,terminalPartial:end-start<step,
   state:openMs===0?'EXPECTED_CLOSURE':end>instant(asOf)?'INCOMPLETE_CLOCK_PERIOD':'ELAPSED_PENDING_SOURCE_FINALITY',sourceFinality:'UNKNOWN',ohlcv:null,...researchFlags});
 }
 return freeze({state:'RESEARCH_INTERVAL_CANDIDATES',calendarVersion:selected.calendarVersion,tradingDate,timeframe,intervals,evidenceKinds:selected.evidenceKinds,...researchFlags});
}
export function sourceMembership({registry,sourceDataset,observation,tradingDate,timeframe,asOf}) {
 const plan=researchIntervals({registry,tradingDate,timeframe,asOf});const p=observation.payload;
 const unavailable=reason=>freeze({state:'QUARANTINED',reason,observationId:observation.observationId??null,intervalCandidateId:null,...researchFlags});
 if(plan.state==='UNAVAILABLE')return unavailable(plan.reason);
 if(!sourceDataset)return unavailable('SOURCE_DATASET_EVIDENCE_REQUIRED');
 try{
  const bindings=sourceDataset.bindings.map(b=>({contract:b.contract,ticker:b.ticker,metadataReceipt:sourceDataset.receipts.find(r=>r.receiptId===b.metadataReceiptId)}));
  const rebuilt=buildSourceDataset({receipts:sourceDataset.receipts,bindings,aggregationPolicyTag:sourceDataset.manifest.aggregationPolicyTag});
  if(hash(rebuilt)!==hash(sourceDataset)||!rebuilt.rows.some(row=>hash(row)===hash(observation)))return unavailable('SOURCE_DATASET_OR_OBSERVATION_TAMPER');
  if(instant(asOf)<instant(sourceDataset.firstUsableAt))return unavailable('ASOF_BEFORE_SOURCE_EVIDENCE');
 }catch{return unavailable('SOURCE_DATASET_OR_OBSERVATION_TAMPER');}
 if(!observation.sourceKey)return unavailable('UNVERIFIED_CONTRACT_SOURCE_KEY');
 if(p?.session_end_date!==tradingDate)return unavailable('SOURCE_SESSION_LABEL_MISMATCH');
 if(typeof p.window_start!=='string'||!/^\d{16,20}$/.test(p.window_start))return unavailable('INEXACT_SOURCE_TIMESTAMP');
 const ns=BigInt(p.window_start),s=registry.sessions.find(x=>x.tradingDate===tradingDate);
 const start=BigInt(instant(s.openUtc))*1000000n,end=BigInt(instant(s.closeUtc))*1000000n;
 if(ns<start||ns>=end)return unavailable('SOURCE_CLOCK_OUTSIDE_LABELLED_SESSION');
 const interval=plan.intervals.find(x=>ns>=BigInt(instant(x.startUtc))*1000000n&&ns<BigInt(instant(x.endUtc))*1000000n);
 const matching=interval.mask.some(x=>x.state==='OPEN'&&ns>=BigInt(instant(x.from))*1000000n&&ns<BigInt(instant(x.to))*1000000n);
 if(!matching)return unavailable('SOURCE_TIMESTAMP_IN_NONMATCHING_SEGMENT');
 // Start-point membership only. Native bars may span a closure or multiple
 // sessions; no OHLCV aggregation, interval extent or finality is certified.
 return freeze({state:'SOURCE_START_MEMBERSHIP_CANDIDATE',observationId:observation.observationId,sourceKey:observation.sourceKey,
  intervalCandidateId:interval.intervalCandidateId,extentVerified:false,sourceFinality:'UNKNOWN',...researchFlags});
}
