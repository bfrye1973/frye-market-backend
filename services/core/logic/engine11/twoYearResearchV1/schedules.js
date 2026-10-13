import { randomUUID } from 'node:crypto';
import { hash,requireTruth } from '../rawCandles/identity.js';
import { parseBody,sha256,freeze } from '../sourceObservationsV2/evidence.js';
const origin='https://api.massive.com';
export function safeResearchUrl(input,initial=null) {
 const u=new URL(input);requireTruth(u.origin===origin&&!u.username&&!u.password&&!u.hash,'UNSAFE_TWO_YEAR_URL');
 requireTruth(/^\/futures\/v1\/(schedules|contracts|aggs\/ES[HMUZ]\d{1,4})$/.test(u.pathname),'TWO_YEAR_ENDPOINT');
 u.searchParams.delete('apiKey');requireTruth(u.toString().length<=8192,'TWO_YEAR_URL_LIMIT');
 requireTruth([...u.searchParams.keys()].every(k=>['cursor','limit','sort','product_code','trading_venue','date','ticker','session_end_date','session_end_date.gte','session_end_date.lte','resolution','window_start.gte','window_start.lt'].includes(k)),'TWO_YEAR_QUERY');
 if(initial){const first=new URL(initial);requireTruth(u.pathname===first.pathname,'TWO_YEAR_CURSOR_PATH');for(const key of ['product_code','trading_venue','session_end_date.gte','session_end_date.lte','resolution','window_start.gte','window_start.lt','sort','date','ticker'])requireTruth(!u.searchParams.has(key)||u.searchParams.get(key)===first.searchParams.get(key),'TWO_YEAR_CURSOR_DRIFT');}
 return u.toString();
}
export async function capturePages({request,apiKey,fetchImpl=fetch,maxPages=20,maxRows=20000}) {
 requireTruth(typeof apiKey==='string'&&apiKey.length>0&&Number.isInteger(maxPages)&&maxPages>0&&maxPages<=100&&Number.isInteger(maxRows)&&maxRows>0&&maxRows<=1000000,'TWO_YEAR_CAPTURE_BUDGET_OR_CREDENTIAL');
 const initial=safeResearchUrl(request),captureId=randomUUID(),receipts=[],rows=[],seen=new Set();let next=initial,failure=null;
 while(next){
  if(receipts.length>=maxPages){failure='PAGE_BUDGET';break;}if(seen.has(next)){failure='CURSOR_CYCLE';break;}seen.add(next);
  try{
   let response;for(let attempt=0;attempt<3;attempt++){response=await fetchImpl(next,{headers:{Accept:'application/json',Authorization:'Bearer '+apiKey},signal:AbortSignal.timeout(25000)});if(![429,500,502,503,504].includes(response.status)||attempt===2)break;await new Promise(r=>setTimeout(r,200*2**attempt));}
   if(!response.ok){failure='HTTP_'+response.status;break;}
   const bytes=Buffer.from(await response.arrayBuffer());requireTruth(bytes.length<=16*1024*1024&&!bytes.includes(Buffer.from(apiKey)),'BODY_SIZE_OR_CREDENTIAL');
   const parsed=parseBody(bytes);const observedAt=new Date().toISOString();
   const receipt={schemaVersion:'engine11.two-year-receipt.v1',captureId,page:receipts.length+1,request:next,httpStatus:response.status,observedAt,bodySha256:sha256(bytes),bodyBase64:bytes.toString('base64'),evidenceKind:'HTTP_BODY_AFTER_CONTENT_DECODE',rowCount:parsed.rows.length};
   receipts.push({...receipt,receiptId:'receipt:two-year:'+hash(receipt)});rows.push(...parsed.rows.map(x=>x.payload));
   if(rows.length>maxRows){failure='ROW_BUDGET';break;}if(parsed.parsed.status!=='OK'){failure='PROVIDER_STATUS';break;}
   next=parsed.parsed.next_url?safeResearchUrl(parsed.parsed.next_url,initial):null;
  }catch(e){failure=e.code??'TRANSPORT_OR_PARSE_UNAVAILABLE';break;}
 }
 return freeze({request:initial,receipts,rows,traversalComplete:failure===null&&next===null,failure,purpose:'ISOLATED_RESEARCH_ONLY',structuralEligible:false});
}
const states={pre_open:'PREOPEN',open:'OPEN',close:'CLOSED',pause:'PAUSED',halt:'PAUSED'};
export function scheduleLedger(rows,{from,through,traversalComplete}) {
 const validDate=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d+'T00:00:00Z'))&&new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d;
 requireTruth(validDate(from)&&validDate(through)&&from<=through&&(Date.parse(through)-Date.parse(from))/86400000<=800,'TWO_YEAR_LEDGER_RANGE');
 const groups=new Map(),unscoped=[];
 for(const row of rows){if(row.product_code!=='ES'||row.trading_venue!=='XCME'||!validDate(row.session_end_date)){unscoped.push(row);continue;}const g=groups.get(row.session_end_date)??[];g.push(row);groups.set(row.session_end_date,g);}
 const dates=[];
 for(let day=Date.parse(from+'T00:00:00Z');day<=Date.parse(through+'T00:00:00Z');day+=86400000){
  const date=new Date(day).toISOString().slice(0,10),source=groups.get(date)??[],events=[...source].sort((a,b)=>Date.parse(a.timestamp)-Date.parse(b.timestamp));
  const unknown=events.filter(x=>!Object.hasOwn(states,x.event)||typeof x.timestamp!=='string'||!/(?:Z|\+00:00)$/.test(x.timestamp)||!Number.isFinite(Date.parse(x.timestamp)));
  const tie=events.some((x,i)=>i&&Date.parse(x.timestamp)===Date.parse(events[i-1].timestamp)&&x.event!==events[i-1].event);
  const repeated=new Set(events.map(x=>hash(x))).size!==events.length;
  const opens=events.filter(x=>x.event==='open'),closes=events.filter(x=>x.event==='close');
  const terminal=events.at(-1)?.event==='close';const matching=[];
  for(let i=0;i+1<events.length;i++)if(events[i].event==='open'&&Date.parse(events[i+1].timestamp)>Date.parse(events[i].timestamp))matching.push({from:new Date(events[i].timestamp).toISOString(),to:new Date(events[i+1].timestamp).toISOString()});
  const state=!traversalComplete?'UNKNOWN_INCOMPLETE_TRAVERSAL':!source.length?'UNKNOWN_NO_SCHEDULE_EVENTS':unknown.length?'UNKNOWN_EVENT_SEMANTICS':tie?'UNKNOWN_EVENT_TIMESTAMP_TIE':repeated?'UNKNOWN_REPEATED_SCHEDULE_EVENT':!opens.length||!closes.length||!terminal||!matching.length?'UNKNOWN_INCOMPLETE_SESSION_EVENTS':'PROVIDER_SCHEDULE_CANDIDATE';
  dates.push({date,state,eventCount:source.length,sourceEventsDigest:hash(source),events,matchingSegments:matching,unknownEvents:unknown,
   firstOpen:opens[0]?.timestamp??null,lastClose:closes.at(-1)?.timestamp??null,sourceScheduleVersion:'NOT_SUPPLIED',calendarAccepted:false,structuralEligible:false});
 }
 return freeze({from,through,dates,unscoped,missingDates:dates.filter(x=>x.state!=='PROVIDER_SCHEDULE_CANDIDATE').map(x=>({date:x.date,reason:x.state})),providerCandidateDates:dates.filter(x=>x.state==='PROVIDER_SCHEDULE_CANDIDATE').length,purpose:'ISOLATED_RESEARCH_ONLY',calendarAccepted:false,structuralEligible:false});
}
