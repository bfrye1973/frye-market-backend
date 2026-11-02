// Engine 11 — bounded, read-only Massive raw ES contract archive, 2020–2024.
// Research evidence only. NEVER stitch contracts, change prices, or publish to LIVE.
// Retain exact successful HTTP body bytes and a SHA-256 receipt per response.
import {mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
const key=process.env.POLYGON_API_KEY||process.env.MASSIVE_API_KEY||process.env.POLY_API_KEY;
if(!key)throw Error('MASSIVE_CREDENTIAL_NOT_CONFIGURED');
const year=Number(process.env.ENGINE11_ACQUISITION_YEAR);
if(!Number.isInteger(year)||year<2020||year>2024)throw Error('YEAR_OUT_OF_BOUNDS');
const root=process.env.ENGINE11_CAPTURE_OUTPUT||'/tmp/engine11-es-2020-2024';
const output=path.resolve(root,String(year));
const sha=b=>createHash('sha256').update(b).digest('hex');
const api='https://api.massive.com';
const frames=['5min','10min','1hour','4hour','1session','1week','1month'];
const codes=[['H',3],['M',6],['U',9],['Z',12]];
const ms=24*3600*1000, UTC=(y,m,d=1)=>Date.UTC(y,m-1,d);
const observations=[], failures=[], totals={};
await mkdir(output,{recursive:true,mode:0o700});
let serial=0;
function windowBounds(code){
  const [letter,month]=code;
  // Every quarterly ticker is independently acquired with overlapping adjacent contracts.
  // December 2020 H2021 evidence is captured in the 2021 batch.
  const from=letter==='H'?UTC(year-1,12):UTC(year,month-3);
  const until=letter==='Z'?UTC(year+1,2):UTC(year,month+1);
  return [Math.max(from,UTC(2020,3)),Math.min(until,UTC(2024,11))];
}
async function fetchOne(url){
  for(let attempt=0;attempt<4;attempt++){
    try{
      const res=await fetch(url,{headers:{Authorization:'Bearer '+key,Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(45000)});
      if(!res.ok){
        if([429,500,502,503,504].includes(res.status)&&attempt<3){await new Promise(r=>setTimeout(r,1500*(2**attempt)));continue;}
        throw Error('HTTP_'+res.status);
      }
      const body=Buffer.from(await res.arrayBuffer());
      const payload=JSON.parse(body.toString('utf8'));
      if(!Array.isArray(payload.results))throw Error('MISSING_RESULTS_ARRAY');
      return {body,payload};
    }catch(e){if(attempt===3||!(/fetch failed|timeout|abort/i).test(String(e)))throw e;await new Promise(r=>setTimeout(r,1500*(2**attempt)));}
  }
  throw Error('FETCH_ATTEMPTS_EXHAUSTED');
}
for(const [letter,month] of codes){
  const ticker='ES'+letter+String(year).slice(-1),[from,until]=windowBounds([letter,month]);
  if(until<=from)continue;
  for(const frame of frames){
    const step=(frame==='5min'?7:frame==='10min'?14:28)*ms;
    let count=0, receipts=0;
    for(let start=from;start<until;start+=step){
      const end=Math.min(start+step,until);
      const initial=new URL('/futures/v1/aggs/'+ticker,api);
      for(const [k,v] of Object.entries({resolution:frame,'window_start.gte':String(BigInt(start)*1000000n),'window_start.lt':String(BigInt(end)*1000000n),limit:'50000',sort:'window_start.asc'}))initial.searchParams.set(k,v);
      let cursor=initial.toString(),page=0;const seen=new Set();
      while(cursor){
        const url=new URL(cursor);
        if(url.origin!==api||!url.pathname.startsWith('/futures/v1/aggs/')||url.pathname.split('/').at(-1)!==ticker||url.searchParams.has('apiKey'))throw Error('UNSAFE_PROVIDER_CURSOR');
        if(seen.has(cursor)||page>=30)throw Error('PAGINATION_CYCLE_OR_LIMIT');
        seen.add(cursor);
        const {body,payload}=await fetchOne(url);
        const rows=payload.results;
        if(rows.some(r=>r.ticker!==ticker||!/^\d{16,20}$/.test(String(r.window_start))||!['open','high','low','close'].every(k=>Number.isFinite(r[k]))))throw Error('SOURCE_ROW_INVALID_'+ticker+'_'+frame);
        const digest=sha(body),file=String(++serial).padStart(6,'0')+'.json';
        const observedAtUtc=new Date().toISOString();
        // Preserve the original successful response, including all duplicate/session-labelled rows.
        const evidence={schema:'engine11.raw-es-original-body.v1',provider:'Massive',ticker,fullYearContractProposal:'ES'+letter+year,contractAccepted:false,frame,requestedFromUtc:new Date(start).toISOString(),requestedToUtc:new Date(end).toISOString(),requestUrl:url.toString(),observedAtUtc,bodySha256:digest,bodyBase64:body.toString('base64'),rowCount:rows.length,sourceFinality:'UNKNOWN',calendarAccepted:false,continuousEligible:false,structuralEligible:false,executionPriceAuthority:false};
        await writeFile(path.join(output,file),JSON.stringify(evidence),{flag:'wx',mode:0o600});
        observations.push({file,ticker,frame,bodySha256:digest,rowCount:rows.length,requestUrl:url.toString(),observedAtUtc,windowStart:evidence.requestedFromUtc,windowEnd:evidence.requestedToUtc});
        count+=rows.length;receipts++;page++;
        cursor=payload.next_url||null;
        // Deliberately modest provider request pacing, independent of local year batching.
        await new Promise(r=>setTimeout(r,250));
      }
    }
    totals[ticker+'_'+frame]={rows:count,receipts};
    if(!count)failures.push({ticker,frame,reason:'NO_SOURCE_ROWS'});
  }
}
const manifest={schema:'engine11.2020-2024-raw-es-receipts.v1',year,targetFromUtc:'2020-03-01T00:00:00.000Z',targetToUtc:'2024-11-01T00:00:00.000Z',source:'Massive native futures aggregate',immutableOriginalBodies:true,quarterlyContractSelection:'NOT_SELECTED_OBSERVATION_ONLY',contractIdentityAccepted:false,rolloverApproved:false,calendarAccepted:false,sourceFinality:'UNKNOWN',researchOnly:true,structuralEligible:false,executionPriceAuthority:false,totals,receipts:observations,failures};
await writeFile(path.join(output,'manifest.json'),JSON.stringify(manifest,null,2),{flag:'wx',mode:0o600});
console.log('ENGINE11_OLDER_ES_RAW_CAPTURE',JSON.stringify({year,receiptCount:observations.length,totals,failures}));
if(failures.length)process.exitCode=2;
