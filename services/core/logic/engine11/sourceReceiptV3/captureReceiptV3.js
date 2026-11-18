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
  resolver=null,sourceMode='LIVE_REST_CONSUMED_BY_ENGINE3',
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
  requireTruth(['LIVE_REST_CONSUMED_BY_ENGINE3','HISTORICAL_REFETCH',
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
  const observations=rows.map((r,ordinal)=>freeze({
    ordinal,windowStartNs:String(r.payload?.window_start??''),
    byteStart:r.byteStart,byteEnd:r.byteEnd,
    rowDigest:sha256(bytes.subarray(r.byteStart,r.byteEnd)),
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
    resolver:resolver?{
      resolvedSymbol:resolver.resolvedSymbol??null,
      selectionRule:resolver.selectionRule??null,
      checkedAt:resolver.checkedAt??null,
    }:null,
    nextUrl,observations,
  };
  return freeze({...base,receiptId:'receipt:v3:'+hash(base)});
}
