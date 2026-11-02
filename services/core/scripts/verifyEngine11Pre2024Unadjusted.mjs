// Engine 11: read-only validation of the built pre-2024 raw-continuous research segment.
// Does not call Massive, modify price data, or import into production.
import {readFile,writeFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import path from 'node:path';

const [root,outfile]=process.argv.slice(2);
if(!root||!outfile)throw Error('USAGE: BUILD_ROOT REPORT_JSON');
const sha=b=>createHash('sha256').update(b).digest('hex');
const frames=['5m','10m','1h','4h','1d','1w','1mo'];
const startMs=Date.parse('2020-03-01T00:00:00.000Z');
const endMs=Date.parse('2024-10-12T00:00:00.000Z');
const report={schema:'engine11.pre2024.segment-acceptance.v1',verifiedUtc:new Date().toISOString(),targetFromUtc:new Date(startMs).toISOString(),targetToExclusiveUtc:new Date(endMs).toISOString(),verifiedFrames:{},problems:[],readiness:'PENDING'};
const fail=(code,detail='')=>report.problems.push({code,detail:String(detail)});
try{
 const m=JSON.parse(await readFile(path.join(root,'manifest.json'),'utf8'));
 if(m.schema!=='engine11.pre2024.unadjusted.manifest.v1')fail('MANIFEST_SCHEMA');
 if(m.basis?.view!=='CONTINUOUS_UNADJUSTED_PRE2024')fail('WRONG_VIEW');
 if(m.basis?.segmentFromUtc!==report.targetFromUtc||m.basis?.segmentToExclusiveUtc!==report.targetToExclusiveUtc)fail('WRONG_WINDOW');
 if(m.existingPost2024ArchiveModified!==false||m.researchOnly!==true||m.rolloverApproved!==false||m.executionPriceAuthority!==false)fail('UNEXPECTED_RELEASE_FLAGS');
 if(m.transitions?.length!==19)fail('TRANSITION_COUNT',m.transitions?.length);
 if(m.ambiguousSourceGroups)fail('AMBIGUOUS_GROUPS',m.ambiguousSourceGroups);
 if(m.sourceCounts&&Object.keys(m.sourceCounts).length!==5)fail('SOURCE_YEAR_COUNT');
 if(!/^research-dataset:[a-f0-9]{64}$/.test(m.datasetVersion)||!/^price-basis:[a-f0-9]{64}$/.test(m.priceBasisVersion))fail('INVALID_VERSION');
 for(const f of frames){
  const d=m.frameEvidence?.[f];
  if(!d){fail('MISSING_FRAME',f);continue;}
  if(d.file!=='continuousRaw-pre2024-'+f+'.json.gz')fail('UNEXPECTED_FILENAME',f);
  const compressed=await readFile(path.join(root,d.file));
  if(sha(compressed)!==d.sha256)fail('FILE_SHA_MISMATCH',f);
  const page=JSON.parse(gunzipSync(compressed).toString('utf8'));
  if(page.schema!=='engine11.pre2024.unadjusted.research.v1'||page.frame!==f||!Array.isArray(page.rows))fail('FRAME_SCHEMA',f);
  const rows=page.rows||[],seen=new Set();
  if(rows.length!==d.count||!rows.length)fail('FRAME_COUNT_MISMATCH',f);
  let earliest=Infinity,latest=-Infinity,prev=-Infinity;
  for(const r of rows){
   const ms=Date.parse(r.timestampUtc),p=r.prices;
   if(!Number.isFinite(ms)||ms<startMs||ms>=endMs||ms<prev)fail('OUT_OF_ORDER_OR_RANGE',f);
   if(seen.has(r.timestampUtc))fail('DUPLICATE_TIMESTAMP',f+' '+r.timestampUtc);
   seen.add(r.timestampUtc);prev=ms;earliest=Math.min(earliest,ms);latest=Math.max(latest,ms);
   if(r.frame!==f||!/^ES[HMUZ]202[0-4]$/.test(r.sourceContract??'')||!['open','high','low','close'].every(k=>Number.isFinite(p?.[k]))||p.high<Math.max(p.open,p.close,p.low)||p.low>Math.min(p.open,p.close,p.high)||!Number.isFinite(r.volume)||r.volume<0||r.adjustment!==0||r.executionPriceAuthority!==false)fail('INVALID_RAW_CANDLE',f+' '+r.timestampUtc);
  }
  const first=Number.isFinite(earliest)?new Date(earliest).toISOString():null,last=Number.isFinite(latest)?new Date(latest).toISOString():null;
  if(d.firstUtc!==first||d.lastUtc!==last)fail('COVERAGE_METADATA_MISMATCH',f);
  if(first&&earliest>Date.parse('2020-04-01T00:00:00Z'))fail('NO_MARCH_2020_COVERAGE',f);
  if(last&&latest<Date.parse('2024-09-01T00:00:00Z'))fail('MISSING_LATE_2024_COVERAGE',f);
  report.verifiedFrames[f]={count:rows.length,firstUtc:first,lastUtc:last,compressedSha256:sha(compressed)};
 }
 report.manifestDatasetVersion=m.datasetVersion;
 report.manifestPriceBasisVersion=m.priceBasisVersion;
 report.rawReceiptCount=m.receiptsCount;
 report.excluded=m.excluded;
 report.ambiguousSourceGroups=m.ambiguousSourceGroups;
 report.existingPost2024ArchiveModified=m.existingPost2024ArchiveModified;
 report.verifiedFrameCount=Object.keys(report.verifiedFrames).length;
 report.totalRows=Object.values(report.verifiedFrames).reduce((s,v)=>s+v.count,0);
}catch(e){fail('VALIDATOR_EXCEPTION',e?.stack||e);}
report.readiness=report.problems.length?'FAIL':'PASS_RESEARCH_SEGMENT_ONLY_NOT_PRODUCTION_APPROVED';
await writeFile(outfile,JSON.stringify(report,null,2)+'\n');
console.log('ENGINE11_PRE2024_ACCEPTANCE '+JSON.stringify({readiness:report.readiness,verifiedFrames:report.verifiedFrames,totalRows:report.totalRows,problems:report.problems.slice(0,15),datasetVersion:report.manifestDatasetVersion}));
if(report.problems.length)process.exitCode=2;
