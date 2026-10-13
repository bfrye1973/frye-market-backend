import { createHash,randomUUID } from 'node:crypto';
export const digest=b=>createHash('sha256').update(b).digest('hex');
export function exactJson(bytes){
 const input=Buffer.from(bytes).toString('utf8');let out='',i=0;
 while(i<input.length){if(input[i]==='"'){let j=i+1;for(;j<input.length;j++){if(input[j]==='\\'){j++;continue;}if(input[j]==='"'){j++;break;}}out+=input.slice(i,j);i=j;continue;}
  if(input[i]==='-'||/\d/.test(input[i])){const match=input.slice(i).match(/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/);if(!match)throw new Error('INVALID_JSON_NUMBER');const token=match[0];out+=/^-?\d+$/.test(token)&&!Number.isSafeInteger(Number(token))?JSON.stringify(token):token;i+=token.length;continue;}out+=input[i++];}
 return JSON.parse(out);
}
const allowedKeys=new Set(['cursor','limit','sort','ticker','date','product_code','trading_venue','session_end_date','session_end_date.gte','session_end_date.lte','window_start.gte','window_start.lt','timestamp.gte','timestamp.lt','resolution']);
export function safeUrl(input,first=null){const u=new URL(input);if(u.origin!=='https://api.massive.com'||u.username||u.password||u.hash||!/^\/futures\/v1\/(?:contracts|schedules|(?:aggs|trades)\/ES[HMUZ]\d{1,4})$/.test(u.pathname))throw new Error('UNSAFE_RESEARCH_ENDPOINT');
 if([...u.searchParams.keys()].some(k=>!allowedKeys.has(k))||u.toString().length>8192)throw new Error('UNSAFE_QUERY');
 if(first){const f=new URL(first);if(f.pathname!==u.pathname)throw new Error('CURSOR_PATH_DRIFT');for(const [k,v] of u.searchParams)if(k!=='cursor'&&k!=='limit'&&f.searchParams.get(k)!==v)throw new Error('CURSOR_QUERY_DRIFT');}
 return u.toString();}
export async function capture({request,apiKey,fetchImpl=fetch,maxPages=3,maxRows=100000}){
 if(!apiKey||!Number.isInteger(maxPages)||maxPages<1||maxPages>20||!Number.isInteger(maxRows)||maxRows<1||maxRows>200000)throw new Error('CAPTURE_BUDGET');
 const first=safeUrl(request),captureId=randomUUID(),seen=new Set(),receipts=[],rows=[];let next=first,failure=null;
 while(next){if(receipts.length>=maxPages){failure='PAGE_BUDGET';break;}if(seen.has(next)){failure='CURSOR_CYCLE';break;}seen.add(next);
  try{let response;for(let n=0;n<3;n++){response=await fetchImpl(next,{headers:{Authorization:'Bearer '+apiKey,Accept:'application/json'},signal:AbortSignal.timeout(25000)});if(![429,500,502,503,504].includes(response.status)||n===2)break;await new Promise(r=>setTimeout(r,200*2**n));}
   const body=Buffer.from(await response.arrayBuffer());if(body.length>16*1024*1024||body.includes(Buffer.from(apiKey)))throw new Error('BODY_BUDGET_OR_SECRET');
   const receipt={schemaVersion:'engine11.finality-receipt.v1',captureId,page:receipts.length+1,request:next,httpStatus:response.status,observedAt:new Date().toISOString(),evidenceKind:'HTTP_BODY_AFTER_CONTENT_DECODE',bodySha256:digest(body),bodyBase64:body.toString('base64')};
   receipts.push({...receipt,receiptId:'finality-receipt:'+digest(JSON.stringify(receipt))});if(!response.ok){failure='HTTP_'+response.status;break;}
   const parsed=exactJson(body);if(parsed.status!=='OK'||!Array.isArray(parsed.results)){failure='PROVIDER_SHAPE';break;}rows.push(...parsed.results);if(rows.length>maxRows){failure='ROW_BUDGET';break;}next=parsed.next_url?safeUrl(parsed.next_url,first):null;
  }catch(e){failure=e.message;break;}}
 return {request:first,receipts,rows,failure,traversalComplete:failure===null&&next===null,structuralEligible:false};
}
