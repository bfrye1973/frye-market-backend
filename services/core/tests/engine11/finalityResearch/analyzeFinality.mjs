import { readFile,writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { digest } from '../../../logic/engine11/finalityResearchV1/sourceCapture.js';
import { sourceClockWindowStatus } from '../../../logic/engine11/finalityResearchV1/verify.js';
export async function analyzeFinality(inputPath){
 const d=JSON.parse(await readFile(inputPath));for(const r of d.receipts)if(digest(Buffer.from(r.bodyBase64,'base64'))!==r.bodySha256)throw new Error('RECEIPT_DIGEST');
 const sample=label=>d.samples.find(x=>x.label===label);const ticks=sample('JAN_TRADES_ALL');
 const lastOld=ticks.rows.filter(x=>x.session_end_date==='2025-01-30').at(-1),firstNew=ticks.rows.find(x=>x.session_end_date==='2025-01-31');
 const minute=sample('JAN_NATIVE_1min'),seconds=sample('JAN_SECONDS');
 const mixedFilterResults=['2025-01-30','2025-01-31'].map(date=>{const r=sample('JAN_MINUTE_SESSION_'+date);return {requestedSession:date,query:r.request,rowCount:r.rows.length,wrongSessionRows:r.rows.filter(x=>x.session_end_date!==date).length,identicalToUnfiltered:digest(JSON.stringify(r.rows))===digest(JSON.stringify(minute.rows)),traversalComplete:r.traversalComplete};});
 const conflictedParents=d.conflicts.filter(x=>['1min','5min','10min','1hour'].includes(x.resolution));
 const tickParity=conflictedParents.filter(x=>['1min','5min'].includes(x.resolution)).flatMap(g=>g.rows.map(parent=>{
  const end=BigInt(parent.window_start)+BigInt(g.resolution==='1min'?60:300)*1000000000n;
  const rows=ticks.rows.filter(x=>x.session_end_date===parent.session_end_date&&BigInt(x.timestamp)>=BigInt(parent.window_start)&&BigInt(x.timestamp)<end);
  const derived=rows.length?{open:rows[0].price,high:Math.max(...rows.map(x=>x.price)),low:Math.min(...rows.map(x=>x.price)),close:rows.at(-1).price,volume:rows.reduce((n,x)=>n+x.size,0),transactions:rows.length}:null;
  return {resolution:g.resolution,parent,rawTradeRows:rows.length,derived,state:derived&&Object.keys(derived).every(k=>derived[k]===parent[k])?'MATCHES_CAPTURED_SAME_SESSION_TRADES':'MISMATCH_OR_CAPTURE_EDGE'};
 }));
 const sourceClockTail=d.samples.filter(x=>x.label.startsWith('TAIL_')).map(s=>{const timeframe=s.label.slice(5),row=s.rows.at(-1);return {timeframe,observedAt:s.receipts.at(-1)?.observedAt,lastObservation:row,...(row?sourceClockWindowStatus({row,timeframe,observedAt:s.receipts.at(-1).observedAt}):{state:'NO_SOURCE_OBSERVATION'})};});
 return {schemaVersion:'engine11.finality-evidence-summary.v1',probeCommit:'ee0b193bcc4bd8bf36b6800684e70b916fb4aaad',runId:38338605379,artifactId:11785905749,asOf:d.asOf,queryCount:d.samples.length,
  queryManifest:d.samples.map(s=>({label:s.label,request:s.request,rows:s.rows.length,traversalComplete:s.traversalComplete,failure:s.failure,receiptIds:s.receipts.map(x=>x.receiptId)})),
  receiptManifest:d.receipts.map(({bodyBase64,...r})=>r),metadata:d.metadata,conflicts:d.conflicts,
  mixedAggregateSessionFilters:mixedFilterResults,tradeBoundary:{lastOld,firstNew,observedGapNs:(BigInt(firstNew.timestamp)-BigInt(lastOld.timestamp)).toString(),sourceCause:'UNRESOLVED',canonicalSessionAcceptance:false},
  tickParity,secondBucketFixture:seconds.rows.filter(x=>x.window_start==='1738274136000000000'),
  parityCounts:d.smallerParity.reduce((a,x)=>(a[x.resolution+':'+x.state]=(a[x.resolution+':'+x.state]??0)+1,a),{}),
  tickSamples:d.tickSamples,repeatObservation:d.repeatObservation,readiness:d.readiness,sourceClockTail,
  official:d.official.map(({bodyBase64,...x})=>x),structuralEligible:false,sourceFinality:'UNKNOWN',
  authenticProof:'Original provider receipt hashes and bounded native/trade observations; calendar trust, source finality and correction authority remain absent.'};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const r=await analyzeFinality(process.argv[2]);await writeFile(process.argv[3],JSON.stringify(r,null,2)+'\n');console.log(JSON.stringify({mixedFilters:r.mixedAggregateSessionFilters,boundary:r.tradeBoundary,tickParity:r.tickParity,sourceClockTail:r.sourceClockTail}));}
