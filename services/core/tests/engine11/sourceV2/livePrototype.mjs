import { mkdir,writeFile } from 'node:fs/promises';
import { acquireSourceObservations } from '../../../logic/engine11/sourceObservationsV2/provider.js';
import { bindingFromMetadata } from '../../../logic/engine11/sourceObservationsV2/evidence.js';
import { buildSourceDataset,correspondenceReport } from '../../../logic/engine11/sourceObservationsV2/dataset.js';
import { createSourceReader } from '../../../logic/engine11/sourceObservationsV2/reader.js';
import { requireTruth } from '../../../logic/engine11/rawCandles/identity.js';
const apiKey=process.env.POLYGON_API_KEY;if(!apiKey)throw new Error('Existing credential required');
const acquisitions=[],bindings=[],receipts=[],bindingFailures=[];
for(const [ticker,contract,date] of [['ESH0','ESH2020','2020-03-10'],['ESM0','ESM2020','2020-03-10'],['ESU6','ESU2026','2026-09-10'],['ESZ6','ESZ2026','2026-09-10']]) {
  const request='https://api.massive.com/futures/v1/contracts?'+new URLSearchParams({ticker,product_code:'ES',date,limit:'100'});
  const a=await acquireSourceObservations({request,apiKey,maxPages:1,maxRows:100});acquisitions.push(a);receipts.push(...a.receipts);
  try{const metadataReceipt=a.receipts[0];bindingFromMetadata(contract,ticker,metadataReceipt);bindings.push({contract,ticker,metadataReceipt});}
  catch(e){bindingFailures.push({contract,ticker,reason:e.code??'METADATA_UNAVAILABLE'});}
}
const specs=[
  ['ESH0','4hour','2020-03-09T20:00:00Z','2020-03-10T00:00:00Z'],
  ['ESH0','5min','2020-03-03T21:00:00Z','2020-03-03T21:10:00Z'],
  ['ESH0','1hour','2020-03-03T21:00:00Z','2020-03-03T22:00:00Z'],
  ['ESM0','5min','2020-03-03T21:00:00Z','2020-03-03T21:10:00Z'],
  ['ESU6','4hour','2026-09-09T20:00:00Z','2026-09-10T00:00:00Z'],
  ['ESZ6','4hour','2026-09-09T20:00:00Z','2026-09-10T00:00:00Z']
];
for(const [ticker,resolution,from,to] of specs){
  const request='https://api.massive.com/futures/v1/aggs/'+ticker+'?'+new URLSearchParams({resolution,'window_start.gte':String(BigInt(Date.parse(from))*1000000n),'window_start.lt':String(BigInt(Date.parse(to))*1000000n),limit:'100',sort:'window_start.asc'});
  const a=await acquireSourceObservations({request,apiKey,maxPages:2,maxRows:200});acquisitions.push(a);receipts.push(...a.receipts);
}
const dataset=buildSourceDataset({receipts,bindings});const asOf=new Date().toISOString();
const read=createSourceReader(dataset,{cursorSecret:'research-only-ephemeral-secret-'+crypto.randomUUID()});
let cursor=null,ids=[];
do{const args={datasetVersion:dataset.datasetVersion,asOf,limit:1,cursor};const a=read(args),b=read(args);requireTruth(a.etag===b.etag&&a.nextCursor===b.nextCursor,'LIVE_V2_NONDETERMINISTIC_PAGE');ids.push(...a.rows.map(x=>x.observationId));cursor=a.nextCursor;}while(cursor);
requireTruth(new Set(ids).size===dataset.rows.length && ids.length===dataset.rows.length,'LIVE_V2_PAGING_LOSS');
requireTruth(dataset.rows.every(x=>x.structuralEligible===false&&x.analyticalInterval===null&&x.correctionAccepted===false),'LIVE_V2_BOUNDARY');
const correspondence=correspondenceReport(dataset,[{v1Id:'ES:4h:1788984000000000000',v1DatasetVersion:'ALIAS_ONLY_NOT_VERIFIED_V1_DATASET',providerTicker:'ESU6',sourceResolution:'4hour',sourceTimestampNs:'1788984000000000000'}]);
const summary={datasetVersion:dataset.datasetVersion,receiptCount:receipts.length,sourceRows:dataset.rows.length,
  bindings:dataset.bindings.map(x=>({contract:x.contract,version:x.bindingVersion})),bindingFailures,
  acquisitionFailures:acquisitions.filter(x=>x.status==='INCOMPLETE').map(x=>x.failure),
  sameTimestampCases:dataset.rows.filter(x=>dataset.rows.some(y=>y.observationId!==x.observationId&&y.providerTicker===x.providerTicker&&y.sourceResolution===x.sourceResolution&&y.payload.window_start===x.payload.window_start)).map(x=>({ticker:x.providerTicker,resolution:x.sourceResolution,timestamp:x.payload.window_start,session:x.payload.session_end_date,sourceKey:x.sourceKey,identityState:x.identityState})),
  deterministicPagingPassed:true,correspondence,purpose:'ISOLATED_RESEARCH_ONLY',structuralEligible:false,sourceFinality:'UNKNOWN'};
await mkdir('research-evidence',{recursive:true});await writeFile('research-evidence/engine11-source-v2.json',JSON.stringify({summary,dataset,acquisitions},null,2)+'\n');
console.log('V2_LIVE_SUMMARY '+JSON.stringify(summary));
