// Engine11 P0 source receipt v3: metadata-only, deterministic, no network or storage.
// Keeps original provider bytes under caller control; never returns raw bodies or API keys.
// Uses the pinned historical lossless parser/byte-range definition unchanged.
import { parseBody, sha256, freeze } from '../sourceObservationsV2/evidence.js';
import { hash, requireTruth } from '../rawCandles/identity.js';

const allowedKeys = new Set(['resolution','window_start.gte','window_start.lt',
  'window_start.lte','sort','limit','cursor']);
const allowedOrigins = new Set(['https://api.massive.com','https://api.polygon.io']);

export function sanitizeMassiveAggregateRequest(input) {
  const original = new URL(input);
  requireTruth(allowedOrigins.has(original.origin) && !original.username &&
    !original.password && !original.hash, 'V3_UNSAFE_ORIGIN');
  requireTruth(/^\/futures\/v1\/aggs\/ES[HMUZ]\d{1,4}$/.test(original.pathname),
    'V3_PHYSICAL_ES_CONTRACT_REQUIRED');
  const clean = new URL(original.origin + original.pathname);
  let apiKeyRemoved = false;
  for (const [key,value] of original.searchParams) {
    if (key === 'apiKey') { apiKeyRemoved = true; continue; }
    requireTruth(allowedKeys.has(key), 'V3_UNSAFE_QUERY_PARAMETER');
    clean.searchParams.append(key,value);
  }
  return freeze({url:clean.toString(),apiKeyRemoved});
}

export function captureReceiptV3({
  request,body,physicalContract,frame,httpStatus=200,
  requestStartedAtMs,firstByteAtMs,bodyCompletedAtMs,
  requestToFirstByteMonoMs,requestToBodyMonoMs,
  resolver=null,sourceMode='REST_AGGREGATE_OBSERVED',
}={}) {
  const clean=sanitizeMassiveAggregateRequest(request);
  requireTruth(typeof physicalContract==='string' &&
    new URL(clean.url).pathname.endsWith('/'+physicalContract),
    'V3_CONTRACT_REQUEST_MISMATCH');
  requireTruth(['1m','5m','10m'].includes(frame),'V3_UNSUPPORTED_FRAME');
  requireTruth(Number.isInteger(httpStatus)&&httpStatus>=200&&httpStatus<=599,
    'V3_HTTP_STATUS');
  const times=[requestStartedAtMs,firstByteAtMs,bodyCompletedAtMs];
  requireTruth(times.every(t=>Number.isSafeInteger(t)&&t>0)&&
    times[0]<=times[1]&&times[1]<=times[2],'V3_RECEIPT_TIME_ORDER');
  requireTruth([requestToFirstByteMonoMs,requestToBodyMonoMs].every(t=>
    typeof t==='number'&&Number.isFinite(t)&&t>=0)&&
    requestToFirstByteMonoMs<=requestToBodyMonoMs,'V3_MONOTONIC_TIME_ORDER');
  requireTruth(['REST_AGGREGATE_OBSERVED','HISTORICAL_REFETCH',
    'SYNTHETIC_FIXTURE'].includes(sourceMode),'V3_SOURCE_MODE_INVALID');
  const bytes=Buffer.from(body);
  requireTruth(bytes.length>0&&bytes.length<=8*1024*1024,'V3_BODY_LIMIT');
  const {parsed,rows}=parseBody(bytes);
  requireTruth(httpStatus===200,'V3_HTTP_NOT_SUCCESS');
  // next_url can contain credential-like query fields; retain only a sanitized
  // same-provider aggregate URL, otherwise fail closed rather than leak it.
  let nextUrl=null;
  if(parsed.next_url!==undefined&&parsed.next_url!==null) {
    nextUrl=sanitizeMassiveAggregateRequest(parsed.next_url).url;
  }
  // Capture the exact normalized value identity without retaining source bodies.
  // This digest is only a comparison token, never a provider trust assertion.
  const normalizedRow = r => {
    const p=r.payload;
    const ns=String(p?.window_start??'');
    requireTruth(/^\\d{16,20}$/.test(ns),'V3_INVALID_WINDOW_START');
    const nanos=BigInt(ns);
    requireTruth(nanos>0n && nanos%1000000000n===0n,'V3_INVALID_WINDOW_ALIGNMENT');
    const time=Number(nanos/1000000000n);
    requireTruth(Number.isSafeInteger(time),'V3_INVALID_WINDOW_TIME');
    const out={time,
      open:Number(p?.open),high:Number(p?.high),
      low:Number(p?.low),close:Number(p?.close),
      volume:Number(p?.volume??0)};
    requireTruth([out.open,out.high,out.low,out.close,out.volume]
      .every(Number.isFinite),'V3_SOURCE_OHLCV_INVALID');
    requireTruth(out.high>=out.low && out.open>=out.low &&
      out.open<=out.high && out.close>=out.low &&
      out.close<=out.high && out.volume>=0,'V3_SOURCE_OHLCV_INVALID');
    return out;
  };
  const observations=rows.map((r,ordinal)=>freeze({
    ordinal,windowStartNs:String(r.payload?.window_start??''),
    byteStart:r.byteStart,byteEnd:r.byteEnd,
    rowDigest:sha256(bytes.subarray(r.byteStart,r.byteEnd)),
    normalizedBarDigest:hash(normalizedRow(r)),
  }));
  requireTruth(observations.every(o=>/^\d{16,20}$/.test(o.windowStartNs)),
    'V3_INVALID_WINDOW_START');
  const base={
    schema:'engine11.es.originalSourceReceipt.v3',
    providerId:'MASSIVE_POLYGON',physicalContract,frame,
    sourceMode,request:clean.url,apiKeyRemoved:clean.apiKeyRemoved,
    httpStatus,bodySha256:sha256(bytes),bodyBytes:bytes.length,
    requestStartedAtMs,firstByteAtMs,bodyCompletedAtMs,
    requestToFirstByteMonoMs,requestToBodyMonoMs,
    clock:{status:'UNVERIFIED',maxUncertaintyMs:null},
    providerFinality:'UNKNOWN',entitlementMode:'UNKNOWN',
    bodyRetained:false,sourceTrustVerified:false,
    engine3ConsumptionVerified:false,
    resolver:resolver?{
      resolvedSymbol:resolver.resolvedSymbol??null,
      selectionRule:resolver.selectionRule??null,
      checkedAt:resolver.checkedAt??null,
    }:null,
    nextUrl,observations,
  };
  return freeze({...base,receiptId:'receipt:v3:'+hash(base)});
}

