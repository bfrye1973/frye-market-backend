// Engine 11 — audit existing authenticated Massive raw receipts. NO provider requests.
// Usage: node auditEngine11QuarterlyRollovers.mjs ARTIFACT_ROOT OUTPUT_JSON
import {readFile,readdir,mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
const [root,destination]=process.argv.slice(2);
if(!root||!destination)throw Error('USAGE: ROOT OUTPUT_JSON');
const hash=b=>createHash('sha256').update(b).digest('hex');
const full=(letter,year)=>'ES'+letter+year;
const short=(letter,year)=>'ES'+letter+String(year).slice(-1);
const months=[['H',3],['M',6],['U',9],['Z',12]];
const contracts=[];
for(let year=2020;year<=2024;year++)for(const [letter,month] of months)contracts.push({year,letter,month,id:full(letter,year),ticker:short(letter,year)});
const indexed=new Map(),yearEvidence=[];
const flags=[];
for(let year=2020;year<=2024;year++){
 const dir=path.join(root,String(year));
 const manifest=JSON.parse(await readFile(path.join(dir,'manifest.json'),'utf8'));
 if(manifest.year!==year||manifest.schema!=='engine11.2020-2024-raw-es-receipts.v1'||!Array.isArray(manifest.receipts)||manifest.failures?.length)throw Error('MANIFEST_INVALID_'+year);
 let rows=0,verified=0;
 for(const receipt of manifest.receipts){
  if(!/^\d{6}\.json$/.test(receipt.file))throw Error('UNSAFE_FILENAME');
  const saved=JSON.parse(await readFile(path.join(dir,receipt.file),'utf8'));
  const bytes=Buffer.from(saved.bodyBase64,'base64');
  const digest=hash(bytes);
  if(digest!==receipt.bodySha256||digest!==saved.bodySha256||receipt.ticker!==saved.ticker||receipt.frame!==saved.frame||receipt.rowCount!==saved.rowCount)throw Error('RECEIPT_HASH_OR_ID_MISMATCH_'+year+'_'+receipt.file);
  const payload=JSON.parse(bytes.toString('utf8'));
  if(!Array.isArray(payload.results)||payload.results.length!==saved.rowCount)throw Error('RECEIPT_CONTENT_MISMATCH');
  const contract=contracts.find(x=>x.year===year&&x.ticker===saved.ticker);
  if(!contract)throw Error('CONTRACT_TICKER_UNRECOGNIZED_'+saved.ticker);
  rows+=payload.results.length;verified++;
  if(saved.frame!=='1session')continue;
  const entries=indexed.get(contract.id)??[];
  for(const row of payload.results){
    if(row.ticker!==saved.ticker||typeof row.window_start!=='string'||typeof row.session_end_date!=='string'||!Number.isFinite(row.close)||!Number.isFinite(row.volume))throw Error('SESSION_ROW_INVALID_'+contract.id);
    entries.push({timestamp:row.window_start,session:row.session_end_date,close:row.close,volume:row.volume,settlement:Number.isFinite(row.settlement_price)?row.settlement_price:null,receipt:receipt.file});
  }
  indexed.set(contract.id,entries);
 }
 if(manifest.receipts.length!==verified)throw Error('RECEIPT_COUNT_MISMATCH');
 yearEvidence.push({year,receipts:verified,sourceObservations:rows});
}
function normalize(contract){
 const all=indexed.get(contract.id)??[],keys=new Map(),collisions=[];
 for(const r of all){
  const key=r.timestamp+'|'+r.session,prior=keys.get(key);
  if(!prior){keys.set(key,r);continue;}
  if(prior.close!==r.close||prior.volume!==r.volume||prior.settlement!==r.settlement)collisions.push({session:r.session,timestamp:r.timestamp,firstReceipt:prior.receipt,secondReceipt:r.receipt});
 }
 return {rows:[...keys.values()].sort((a,b)=>a.timestamp.localeCompare(b.timestamp)),collisions,total:all.length};
}
function thirdFriday(year,month){
 const first=new Date(Date.UTC(year,month-1,1)).getUTCDay();
 return new Date(Date.UTC(year,month-1,1+((5-first+7)%7)+14)).toISOString().slice(0,10);
}
const transitions=[];
for(let i=0;i<contracts.length-1;i++){
 const old=contracts[i],next=contracts[i+1];
 // 2024 Z is included as evidence, but 2025 H comes from existing trusted archive
 // and is deliberately not stitched to this source comparison.
 const a=normalize(old),b=normalize(next);
 const lookup=new Map(b.rows.map(r=>[r.timestamp+'|'+r.session,r]));
 const matched=a.rows.flatMap(r=>{const n=lookup.get(r.timestamp+'|'+r.session);return n?[{session:r.session,timestamp:r.timestamp,oldClose:r.close,newClose:n.close,closeDifference:Number((n.close-r.close).toFixed(2)),oldVolume:r.volume,newVolume:n.volume,settlementDifference:r.settlement!==null&&n.settlement!==null?Number((n.settlement-r.settlement).toFixed(2)):null}]:[]}).sort((x,y)=>x.timestamp.localeCompare(y.timestamp));
 const crossover=matched.find(r=>r.newVolume>r.oldVolume)??null;
 const prior=crossover?matched.filter(r=>r.timestamp<crossover.timestamp).at(-1)??null:null;
 const expiration=thirdFriday(old.year,old.month);
 const calendarCandidate=new Date(Date.parse(expiration+'T00:00:00Z')-4*86400000).toISOString().slice(0,10);
 const issue=matched.length===0?'NO_MATCHED_NATIVE_SESSIONS':a.collisions.length||b.collisions.length?'CONFLICTING_SESSION_SOURCE_ROWS':null;
 if(issue)flags.push({transition:old.id+'->'+next.id,issue});
 transitions.push({oldContract:old.id,newContract:next.id,oldTicker:old.ticker,newTicker:next.ticker,matchedSessions:matched.length,firstMatched:matched[0]?.session??null,lastMatched:matched.at(-1)?.session??null,firstObservedNewVolumeDominance:crossover,immediatelyPriorMatchedSession:prior,calendarCandidateMondayBeforeThirdFriday:calendarCandidate,referenceField:'UNSELECTED',rollPolicyApproved:false,rollInstantApproved:false,adjustmentCoefficientApproved:false,sourceIdentityCertified:false,sourceConflicts:{old:a.collisions,new:b.collisions},issue,matchedSessionsEvidence:matched});
}
const report={schema:'engine11.quarterly-es-overlap-audit.v1',generatedUtc:new Date().toISOString(),source:'immutable Massive original-body GitHub Actions artifacts 2020-2024',researchOnly:true,existingChartModified:false,selectedRollPolicy:null,allContinuousSeriesPublished:false,sourceYearEvidence:yearEvidence,transitions,flags,readiness:flags.length?'INCOMPLETE_SOURCE_EVIDENCE':'OVERLAP_EVIDENCE_COMPLETE_ROLL_POLICY_UNAPPROVED'};
await mkdir(path.dirname(destination),{recursive:true});
await writeFile(destination,JSON.stringify(report,null,2)+'\n');
console.log('ENGINE11_QUARTERLY_ROLLOVER_AUDIT '+JSON.stringify({years:yearEvidence,transitionCount:transitions.length,matched:transitions.filter(x=>x.matchedSessions>0).length,flags:flags.length,readiness:report.readiness,transitions:transitions.map(x=>({pair:x.oldContract+'->'+x.newContract,matched:x.matchedSessions,crossover:x.firstObservedNewVolumeDominance?.session??null,diff:x.firstObservedNewVolumeDominance?.closeDifference??null,calendarCandidate:x.calendarCandidateMondayBeforeThirdFriday,issue:x.issue}))}));
if(flags.length)process.exitCode=2;
