// Engine11 no-mutation seam audit between isolated 2020-2024 source research
// and immutable currently-served Engine2C UNADJUSTED private history pages.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import path from 'node:path';
const [oldRoot,privateRoot,reportFile]=process.argv.slice(2);
if(!oldRoot||!privateRoot||!reportFile)throw Error('USAGE: OLD_ROOT PRIVATE_PAGES_ROOT REPORT_FILE');
const sha=b=>createHash('sha256').update(b).digest('hex');
const frames=['5m','10m','1h','4h','1d','1w','1mo'];
const expected=[144999,72505,12094,2868,503,99,16];
const dataset='research-dataset:a0c81ce398869440b1b9cd42b94ced0101923356c4c860a9c13232a1f98f3c91';
const basis='price-basis:fcbfa10815555415c8afdfddbbc28a96a4f42207db162a0db853b549546b3908';
const cutoff=Date.parse('2024-10-12T00:00:00.000Z');
const report={schema:'engine11.pre2024-to-existing-seam.v1',verifiedAt:new Date().toISOString(),existingDatasetVersion:dataset,existingPriceBasisVersion:basis,frames:{},issues:[],existingHistoryFilesModified:false,sourceArchiveReconstructed:false,releaseApproved:false};
const problem=(code,detail)=>report.issues.push({code,detail});
try{
 const oldManifest=JSON.parse(await readFile(path.join(oldRoot,'manifest.json'),'utf8'));
 if(oldManifest.schema!=='engine11.pre2024.unadjusted.manifest.v1'||oldManifest.rolloverApproved!==false)throw Error('OLD_SEGMENT_IDENTITY_INVALID');
 const oldAccept=JSON.parse(await readFile(path.join(oldRoot,'acceptance-report.json'),'utf8'));
 if(!oldAccept.readiness?.startsWith('PASS_ISOLATED_RESEARCH')||oldAccept.problems?.length)throw Error('OLD_SEGMENT_NOT_VALIDATED');
 const folder=path.join(privateRoot,'continuousRaw');
 const catalog=JSON.parse(await readFile(path.join(folder,'continuousRaw-catalog.json'),'utf8'));
 if(catalog.datasetVersion!==dataset||catalog.priceBasisVersion!==basis||catalog.researchOnly!==true||catalog.structuralEligible!==false||catalog.executionPriceAuthority!==false){
  problem('PINNED_EXISTING_CATALOG_IDENTITY_CHANGED',{
   actual:{view:catalog.view,datasetVersion:catalog.datasetVersion,priceBasisVersion:catalog.priceBasisVersion,researchOnly:catalog.researchOnly,structuralEligible:catalog.structuralEligible,executionPriceAuthority:catalog.executionPriceAuthority,frames:Object.fromEntries(frames.map(frame=>[frame,catalog.frames?.[frame]?.rows??null]))},
   required:{view:'continuousRaw',datasetVersion:dataset,priceBasisVersion:basis,researchOnly:true,structuralEligible:false,executionPriceAuthority:false}
  });
  report.status='FAIL';
  throw Error('PINNED_EXISTING_CATALOG_IDENTITY_CHANGED_DIAGNOSTICS_CAPTURED');
 }
 for(let i=0;i<frames.length;i++){
  const frame=frames[i],oldEvidence=oldManifest.frameEvidence?.[frame],group=catalog.frames?.[frame];
  if(!oldEvidence||!group||group.rows!==expected[i])throw Error('FRAME_MANIFEST_INVALID_'+frame);
  const gz=await readFile(path.join(oldRoot,oldEvidence.file));
  if(sha(gz)!==oldEvidence.sha256)throw Error('OLD_ARCHIVE_HASH_'+frame);
  const oldRows=JSON.parse(gunzipSync(gz)).rows;
  if(!Array.isArray(oldRows)||oldRows.length!==oldEvidence.count)throw Error('OLD_ROWS_INVALID_'+frame);
  let oldLast=-Infinity,oldFirst=Infinity;
  const oldKeys=new Set();
  for(const r of oldRows){
   const ts=Date.parse(r.timestampUtc);
   if(!Number.isFinite(ts)||ts>=cutoff||ts<oldLast)throw Error('OLD_TIME_OR_ORDER_'+frame);
   if(oldKeys.has(ts))throw Error('OLD_DUPLICATE_'+frame);
   oldKeys.add(ts);oldLast=ts;oldFirst=Math.min(oldFirst,ts);
   if(r.adjustment!==0||!['open','high','low','close'].every(k=>Number.isFinite(r.prices?.[k])))throw Error('OLD_RAW_PRICE_INVALID_'+frame);
  }
  let newerFirst=Infinity,newerLast=-Infinity,last=Infinity,count=0,prevCursor=null,firstExistingRow=null;
  const newKeys=new Set();
  for(const entry of group.pages){
   if(entry.requestCursor!==prevCursor||!/^[a-zA-Z0-9_-]+\.json$/.test(entry.name))throw Error('BAD_PAGE_CHAIN_'+frame);
   const bytes=await readFile(path.join(folder,entry.name));
   if(sha(bytes)!==entry.sha256)throw Error('EXISTING_PAGE_HASH_MISMATCH_'+frame);
   const page=JSON.parse(bytes);
   if(page.datasetVersion!==dataset||page.priceBasisVersion!==basis||page.frame!==frame||page.rows?.length!==entry.rows||page.nextCursor!==entry.nextCursor||page.direction!=='DESC')throw Error('EXISTING_PAGE_CONTRACT_'+frame);
   for(const r of page.rows){
    const ts=Date.parse(r.timestampUtc);
    if(!Number.isFinite(ts)||ts<cutoff||ts>last)throw Error('EXISTING_TIME_OR_ORDER_'+frame);
    if(oldKeys.has(ts)||newKeys.has(ts))throw Error('SEAM_OVERLAP_OR_DUPLICATE_'+frame);
    newKeys.add(ts);last=ts;count++;newerFirst=Math.min(newerFirst,ts);newerLast=Math.max(newerLast,ts);
    if(r.adjustment!==0||!['open','high','low','close'].every(k=>Number.isFinite(r.prices?.[k])))throw Error('EXISTING_RAW_PRICE_INVALID_'+frame);
    if(ts===newerFirst)firstExistingRow=r;
   }
   prevCursor=entry.nextCursor;
  }
  if(count!==expected[i]||prevCursor!==null)throw Error('EXISTING_PAGINATION_INCOMPLETE_'+frame);
  if(!(oldLast<cutoff&&newerFirst>=cutoff&&oldLast<newerFirst))throw Error('HANDOFF_BOUNDARY_INVALID_'+frame);
  // Our target cutoff is within the already selected December 2024 contract.
  // Never splice a different physical contract at this historical boundary.
  const lastOldRow=oldRows.at(-1);
  if(lastOldRow?.sourceContract!=='ESZ2024'||firstExistingRow?.sourceContract!=='ESZ2024')
   throw Error('CROSS_ARCHIVE_CONTRACT_MISMATCH_'+frame);
  if(!lastOldRow?.prices||!firstExistingRow?.prices)throw Error('MISSING_HANDOFF_PRICES_'+frame);
  // This is source-date continuity, not certification of all exchange sessions.
  const seamGapMs=newerFirst-oldLast;
  const maximumExpectedMs=frame==='1mo'?62*86400000:frame==='1w'?14*86400000:frame==='1d'?7*86400000:frame==='4h'?5*86400000:4*86400000;
  if(seamGapMs>maximumExpectedMs)problem('SEAM_GAP_NEEDS_EXCHANGE_CALENDAR_REVIEW',{frame,oldLast:new Date(oldLast).toISOString(),existingFirst:new Date(newerFirst).toISOString(),gapHours:seamGapMs/3600000});
  report.frames[frame]={oldCount:oldRows.length,existingCount:count,combinedCount:oldRows.length+count,oldFirstUtc:new Date(oldFirst).toISOString(),oldLastUtc:new Date(oldLast).toISOString(),existingFirstUtc:new Date(newerFirst).toISOString(),existingLastUtc:new Date(newerLast).toISOString(),seamHours:seamGapMs/3600000,oldFileSha256:sha(gz),existingCatalogDatasetVersion:catalog.datasetVersion,existingPageChainVerified:true,noDuplicateTimestamps:true,oldLastContract:oldRows.at(-1).sourceContract,existingFirstContract:firstExistingRow.sourceContract,oldLastClose:lastOldRow.prices.close,existingFirstOpen:firstExistingRow.prices.open,existingFirstClose:firstExistingRow.prices.close,handoffOpenGapPoints:Number((firstExistingRow.prices.open-lastOldRow.prices.close).toFixed(2)),exchangeCalendarCertified:false};
 }
 report.status=report.issues.length?'REVIEW_REQUIRED':'PASS_READ_ONLY_SEAM_RESEARCH_ONLY';
}catch(e){problem('AUDIT_EXCEPTION',String(e?.stack||e));report.status='FAIL';}
await mkdir(path.dirname(reportFile),{recursive:true});
await writeFile(reportFile,JSON.stringify(report,null,2)+'\n');
console.log('ENGINE11_SEAM_AUDIT '+JSON.stringify({status:report.status,issues:report.issues,frames:report.frames}));
if(report.issues.length)process.exitCode=2;
