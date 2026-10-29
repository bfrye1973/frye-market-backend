// Strict rolling-window quota, persisted before every external OHLC request.
// The optional persistent root survives new backfill/enricher instances and process restarts.
import fs from "node:fs";
import path from "node:path";
export function createCandleRequestGate({
 maxPerMinute=2,minSpacingMs=15000,now=()=>Date.now(),root=null
}={}){
 if(!Number.isInteger(maxPerMinute)||maxPerMinute<1||maxPerMinute>6||
    !Number.isInteger(minSpacingMs)||minSpacingMs<0||minSpacingMs>60000)
  throw Error("INVALID_CANDLE_RATE_POLICY");
 let hits=[],last=-Infinity,inFlight=false,blocked=0;
 const file=root?path.join(root,"ohlc-request-budget.json"):null;
 const lock=root?path.join(root,".ohlc-request-budget-lock"):null;
 function reserve(tick){
  if(!file){
   hits=hits.filter(t=>tick-t<60000);
  }else{
   fs.mkdirSync(root,{recursive:true});
   // Never reset the quota when a worker restarts; uncertain lock/state fails closed.
   fs.mkdirSync(lock);
   try{
    if(fs.existsSync(file)){
     const parsed=JSON.parse(fs.readFileSync(file,"utf8"));
     if(parsed.schema!=="engine27.v6.ohlcQuota.v1"||!Array.isArray(parsed.hits)||
        parsed.hits.some(t=>!Number.isFinite(t)||t>tick)||
        parsed.hits.length>1000)throw Error("INVALID_OHLC_QUOTA_STATE");
     hits=parsed.hits.filter(t=>tick-t<60000);
    }else hits=[];
    last=hits.length?hits[hits.length-1]:-Infinity;
   }catch(e){throw e}
   finally{
    // Persistence below takes place while holding the lock. Leave it until exit.
   }
  }
  const retryAfterMs=Math.max(
   hits.length>=maxPerMinute?60000-(tick-hits[0]):0,
   tick-last<minSpacingMs?minSpacingMs-(tick-last):0,0);
  if(inFlight||retryAfterMs>0){
   if(lock)fs.rmdirSync(lock);
   blocked++;
   return {accepted:false,retryAfterMs};
  }
  hits.push(tick);last=tick;
  if(file){
   try{
    const tmp=file+"."+process.pid+".pending";
    const fd=fs.openSync(tmp,"wx",0o600);
    try{fs.writeFileSync(fd,JSON.stringify({schema:"engine27.v6.ohlcQuota.v1",hits})+"\n");
     fs.fsyncSync(fd)}finally{fs.closeSync(fd)}
    fs.renameSync(tmp,file);
    const d=fs.openSync(root,"r");try{fs.fsyncSync(d)}finally{fs.closeSync(d)}
   }finally{fs.rmdirSync(lock)}
  }
  return {accepted:true,retryAfterMs:0};
 }
 async function execute(fn){
  if(inFlight){blocked++;return {available:false,reason:"CANDLE_REQUEST_BACKPRESSURE",retryAfterMs:minSpacingMs}}
  const tick=now();
  let slot;
  try{slot=reserve(tick)}catch(e){
   blocked++;return {available:false,reason:"CANDLE_QUOTA_STATE_UNAVAILABLE",retryAfterMs:60000};
  }
  if(!slot.accepted)return {available:false,reason:"CANDLE_REQUEST_BACKPRESSURE",retryAfterMs:slot.retryAfterMs};
  inFlight=true;
  try{return await fn()}finally{inFlight=false}
 }
 return Object.freeze({execute,status:()=>({requestsLastMinute:hits.filter(t=>now()-t<60000).length,
  maxPerMinute,blocked,inFlight})});
}
