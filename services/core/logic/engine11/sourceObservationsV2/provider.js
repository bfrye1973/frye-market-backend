import { randomUUID } from 'node:crypto';
import { requireTruth } from '../rawCandles/identity.js';
import { safePageUrl } from '../rawCandles/provider.js';
import { captureReceipt,safeRequest,freeze } from './evidence.js';
export async function acquireSourceObservations({request,apiKey,fetchImpl=fetch,maxPages=3,maxRows=100000,captureId=randomUUID()}) {
  const initial=safeRequest(request);requireTruth(typeof apiKey==='string'&&apiKey.length>0,'V2_PROVIDER_CREDENTIAL_REQUIRED');
  requireTruth(Number.isInteger(maxPages)&&maxPages>0&&maxPages<=100&&Number.isInteger(maxRows)&&maxRows>0&&maxRows<=500000,'V2_ACQUISITION_BUDGET');
  const receipts=[],seen=new Set();let next=initial,failure=null,rowCount=0;
  while(next){
    if(receipts.length>=maxPages){failure='V2_PAGE_BUDGET_EXCEEDED';break;}
    if(seen.has(next)){failure='V2_CURSOR_CYCLE';break;}seen.add(next);
    try{
      const response=await fetchImpl(next,{headers:{Accept:'application/json',Authorization:'Bearer '+apiKey},signal:AbortSignal.timeout(25000)});
      if(!response.ok){failure=response.status===401||response.status===403?'V2_ENTITLEMENT_DENIED':'V2_PROVIDER_HTTP_'+response.status;break;}
      const bytes=Buffer.from(await response.arrayBuffer());requireTruth(!bytes.includes(Buffer.from(apiKey)),'V2_CREDENTIAL_IN_BODY');
      const receipt=captureReceipt({request:next,body:bytes,observedAt:new Date().toISOString(),captureId,page:receipts.length+1,httpStatus:response.status});receipts.push(receipt);
      rowCount+=receipt.observations.length;if(rowCount>maxRows){failure='V2_ROW_BUDGET_EXCEEDED';break;}
      if(receipt.parseFailure || receipt.providerStatus!=='OK'){failure=receipt.parseFailure??'V2_PROVIDER_STATUS';break;}
      if(receipt.nextUrl){requireTruth(new URL(initial).pathname.includes('/aggs/'),'V2_METADATA_PAGINATION_UNRESOLVED');next=safeRequest(safePageUrl(receipt.nextUrl,initial).toString());}else next=null;
    }catch(e){failure=e.code??'V2_PROVIDER_TRANSPORT_UNAVAILABLE';break;}
  }
  return freeze({schemaVersion:'engine11.source-acquisition.v2',status:failure?'INCOMPLETE':'COMPLETE_TRAVERSAL',failure,receipts,rowCount,
    purpose:'ISOLATED_RESEARCH_ONLY',structuralEligible:false,sourceFinality:'UNKNOWN',analyticalInterval:null});
}
