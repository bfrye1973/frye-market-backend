// Owner-approved one-shot Massive ES source capture, strictly isolated.
import fs from "node:fs/promises";
import path from "node:path";
import {createHash} from "node:crypto";
import {performance} from "node:perf_hooks";

const key=process.env.MASSIVE_API_KEY||process.env.POLYGON_API_KEY||
  process.env.POLYGON_API||process.env.POLY_API_KEY;
if(!key)throw Error("ENGINE11_CAPTURE_CREDENTIAL_UNAVAILABLE");
const root=process.env.ENGINE11_TRIAL_OUTPUT||"/tmp/engine11-single-es-trial";
const base="https://api.massive.com";
const timeoutMs=20000, limit=100, maxBytes=2_000_000;
const sha=x=>createHash("sha256").update(x).digest("hex");
const iso=n=>new Date(n).toISOString();
const startMs=Date.now();
const deadline=startMs+120000; // hard max trial wall time
await fs.mkdir(root,{recursive:true,mode:0o700});
const receipts=[];
async function capture({name,url}){
 if(Date.now()>deadline)throw Error("ENGINE11_TRIAL_DEADLINE_EXCEEDED");
 if(url.origin!==base)throw Error("ENGINE11_UNTRUSTED_SOURCE_ORIGIN");
 if(url.searchParams.has("apiKey"))throw Error("ENGINE11_CREDENTIAL_IN_URL_FORBIDDEN");
 const ctrl=new AbortController();
 const timeout=setTimeout(()=>ctrl.abort(),timeoutMs);
 const began=Date.now(), monoBegan=performance.now();
 try {
  const r=await fetch(url,{signal:ctrl.signal,redirect:"error",cache:"no-store",
    headers:{Authorization:"Bearer "+key,Accept:"application/json"}});
  const firstReceived=Date.now(),monoFirst=performance.now();
  if(!r.ok)throw Error("ENGINE11_MASSIVE_HTTP_"+r.status+"_"+name);
  const bytes=Buffer.from(await r.arrayBuffer());
  const finished=Date.now(),monoFinished=performance.now();
  if(bytes.length>maxBytes)throw Error("ENGINE11_TRIAL_RESPONSE_TOO_LARGE_"+name);
  const digest=sha(bytes);
  const text=bytes.toString("utf8");
  let json;try{json=JSON.parse(text)}catch{throw Error("ENGINE11_TRIAL_INVALID_JSON_"+name)}
  if(!Array.isArray(json.results))throw Error("ENGINE11_TRIAL_RESULTS_MISSING_"+name);
  const outfile=path.join(root,name+".raw.json");
  await fs.writeFile(outfile,bytes,{flag:"wx",mode:0o600});
  const receipt={
    captureKind:"SOURCE_REST_FETCH_TIME_ONLY_NOT_ORIGINAL_BAR_ARRIVAL",
    name,provider:"MASSIVE_POLYGON",urlOrigin:url.origin,urlPath:url.pathname,
    // Query params contain no token; URLs are documented without API keys.
    query:Object.fromEntries(url.searchParams.entries()),
    httpStatus:r.status,requestedAtUtc:iso(began),
    responseHeadersObservedAtUtc:iso(firstReceived),bodyReadCompletedAtUtc:iso(finished),
    monotonicRequestToHeadersMs:monoFirst-monoBegan,
    monotonicRequestToBodyMs:monoFinished-monoBegan,
    rawBodySha256:digest,rawByteSize:bytes.length,
    resultCount:json.results.length,
    clockQuality:"UNVERIFIED",entitlement:"UNKNOWN",providerFinality:"UNKNOWN",
    provesHistoricalAsOfAvailability:false,calibrationAdmissible:false,
    originalEngine3ReceptionVerified:false,
  };
  receipts.push(receipt);
  return {json,receipt};
 } finally {clearTimeout(timeout);}
}
try{
 const snapshotUrl=new URL("/futures/v1/snapshot",base);
 snapshotUrl.searchParams.set("product_code","ES");
 const snapshot=await capture({name:"contract-snapshot",url:snapshotUrl});
 const today=Date.now();
 const candidates=(snapshot.json.results||[]).map(v=>{
   const t=String(v?.details?.ticker||"");
   const settlement=Date.parse(v?.details?.settlement_date||"");
   return {ticker:t,settlement,raw:v};
 }).filter(v=>/^ES[HMUZ]\d{1,2}$/.test(v.ticker)&&
   Number.isFinite(v.settlement)&&v.settlement>=today)
   .sort((a,b)=>a.settlement-b.settlement);
 if(!candidates.length)throw Error("ENGINE11_ES_PHYSICAL_CONTRACT_UNRESOLVED");
 const physicalContract=candidates[0].ticker;
 const now=Date.now();
 const left=now-45*60000;
 const resolutions=["1min","5min","10min"];
 for(const resolution of resolutions){
  const url=new URL("/futures/v1/aggs/"+physicalContract,base);
  url.searchParams.set("resolution",resolution);
  url.searchParams.set("window_start.gte",String(BigInt(left)*1000000n));
  url.searchParams.set("window_start.lt",String(BigInt(now)*1000000n));
  url.searchParams.set("limit",String(limit));
  url.searchParams.set("sort","window_start.asc");
  const {json}=await capture({name:"es-"+resolution,url});
  const rows=json.results||[];
  if(!rows.length)throw Error("ENGINE11_TRIAL_NO_SOURCE_ROWS_"+resolution);
  if(rows.some(row=>{
   const t=String(row?.ticker??physicalContract);
   return t!==physicalContract||!Number.isFinite(Number(row?.window_start)) ||
     !["open","high","low","close"].every(k=>Number.isFinite(Number(row?.[k])));
  }))throw Error("ENGINE11_TRIAL_SOURCE_DATA_MALFORMED_"+resolution);
 }
 // Independent readback: reopen every temporary original provider body.
 // Keep only digest / clock metadata as a public Actions artifact.
 for(const r of receipts){
   const bytes=await fs.readFile(path.join(root,r.name+".raw.json"));
   if(bytes.length!==r.rawByteSize||sha(bytes)!==r.rawBodySha256)
     throw Error("ENGINE11_TRIAL_RAW_READBACK_DIGEST_MISMATCH_"+r.name);
 }
 const manifest={
  schema:"engine11.es.oneShotSourceCaptureTrial.v1",
  capturedAtUtc:iso(Date.now()),physicalContract,rootSymbol:"ES",
  resolver:"nearest-nonexpired-settlement-from-original-provider_snapshot",
  sourceOriginalResponseBytesPreserved:true,
  receiptCount:receipts.length,receipts,
  noContinuousRecording:true,noProductionStorageWrite:true,
  noEngine12ArchiveWrite:true,clockQuality:"UNVERIFIED",
  providerEntitlement:"UNKNOWN",asOfEngine3SourceAttested:false,
  calibrationAdmissible:false,recordingActivated:false
 };
 await fs.writeFile(path.join(root,"manifest.json"),JSON.stringify(manifest,null,2),{flag:"wx",mode:0o600});
 // Output metadata without provider source-body contents or credentials.
 console.log("ENGINE11_ONE_SHOT_CAPTURE_SUCCESS",JSON.stringify({
  contract:physicalContract,receipts:receipts.map(r=>({
   name:r.name,sha256:r.rawBodySha256,bytes:r.rawByteSize,
   count:r.resultCount,captureTimestamp:r.bodyReadCompletedAtUtc
  })),
  entitlement:"UNKNOWN",clock:"UNVERIFIED",calibrationAdmissible:false,
  output:"METADATA_ONLY_PUBLIC_REPO_NO_RAW_ARTIFACT"
 }));
}catch(e){
 console.error("ENGINE11_ONE_SHOT_CAPTURE_BLOCKED",String(e?.message||e));
 process.exitCode=1;
}
