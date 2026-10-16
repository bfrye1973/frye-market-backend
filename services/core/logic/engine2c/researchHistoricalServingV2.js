// Engine2C V2 — release-preparation ONLY. Not mounted by server.js.
// Every request fails closed until a manager-reviewed verifier and approved
// private storage path are explicitly injected; no tokens or archives are stored here.
import {createHash, timingSafeEqual} from 'node:crypto';
import {readFile,realpath} from 'node:fs/promises';
import path from 'node:path';

export const RESEARCH_VIEWS=Object.freeze({
  UNADJUSTED:{folder:'continuousRaw',dataset:'research-dataset:5224f595326ff44d424a9a3ada59fcf548ac5efa4c1e25eb7f4e141331b290f5',basis:'price-basis:d4ff32a184e2236d5bcb6551637253517ec694f7cbdcb8d34afd2f017a35f569'},
  ADJUSTED_RESEARCH:{folder:'continuousAdjustedClose',dataset:'research-dataset:9caaa3723b576f09bb4040a44c9da3f2a6e0fd5f0bc177f809802e4b80b9a0a4',basis:'price-basis:40baff5124d2cae5b6678813329ed7aab1f47a3ac947555390f8ac7cd212c655'},
  ACTUAL_CONTRACT:{folder:'actualESZ2026',dataset:'research-dataset:ec592b47b697dc860a47b61dd713d45602d293c8797e1b52fc924a7459d68ac0',basis:'price-basis:98e08538fb38efedcb944e54232df4af396383ed6014c0bc1ef874f228dde05e'}
});
const FRAMES=new Set(['5m','10m','1h','4h','1d','1w','1mo']);
function fail(code,message){return {status:code,body:JSON.stringify({error:message})};}
const hex=b=>createHash('sha256').update(b).digest('hex');
function sameHash(a,b){
 if(!/^[a-f0-9]{64}$/.test(String(a))||!/^[a-f0-9]{64}$/.test(String(b)))return false;
 return timingSafeEqual(Buffer.from(a,'hex'),Buffer.from(b,'hex'));
}
export function createResearchHistoricalHandler({enabled=false,verifySession,authorizeViewer,privateRoot,licensedAudience=false}={}){
 // Fail closed on startup when inactive or incomplete. No default allow.
 const configured=enabled===true&&licensedAudience===true&&typeof verifySession==='function'&&typeof authorizeViewer==='function'&&typeof privateRoot==='string'&&path.isAbsolute(privateRoot);
 return async function handle({method='GET',query={},headers={},context={}}={}){
  const responseHeaders={'Cache-Control':'private, no-store, max-age=0','Pragma':'no-cache','X-Content-Type-Options':'nosniff','Vary':'Cookie, Authorization','Content-Type':'application/json; charset=utf-8'};
  const output=(r)=>({...r,headers:responseHeaders});
  if(!configured)return output(fail(404,'RESEARCH_DISABLED'));
  if(method!=='GET')return output(fail(405,'METHOD_NOT_ALLOWED'));
  // Both authentication and viewer entitlement must be separately established.
  let session;try{session=await verifySession({headers,context});}catch{return output(fail(401,'NOT_AUTHENTICATED'));}
  if(!session||session.authenticated!==true||typeof session.subject!=='string'||!session.subject)return output(fail(401,'NOT_AUTHENTICATED'));
  let allowed=false;try{allowed=await authorizeViewer({subject:session.subject,context,session})===true;}catch{}
  if(!allowed)return output(fail(403,'RESEARCH_NOT_AUTHORIZED'));
  const view=RESEARCH_VIEWS[query.view],frame=query.frame;
  if(!view||!FRAMES.has(frame)||query.direction!=='DESC'||query.limit!=='1000'||query.datasetVersion!==view.dataset||query.priceBasisVersion!==view.basis||typeof query.cursor!=='undefined'&&typeof query.cursor!=='string')return output(fail(400,'INVALID_RESEARCH_CONTEXT'));
  if(query.cursor&&query.cursor.length>2048)return output(fail(400,'INVALID_CURSOR'));
  const requestedCursor=query.cursor??null;
  try{
   const root=await realpath(privateRoot),dir=await realpath(path.resolve(root,view.folder));
   if(!dir.startsWith(root+path.sep))return output(fail(503,'STORAGE_INVALID'));
   const catalog=JSON.parse(await readFile(path.join(dir,view.folder+'-catalog.json'),'utf8'));
   if(catalog.datasetVersion!==view.dataset||catalog.priceBasisVersion!==view.basis||catalog.researchOnly!==true||catalog.structuralEligible!==false||catalog.executionPriceAuthority!==false)return output(fail(503,'DATASET_INVALID'));
   const desc=catalog.frames?.[frame]?.pages?.find(p=>p.requestCursor===requestedCursor);
   if(!desc||!/^[a-zA-Z0-9_-]+\.json$/.test(desc.name)||!/^[a-f0-9]{64}$/.test(String(desc.sha256)))return output(fail(404,'PAGE_NOT_FOUND'));
   const full=path.resolve(dir,desc.name);
   if(!full.startsWith(dir+path.sep))return output(fail(400,'PAGE_INVALID'));
   const canonicalFile=await realpath(full);
   if(!canonicalFile.startsWith(dir+path.sep))return output(fail(503,'STORAGE_INVALID'));
   const bytes=await readFile(canonicalFile);
   if(bytes.length>2000000)return output(fail(503,'PAGE_TOO_LARGE'));
   if(!sameHash(hex(bytes),desc.sha256))return output(fail(503,'PAGE_INTEGRITY_FAILED'));
   const page=JSON.parse(bytes.toString('utf8'));
   const seen=new Set();let prior=Infinity;
   for(const row of page.rows||[]){const t=Date.parse(row.timestampUtc);if(!Number.isFinite(t)||t>prior||seen.has(row.researchCandleId))return output(fail(503,'PAGE_ORDER_INVALID'));seen.add(row.researchCandleId);prior=t;}
   if(page.datasetVersion!==view.dataset||page.priceBasisVersion!==view.basis||page.frame!==frame||page.direction!=='DESC'||page.requestCursor!==requestedCursor||page.researchOnly!==true||page.structuralEligible!==false||page.executionPriceAuthority!==false||!Array.isArray(page.rows)||page.rows.length>1000||page.nextCursor!==desc.nextCursor||page.rows.length!==desc.rows||page.rows.some(r=>r.frame!==frame||r.priceBasisVersion!==view.basis||r.structuralEligible!==false||r.executionPriceAuthority!==false||typeof r.researchCandleId!=='string'||!Number.isFinite(Date.parse(r.timestampUtc))||!r.prices||!['open','high','low','close'].every(k=>Number.isFinite(r.prices[k]))))return output(fail(503,'PAGE_CONTRACT_INVALID'));
   return output({status:200,body:bytes.toString('utf8')});
  }catch{return output(fail(503,'RESEARCH_UNAVAILABLE'));}
 };
}