/**
 * Bind only actually returned normalized bars to their exact source-row digests.
 * This is *structural* linkage, not a claim about Engine3 consumption or trust.
 * A conflicting same-start provider row is ambiguous and fails closed.
 */
export function bindSelectedBarsToReceipt(receipt,selectedBars) {
  requireTruth(receipt?.schema==='engine11.es.originalSourceReceipt.v3' &&
    Array.isArray(selectedBars),'V3_BIND_INPUT_INVALID');
  requireTruth(receipt.nextUrl===null,'V3_PAGINATION_INCOMPLETE');
  const sourceByStart=new Map();
  for(const source of receipt.observations) {
    const timeSec=Number(BigInt(source.windowStartNs)/1000000000n);
    const previous=sourceByStart.get(timeSec);
    requireTruth(!previous||previous.rowDigest===source.rowDigest,
      'V3_CONFLICTING_SOURCE_REVISIONS');
    if(!previous)sourceByStart.set(timeSec,source);
  }
  const seen=new Set();
  const refs=selectedBars.map(bar=>{
    requireTruth(Number.isSafeInteger(bar?.time)&&!seen.has(bar.time),
      'V3_DUPLICATE_SELECTED_BAR');
    seen.add(bar.time);
    const source=sourceByStart.get(bar.time);
    requireTruth(source,'V3_SELECTED_BAR_SOURCE_MISSING');
    requireTruth(source.normalizedBarDigest===hash({
      time:bar.time,open:bar.open,high:bar.high,low:bar.low,
      close:bar.close,volume:bar.volume
    }), 'V3_SELECTED_BAR_OHLCV_MISMATCH');
    return freeze({
      sourceBarId:receipt.physicalContract+'|'+receipt.frame+'|'+source.windowStartNs,
      sourceRevisionId:'OBSERVED_SHA256:'+source.rowDigest,
      sourcePayloadDigest:source.rowDigest,
      normalizedBarDigest:source.normalizedBarDigest,
      receiptId:receipt.receiptId,
      physicalContract:receipt.physicalContract,
      timeframe:receipt.frame,
      windowStartNs:source.windowStartNs,
      ordinal:source.ordinal,
      byteStart:source.byteStart,byteEnd:source.byteEnd,
      sourceTrustVerified:false,
    });
  });
  return freeze(refs);
}
