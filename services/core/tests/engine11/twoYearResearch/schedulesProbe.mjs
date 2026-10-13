import { mkdir,writeFile } from 'node:fs/promises';
import { capturePages,scheduleLedger } from '../../../logic/engine11/twoYearResearchV1/schedules.js';
const apiKey=process.env.POLYGON_API_KEY;if(!apiKey)throw new Error('Existing provider credential required');
const from='2024-10-12',asOf=new Date().toISOString(),through=asOf.slice(0,10),attempts=[];
const variants=[{product_code:'ES',trading_venue:'XCME','session_end_date.gte':from,'session_end_date.lte':through,sort:'timestamp.asc'},
 {product_code:'ES',trading_venue:'XCME','session_end_date.gte':from,'session_end_date.lte':through},
 {product_code:'ES',session_end_date:'2026-09-10'}, {product_code:'ES',session_end_date:'2024-10-14'}];
let full=null;
for(const query of variants){const result=await capturePages({request:'https://api.massive.com/futures/v1/schedules?'+new URLSearchParams({...query,limit:'1000'}),apiKey,maxPages:20,maxRows:20000});attempts.push(result);
 console.log('SCHEDULE_DIAGNOSTIC '+JSON.stringify({request:result.request,failure:result.failure,rows:result.rows.length,pages:result.receipts.length,errors:result.receipts.filter(x=>x.httpStatus>=400).map(x=>({httpStatus:x.httpStatus,body:Buffer.from(x.bodyBase64,'base64').toString(),sha256:x.bodySha256}))}));
 if(query['session_end_date.gte']&&result.traversalComplete){full=result;break;}}
for(const date of ['2024-10-14','2024-11-28','2025-01-21','2025-01-30','2025-03-10','2025-03-18','2025-11-27']){
 const r=await capturePages({request:'https://api.massive.com/futures/v1/schedules?'+new URLSearchParams({product_code:'ES',trading_venue:'XCME',session_end_date:date,limit:'1000'}),apiKey,maxPages:2,maxRows:2000});attempts.push(r);
 console.log('SCHEDULE_EXACT_DATE '+JSON.stringify({date,failure:r.failure,traversalComplete:r.traversalComplete,rows:r.rows,receiptIds:r.receipts.map(x=>x.receiptId)}));}
for(const [ticker,date] of [['ESZ4','2024-10-14'],['ESZ4','2024-12-19'],['ESH5','2025-03-20']]){
 const r=await capturePages({request:'https://api.massive.com/futures/v1/contracts?'+new URLSearchParams({ticker,date,product_code:'ES',limit:'100'}),apiKey,maxPages:1,maxRows:100});attempts.push(r);
 console.log('CONTRACT_METADATA_FOLLOWUP '+JSON.stringify({ticker,date,failure:r.failure,rows:r.rows,receiptIds:r.receipts.map(x=>x.receiptId)}));}
const calendar=scheduleLedger(full?.rows??[],{from,through,traversalComplete:full?.traversalComplete??false});
const samples=['2024-10-14','2024-11-04','2024-11-28','2024-12-25','2025-03-10','2025-04-18','2025-11-03','2025-11-27','2025-12-25','2026-03-09','2026-04-03','2026-09-10','2026-10-13'];
const summary={from,asOf,traversalComplete:full?.traversalComplete??false,rows:full?.rows.length??0,pages:full?.receipts.length??0,eventTypes:[...new Set(full?.rows.map(x=>x.event)??[])],requestedDates:calendar.dates.length,providerCandidateDates:calendar.providerCandidateDates,stateCounts:calendar.dates.reduce((a,x)=>(a[x.state]=(a[x.state]??0)+1,a),{}),firstDate:full?.rows[0]?.session_end_date,lastDate:full?.rows.at(-1)?.session_end_date,examples:calendar.dates.filter(x=>samples.includes(x.date)),missingDates:calendar.missingDates,unscopedRows:calendar.unscoped.length};
console.log('SCHEDULE_REPAIRED_SUMMARY '+JSON.stringify(summary));
await mkdir('research-evidence',{recursive:true});await writeFile('research-evidence/two-year-schedule-diagnostics.json',JSON.stringify({asOf,attempts,calendar,summary},null,2)+'\n');
