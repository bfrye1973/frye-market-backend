// Engine27 read-only contrast: 11:00 vs 13:01 Arizona wick, and actual 10/30/60m follow-through.
// Source is a fresh provider request, not original Engine12 replay contract identity.
const u=new URL("https://frye-market-backend-1.onrender.com/api/v1/futures/ohlc");
for(const [k,v] of Object.entries({symbol:"ES",timeframe:"1m",limit:"6000",debug:"1"}))u.searchParams.set(k,v);
try{
 const r=await fetch(u,{signal:AbortSignal.timeout(30000)});if(!r.ok)throw Error("HTTP_"+r.status);
 const d=await r.json();if(!Array.isArray(d.bars))throw Error("NO_BARS");
 const target=[{label:"earlier_1100",start:"2026-10-28T18:00:00Z"},{label:"later_1301",start:"2026-10-28T20:01:00Z"}];
 const bmap=new Map(d.bars.map(b=>[b.time,b]));
 const out=target.map(x=>{
  const sec=Date.parse(x.start)/1000,b=bmap.get(sec);
  if(!b)return {label:x.label,status:"MISSING_EVENT_CANDLE"};
  const upper=b.high-Math.max(b.open,b.close),range=b.high-b.low;
  const outcomes=[10,30,60].map(minutes=>{
   const at=sec+minutes*60;
   const after=bmap.get(at);
   return {minutes,observedAt:after?new Date(after.time*1000).toISOString():null,
    close:after?.close??null,changeFromHigh:after?Number((after.close-b.high).toFixed(2)):null,
    lowerLowAfterEvent:d.bars.filter(y=>y.time>sec&&y.time<=at).some(y=>y.low<b.low),
    higherHighAfterEvent:d.bars.filter(y=>y.time>sec&&y.time<=at).some(y=>y.high>b.high)};
  });
  return {label:x.label,eventUtc:x.start,candle:b,upperWick:upper,upperWickPct:range?upper/range*100:null,
   outcomes};
 });
 process.stdout.write(JSON.stringify({resolvedSymbol:d.resolvedSymbol,resolver:d.resolver?.selectionRule,
  records:out,originalReplayContractIdentity:"UNVERIFIED",researchOnly:true})+"\n");
}catch(e){process.stdout.write(JSON.stringify({status:"UNAVAILABLE",reason:String(e.message).slice(0,90)})+"\n");}
