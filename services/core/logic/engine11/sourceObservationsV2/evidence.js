import { createHash } from 'node:crypto';
import { hash, instant, requireTruth, esContract, validateProviderAlias } from '../rawCandles/identity.js';
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
export function safeRequest(input) {
  const url = new URL(input);
  requireTruth(['https://api.massive.com','https://api.polygon.io'].includes(url.origin) && !url.username && !url.password && !url.hash, 'UNSAFE_V2_REQUEST');
  requireTruth(/^\/futures\/v1\/(contracts|aggs\/ES[HMUZ]\d{1,4})$/.test(url.pathname), 'UNSUPPORTED_V2_ENDPOINT');
  requireTruth([...url.searchParams.keys()].every(k => ['date','product_code','ticker','limit','sort','cursor','resolution','window_start.gte','window_start.lt'].includes(k)), 'UNSAFE_V2_QUERY');
  return url.toString();
}

// Lossless timestamp parsing and exact result-row byte spans. Duplicate keys are
// ambiguous evidence, not last-write-wins JSON. Original bytes survive parse failure.
export function parseBody(bytes) {
  const text = new TextDecoder('utf-8',{fatal:true}).decode(bytes), spans=[];
  let i=0;
  const ws=()=>{while(/[ \t\r\n]/.test(text[i] ?? '') && i<text.length)i++;};
  function value(key='',depth=0) {
    requireTruth(depth<64,'V2_JSON_DEPTH'); ws();const start=i;let out;
    if(text[i]==='{') {
      i++;out={};ws();const seen=new Set();
      if(text[i]!=='}')while(true){ws();requireTruth(text[i]==='"','V2_JSON_KEY');const k=value('',depth+1);requireTruth(!seen.has(k),'V2_DUPLICATE_JSON_KEY');seen.add(k);ws();requireTruth(text[i++]===':','V2_JSON_COLON');Object.defineProperty(out,k,{value:value(k,depth+1),enumerable:true,writable:true,configurable:true});ws();if(text[i]!==',')break;i++;}
      requireTruth(text[i++]==='}','V2_JSON_OBJECT');
    } else if(text[i]==='[') {
      i++;out=[];ws();if(text[i]!==']')while(true){ws();const rowStart=i;out.push(value('',depth+1));if(key==='results' && depth===1)spans.push([rowStart,i]);ws();if(text[i]!==',')break;i++;}
      requireTruth(text[i++ ]===']','V2_JSON_ARRAY');
    } else if(text[i]==='"') {
      i++;while(i<text.length){if(text[i]==='\\'){i+=2;continue;}if(text[i++]==='"')break;}out=JSON.parse(text.slice(start,i));
    } else {
      const token=text.slice(i).match(/^(?:-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/)?.[0];requireTruth(token,'V2_JSON_SCALAR');i+=token.length;
      if(key==='window_start' && /^\d{16,20}$/.test(token))out=token;
      else {out=JSON.parse(token);if(typeof out==='number' && (!Number.isFinite(out)||(Number.isInteger(out)&&!Number.isSafeInteger(out))))out={numericLexeme:token};}
    }
    return out;
  }
  const parsed=value();ws();requireTruth(i===text.length && parsed && typeof parsed==='object' && !Array.isArray(parsed),'V2_JSON_ROOT');
  requireTruth(Array.isArray(parsed.results),'V2_RESULTS_REQUIRED');
  requireTruth(spans.length===parsed.results.length && spans.length<=50000,'V2_RESULT_SPANS');
  let charCursor=0,byteCursor=0;
  const rows=parsed.results.map((payload,n)=>{
    const start=byteCursor+Buffer.byteLength(text.slice(charCursor,spans[n][0]),'utf8');
    const end=start+Buffer.byteLength(text.slice(spans[n][0],spans[n][1]),'utf8');
    charCursor=spans[n][1];byteCursor=end;return {payload,byteStart:start,byteEnd:end};
  });
  return {parsed,rows};
}
export function captureReceipt({request,body,observedAt,captureId,page=1,httpStatus=200,evidenceKind='HTTP_BODY_AFTER_CONTENT_DECODE'}) {
  const clean=safeRequest(request);instant(observedAt);
  requireTruth(typeof captureId==='string' && captureId.length>0 && Number.isSafeInteger(page)&&page>0,'V2_CAPTURE_CONTEXT');
  const bytes=Buffer.from(body);requireTruth(bytes.length<=8*1024*1024,'V2_BODY_LIMIT');
  requireTruth(['HTTP_BODY_AFTER_CONTENT_DECODE','ARCHIVED_ORIGINAL_BODY_TEXT','FIXTURE'].includes(evidenceKind),'V2_EVIDENCE_KIND');
  const base={schemaVersion:'engine11.source-receipt.v2',provider:'MASSIVE_FUTURES',request:clean,observedAt,captureId,page,httpStatus,evidenceKind,bodySha256:sha256(bytes),bodyBase64:bytes.toString('base64')};
  const receiptId='receipt:v2:'+hash(base);let parsed=null,rows=[],parseFailure=null;
  try{({parsed,rows}=parseBody(bytes));}catch(e){parseFailure=e.code??'V2_INVALID_JSON';}
  const observations=rows.map((row,n)=>{
    const raw=bytes.subarray(row.byteStart,row.byteEnd);const rowDigest=sha256(raw);
    return {schemaVersion:'engine11.source-observation.v2',observationId:'observation:v2:'+hash([receiptId,page,n,rowDigest]),receiptId,page,ordinal:n,
      rowDigest,rowBase64:raw.toString('base64'),byteStart:row.byteStart,byteEnd:row.byteEnd,payload:row.payload,
      sourceFinality:'UNKNOWN',purpose:'ISOLATED_RESEARCH_ONLY',structuralEligible:false};
  });
  return freeze({...base,receiptId,parseFailure,providerStatus:parsed?.status??null,nextUrl:parsed?.next_url??null,observations});
}
export function verifyReceipt(receipt) {
  const rebuilt=captureReceipt({...receipt,body:Buffer.from(receipt.bodyBase64,'base64')});
  requireTruth(hash(rebuilt)===hash(receipt),'V2_RECEIPT_TAMPER');return rebuilt;
}
export function bindingFromMetadata(contract,ticker,receipt) {
  const evidence=verifyReceipt(receipt);const c=validateProviderAlias(contract,ticker);
  requireTruth(new URL(evidence.request).pathname==='/futures/v1/contracts' && evidence.httpStatus===200 && !evidence.parseFailure && !evidence.nextUrl,'V2_METADATA_UNAVAILABLE');
  const matches=evidence.observations.filter(x=>x.payload?.ticker===ticker && x.payload.product_code==='ES' && x.payload.trading_venue==='XCME' &&
    typeof x.payload.settlement_date==='string' && x.payload.settlement_date.startsWith(`${c.expirationYear}-${String(c.expirationMonth).padStart(2,'0')}-`));
  requireTruth(matches.length===1,'V2_FULL_CONTRACT_BINDING_UNRESOLVED');
  const row=matches[0];const binding={schemaVersion:'engine11.contract-binding.v2',contract:c.contract,instrumentId:esContract(contract).instrumentId,ticker,metadataReceiptId:evidence.receiptId,metadataObservationId:row.observationId,
    metadataObservedAt:evidence.observedAt,bindingEvidenceKind:evidence.evidenceKind,settlementDate:row.payload.settlement_date,
    firstTradeDate:row.payload.first_trade_date??null,lastTradeDate:row.payload.last_trade_date??null,
    state:'METADATA_MATCH_RESEARCH_ONLY',structuralEligible:false};
  return freeze({...binding,bindingVersion:'binding:v2:'+hash(binding)});
}
