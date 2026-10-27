// Read-only production replay availability probe for isolated Engine27 shadow preview.
// Emits only aggregate counts / field presence. Never logs prices, trade records or secrets.
const endpoint="https://frye-market-backend-1.onrender.com";
// Bounded metadata inspection: log contract-bearing field paths only, never raw contents.
function findEsContractPaths(value){
 const hits=[];let visited=0;
 function walk(node,path,depth){
  if(depth>7||visited++>3000||hits.length>=12)return;
  if(typeof node==="string"){
   if(/^\\/?ES[FGHJKMNQUVXZ]\\d{1,2}$/.test(node.trim().toUpperCase()))hits.push(path);
   return;
  }
  if(!node||typeof node!=="object")return;
  if(Array.isArray(node)){
   for(let i=0;i<Math.min(5,node.length);i++)walk(node[i],path+"["+i+"]",depth+1);
   return;
  }
  for(const [key,child] of Object.entries(node).slice(0,80))walk(child,path?path+"."+key:key,depth+1);
 }
 walk(value,"",0);
 return hits;
}
const phoenixDate=()=>new Intl.DateTimeFormat("en-CA",{timeZone:"America/Phoenix",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date());
export async function auditReplayAvailability({date=phoenixDate(),fetcher=fetch}={}){
 const fail=(reason)=>({schema:"engine27.v3.replayAvailabilityAudit.v1",ok:false,date,reason,readOnly:true,noExecution:true});
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return fail("INVALID_DATE");
 try{
  const url=endpoint+"/api/v1/replay/es/times?date="+encodeURIComponent(date);
  const response=await fetcher(url,{headers:{Accept:"application/json"},cache:"no-store",signal:AbortSignal.timeout(12000)});
  if(!response.ok)return fail("REPLAY_LIST_HTTP_"+response.status);
  const body=await response.json();
  // Do not guess missing response wrappers or timestamps.
  const times=Array.isArray(body)?body:Array.isArray(body?.times)?body.times:
   Array.isArray(body?.availableTimes)?body.availableTimes:null;
  if(!times)return {...fail("UNRECOGNIZED_TIMES_RESPONSE"),keys:body&&typeof body==="object"?Object.keys(body).slice(0,15):[]};
  const valid=times.filter(x=>typeof x==="string"&&/^\d{4}$/.test(x));
  if(!valid.length)return {schema:"engine27.v3.replayAvailabilityAudit.v1",ok:true,date,snapshotCount:0,readOnly:true,noExecution:true};
  const chosen=valid[Math.floor(valid.length/2)];
  const one=await fetcher(endpoint+"/api/v1/replay/es/snapshot?date="+date+"&time="+chosen,
   {headers:{Accept:"application/json"},cache:"no-store",signal:AbortSignal.timeout(12000)});
  if(!one.ok)return {...fail("REPLAY_SNAPSHOT_HTTP_"+one.status),snapshotCount:valid.length};
  const item=await one.json();
  const candidate=item?.snapshot??item?.data??item;
  return {schema:"engine27.v3.replayAvailabilityAudit.v1",ok:true,date,snapshotCount:valid.length,
   sampleResponseKeys:Object.keys(item??{}).slice(0,20),
   canonicalReplaySchema:candidate?.schema??null,
   hasSnapshotTime:typeof candidate?.snapshotTime==="string",
   hasCurrentPrice:Number.isFinite(candidate?.currentPrice),
   hasStrategy1:!!candidate?.strategies?.["intraday_scalp@10m"],
   hasResolvedEsContract:typeof candidate?.resolvedEsContract==="string"||
    typeof candidate?.resolvedContract==="string",
   verifiedContractCandidatePaths:findEsContractPaths(candidate),
   readOnly:true,noExecution:true};
 }catch{return fail("REPLAY_TRANSPORT_OR_PARSE_UNAVAILABLE")}
}
