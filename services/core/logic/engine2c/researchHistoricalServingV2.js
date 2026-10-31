// Engine2C V2 — release-preparation ONLY. Not mounted by server.js.
// Every request fails closed until a manager-reviewed verifier and approved
// private storage path are explicitly injected; no tokens or archives are stored here.
import {createHash, timingSafeEqual} from 'node:crypto';
import {readFile,realpath} from 'node:fs/promises';
import path from 'node:path';

export const RESEARCH_VIEWS=Object.freeze({
  UNADJUSTED:{folder:'continuousRaw',dataset:'research-dataset:a0c81ce398869440b1b9cd42b94ced0101923356c4c860a9c13232a1f98f3c91',basis:'price-basis:fcbfa10815555415c8afdfddbbc28a96a4f42207db162a0db853b549546b3908'},
  ADJUSTED_RESEARCH:{folder:'continuousAdjustedClose',dataset:'research-dataset:5d880a0fddf98e0db3d90c2262ab4f5febcf37d3deed83fc3d45426158863b14',basis:'price-basis:94b25a5e2dc04574a59966c369243300d205a50527800b63876641a6023e9f63'},
  ACTUAL_CONTRACT:{folder:'actualESZ2026',dataset:'research-dataset:2dd028c39df6fe16e2adfec59b4c1bba312b21f1b2a2f9b783751a25b32dc808',basis:'price-basis:757ed82449f97edfea282111a163ffa04681ba188242fd17034ff9cb91410623'}
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
