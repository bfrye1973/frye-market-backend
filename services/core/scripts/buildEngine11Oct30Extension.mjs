// Engine11 October extension — isolated, source-hashed, research-only.
// Consumes pinned original October13 datasets plus native ESZ6 receipt artifact.
// No price calculation or rollover methodology is implemented here:
// ingestArchive/buildDataset/hash are imported from immutable Phase4 source SHA.
import {readFile,writeFile,mkdir,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {gunzipSync,gzipSync} from 'node:zlib';
import path from 'node:path';
import {ingestArchive,buildDataset,hash} from '../logic/engine11/continuousChartResearchV1/series.js';
const [oldDir,receiptDir,outDir]=process.argv.slice(2);
if(!oldDir||!receiptDir||!outDir)throw Error('REQUIRED_IMMUTABLE_INPUT_DIRS');
await mkdir(outDir,{recursive:true,mode:0o700});
const load=async name=>JSON.parse(gunzipSync(await readFile(path.join(oldDir,name+'.json.gz'))));
const originalSource=await load('continuous-source-observations');
const manifest=JSON.parse(await readFile(path.join(receiptDir,'manifest.json'),'utf8'));
if(manifest.schema!=='engine11.oct30.esz6.receipts.v1'||manifest.physicalContract!=='ESZ2026'||
   manifest.providerTicker!=='ESZ6'||manifest.asOf!=='2026-10-31T00:00:00.000Z'||manifest.researchOnly!==true)throw Error('ESZ6_RECEIPT_MANIFEST_MISMATCH');
const receiptBodies=[];
const sha=b=>createHash('sha256').update(b).digest('hex');
for(const item of manifest.records){
 const p=JSON.parse(await readFile(path.join(receiptDir,item.file),'utf8'));
 if(sha(Buffer.from(p.receipt.bodyBase64,'base64'))!==item.sha256)throw Error('ESZ6_RECEIPT_BYTES_CHANGED');
 if(p.receipt.httpStatus!==200||p.receipt.parseFailure||p.receipt.evidenceKind!=='HTTP_BODY_AFTER_CONTENT_DECODE')throw Error('ESZ6_RECEIPT_NOT_ACCEPTED');
 receiptBodies.push(p.receipt);
}
const additions=ingestArchive({receipts:receiptBodies,from:manifest.from,asOf:manifest.asOf});
const originalKeys=new Set(originalSource.observations.map(r=>[r.contractProposal,r.frame,r.timestampNs].join('|')));
const newRows=additions.observations.filter(r=>r.reason===null&&!originalKeys.has([r.contractProposal,r.frame,r.timestampNs].join('|')));
const distinct=new Map();
for(const row of newRows){
 const k=[row.contractProposal,row.frame,row.timestampNs].join('|');
 const prior=distinct.get(k);
 if(prior){
  const left=JSON.stringify(prior.raw),right=JSON.stringify(row.raw);
  if(left!==right)throw Error('DISAGREEING_ESZ6_SAME_TIMESTAMP_'+row.frame);
 }else distinct.set(k,row);
}
if(!distinct.size)throw Error('NO_NEW_ESZ6_NATIVE_ROWS');
const source={
 observations:[...originalSource.observations,...distinct.values()],
 receipts:[...originalSource.receipts,...additions.receipts],
 queryWindows:[...originalSource.queryWindows,...additions.queryWindows],
 from:originalSource.from,asOf:manifest.asOf
};
source.observations.sort((a,b)=>String(a.observationId).localeCompare(String(b.observationId)));
source.receipts.sort((a,b)=>String(a.receiptId).localeCompare(String(b.receiptId)));
const sourceArchiveSha256=hash({originalSourceArchiveSha256:hash(originalSource),receiptSha256:manifest.records.map(x=>x.sha256),asOf:manifest.asOf});
const configurations=[
 ['continuousRaw','CONTINUOUS_UNADJUSTED'],
 ['continuousAdjustedClose','CONTINUOUS_ADJUSTED'],
 ['continuousAdjustedSettlement','CONTINUOUS_ADJUSTED'],
 ['continuousAdjustedVolumeClose','CONTINUOUS_ADJUSTED'],
 ['actualESZ2026','ACTUAL_ESZ2026']
];
const proof=[];
for(const [name,view] of configurations){
 const older=await load(name),{policyVersion,...base}=older.policy;
 const p={...base,to:manifest.asOf};
 const newPolicy=Object.freeze({...p,policyVersion:'roll-policy:'+hash(p)});
 const built=buildDataset(source,newPolicy,{sourceArchiveSha256,view});
 // Immutable older selected OHLCV and adjustments: compare by native contract/frame/timestamp,
 // not generated dataset IDs, which necessarily change when a new policy is versioned.
 const index=new Map(built.rows.map(row=>[[row.sourceContract,row.frame,row.timestampNs].join('|'),row]));
 let checked=0;
 for(const old of older.rows){
  const key=[old.sourceContract,old.frame,old.timestampNs].join('|');
  const newer=index.get(key);
  if(!newer)throw Error('EXISTING_CANDLE_MISSING_'+name+'_'+key);
  for(const field of ['open','high','low','close'])
   if(newer.prices[field]!==old.prices[field])throw Error('OLDER_PRICE_CHANGED_'+name+'_'+key+'_'+field);
  if(newer.volume!==old.volume||newer.adjustment!==old.adjustment||
     newer.settlementPrice!==old.settlementPrice)throw Error('OLDER_VOLUME_OR_ADJUSTMENT_CHANGED_'+name+'_'+key);
  checked++;
 }
 const countNew=built.rows.length-older.rows.length;
 if(countNew<=0)throw Error('NO_VALID_NEW_ROWS_'+name);
 await writeFile(path.join(outDir,name+'.json.gz'),gzipSync(Buffer.from(JSON.stringify(built)),{level:6}),{flag:'wx',mode:0o600});
 proof.push({name,view,oldRows:older.rows.length,newRows:built.rows.length,added:countNew,verifiedUnchanged:checked,
  datasetVersion:built.datasetVersion,priceBasisVersion:built.manifest.priceBasisVersion,
  frames:Object.fromEntries(Object.entries(built.coverage).map(([f,v])=>[f,{rows:v.rows,first:v.firstUtc,last:v.lastUtc}]))});
 console.log('ENGINE11_OCT30_VERIFIED',JSON.stringify({name,oldRows:checked,added:countNew}));
}
const receiptSha=sha(Buffer.from(JSON.stringify(manifest.records)));
const result={schema:'engine11.oct30.rebuild.proof.v1',researchOnly:true,executionPriceAuthority:false,
 originalArchiveUntouched:true,oldAsOf:originalSource.asOf,newAsOf:manifest.asOf,
 nativeReceiptCount:manifest.records.length,sourceReceiptManifestSha256:receiptSha,
 addedNativeObservationCount:distinct.size,sourceArchiveSha256,datasets:proof};
await writeFile(path.join(outDir,'extension-validation.json'),JSON.stringify(result,null,2),{flag:'wx',mode:0o600});
console.log('ENGINE11_OCT30_FULL_EXTENSION_PASS',JSON.stringify({native:distinct.size,datasets:proof.map(p=>({name:p.name,newRows:p.newRows,added:p.added}))}));
