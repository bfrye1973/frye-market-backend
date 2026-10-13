import { hash } from '../acceptanceResearchV1/eligibility.js';
export function versionCoverageReport({report,receiptManifests,from,to,confidence}){
 if(!Array.isArray(receiptManifests)||!receiptManifests.length||!['OBSERVATION_ONLY','FIXTURE'].includes(confidence))throw new Error('COVERAGE_CONTEXT');
 if(!Number.isFinite(Date.parse(from))||!Number.isFinite(Date.parse(to))||Date.parse(from)>=Date.parse(to))throw new Error('COVERAGE_RANGE');
 const receipts=receiptManifests.map(r=>{if(!r.receiptId||!/^[a-f0-9]{64}$/.test(r.bodySha256??'')||!Number.isFinite(Date.parse(r.observedAt)))throw new Error('COVERAGE_RECEIPT');return {receiptId:r.receiptId,bodySha256:r.bodySha256,observedAt:r.observedAt};}).sort((a,b)=>a.receiptId.localeCompare(b.receiptId));
 const value={schemaVersion:'engine11.coverage-report.research.v1',range:{fromInclusive:from,toExclusive:to},confidence,report:structuredClone(report),sourceReceipts:receipts,snapshotSemantics:'PER_RECEIPT_CAPTURE_VECTOR_NOT_ATOMIC_ASOF',sourceFinality:'UNKNOWN',structuralEligible:false};
 return {...value,reportVersion:'coverage-report:'+hash(value)};
}
export function compareCoverageVersions(a,b){
 if(a.schemaVersion!=='engine11.coverage-report.research.v1'||b.schemaVersion!==a.schemaVersion)throw new Error('COVERAGE_SCHEMA');
 const older=new Map(a.sourceReceipts.map(x=>[x.receiptId,x])),updates=b.sourceReceipts.filter(x=>!older.has(x.receiptId));
 if(b.sourceReceipts.some(x=>older.has(x.receiptId)&&older.get(x.receiptId).bodySha256!==x.bodySha256))throw new Error('IMMUTABLE_RECEIPT_MUTATION');
 return {fromVersion:a.reportVersion,toVersion:b.reportVersion,newReceiptCount:updates.length,interpretation:'NEW_OBSERVATIONS_NOT_AUTOMATIC_SOURCE_CORRECTIONS',sourceFinality:'UNKNOWN',structuralEligible:false};
}
export function verifyPeriodGuard({timeframe,requestFrom,requestTo,periodStart,periodEnd,calendarAccepted=false}){
 if(!['5m','10m','1h','4h','1d','1w','1mo'].includes(timeframe))throw new Error('PERIOD_FRAME');
 const dates=[requestFrom,requestTo,periodStart,periodEnd].map(Date.parse);if(dates.some(x=>!Number.isFinite(x))||dates[0]>=dates[1]||dates[2]>=dates[3])throw new Error('PERIOD_RANGE');
 return {timeframe,guardCovered:dates[0]<=dates[2]&&dates[1]>=dates[3],calendarAccepted,state:dates[0]>dates[2]||dates[1]<dates[3]?'UNKNOWN_GUARD_EDGE':calendarAccepted?'RESEARCH_GUARD_ACCOUNTED_SOURCE_FINALITY_STILL_REQUIRED':'UNKNOWN_CALENDAR_POLICY',structuralEligible:false};
}
