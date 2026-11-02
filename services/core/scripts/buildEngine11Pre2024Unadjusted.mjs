// Engine11 isolated research projection; NO production routes and NO Massive requests.
// Inputs: immutable original-body yearly archives + audited overlap report.
// Existing October-2024+ price rows are never read, replaced, or recalculated.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {gzipSync} from 'node:zlib';
import path from 'node:path';
const [rawRoot,auditFile,outDir]=process.argv.slice(2);
if(!rawRoot||!auditFile||!outDir)throw Error('USAGE: RAW_ROOT AUDIT_JSON OUTPUT_DIR');
const sha=b=>createHash('sha256').update(b).digest('hex');
const begin='2020-03-01T00:00:00.000Z', end='2024-10-12T00:00:00.000Z';
const beginMs=Date.parse(begin), endMs=Date.parse(end);
const frames={ '5min':'5m','10min':'10m','1hour':'1h','4hour':'4h','1session':'1d','1week':'1w','1month':'1mo'};
const periodMs={'5m':300000,'10m':600000,'1h':3600000,'4h':14400000,'1d':86400000,'1w':604800000};
const shortToFull=new Map();
for(let year=2020;year<=2024;year++)for(const letter of ['H','M','U','Z'])shortToFull.set('ES'+letter+String(year).slice(-1),'ES'+letter+year);
function switchUtc(date){
 // Identical research convention to the post-2024 Engine11 candidate policy:
 // Sunday at 17:00 America/Chicago before a Monday roll label.
 const prior=new Date(Date.parse(date+'T00:00:00Z')-86400000).toISOString().slice(0,10);
 const guess=Date.parse(prior+'T17:00:00Z');
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/Chicago',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(guess)).filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
 const seen=Date.UTC(+parts.year,+parts.month-1,+parts.day,+parts.hour,+parts.minute,+parts.second);
 return new Date(guess+(guess-seen)).toISOString();
}
function nextEnd(start,frame){
 if(frame==='1mo'){const d=new Date(start);return Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,1);}
 return start+periodMs[frame];
}
function parseSource(bytes){
 // Retain source nanosecond precision. Saved body is never rewritten.
 const text=bytes.toString('utf8').replace(/("window_start"\s*:\s*)(\d{16,20})(?=\s*[,}])/g,'$1"$2"');
 return JSON.parse(text);
}
const audit=JSON.parse(await readFile(auditFile,'utf8'));
if(audit.schema!=='engine11.quarterly-es-overlap-audit.v1'||audit.transitions?.length!==19||audit.flags?.length!==0||audit.sourceYearEvidence?.length!==5)throw Error('QUARTERLY_EVIDENCE_NOT_READY');
const transitions=audit.transitions.map(x=>({from:x.oldContract,to:x.newContract,calendarCandidate:x.calendarCandidateMondayBeforeThirdFriday,effectiveUtc:switchUtc(x.calendarCandidateMondayBeforeThirdFriday),matchedSessions:x.matchedSessions,rollApproved:false,volumeCrossoverObserved:x.firstObservedNewVolumeDominance?.session??null,priceCoefficientApproved:false}));
for(let i=0;i<transitions.length;i++)if((i&&transitions[i-1].to!==transitions[i].from)||(i&&transitions[i].effectiveUtc<=transitions[i-1].effectiveUtc)||transitions[i].matchedSessions<1)throw Error('BROKEN_TRANSITION_CHAIN');
const selectedContract=ms=>{let c='ESH2020';for(const t of transitions)if(ms>=Date.parse(t.effectiveUtc))c=t.to;return c;};
const groups=new Map(),receipts=[],sourceCounts={},excluded={};
function exclusion(reason){excluded[reason]=(excluded[reason]??0)+1;}
for(let year=2020;year<=2024;year++){
 const dir=path.join(rawRoot,String(year)),manifest=JSON.parse(await readFile(path.join(dir,'manifest.json'),'utf8'));
 const rowSummary=audit.sourceYearEvidence.find(x=>x.year===year);
 if(!rowSummary||manifest.year!==year||manifest.failures?.length||manifest.receipts?.length!==rowSummary.receipts)throw Error('SOURCE_YEAR_MISMATCH_'+year);
 let n=0;
 for(const entry of manifest.receipts){
  if(!/^\d{6}\.json$/.test(entry.file))throw Error('UNSAFE_SOURCE_FILENAME');
  const e=JSON.parse(await readFile(path.join(dir,entry.file),'utf8')),body=Buffer.from(e.bodyBase64,'base64');
  if(sha(body)!==e.bodySha256||e.bodySha256!==entry.bodySha256||e.frame!==entry.frame||e.ticker!==entry.ticker)throw Error('IMMUTABLE_SOURCE_DIGEST_MISMATCH');
  const p=parseSource(body);
  if(!Array.isArray(p.results)||p.results.length!==entry.rowCount)throw Error('SOURCE_ROW_COUNT_MISMATCH');
  const full=shortToFull.get(e.ticker),frame=frames[e.frame];
  if(!full||!frame)throw Error('UNKNOWN_CONTRACT_OR_FRAME');
  n+=p.results.length;
  receipts.push({year,file:entry.file,sha256:e.bodySha256,ticker:e.ticker,frame,rows:p.results.length});
  for(const r of p.results){
   if(typeof r.window_start!=='string'||! /^\d{16,20}$/.test(r.window_start)){exclusion('BAD_TIMESTAMP');continue;}
   const ms=Number(BigInt(r.window_start)/1000000n),periodEnd=nextEnd(ms,frame);
   if(ms<beginMs||ms>=endMs){exclusion('OUT_OF_TARGET_WINDOW');continue;}
   if(selectedContract(ms)!==full){exclusion('OVERLAP_CONTRACT_NOT_SELECTED');continue;}
   if(transitions.some(t=>ms<Date.parse(t.effectiveUtc)&&periodEnd>Date.parse(t.effectiveUtc))){exclusion('PERIOD_SPANS_ROLL_CANDIDATE');continue;}
   if(r.ticker!==e.ticker||!['open','high','low','close','volume'].every(k=>Number.isFinite(r[k]))||r.low>Math.min(r.open,r.close)||r.high<Math.max(r.open,r.close)){exclusion('MALFORMED_SOURCE_OHLCV');continue;}
   const key=frame+'|'+r.window_start;
   const list=groups.get(key)||[];
   list.push({frame,full,ticker:e.ticker,ns:r.window_start,time:new Date(ms).toISOString(),session:r.session_end_date??null,prices:{open:r.open,high:r.high,low:r.low,close:r.close},volume:r.volume,settlement:Number.isFinite(r.settlement_price)?r.settlement_price:null,receipt:year+'/'+entry.file,sourceRowSha256:sha(JSON.stringify(r)),periodEnd:new Date(periodEnd).toISOString()});
   groups.set(key,list);
  }
 }
 if(n!==rowSummary.sourceObservations)throw Error('SOURCE_YEAR_TOTAL_MISMATCH_'+year);
 sourceCounts[year]={receipts:rowSummary.receipts,observations:n};
}
const byFrame=Object.fromEntries(Object.values(frames).map(x=>[x,[]]));
const ambiguity=[];
for(const [key,list] of groups){
 const fields=list.map(x=>JSON.stringify({contract:x.full,session:x.session,prices:x.prices,volume:x.volume,settlement:x.settlement})),unique=new Set(fields);
 if(unique.size!==1){
  ambiguity.push({key,sourceReceipts:list.map(x=>x.receipt),reason:'CONFLICTING_SAME_START_OBSERVATIONS'});
  exclusion('AMBIGUOUS_SAME_START');continue;
 }
 const row=list[0];
 byFrame[row.frame].push({researchCandleId:'engine11-pre2024:'+sha([key,list.map(x=>x.receipt),fields[0]]),frame:row.frame,timestampUtc:row.time,timestampNs:row.ns,nominalPeriodEndUtc:row.periodEnd,sourceContract:row.full,providerTicker:row.ticker,sourceSessionLabel:row.session,sourceReceiptPaths:[...new Set(list.map(x=>x.receipt))],prices:row.prices,volume:row.volume,settlementPrice:row.settlement,adjustment:0,priceBasis:'UNADJUSTED_RESEARCH',completion:'UNKNOWN',calendarAccepted:false,rolloverApproved:false,structuralEligible:false,executionPriceAuthority:false});
}
await mkdir(outDir,{recursive:true});
const frameEvidence={};
for(const [frame,rows] of Object.entries(byFrame)){
 rows.sort((a,b)=>a.timestampUtc.localeCompare(b.timestampUtc));
 if(!rows.length)throw Error('EMPTY_FRAME_'+frame);
 const filename='continuousRaw-pre2024-'+frame+'.json.gz';
 const bytes=gzipSync(JSON.stringify({schema:'engine11.pre2024.unadjusted.research.v1',frame,rows}),{level:6});
 await writeFile(path.join(outDir,filename),bytes,{flag:'wx'});
 frameEvidence[frame]={file:filename,sha256:sha(bytes),count:rows.length,firstUtc:rows[0].timestampUtc,lastUtc:rows.at(-1).timestampUtc};
}
const basis={view:'CONTINUOUS_UNADJUSTED_PRE2024',rollConvention:'ENGINE11_EXISTING_POST2024_CALENDAR_CANDIDATE',segmentFromUtc:begin,segmentToExclusiveUtc:end,sourceAuditSha256:sha(await readFile(auditFile)),sourceReceiptVectorSha256:sha(receipts),transitionVectorSha256:sha(transitions),researchOnly:true};
const manifest={schema:'engine11.pre2024.unadjusted.manifest.v1',datasetVersion:'research-dataset:'+sha({basis,frameEvidence}),priceBasisVersion:'price-basis:'+sha(basis),basis,frameEvidence,sourceCounts,receiptsCount:receipts.length,excluded,ambiguousSourceGroups:ambiguity.length,ambiguousSamples:ambiguity.slice(0,40),transitions,joinBoundary:'2024-10-12T00:00:00.000Z (exclusive)',existingPost2024ArchiveModified:false,rolloverApproved:false,sourceIdentityAccepted:false,calendarAccepted:false,sourceFinality:'UNKNOWN',researchOnly:true,structuralEligible:false,executionPriceAuthority:false};
await writeFile(path.join(outDir,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
console.log('ENGINE11_PRE2024_UNADJUSTED_BUILT '+JSON.stringify({datasetVersion:manifest.datasetVersion,priceBasisVersion:manifest.priceBasisVersion,frameEvidence,sourceCounts,ambiguous:ambiguity.length,excluded,rolloverApproved:false,existingArchiveModified:false}));
