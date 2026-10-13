import { createHmac, timingSafeEqual } from 'node:crypto';
import { hash, instant, requireTruth } from '../rawCandles/identity.js';
import { buildSourceDataset } from './dataset.js';
import { freeze } from './evidence.js';
export function createSourceReader(dataset,{cursorSecret}) {
  requireTruth(typeof cursorSecret==='string'&&cursorSecret.length>=32,'V2_CURSOR_SECRET_REQUIRED');
  const bindings=dataset.bindings.map(x=>({contract:x.contract,ticker:x.ticker,metadataReceipt:dataset.receipts.find(r=>r.receiptId===x.metadataReceiptId)}));
  const rebuilt=buildSourceDataset({receipts:dataset.receipts,bindings,aggregationPolicyTag:dataset.manifest.aggregationPolicyTag});
  requireTruth(hash(dataset)===hash(rebuilt),'V2_DATASET_TAMPER');
  const sign=text=>createHmac('sha256',cursorSecret).update(text).digest('hex');
  return function page({datasetVersion,asOf,purpose='ISOLATED_RESEARCH_ONLY',limit=100,cursor=null}) {
    requireTruth(purpose==='ISOLATED_RESEARCH_ONLY','V2_PURPOSE_REJECTED');
    requireTruth(datasetVersion===dataset.datasetVersion,'V2_PINNED_VERSION_UNAVAILABLE');instant(asOf);
    requireTruth(instant(asOf)>=instant(dataset.firstUsableAt),'V2_ASOF_BEFORE_EVIDENCE');
    requireTruth(Number.isInteger(limit)&&limit>0&&limit<=5000,'V2_PAGE_LIMIT');
    const query={schemaVersion:'engine11.source-cursor.v2',datasetVersion,asOf,purpose,limit};let offset=0;
    if(cursor){
      requireTruth(typeof cursor==='string'&&cursor.length<=4096,'V2_CURSOR_FORMAT');
      const [encoded,signature,...extra]=cursor.split('.');requireTruth(!extra.length&&/^[a-f0-9]{64}$/.test(signature??''),'V2_CURSOR_FORMAT');
      requireTruth(timingSafeEqual(Buffer.from(signature,'hex'),Buffer.from(sign(encoded),'hex')),'V2_CURSOR_SIGNATURE');
      let decoded;try{decoded=JSON.parse(Buffer.from(encoded,'base64url').toString('utf8'));}catch{throw new Error('V2_CURSOR_PAYLOAD');}
      requireTruth(hash(decoded.query)===hash(query),'V2_CURSOR_QUERY_DRIFT');offset=decoded.offset;
      requireTruth(Number.isInteger(offset)&&offset>=0&&offset<=dataset.rows.length,'V2_CURSOR_OFFSET');
    }
    const rows=dataset.rows.slice(offset,offset+limit),next=offset+rows.length;
    const encoded=next<dataset.rows.length?Buffer.from(JSON.stringify({query,offset:next})).toString('base64url'):null;
    return freeze({schemaVersion:'engine11.source-page.v2',datasetVersion,rows,nextCursor:encoded?encoded+'.'+sign(encoded):null,
      etag:hash([query,offset,rows.map(x=>x.observationId)]),purpose,structuralEligible:false,sourceFinality:'UNKNOWN',analyticalInterval:null});
  };
}
