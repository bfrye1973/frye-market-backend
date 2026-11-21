// Engine11 — verify saved combined research artifact *after* packaging, without
// importing its contents into production or mutating original history.
import {readFile,writeFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import path from 'node:path';
const [root,out]=process.argv.slice(2);
if(!root||!out)throw Error('USAGE COMBINED_ROOT REPORT_JSON');
const frames=['5m','10m','1h','4h','1d','1w','1mo'];
const expectedModern=[144999,72505,12094,2868,503,99,16];
const sha=b=>createHash('sha256').update(Buffer.isBuffer(b)||typeof b==='string'?b:JSON.stringify(b)).digest('hex');
const report={schema:'engine11.combined-research-verification.v1',frames:{},problems:[],status:'PENDING',productionEligible:false,liveChartUpdated:false};
function problem(code,frame,details){if(report.problems.length<50)report.problems.push({code,frame,details});}
try{
 const manifest=JSON.parse(await readFile(path.join(root,'manifest.json'),'utf8'));
 if(manifest.schema!=='engine11.combined-unadjusted-research-handoff.v1'||manifest.status!=='PASS_ISOLATED_RESEARCH_PACKAGE_ONLY_NOT_SERVING_AUTHORIZED')throw Error('UNEXPECTED_MANIFEST');
 if(manifest.releaseApproved!==false||manifest.rolloverApproved!==false||manifest.sourceIdentityAccepted!==false||manifest.researchOnly!==true||manifest.executionPriceAuthority!==false||manifest.sourceRowChanges!==0||manifest.originalPageFilesModified!==0)throw Error('UNSAFE_MANIFEST_FLAGS');
 if(!/^research-dataset:[a-f0-9]{64}$/.test(manifest.version)||!/^price-basis:[a-f0-9]{64}$/.test(manifest.priceBasisVersion))throw Error('UNPINNED_VERSION');
 if(manifest.existingDatasetVersion!=='research-dataset:a0c81ce398869440b1b9cd42b94ced0101923356c4c860a9c13232a1f98f3c91')throw Error('MODERN_DATASET_IDENTITY');
 let sum=0;
 for(let i=0;i<frames.length;i++){
  const frame=frames[i],f=manifest.frames?.[frame];
  if(!f){problem('MISSING_FRAME',frame);continue;}
  const saved=await readFile(path.join(root,f.file));
  if(sha(saved)!==f.sha256)throw Error('SAVED_ARTIFACT_HASH_MISMATCH_'+frame);
  const decoded=JSON.parse(gunzipSync(saved).toString('utf8'));
  if(decoded.frame!==frame||decoded.schema!=='engine11.combined-unadjusted-research-frame.v1'||!Array.isArray(decoded.rows))throw Error('FRAME_BODY_INVALID_'+frame);
  const rows=decoded.rows,oldCount=f.oldRows,modernCount=f.modernRows;
  if(!Number.isSafeInteger(oldCount)||oldCount<=0||modernCount!==expectedModern[i]||rows.length!==oldCount+modernCount||f.combinedRows!==rows.length)throw Error('SAVED_ROW_COUNTS_'+frame);
  if(f.oldLastContract!=='ESZ2024'||f.modernFirstContract!=='ESZ2024'||f.preservedExistingRows!==true)throw Error('CONTRACT_OR_PRESERVATION_FLAG_'+frame);
  let prev=-Infinity;
  const seen=new Set();
  for(let n=0;n<rows.length;n++){
   const row=rows[n],t=Date.parse(row.timestampUtc),p=row.prices;
   if(!Number.isFinite(t)||t<=prev||seen.has(t)){problem('DUPLICATE_OR_UNSORTED',frame,{index:n});break;}
   prev=t;seen.add(t);
   if(row.frame!==frame||row.adjustment!==0||!['open','high','low','close'].every(k=>Number.isFinite(p?.[k]))||p.high<Math.max(p.open,p.close,p.low)||p.low>Math.min(p.open,p.close,p.high)){problem('INVALID_UNADJUSTED_ROW',frame,{index:n});break;}
   if(n<oldCount&&t>=Date.parse('2024-10-12T00:00:00Z')||n>=oldCount&&t<Date.parse('2024-10-12T00:00:00Z')){problem('ROW_WRONG_SIDE_OF_SEAM',frame,{index:n});break;}
  }
  if(sha(rows.slice(oldCount))!==f.modernOriginalRowVectorSha256||f.modernOriginalRowVectorSha256!==f.modernSavedRowVectorSha256)problem('EXISTING_2024_TO_2026_ROW_CHANGED',frame);
  if(rows[oldCount-1]?.sourceContract!=='ESZ2024'||rows[oldCount]?.sourceContract!=='ESZ2024')problem('CONTRACT_HANDOFF_MISMATCH',frame);
  if(rows[0]?.timestampUtc!==f.firstUtc||rows.at(-1)?.timestampUtc!==f.lastUtc)problem('COVERAGE_MISMATCH',frame);
  if(Date.parse(f.firstUtc)>Date.parse('2020-04-01T00:00:00Z'))problem('MARCH_2020_NOT_COVERED',frame);
  report.frames[frame]={oldRows:oldCount,existingRows:modernCount,combinedRows:rows.length,firstUtc:f.firstUtc,lastUtc:f.lastUtc,existingRowsUnchanged:sha(rows.slice(oldCount))===f.modernOriginalRowVectorSha256,sha256:f.sha256};
  sum+=rows.length;
 }
 if(sum!==manifest.totalRows)problem('TOTAL_ROW_COUNT','all',{manifest:manifest.totalRows,verified:sum});
 report.datasetVersion=manifest.version;report.priceBasisVersion=manifest.priceBasisVersion;report.totalRows=sum;
}catch(e){problem('VALIDATOR_EXCEPTION','all',String(e?.stack||e));}
report.status=report.problems.length?'FAIL':'PASS_SEVEN_FRAMES_RESEARCH_ONLY_NOT_PRODUCTION_APPROVED';
await writeFile(out,JSON.stringify(report,null,2)+'\n');
console.log('ENGINE11_COMBINED_ARCHIVE_VALIDATION',JSON.stringify(report));
if(report.problems.length)process.exitCode=2;
