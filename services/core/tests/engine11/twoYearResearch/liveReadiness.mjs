import { mkdir,writeFile } from 'node:fs/promises';
import { capturePages,scheduleLedger } from '../../../logic/engine11/twoYearResearchV1/schedules.js';
import { inspectRows } from '../research/coverageAudit.mjs';
import { captureReceipt,bindingFromMetadata } from '../../../logic/engine11/sourceObservationsV2/evidence.js';
const apiKey=process.env.POLYGON_API_KEY;if(!apiKey)throw new Error('Existing provider credential required');
const from='2024-10-12',asOf=new Date().toISOString(),through=asOf.slice(0,10),receipts=[];
const schedules=await capturePages({request:'https://api.massive.com/futures/v1/schedules?'+new URLSearchParams({product_code:'ES',trading_venue:'XCME','session_end_date.gte':from,'session_end_date.lte':through,limit:'1000',sort:'session_end_date.asc'}),apiKey,maxPages:20,maxRows:20000});
receipts.push(...schedules.receipts);const calendar=scheduleLedger(schedules.rows,{from,through,traversalComplete:schedules.traversalComplete});
console.log('TWO_YEAR_SCHEDULE_SUMMARY '+JSON.stringify({traversalComplete:schedules.traversalComplete,failure:schedules.failure,rows:schedules.rows.length,pages:schedules.receipts.length,providerCandidateDates:calendar.providerCandidateDates,requestedDates:calendar.dates.length,missingDates:calendar.missingDates,unscopedRows:calendar.unscoped.length,eventTypes:[...new Set(schedules.rows.map(x=>x.event))],firstDate:schedules.rows[0]?.session_end_date,lastDate:schedules.rows.at(-1)?.session_end_date,examples:calendar.dates.filter(x=>x.eventCount).slice(0,2)}));
const inputs=[['SUBMICRO','5m','5min',300000],['MICRO','10m','10min',600000],['SUBMINUTE','1h','1hour',3600000],['MINUTE','4h','4hour',14400000],['MINOR','1d','1session',null],['INTERMEDIATE','1w','1week',null],['PRIMARY','1mo','1month',null]];
const windows=[];const low=Date.parse(from+'T00:00:00Z'),high=Date.parse(asOf);
for(let year=2024;year<=new Date(asOf).getUTCFullYear();year++)for(const [code,month] of [['H',0],['M',3],['U',6],['Z',9]]){
 const start=Math.max(low,Date.UTC(year,month,1)),end=Math.min(high,Date.UTC(year,month+3,1));if(start>=end)continue;
 windows.push({contract:'ES'+code+year,ticker:'ES'+code+String(year).at(-1),year,from:new Date(start).toISOString(),to:new Date(end).toISOString(),role:'CALENDAR_QUARTER_SAMPLING_NOT_ROLLOVER'});
}
// Successor overlap covers the preceding roll month as independent raw contracts.
// It is not a selected roll date, adjustment, or published continuous series.
for(const w of [...windows]){const month={H:0,M:3,U:6,Z:9}[w.contract[2]],start=Math.max(low,Date.UTC(w.year,month-1,1)),end=Math.min(high,Date.UTC(w.year,month,1));if(start<end)windows.push({...w,from:new Date(start).toISOString(),to:new Date(end).toISOString(),role:'SUCCESSOR_OVERLAP_RESEARCH'});}
const metadata=[],bindings=new Map(),coverage=[];
for(const w of windows.filter((w,i,a)=>a.findIndex(x=>x.contract===w.contract)===i)){
 const date=w.from.slice(0,10),request='https://api.massive.com/futures/v1/contracts?'+new URLSearchParams({ticker:w.ticker,product_code:'ES',date,limit:'100'});
 const result=await capturePages({request,apiKey,maxPages:1,maxRows:100});receipts.push(...result.receipts);let binding=null,failure=result.failure;
 try{const r=result.receipts[0];const source=captureReceipt({request:r.request,body:Buffer.from(r.bodyBase64,'base64'),captureId:r.captureId,page:r.page,observedAt:r.observedAt,httpStatus:r.httpStatus});binding=bindingFromMetadata(w.contract,w.ticker,source);bindings.set(w.contract,binding);}catch(e){failure=e.code??'METADATA_BINDING_UNAVAILABLE';}
 const item={contract:w.contract,ticker:w.ticker,date,rows:result.rows,binding,failure};metadata.push(item);console.log('TWO_YEAR_METADATA '+JSON.stringify(item));
}
for(const w of windows)for(const [degree,timeframe,resolution,stepMs] of inputs){
 const request='https://api.massive.com/futures/v1/aggs/'+w.ticker+'?'+new URLSearchParams({resolution,'window_start.gte':String(BigInt(Date.parse(w.from))*1000000n),'window_start.lt':String(BigInt(Date.parse(w.to))*1000000n),limit:'50000',sort:'window_start.asc'});
 const result=await capturePages({request,apiKey,maxPages:3,maxRows:150000});receipts.push(...result.receipts);
 const audit=inspectRows(result.rows,{ticker:w.ticker,from:w.from,to:w.to,stepMs});
 const row={...w,degree,timeframe,resolution,bindingVerifiedForResearch:bindings.has(w.contract),traversalComplete:result.traversalComplete,failure:result.failure,receiptIds:result.receipts.map(x=>x.receiptId),...audit};coverage.push(row);
 console.log('TWO_YEAR_CANDLE '+JSON.stringify(row));
}
const readiness=inputs.map(([degree,timeframe])=>{
 const rows=coverage.filter(x=>x.degree===degree);
 return {degree,timeframe,queryWindows:rows.length,nonemptyWindows:rows.filter(x=>x.inRangeRows>0).length,sourceRows:rows.reduce((s,x)=>s+x.inRangeRows,0),
  failedWindows:rows.filter(x=>!x.traversalComplete).map(x=>({contract:x.contract,from:x.from,reason:x.failure})),
  integrityFindings:rows.filter(x=>x.errors.length||x.conflicts).map(x=>({contract:x.contract,from:x.from,errors:x.errors,conflicts:x.conflicts})),
  internalGaps:rows.reduce((s,x)=>s+x.gapCount,0),unboundContracts:[...new Set(rows.filter(x=>!x.bindingVerifiedForResearch).map(x=>x.contract))],
  status:'OBSERVED_SOURCE_COVERAGE_ONLY_NOT_STRUCTURALLY_ACCEPTED',depthSufficient:'ENGINE22_DECISION_REQUIRED',calendarAccepted:false,sourceFinality:'UNKNOWN',structuralEligible:false};
});
await mkdir('research-evidence',{recursive:true});
await writeFile('research-evidence/two-year-receipts.json',JSON.stringify({from,asOf,receipts},null,2)+'\n');
await writeFile('research-evidence/two-year-readiness.json',JSON.stringify({from,asOf,calendar,metadata,coverage,readiness},null,2)+'\n');
console.log('TWO_YEAR_READINESS '+JSON.stringify(readiness));
