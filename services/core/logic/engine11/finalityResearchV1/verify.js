import { digest } from './sourceCapture.js';
const degrees={ '5m':300000,'10m':600000,'1h':3600000,'4h':14400000,'1d':null,'1w':null,'1mo':null };
const ns=x=>{if(typeof x!=='string'||!/^\d+$/.test(x))throw new Error('EXACT_NS_REQUIRED');return BigInt(x);};
const iso=x=>{if(typeof x!=='string'||!/(?:Z|\+00:00)$/.test(x)||!Number.isFinite(Date.parse(x)))throw new Error('UTC_EVIDENCE_REQUIRED');return Date.parse(x);};
// A caller-supplied trust envelope is a research input, never an authorization to publish candles.
function compatible(a,b){return a&&b&&['contract','seriesId','priceBasis','resolution','calendarVersion','alignmentVersion','datasetVersion'].every(k=>typeof a[k]==='string'&&a[k]===b[k]);}
export function verifyInterval({interval,calendar,observations=[],acquisition,watermark,noTrades,asOf,correctionEvidence=[]}){
 if(!Object.hasOwn(degrees,interval.timeframe))throw new Error('UNSUPPORTED_TIMEFRAME');
 const from=iso(interval.from),to=iso(interval.to),now=iso(asOf);if(from>=to)throw new Error('INTERVAL_RANGE');
 const start=BigInt(from)*1000000n,end=BigInt(to)*1000000n;
 const result={schemaVersion:'engine11.completeness-finality-research.v1',intervalId:interval.id??null,timeframe:interval.timeframe,
  completeness:'UNKNOWN_CALENDAR',completion:now<to?'PARTIAL_PERIOD':'ELAPSED_NOT_FINAL',sourceFinality:'UNKNOWN_SOURCE_WATERMARK',revisionState:'NO_CORRECTION_AUTHORITY',guardState:'UNKNOWN_ALIGNMENT',calendarEvidenceKind:calendar?.evidenceKind??'NONE',structuralEligible:false,publishedCanonical:false};
 const scope=interval.scope;
 const calendarTrusted=calendar?.state==='VERIFIED_RESEARCH_INPUT'&&calendar.evidenceId&&calendar.effectiveFrom&&calendar.effectiveThrough&&compatible(scope,calendar.scope)&&iso(calendar.effectiveFrom)<=from&&iso(calendar.effectiveThrough)>=to;
 const records=observations.filter(x=>x.ticker===interval.providerTicker);
 const identities=new Map();for(const r of records){const key=r.window_start+'|'+r.session_end_date,content=digest(JSON.stringify(r));const prior=identities.get(key);if(prior&&prior!==content)result.revisionState='AMBIGUOUS_CONTENT_CHANGE';identities.set(key,content);}
 const crossSession=new Map();for(const r of records){const set=crossSession.get(r.window_start)??new Set();set.add(r.session_end_date);crossSession.set(r.window_start,set);}
 if([...crossSession.values()].some(x=>x.size>1))result.revisionState='DISTINCT_SESSION_BUCKETS_UNRESOLVED';
 if(correctionEvidence.length){const valid=correctionEvidence.every(x=>x.state==='VERIFIED_CORRECTION_RESEARCH_INPUT'&&x.evidenceId&&x.supersedesObservationId&&x.correctedObservationId&&x.supersedesObservationId!==x.correctedObservationId&&compatible(scope,x.scope));result.correctionEvidenceState=valid?'EXPLICIT_CORRECTION_EVIDENCE':'UNKNOWN_CORRECTION_EVIDENCE';}
 if(!calendarTrusted)return result;
 const matching=calendar.matchingSegments??[],closed=calendar.closedSegments??[];
 const partition=[...matching.map(x=>({...x,type:'MATCHING'})),...closed.map(x=>({...x,type:'CLOSED'}))].map(x=>({from:iso(x.from),to:iso(x.to),type:x.type})).filter(x=>x.to>from&&x.from<to).map(x=>({...x,from:Math.max(from,x.from),to:Math.min(to,x.to)})).sort((a,b)=>a.from-b.from);
 let covered=from;for(const segment of partition){if(segment.from!==covered||segment.to<=segment.from)throw new Error('CALENDAR_PARTITION_NOT_EXACT');covered=segment.to;}if(covered!==to)throw new Error('CALENDAR_PARTITION_NOT_EXACT');
 const scopedWatermark=watermark?.kind==='VERIFIED_SOURCE_COMPLETENESS_WATERMARK_RESEARCH_INPUT'&&watermark.evidenceId&&compatible(scope,watermark.scope)&&typeof watermark.through==='string'&&ns(watermark.through)>=end&&typeof watermark.observedAt==='string'&&iso(watermark.observedAt)<=now&&iso(watermark.observedAt)>=to&&ns(watermark.through)<=BigInt(iso(watermark.observedAt))*1000000n;
 if(watermark&&!scopedWatermark)result.sourceFinality='INCOMPATIBLE_OR_INSUFFICIENT_WATERMARK';
 if(scopedWatermark){result.sourceFinality='SOURCE_COMPLETENESS_WATERMARK_RESEARCH_ONLY';result.completion=now>=to?'COMPLETED_BY_EXPLICIT_SOURCE_EVIDENCE_RESEARCH_ONLY':'PARTIAL_PERIOD';}
 const isClosed=partition.every(x=>x.type==='CLOSED');
 if(isClosed){result.completeness=records.length?'OBSERVATIONS_IN_VERIFIED_CLOSURE':'EXPECTED_CLOSURE_RESEARCH_ONLY';return result;}
 if(!acquisition?.traversalComplete||!compatible(scope,acquisition.scope)||typeof acquisition.from!=='string'||typeof acquisition.to!=='string'||ns(acquisition.from)>start||ns(acquisition.to)<end){result.completeness='UNKNOWN_ACQUISITION_OR_GUARD_COVERAGE';return result;}
 if(now<to){result.completeness='PARTIAL_PERIOD';return result;}
 const policy=interval.alignment;
 if(policy?.state!=='VERIFIED_RESEARCH_INPUT'||!policy.evidenceId||!compatible(scope,policy.scope)){result.completeness='UNKNOWN_ALIGNMENT';return result;}
 result.guardState='EXPLICIT_INTERVAL_GUARDS_RESEARCH_ONLY';
 const trustedNoTrades=(a,b)=>noTrades?.kind==='VERIFIED_TRADE_ABSENCE_RESEARCH_INPUT'&&noTrades.evidenceId&&compatible(scope,noTrades.scope)&&noTrades.traversalComplete===true&&ns(noTrades.from)<=a&&ns(noTrades.to)>=b&&noTrades.tradeCount===0&&scopedWatermark;
 if(!records.length){result.completeness=trustedNoTrades(start,end)?'VERIFIED_NO_TRADES_RESEARCH_ONLY':'UNKNOWN_SOURCE_ABSENCE';return result;}
 if(!degrees[interval.timeframe]){result.completeness=policy.periodEvidenceId&&policy.constituentCoverageVerified===true&&scopedWatermark?'VERIFIED_PERIOD_CONSTITUENTS_RESEARCH_ONLY':'UNKNOWN_PERIOD_CONSTITUENT_COVERAGE';return result;}
 const step=BigInt(degrees[interval.timeframe])*1000000n;let expected=0,observed=0,absent=0,verifiedNoTrades=0;
 if(typeof interval.sessionEndDate!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(interval.sessionEndDate)){result.completeness='UNKNOWN_SESSION_IDENTITY';return result;}
 const allStarts=new Set(records.filter(x=>x.session_end_date===interval.sessionEndDate).map(x=>ns(x.window_start).toString()));
 for(const segment of partition.filter(x=>x.type==='MATCHING')){
  const left=BigInt(segment.from)*1000000n,right=BigInt(segment.to)*1000000n;
  if((left-start)%step!==0n||(right-left)%step!==0n){result.completeness='UNRESOLVED_CLIPPED_INTERVAL_POLICY';return result;}
  for(let t=left;t<right;t+=step){if(++expected>100000)throw new Error('EXPECTED_INTERVAL_BUDGET');if(allStarts.has(t.toString()))observed++;else if(trustedNoTrades(t,t+step))verifiedNoTrades++;else absent++;}
 }
 result.expectedIntervals=expected;result.observedIntervals=observed;result.unresolvedIntervals=absent;result.verifiedNoTradeIntervals=verifiedNoTrades;
 result.completeness=absent?'UNKNOWN_SOURCE_ABSENCE':result.revisionState==='AMBIGUOUS_CONTENT_CHANGE'||result.revisionState==='DISTINCT_SESSION_BUCKETS_UNRESOLVED'?'UNRESOLVED_SOURCE_IDENTITIES':scopedWatermark?'EXPECTED_INTERVALS_ACCOUNTED_RESEARCH_ONLY':'OBSERVED_INTERVALS_NOT_FINAL';
 return result;
}
