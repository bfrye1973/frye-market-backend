// Engine11 isolated combined 2020–2026 Continuous ES UNADJUSTED research handoff.
// Read-only old/new input archives. No provider calls, adjustment or chart writes.
// This is NOT a production-serving archive: existing private route pins must not be changed.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {gzipSync,gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import path from 'node:path';
const [oldRoot,existingRoot,seamFile,outRoot]=process.argv.slice(2);
if(!oldRoot||!existingRoot||!seamFile||!outRoot)throw Error('USAGE: PRE2024_ROOT OCT30_PRIVATE_ROOT PASSING_SEAM_JSON OUTPUT_ROOT');
const sha=b=>createHash('sha256').update(typeof b==='string'||Buffer.isBuffer(b)?b:JSON.stringify(b)).digest('hex');
const frames=['5m','10m','1h','4h','1d','1w','1mo'];
const requiredDataset='research-dataset:a0c81ce398869440b1b9cd42b94ced0101923356c4c860a9c13232a1f98f3c91';
const requiredBasis='price-basis:fcbfa10815555415c8afdfddbbc28a96a4f42207db162a0db853b549546b3908';
const requiredCounts=[144999,72505,12094,2868,503,99,16];
const cutoff=Date.parse('2024-10-12T00:00:00.000Z');
const old=JSON.parse(await readFile(path.join(oldRoot,'manifest.json'),'utf8'));
const seam=JSON.parse(await readFile(seamFile,'utf8'));
const catalog=JSON.parse(await readFile(path.join(existingRoot,'continuousRaw','continuousRaw-catalog.json'),'utf8'));
if(seam.status!=='PASS_READ_ONLY_SEAM_RESEARCH_ONLY'||seam.issues?.length||Object.keys(seam.frames||{}).length!==7)throw Error('SEAM_NOT_PASSED');
if(old.schema!=='engine11.pre2024.unadjusted.manifest.v1'||old.rolloverApproved!==false||old.existingPost2024ArchiveModified!==false||old.basis?.view!=='CONTINUOUS_UNADJUSTED_PRE2024')throw Error('OLD_ARCHIVE_UNVERIFIED');
if(catalog.view!=='continuousRaw'||catalog.datasetVersion!==requiredDataset||catalog.priceBasisVersion!==requiredBasis||catalog.researchOnly!==true||catalog.structuralEligible!==false||catalog.executionPriceAuthority!==false)throw Error('EXISTING_PIN_MISMATCH');
const report={schema:'engine11.combined-unadjusted-research-handoff.v1',existingDatasetVersion:requiredDataset,existingPriceBasisVersion:requiredBasis,pre2024DatasetVersion:old.datasetVersion,pre2024PriceBasisVersion:old.priceBasisVersion,seamStatus:seam.status,sourceAsOf:'2026-10-30',frames:{},sourceRowChanges:0,originalPageFilesModified:0,releaseApproved:false,rolloverApproved:false,sourceIdentityAccepted:false,executionPriceAuthority:false,researchOnly:true};
await mkdir(outRoot,{recursive:true,mode:0o700});
for(let index=0;index<frames.length;index++){
 const frame=frames[index],oldFrame=old.frameEvidence?.[frame],modern=catalog.frames?.[frame];
 if(!oldFrame||!modern||modern.rows!==requiredCounts[index])throw Error('FRAME_COUNTS_PIN_MISMATCH_'+frame);
 const bytes=await readFile(path.join(oldRoot,oldFrame.file));
 if(sha(bytes)!==oldFrame.sha256)throw Error('OLD_COMPRESSED_SHA_MISMATCH_'+frame);
 const older=JSON.parse(gunzipSync(bytes).toString('utf8')).rows;
 if(!Array.isArray(older)||older.length!==oldFrame.count)throw Error('OLD_ROW_COUNT_MISMATCH_'+frame);
 const modernDescending=[],modernRawHashes=[];
 let prior=Infinity,lastCursor=null,modernCount=0;
 for(const entry of modern.pages){
  if(entry.requestCursor!==lastCursor)throw Error('MODERN_PAGE_CHAIN_'+frame);
  const file=await readFile(path.join(existingRoot,'continuousRaw',entry.name));
  if(sha(file)!==entry.sha256)throw Error('MODERN_IMMUTABLE_PAGE_HASH_'+frame);
  const page=JSON.parse(file.toString('utf8'));
  if(page.frame!==frame||page.datasetVersion!==requiredDataset||page.priceBasisVersion!==requiredBasis||page.direction!=='DESC'||page.requestCursor!==entry.requestCursor||page.nextCursor!==entry.nextCursor||page.rows?.length!==entry.rows)throw Error('MODERN_PAGE_CONTRACT_'+frame);
  for(const row of page.rows){
   const stamp=Date.parse(row.timestampUtc);
   if(!Number.isFinite(stamp)||stamp>prior||stamp<cutoff||row.frame!==frame||row.adjustment!==0||row.priceBasisVersion!==requiredBasis||row.sourceContract==null)throw Error('MODERN_ROW_INVALID_'+frame);
   prior=stamp;modernDescending.push(row);modernRawHashes.push(sha(row));modernCount++;
  }
  lastCursor=page.nextCursor;
 }
 if(lastCursor!==null||modernCount!==requiredCounts[index])throw Error('MODERN_PAGE_TOTAL_'+frame);
 const modernAscending=modernDescending.reverse();
 const lastOld=older.at(-1),firstNew=modernAscending[0];
 if(!lastOld||!firstNew||lastOld.sourceContract!=='ESZ2024'||firstNew.sourceContract!=='ESZ2024')throw Error('HANDOFF_CONTRACT_CHANGE_'+frame);
 if(Date.parse(lastOld.timestampUtc)>=Date.parse(firstNew.timestampUtc))throw Error('HANDOFF_OVERLAP_'+frame);
 const unique=new Set(),combined=[];
 for(const row of [...older,...modernAscending]){
  const stamp=Date.parse(row.timestampUtc);
  if(!Number.isFinite(stamp)||unique.has(stamp)||stamp<cutoff&&row.priceBasis!=='UNADJUSTED_RESEARCH'||stamp>=cutoff&&row.priceBasisVersion!==requiredBasis)throw Error('COMBINED_ROW_IDENTITY_INVALID_'+frame);
  if(combined.length&&stamp<=Date.parse(combined.at(-1).timestampUtc))throw Error('COMBINED_NOT_ORDERED_'+frame);
  unique.add(stamp);
  if(!['open','high','low','close'].every(k=>Number.isFinite(row.prices?.[k]))||row.adjustment!==0)throw Error('CANDLE_PRICE_MUTATION_'+frame);
  combined.push(row);
 }
 const savedName='engine11-continuous-unadjusted-2020plus-'+frame+'.json.gz';
 const saved=gzipSync(JSON.stringify({schema:'engine11.combined-unadjusted-research-frame.v1',frame,rows:combined}),{level:6});
 await writeFile(path.join(outRoot,savedName),saved,{flag:'wx',mode:0o600});
 const decode=JSON.parse(gunzipSync(saved).toString('utf8')).rows;
 if(decode.length!==combined.length||sha(decode.slice(older.length))!==sha(modernAscending)||sha(decode.slice(0,older.length))!==sha(older))throw Error('SOURCE_ROW_VECTOR_NOT_PRESERVED_'+frame);
 report.frames[frame]={file:savedName,sha256:sha(saved),oldRows:older.length,modernRows:modernCount,combinedRows:combined.length,firstUtc:combined[0].timestampUtc,lastUtc:combined.at(-1).timestampUtc,oldLastUtc:lastOld.timestampUtc,modernFirstUtc:firstNew.timestampUtc,oldLastContract:lastOld.sourceContract,modernFirstContract:firstNew.sourceContract,modernOriginalRowVectorSha256:sha(modernAscending),modernSavedRowVectorSha256:sha(decode.slice(older.length)),existingPageShaVector:sha(modern.pages.map(p=>p.sha256)),preservedExistingRows:true};
 console.log('ENGINE11_JOINED_FRAME',JSON.stringify({frame,...report.frames[frame]}));
}
report.version='research-dataset:'+sha({old:old.datasetVersion,existing:requiredDataset,frames:report.frames,seamStatus:seam.status,view:'CONTINUOUS_UNADJUSTED'});
report.priceBasisVersion='price-basis:'+sha({old:old.priceBasisVersion,existing:requiredBasis,view:'CONTINUOUS_UNADJUSTED',changeExistingRows:false});
report.totalRows=Object.values(report.frames).reduce((sum,v)=>sum+v.combinedRows,0);
report.status='PASS_ISOLATED_RESEARCH_PACKAGE_ONLY_NOT_SERVING_AUTHORIZED';
await writeFile(path.join(outRoot,'manifest.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx',mode:0o600});
console.log('ENGINE11_COMBINED_HISTORY_RESEARCH_READY',JSON.stringify({version:report.version,priceBasisVersion:report.priceBasisVersion,totalRows:report.totalRows,frames:Object.fromEntries(frames.map(f=>[f,report.frames[f].combinedRows])),sourceRowChanges:report.sourceRowChanges,releaseApproved:false}));
