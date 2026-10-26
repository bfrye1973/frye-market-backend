// Backend1 persistent archive client. Bounded retry queue, strict owned endpoint.
// Never writes to Engine10 Journal, orders, Polygon or browser storage.
const PATH="/api/v1/engine27/micro-alignment/history";
export function createMicroAlignmentArchiveClient({url,token,fetcher=fetch}={}){
 const pending=[],seen=new Set();let history=[],state="NOT_CONFIGURED",inFlight=false;
 const base=()=>{
  if(!url||!token)return null;
  let u;try{u=new URL(url)}catch{return null}
  if(u.origin!=="https://frye-market-backend-1.onrender.com"||u.pathname!==PATH)return null;
  return u.toString();
 };
 const headers=()=>({Authorization:"Bearer "+token,Accept:"application/json"});
 async function refresh(){
  const endpoint=base();if(!endpoint)return {ok:false,state:"NOT_CONFIGURED"};
  try{
   const r=await fetcher(endpoint+"?limit=100",{headers:headers(),signal:AbortSignal.timeout(10000),cache:"no-store"});
   if(!r.ok)throw Error("ARCHIVE_HTTP_UNAVAILABLE");
   const data=await r.json();
   if(data?.ok!==true||data.persistence!=="BACKEND1_RENDER_DISK"||!Array.isArray(data.events))
    throw Error("ARCHIVE_CONTRACT_INVALID");
   history=data.events.slice(0,100);state="DURABLE";
   return {ok:true,state};
  }catch{state="UNVERIFIED";return {ok:false,state}}
 }
 function enqueue(e){
  if(!base()||e?.schema!=="engine27.v3.microFiveMinuteAlignmentEvent.v1"||
     typeof e.id!=="string"||seen.has(e.id))return false;
  seen.add(e.id);pending.push(e);
  if(pending.length>64){const removed=pending.shift();seen.delete(removed.id);state="QUEUE_OVERFLOW"}
  void flush();
  return true;
 }
 async function flush(){
  if(inFlight||!base())return;
  inFlight=true;
  try{
   while(pending.length){
    const evt=pending[0];
    let r;
    try{r=await fetcher(base(),{method:"POST",headers:{...headers(),"Content-Type":"application/json"},
      body:JSON.stringify(evt),signal:AbortSignal.timeout(10000),cache:"no-store"})}catch{state="UNVERIFIED";break}
    if(!r.ok){state="UNVERIFIED";break}
    const result=await r.json().catch(()=>null);
    if(result?.ok!==true){state="UNVERIFIED";break}
    pending.shift();state="DURABLE";
   }
  }finally{inFlight=false}
 }
 function status(){return {state,queued:pending.length,events:history.slice(0,25),
   persistenceVerified:state==="DURABLE",backend:"BACKEND1_RENDER_DISK"}}
 return Object.freeze({enqueue,flush,refresh,status});
}
