// Engine27 V6 read-only Backend-1 OHLC adapter; never calls Massive directly.
// No scheduling, disk writes or inferred original Replay contract identity.
const TF=new Set(["1m","5m","10m"]);
const tms=v=>typeof v==="string"&&Number.isFinite(Date.parse(v))?Date.parse(v):null;
export async function fetchBoundedWaveCandles({origin="https://frye-market-backend-1.onrender.com",
 timeframe,fromUtc,toUtc,symbol="ES",request=fetch}={}){
 const from=tms(fromUtc),to=tms(toUtc);
 if(!TF.has(timeframe)||from===null||to===null||from>=to||to-from>3*3600000||
  !/^ES(?:[FGHJKMNQUVXZ]\d{1,2})?$/.test(symbol))
  return {available:false,reason:"INVALID_BOUNDED_OHLC_REQUEST"};
 const base=new URL(origin);
 if(base.protocol!=="https:"||base.hostname!=="frye-market-backend-1.onrender.com"||base.pathname!=="/")
  return {available:false,reason:"UNAPPROVED_OHLC_ORIGIN"};
 const url=new URL("/api/v1/futures/ohlc",base);
 url.searchParams.set("symbol",symbol);url.searchParams.set("timeframe",timeframe);
 url.searchParams.set("debug","1");url.searchParams.set("limit","7000");
 try{
  const response=await request(url.toString(),{headers:{Accept:"application/json"},signal:AbortSignal.timeout(25000)});
  if(!response.ok)return {available:false,reason:"BACKEND_OHLC_HTTP_"+response.status};
  const data=await response.json();
  if(data?.ok!==true||!Array.isArray(data?.bars)||!/^ES[FGHJKMNQUVXZ]\d{1,2}$/.test(data.resolvedSymbol??""))
   return {available:false,reason:"BACKEND_OHLC_CONTRACT_OR_BARS_UNVERIFIED"};
  const bounded=data.bars.filter(b=>{
   const at=Number(b?.time)*1000;
   return Number.isFinite(at)&&at>=from&&at<=to&&[b.open,b.high,b.low,b.close].every(Number.isFinite);
  }).sort((a,b)=>a.time-b.time);
  if(!bounded.length)return {available:false,reason:"HISTORICAL_CANDLE_WINDOW_EMPTY",
   resolvedSymbol:data.resolvedSymbol};
  return {available:true,source:"BACKEND1_FUTURES_OHLC",priceBasis:"PHYSICAL_PROVIDER_AGGREGATES",
   resolvedSymbol:data.resolvedSymbol,requestedSymbol:data.requestedSymbol??symbol,timeframe,
   windowStartUtc:fromUtc,windowEndUtc:toUtc,bars:bounded,
   originalReplayContractMatch:"UNVERIFIED",noExecution:true,noWaveAuthority:true};
 }catch(error){return {available:false,reason:"BACKEND_OHLC_READ_FAILURE",errorClass:error?.name??"Error"};}
}
