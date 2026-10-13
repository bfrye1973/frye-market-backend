import { readFile,writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { parseBody,sha256,captureReceipt,bindingFromMetadata } from '../../../logic/engine11/sourceObservationsV2/evidence.js';
import { scheduleLedger } from '../../../logic/engine11/twoYearResearchV1/schedules.js';
export function parentParity(parent,children){
 const start=BigInt(parent.window_start),end=start+14400000000000n;
 const scoped=children.filter(x=>x.ticker===parent.ticker&&x.session_end_date===parent.session_end_date&&BigInt(x.window_start)>=start&&BigInt(x.window_start)<end).sort((a,b)=>BigInt(a.window_start)<BigInt(b.window_start)?-1:1);
 if(!scoped.length)return {state:'NO_CAPTURED_CHILDREN',children:0};
 if(new Set(scoped.map(x=>x.window_start)).size!==scoped.length)return {state:'AMBIGUOUS_CHILD_IDENTITIES',children:scoped.length};
 const derived={open:scoped[0].open,high:Math.max(...scoped.map(x=>x.high)),low:Math.min(...scoped.map(x=>x.low)),close:scoped.at(-1).close,volume:scoped.reduce((n,x)=>n+x.volume,0),transactions:scoped.reduce((n,x)=>n+x.transactions,0)};
 return {state:Object.keys(derived).every(k=>derived[k]===parent[k])?'MATCHES_CAPTURED_SAME_SESSION_CHILDREN':'MISMATCH_CAPTURED_CHILDREN',children:scoped.length,derived};
}
export async function analyze({candleEvidence,scheduleEvidence,readinessEvidence}){
 const c=JSON.parse(await readFile(candleEvidence)),s=JSON.parse(await readFile(scheduleEvidence)),r=JSON.parse(await readFile(readinessEvidence));
 const full=s.attempts.find(x=>x.traversalComplete&&x.request.includes('session_end_date.gte'));
 const ledger=scheduleLedger(full.rows,{from:s.calendar.from,through:s.calendar.through,traversalComplete:full.traversalComplete});
 const receipts=new Map(c.receipts.map(x=>[x.receiptId,x]));
 const rowsFor=w=>w.receiptIds.flatMap(id=>{const receipt=receipts.get(id),b=Buffer.from(receipt.bodyBase64,'base64');if(sha256(b)!==receipt.bodySha256)throw new Error('RECEIPT_DIGEST_MISMATCH');return parseBody(b).rows.map(x=>x.payload);});
 const parity=[],fixtures=[];
 const followupBindings=[],unresolved=[];
 for(const [contract,ticker] of [['ESZ2024','ESZ4'],['ESH2025','ESH5']]){
  let binding=null;
  for(const attempt of s.attempts.filter(x=>new URL(x.request).pathname.endsWith('/contracts')&&new URL(x.request).searchParams.get('ticker')===ticker))try{
   const receipt=attempt.receipts[0];binding=bindingFromMetadata(contract,ticker,captureReceipt({request:receipt.request,body:Buffer.from(receipt.bodyBase64,'base64'),captureId:receipt.captureId,page:receipt.page,observedAt:receipt.observedAt,httpStatus:receipt.httpStatus}));break;
  }catch{};
  if(binding)followupBindings.push(binding);else unresolved.push(contract);
 }
 for(const w of r.coverage.filter(x=>x.timeframe==='4h')){
  const one=r.coverage.find(x=>x.timeframe==='1h'&&x.contract===w.contract&&x.from===w.from&&x.role===w.role),children=rowsFor(one),parents=rowsFor(w),states={};
  for(const parent of parents){const p=parentParity(parent,children);states[p.state]=(states[p.state]??0)+1;
   if(w.contract==='ESZ2026'&&w.role==='SUCCESSOR_OVERLAP_RESEARCH'&&parent.window_start==='1788984000000000000')fixtures.push({parent,children:children.filter(x=>x.session_end_date===parent.session_end_date&&BigInt(x.window_start)>=BigInt(parent.window_start)&&BigInt(x.window_start)<BigInt(parent.window_start)+14400000000000n),expected:p.state});}
  parity.push({contract:w.contract,from:w.from,role:w.role,parents:parents.length,states});
 }
 return {schemaVersion:'engine11.two-year-readiness-evidence.v1',from:r.from,asOf:r.asOf,
  candleProbeCommit:'f004b5fee81b86511616811c5715354173a0eee3',candleRun:38333722706,candleArtifact:11783458871,
  scheduleObservedAt:s.asOf,scheduleReceiptManifest:s.attempts.flatMap(x=>x.receipts.map(({bodyBase64,...rest})=>rest)),
  scheduleRows:full.rows.length,outrightEventRows:full.rows.length-ledger.unscoped.length,excludedScheduleRows:ledger.unscoped.length,
  calendarStateCounts:ledger.dates.reduce((a,x)=>(a[x.state]=(a[x.state]??0)+1,a),{}),
  calendarDates:ledger.dates.map(({events,unknownEvents,...rest})=>rest),
  metadata:r.metadata,followupBindings,unresolvedBindings:unresolved,readiness:r.readiness,windowResults:r.coverage,
  fourHourSameSessionParity:parity,authenticParentFixtures:fixtures,
  sourceFinality:'UNKNOWN',calendarAccepted:false,structuralEligible:false,
  limitation:'Same-session child parity explains aggregation content only, not authentic trade timing, finality, calendar acceptance, roll selection or structural eligibility.'};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const result=await analyze({candleEvidence:process.argv[2],scheduleEvidence:process.argv[3],readinessEvidence:process.argv[4]});await writeFile(process.argv[5],JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({calendarStateCounts:result.calendarStateCounts,outrightEventRows:result.outrightEventRows,excludedScheduleRows:result.excludedScheduleRows,parity:result.fourHourSameSessionParity,fixtures:result.authenticParentFixtures}));}
