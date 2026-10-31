// Engine11 P0 — ESZ6 archived source capture extension; DOES NOT alter production.
// Native Massive responses retained byte-for-byte (within HTTP decoding contract).
import {writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {captureReceipt} from '../logic/engine11/sourceObservationsV2/evidence.js';
const key=process.env.MASSIVE_API_KEY||process.env.POLYGON_API_KEY||process.env.POLYGON_API||process.env.POLY_API_KEY;
if(!key)throw Error('MASSIVE_CREDENTIAL_NOT_CONFIGURED_FOR_PRIVATE_ACTIONS');
const asOf='2026-10-31T00:00:00.000Z',from='2026-10-12T00:00:00.000Z';
const output=process.env.ENGINE11_EXTENSION_OUTPUT||'/tmp/engine11-october-esz6';
const resolutions=['5min','10min','1hour','4hour','1day','1week','1month'];
const start=Date.parse(from),end=Date.parse(asOf);
const records=[],counts={};
await mkdir(output,{recursive:true,mode:0o700});
let serial=0;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
for(const resolution of resolutions){
  const windowMs=resolution==='5min'?24*3600000:7*24*3600000;
  let bars=0;
  for(let a=start;a<end;a+=windowMs){
    const b=Math.min(end,a+windowMs);
    let cursorUrl=null,page=0;
    do{
      const url=cursorUrl?new URL(cursorUrl):new URL('https://api.massive.com/futures/v1/aggs/ESZ6');
      if(!cursorUrl){
        url.searchParams.set('resolution',resolution);
        url.searchParams.set('window_start.gte',String(BigInt(a)*1000000n));
        url.searchParams.set('window_start.lt',String(BigInt(b)*1000000n));
        url.searchParams.set('limit','50000');
        url.searchParams.set('sort','window_start.asc');
      }
      // Query strings with credentials are forbidden in durable receipts.
      url.searchParams.delete('apiKey');
      if(url.origin!=='https://api.massive.com'&&url.origin!=='https://api.polygon.io')throw Error('UPSTREAM_ORIGIN_CHANGED');
      const response=await fetch(url,{headers:{Authorization:'Bearer '+key,Accept:'application/json'},signal:AbortSignal.timeout(45000),redirect:'error'});
      const body=Buffer.from(await response.arrayBuffer());
      if(!response.ok)throw Error('MASSIVE_ESZ6_'+resolution+'_HTTP_'+response.status);
      const observedAt=new Date().toISOString(),captureId='engine11-oct30-esz6-'+String(++serial);
      const receipt=captureReceipt({request:url.toString(),body,observedAt,captureId,page:page+1,httpStatus:response.status});
      if(receipt.parseFailure)throw Error('MASSIVE_RESPONSE_PARSE_'+resolution+'_'+receipt.parseFailure);
      const rows=receipt.observations;
      if(rows.some(r=>r.payload?.ticker!=='ESZ6'||typeof r.payload.window_start!=='string'))throw Error('ESZ6_IDENTITY_OR_TIMESTAMP');
      const name=resolution+'-'+String(a)+'-'+String(page)+'.json';
      await writeFile(path.join(output,name),JSON.stringify({receipt,sha256:sha(body)}),{flag:'wx',mode:0o600});
      records.push({file:name,request:url.toString(),sha256:sha(body),observedAt,count:rows.length});
      bars+=rows.length;
      cursorUrl=receipt.nextUrl||null;page++;
      if(page>30)throw Error('EXCESSIVE_UPSTREAM_PAGINATION');
    }while(cursorUrl);
  }
  counts[resolution]=bars;
  if(!bars)throw Error('NO_AUTHENTIC_ESZ6_'+resolution+'_CANDLES');
}
await writeFile(path.join(output,'manifest.json'),JSON.stringify({schema:'engine11.oct30.esz6.receipts.v1',from,asOf,physicalContract:'ESZ2026',providerTicker:'ESZ6',records,counts,unverifiedSessionFinality:true,researchOnly:true,executionPriceAuthority:false},null,2),{flag:'wx',mode:0o600});
console.log('ENGINE11_ESZ6_OCT30_RECEIPTS_CAPTURED',JSON.stringify({counts,receiptCount:records.length}));
