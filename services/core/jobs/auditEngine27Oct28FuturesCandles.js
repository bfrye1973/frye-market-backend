// Read-only Oct28 11:00 Arizona wave-ending candle probe.
// Prints only a tightly bounded candle window; never logs credentials or broker data.
// A newly resolved contract proves this query's provenance, NOT older Replay lineage.
const origin="https://frye-market-backend-1.onrender.com";
const from=Date.parse("2026-10-28T17:50:00Z")/1000;
const to=Date.parse("2026-10-28T18:10:00Z")/1000;
const ending=7788.50;
for(const timeframe of ["1m","5m","10m"]){
 try{
  const url=new URL(origin+"/api/v1/futures/ohlc");
  url.searchParams.set("symbol","ES");url.searchParams.set("timeframe",timeframe);
  url.searchParams.set("limit","5000");url.searchParams.set("debug","1");
  const res=await fetch(url,{headers:{Accept:"application/json"},signal:AbortSignal.timeout(25000)});
  if(!res.ok)throw Error("HTTP_"+res.status);
  const data=await res.json();
  if(data?.ok!==true||!Array.isArray(data.bars))throw Error("UNEXPECTED_OHLC_FORMAT");
  const selected=data.bars.filter(b=>Number.isFinite(b.time)&&b.time>=from&&b.time<=to)
   .map(b=>({utc:new Date(b.time*1000).toISOString(),open:b.open,high:b.high,low:b.low,close:b.close,volume:b.volume,
   sourceContract:data.resolvedSymbol,containsOwnerHigh:b.low<=ending&&ending<=b.high}));
  process.stdout.write(JSON.stringify({timeframe,requestedSymbol:data.requestedSymbol,resolvedSymbol:data.resolvedSymbol,
   selectionRule:data.resolver?.selectionRule??null,firstAvailable:data.firstBar?.time??null,
   count:data.count,windowFrom:"2026-10-28T17:50:00Z",windowTo:"2026-10-28T18:10:00Z",
   bars:selected,ownerHighWithinAnySelectedBar:selected.some(x=>x.containsOwnerHigh),
   originalReplayContractMatched:null,warning:"FRESH_QUERY_CONTRACT_NOT_PROOF_OF_REPLAY_CONTRACT"})+"\n");
 }catch(e){process.stdout.write(JSON.stringify({timeframe,status:"UNAVAILABLE",
  reason:String(e.message).slice(0,80)})+"\n");}
}
