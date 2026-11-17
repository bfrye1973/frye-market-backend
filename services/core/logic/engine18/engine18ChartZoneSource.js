// Canonical READ-ONLY source for Engine18: the owner's GitHub main TXT.
// Use pinned main commit SHA for the content read to avoid an intra-poll race.
// No deployed static zone route, local branch file, price adjustment or chart write.
import {createHash} from 'node:crypto';
const REPO='bfrye1973/frye-market-backend';
const API='https://api.github.com/repos/'+REPO;
const FILE='services/core/data/es-smz-manual-zones.txt';
const tick=x=>Number.isFinite(x)&&x>0&&Math.abs(x*4-Math.round(x*4))<1e-7;
const numberRange=x=>{
 const m=/^([0-9]+(?:\.[0-9]+)?)\s*-\s*([0-9]+(?:\.[0-9]+)?)$/.exec(x.trim());
 if(!m)return null;
 const a=Number(m[1]),b=Number(m[2]);
 if(!tick(a)||!tick(b)||a===b)throw Error('MALFORMED_ES_ZONE_TICK_OR_WIDTH');
 return {lo:Math.min(a,b),hi:Math.max(a,b)};
};
const fmt=x=>x.toFixed(2);
const gitBlobSha=text=>{
 const b=Buffer.from(text,'utf8');
 return createHash('sha1').update(Buffer.from('blob '+b.length+'\0')).update(b).digest('hex');
};
export function parseCanonicalEsHandZoneText(text,{revision,servedAt}={}){
 if(typeof text!=='string'||text.length>200000||!text.trim())throw Error('CANONICAL_ZONE_TEXT_MISSING');
 if(!/^[a-f0-9]{40}$/.test(revision||'')||
    typeof servedAt!=='string'||!Number.isFinite(Date.parse(servedAt)))
  throw Error('GITHUB_VERSION_UNVERIFIED');
 const zones=[],seen=new Set();
 const add=(r,kind,parentId=null)=>{
  const id='MANUAL|ES|'+(kind==='NEGOTIATED'?'NEG|':'')+fmt(r.lo)+'-'+fmt(r.hi);
  if(seen.has(id))throw Error('DUPLICATE_MANUAL_ZONE');
  seen.add(id);
  zones.push({details:{id},rangeSource:'manual',locked:true,status:'active',
   isNegotiated:kind==='NEGOTIATED',displayPriceRange:[r.hi,r.lo],
   ...(parentId?{parentId}:{})});
 };
 for(const raw of text.split(/\r?\n/)){
  let line=raw.split('#',1)[0].trim();
  if(!line||line.startsWith('//'))continue;
  const segments=line.split('|').map(s=>s.trim()).filter(Boolean);
  if(!segments.length||segments.length>2)throw Error('MALFORMED_MANUAL_ZONE_LINE');
  const isNeg=s=>/^NEG\s+/i.test(s);
  const parent=segments.find(s=>!isNeg(s));
  const negotiated=segments.find(isNeg);
  if(segments.length===2&&(!parent||!negotiated))throw Error('MALFORMED_PARENT_NEG_PAIR');
  const p=parent?numberRange(parent):null;
  const n=negotiated?numberRange(negotiated.replace(/^NEG\s+/i,'')):null;
  if(parent&&!p||negotiated&&!n||!parent&&!negotiated)throw Error('MALFORMED_MANUAL_ZONE_LINE');
  if(p)add(p,'PARENT');
  if(n){
   if(p&&(n.lo<p.lo||n.hi>p.hi))throw Error('NEG_OUTSIDE_PARENT');
   add(n,'NEGOTIATED',p?'MANUAL|ES|'+fmt(p.lo)+'-'+fmt(p.hi):null);
  }
 }
 if(!zones.length)throw Error('NO_APPROVED_ZONES');
 return {ok:true,symbol:'ES',structures_sticky:zones,
  meta:{sourceRevision:revision,sourceGitBlobSha:gitBlobSha(text),
   // Source is an existing owner-approved chart coordinate system as-is.
   // It does NOT verify that Ironbeam book prices share that basis.
   contract:'XCME:ES.Z26',priceBasis:'CHART_UNADJUSTED',
   zoneAuthority:'GITHUB_MAIN_HAND',servedAt,sourceUpdatedAt:servedAt,
   sourceName:'GITHUB_MAIN_ES_MANUAL_TXT'}};
}
function decodeGitHubContents(json){
 if(json?.type!=='file'||json.encoding!=='base64'||
  typeof json.content!=='string'||typeof json.sha!=='string')
  throw Error('GITHUB_CONTENT_SCHEMA_INVALID');
 const b=Buffer.from(json.content.replace(/\s/g,''),'base64');
 if(!b.length||b.length>200000)throw Error('GITHUB_CONTENT_SIZE_INVALID');
 const value=b.toString('utf8');
 if(Buffer.from(value,'utf8').compare(b)!==0)throw Error('GITHUB_CONTENT_UTF8_INVALID');
 if(gitBlobSha(value)!==json.sha)throw Error('GITHUB_BLOB_HASH_INVALID');
 return value;
}
export function makeEngine18ChartZoneFetcher({fetchImpl=fetch,token=null,now=()=>Date.now()}={}){
 if(typeof fetchImpl!=='function'||typeof now!=='function')
  throw Error('GITHUB_FETCH_CONFIG_INVALID');
 return async function fetchCanonicalZoneSource({timeoutMs=8000,previousSourceRevision=null}={}){
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),timeoutMs);
  const headers={Accept:'application/vnd.github+json',
   'X-GitHub-Api-Version':'2022-11-28',...(token?{Authorization:'Bearer '+token}:{})};
  const request=async url=>{
   const r=await fetchImpl(url,{method:'GET',headers,signal:controller.signal,
    cache:'no-store',redirect:'error'});
   if(r.status===403||r.status===429)throw Error('GITHUB_RATE_LIMIT_OR_ACCESS');
   if(!r.ok)throw Error('GITHUB_CANONICAL_UNAVAILABLE');
   return r.json();
  };
  try{
   const branch=await request(API+'/branches/main');
   const revision=branch?.commit?.sha;
   if(!/^[a-f0-9]{40}$/.test(revision||''))throw Error('MAIN_COMMIT_UNVERIFIED');
   if(previousSourceRevision&&revision!==previousSourceRevision){
    if(!/^[a-f0-9]{40}$/.test(previousSourceRevision))throw Error('PREVIOUS_COMMIT_UNVERIFIED');
    const compare=await request(API+'/compare/'+previousSourceRevision+'...'+revision);
    if(compare.status!=='ahead'||compare.behind_by!==0||compare.ahead_by<1)
     throw Error('GITHUB_SOURCE_ROLLBACK_OR_DIVERGENCE');
   }
   const file=await request(API+'/contents/'+FILE+'?ref='+revision);
   const text=decodeGitHubContents(file);
   const result=parseCanonicalEsHandZoneText(text,{revision,servedAt:new Date(now()).toISOString()});
   if(result.meta.sourceGitBlobSha!==file.sha)throw Error('GITHUB_FILE_CHANGED_OR_INVALID');
   return result;
  }finally{clearTimeout(timeout);}
 };
}
