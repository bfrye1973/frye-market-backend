// Read-only audit of revised owner Micro W3 high at 7820, Oct 28.
// Search 1m bars over 09:00–16:00 Arizona, print only bounded matches and neighborhood.
const origin="https://frye-market-backend-1.onrender.com";
const start=Date.parse("2026-10-28T16:00:00Z")/1000;
const end=Date.parse("2026-10-28T23:00:00Z")/1000;
for(const timeframe of ["1m","5m","10m"]){
 try{
  const u=new URL(origin+"/api/v1/futures/ohlc");
  for(const [k,v] of Object.entries({symbol:"ES",timeframe,limit:"6000",debug:"1"}))u.searchParams.set(k,v);
  const res=await fetch(u,{signal:AbortSignal.timeout(25000)});
  if(!res.ok)throw Error("HTTP_"+res.status);
  const d=await res.json();if(!Array.isArray(d.bars))throw Error("BARS_UNAVAILABLE");
  const bars=d.bars.filter(b=>b.time>=start&&b.time<=end);
  const highest=bars.reduce((a,b)=>!a||b.high>a.high?b:a,null);
  const candidates=bars.filter(b=>b.high>=7820).slice(0,12);
  const neighbourhood=highest?bars.filter(b=>Math.abs(b.time-highest.time)<=20*60).map(b=>({
   time:new Date(b.time*1000).toISOString(),o:b.open,h:b.high,l:b.low,c:b.close,v:b.volume
  })): [];
  process.stdout.write(JSON.stringify({timeframe,resolvedSymbol:d.resolvedSymbol,selectionRule:d.resolver?.selectionRule,
   barCount:bars.length,high:highest?.high??null,highTime:highest?new Date(highest.time*1000).toISOString():null,
   reached7820:candidates.length>0,candidates:candidates.map(b=>({time:new Date(b.time*1000).toISOString(),high:b.high})),
   neighbourhood,originalReplayContractMatch:"UNVERIFIED"})+"\n");
 }catch(e){process.stdout.write(JSON.stringify({timeframe,error:String(e.message).slice(0,80)})+"\n");}
}
