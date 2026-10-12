import { hash, requireTruth, instant } from '../rawCandles/identity.js';
import { freeze, verifyReceipt, bindingFromMetadata } from './evidence.js';
const flag={purpose:'ISOLATED_RESEARCH_ONLY',structuralEligible:false,sourceFinality:'UNKNOWN',analyticalInterval:null,coverageComplete:false};
export function buildSourceDataset({receipts,bindings=[],aggregationPolicyTag='MASSIVE_NATIVE_UNRESOLVED'}) {
  requireTruth(Array.isArray(receipts)&&receipts.length>0 && typeof aggregationPolicyTag==='string'&&aggregationPolicyTag.length>0,'V2_DATASET_INPUT');
  const verifiedReceipts=receipts.map(verifyReceipt);
  requireTruth(new Set(verifiedReceipts.map(x=>x.receiptId)).size===verifiedReceipts.length,'V2_DUPLICATE_RECEIPT');
  const verifiedBindings=bindings.map(x=>bindingFromMetadata(x.contract,x.ticker,x.metadataReceipt));
  requireTruth(verifiedBindings.every(x=>verifiedReceipts.some(r=>r.receiptId===x.metadataReceiptId)),'V2_METADATA_RECEIPT_DEPENDENCY_REQUIRED');
  requireTruth(new Set(verifiedBindings.map(x=>x.ticker)).size===verifiedBindings.length,'V2_AMBIGUOUS_BINDING');
  const rows=[];
  for(const receipt of verifiedReceipts) {
    const url=new URL(receipt.request);if(!url.pathname.includes('/aggs/'))continue;
    const ticker=decodeURIComponent(url.pathname.split('/').at(-1)),resolution=url.searchParams.get('resolution');
    for(const observation of receipt.observations) {
      const p=observation.payload;const binding=verifiedBindings.find(x=>x.ticker===ticker);
      const componentsValid=p && p.ticker===ticker && typeof p.window_start==='string'&&/^\d{16,20}$/.test(p.window_start) && typeof p.session_end_date==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(p.session_end_date)&&
        Number.isFinite(Date.parse(p.session_end_date+'T00:00:00Z')) && new Date(p.session_end_date+'T00:00:00Z').toISOString().slice(0,10)===p.session_end_date && !!resolution;
      const responseValid=receipt.httpStatus===200 && !receipt.parseFailure && receipt.providerStatus==='OK';
      const lifespanMatch=binding && typeof binding.firstTradeDate==='string' && typeof binding.lastTradeDate==='string' && componentsValid && p.session_end_date>=binding.firstTradeDate && p.session_end_date<=binding.lastTradeDate;
      const sourceKey=componentsValid && lifespanMatch && responseValid ? 'source:v2:'+hash([receipt.provider,binding.instrumentId,ticker,resolution,p.window_start,p.session_end_date,aggregationPolicyTag]):null;
      rows.push({...observation,sourceKey,sourceRevisionId:sourceKey?'revision:v2:'+hash([sourceKey,observation.rowDigest]):null,
        parsedContentDigest:hash(p),bindingVersion:binding?.bindingVersion??null,bindingObservedAt:binding?.metadataObservedAt??null,
        sourceTimestampNs:componentsValid?p.window_start:null,sourceSessionLabel:componentsValid?p.session_end_date:null,
        providerTicker:ticker,sourceResolution:resolution,observedAt:receipt.observedAt,
        identityState:sourceKey?'SESSION_DISCRIMINATED_RESEARCH_KEY':!responseValid?'RESPONSE_UNAVAILABLE':!componentsValid?'MALFORMED_SOURCE_COMPONENTS':'FULL_CONTRACT_BINDING_UNRESOLVED',...flag});
    }
  }
  const groups=new Map();for(const row of rows)if(row.sourceKey){const group=groups.get(row.sourceKey)??[];group.push(row);groups.set(row.sourceKey,group);}
  const classified=rows.map(row=>{
    const group=groups.get(row.sourceKey)??[row],revisions=new Set(group.map(x=>x.sourceRevisionId)),semantic=new Set(group.map(x=>x.parsedContentDigest));
    return {...row,revisionClassification:!row.sourceKey?'UNRESOLVED':semantic.size>1?'SAME_KEY_CHANGED_CONTENT_UNCLASSIFIED':revisions.size>1?'EQUIVALENT_PARSED_CONTENT_DISTINCT_BYTES':group.length>1?'REPEATED_IDENTICAL_CONTENT':'SINGLE_OBSERVATION',
      correctionAccepted:false,analyticalState:'QUARANTINED_PENDING_SOURCE_CALENDAR_FINALITY'};
  });
  classified.sort((a,b)=>{
    const ta=BigInt(a.sourceTimestampNs??'0'),tb=BigInt(b.sourceTimestampNs??'0');if(ta!==tb)return ta<tb?-1:1;
    for(const k of ['providerTicker','sourceSessionLabel','sourceResolution','sourceKey','sourceRevisionId','observationId']){const d=String(a[k]??'').localeCompare(String(b[k]??''),'en');if(d)return d;}return 0;
  });
  const manifest={schemaVersion:'engine11.source-dataset.v2',identityPolicyVersion:'engine11.source-prototype.v2.0',aggregationPolicyTag,receiptIds:verifiedReceipts.map(x=>x.receiptId).sort(),bindingVersions:verifiedBindings.map(x=>x.bindingVersion).sort(),observationIds:classified.map(x=>x.observationId),...flag};
  const firstUsableAt=[...verifiedReceipts.map(x=>x.observedAt),...verifiedBindings.map(x=>x.metadataObservedAt)].reduce((latest,t)=>instant(t)>instant(latest)?t:latest);
  return freeze({manifest,datasetVersion:'dataset:v2:'+hash(manifest),firstUsableAt,receipts:verifiedReceipts,bindings:verifiedBindings,rows:classified,...flag});
}
export function correspondenceReport(dataset,v1Rows) {
  return freeze(v1Rows.map(old=>{
    const matches=dataset.rows.filter(row=>row.providerTicker===old.providerTicker&&row.sourceResolution===old.sourceResolution&&row.sourceTimestampNs===old.sourceTimestampNs);
    return {v1Id:old.v1Id,v1DatasetVersion:old.v1DatasetVersion??null,v2DatasetVersion:dataset.datasetVersion,
      status:!matches.length||matches.some(x=>!x.sourceKey)?'UNRESOLVED':new Set(matches.map(x=>x.sourceKey)).size>1?'ONE_TO_MANY':'CANDIDATE_CORRESPONDENCE',
      observationIds:matches.map(x=>x.observationId),sourceKeys:[...new Set(matches.map(x=>x.sourceKey).filter(Boolean))],migrationApproved:false,...flag};
  }));
}
