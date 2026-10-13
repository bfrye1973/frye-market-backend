import { readFile,writeFile } from 'node:fs/promises';
import { parseBody } from '../../../logic/engine11/sourceObservationsV2/evidence.js';
import { classifyObservation,compareParent,hash } from '../../../logic/engine11/acceptanceResearchV1/eligibility.js';
import { proposeHistoricalIdentity } from '../../../logic/engine11/acceptanceResearchV1/historicalBindingProposal.js';
const corpus=JSON.parse(await readFile(process.argv[2])),coverage=JSON.parse(await readFile(process.argv[3])),calendar=JSON.parse(await readFile(process.argv[4]));
const receipts=new Map(corpus.receipts.map(x=>[x.receiptId,x]));
const boundContracts=new Set([...(calendar.metadata??[]).filter(x=>x.binding).map(x=>x.binding.contract),...(calendar.followupBindings??[]).map(x=>x.contract)]);
const dayMatrix=new Map(calendar.calendarDates.map(x=>[x.date,{date:x.date,calendarState:x.state,timeframes:Object.fromEntries(['5m','10m','1h','4h','1d','1w','1mo'].map(tf=>[tf,{sourceObservations:0,COMPLETE:0,PROVISIONAL:0,UNKNOWN:0,QUARANTINED:0}]))}]));
const totals=Object.fromEntries(['5m','10m','1h','4h','1d','1w','1mo'].map(tf=>[tf,{sourceObservations:0,COMPLETE:0,PROVISIONAL:0,UNKNOWN:0,QUARANTINED:0,reasons:{}}]));
const windows=[],parity=[],samples=[];
const rowsFor=w=>w.receiptIds.flatMap(id=>{const r=receipts.get(id),b=Buffer.from(r.bodyBase64,'base64');if(hash(b)!==r.bodySha256)throw new Error('RECEIPT_TAMPER');return parseBody(b).rows.map((x,n)=>({row:x.payload,receipt:r,ordinal:n}));});
for(const w of coverage.coverage){
 const records=rowsFor(w),from=BigInt(Date.parse(w.from))*1000000n,to=BigInt(Date.parse(w.to))*1000000n;
 const clockSessions=new Map();for(const {row} of records){const group=clockSessions.get(row.window_start)??new Set();group.add(row.session_end_date);clockSessions.set(row.window_start,group);}
 const summary={contract:w.contract,timeframe:w.timeframe,from:w.from,to:w.to,role:w.role,COMPLETE:0,PROVISIONAL:0,UNKNOWN:0,QUARANTINED:0};
 for(const {row,receipt,ordinal} of records){const t=BigInt(row.window_start);if(t<from||t>=to)continue;
  const bindingState=boundContracts.has(w.contract)?'MATCHED_EXISTING_V2_RESEARCH':'UNACCEPTED';
  const r=classifyObservation({row,timeframe:w.timeframe,contract:w.contract,bindingState,receipt,collision:clockSessions.get(row.window_start).size>1});
  summary[r.state]++;const group=totals[w.timeframe];group.sourceObservations++;group[r.state]++;for(const reason of r.reasons)group.reasons[reason]=(group.reasons[reason]??0)+1;
  const day=dayMatrix.get(row.session_end_date)?.timeframes[w.timeframe];if(day){day.sourceObservations++;day[r.state]++;}
  if(samples.length<12&&r.state!=='UNKNOWN')samples.push({observationEvidenceId:'research-row:'+hash([receipt.receiptId,ordinal,hash(row)]),originalRow:row,classification:r});
 }
 windows.push(summary);
 if(['10m','1h','4h'].includes(w.timeframe)){
  const base=coverage.coverage.find(x=>x.timeframe==='5m'&&x.contract===w.contract&&x.from===w.from&&x.role===w.role),children=rowsFor(base).map(x=>x.row),step={ '10m':'600000000000','1h':'3600000000000','4h':'14400000000000' }[w.timeframe],states={},childBuckets=new Map();
  for(const child of children){const bucket=(BigInt(child.window_start)/BigInt(step)*BigInt(step)).toString()+'|'+child.session_end_date;const a=childBuckets.get(bucket)??[];a.push(child);childBuckets.set(bucket,a);}
  for(const {row:parent} of records){if(BigInt(parent.window_start)<from||BigInt(parent.window_start)>=to)continue;const result=compareParent({parent,children:childBuckets.get(parent.window_start+'|'+parent.session_end_date)??[],stepNs:step,fromNs:from.toString(),toNs:to.toString()});states[result.state]=(states[result.state]??0)+1;}
  parity.push({contract:w.contract,timeframe:w.timeframe,role:w.role,from:w.from,to:w.to,states});
 }
}
const output={schemaVersion:'engine11.consolidated-readiness-research.v1',sourceRun:38333722706,sourceArtifact:11783458871,sourceCaptureAsOf:coverage.asOf,targetFrom:'2024-10-12',targetThrough:coverage.asOf.slice(0,10),currentWallClockAsOf:new Date().toISOString(),snapshotIsolation:'PER_RECEIPT_OBSERVATIONS_NO_ATOMIC_PROVIDER_ASOF',
 totals,windows,calendarDayMatrix:[...dayMatrix.values()],nativeParentResearchParity:parity,classificationSamples:samples,sourceFinality:'UNKNOWN',structuralEligible:false,qualificationNote:'COMPLETE is research-only accounting; current authentic source/calendar gates remain unaccepted. Day counts include distinct contracts/period labels, not continuous or expected per-day bar counts.'};
const source=JSON.parse(await readFile(process.argv[5]));const candidate=source.samples.find(x=>x.label==='ESZ4_METADATA_2024-12-20');output.historicalBindingProposal=proposeHistoricalIdentity({contract:'ESZ2024',metadata:candidate.rows[0],receiptId:candidate.receipts[0].receiptId,metadataObservedAt:candidate.receipts[0].observedAt});
await writeFile(process.argv[6],JSON.stringify(output)+'\n');console.log(JSON.stringify({totals,parityTotals:parity.reduce((a,w)=>{for(const [state,n] of Object.entries(w.states))a[w.timeframe+':'+state]=(a[w.timeframe+':'+state]??0)+n;return a;},{}),calendarDates:dayMatrix.size,binding:output.historicalBindingProposal}));
