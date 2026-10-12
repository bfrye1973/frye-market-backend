// Read-only V3 source builder. No invented OHLC, backfill, or anchor authority.
// Requires an independently verified continuous ES history, including rollover.
const day=86400000;
const finite=x=>x!==null&&x!==undefined&&Number.isFinite(Number(x));
const ms=x=>{if(typeof x==="string"&&!/^\d+$/.test(x))return Date.parse(x);
 const n=Number(x);return Number.isFinite(n)?n>1e12?n:n*1000:NaN;};
const start=(t,tf)=>{const d=new Date(t);
 if(tf==="1mo")return Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),1);
 const w=d.getUTCDay();return Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),d.getUTCDate()-(w===0?6:w-1));};
const end=(t,tf)=>tf==="1mo"?Date.UTC(new Date(t).getUTCFullYear(),new Date(t).getUTCMonth()+1,1):t+7*day;
export function aggregateValidatedEsDailyHistory({dailyBars=[],provenance=null,asOfMs=Date.now(),timeframe="1w"}={}){
 const reject=(reason)=>({available:false,reasonCodes:[reason],bars:[],shadowOnly:true,noAnchorPromotion:true});
 if(!["1w","1mo"].includes(timeframe))return reject("INVALID_AGGREGATION_TIMEFRAME");
 if(provenance?.symbol!=="ES"||provenance?.continuousVerified!==true||
   !provenance?.rolloverMethod||!provenance?.sessionCalendar||
   !provenance?.sourceId)return reject("CONTINUOUS_ROLLOVER_PROVENANCE_REQUIRED");
 if(!Array.isArray(dailyBars)||dailyBars.length<20)return reject("DAILY_HISTORY_INSUFFICIENT");
 const sorted=dailyBars.map(b=>({...b,_ms:ms(b?.time??b?.sourceTimestamp)})).sort((a,b)=>a._ms-b._ms);
 if(sorted.some((b,i)=>!Number.isFinite(b._ms)|| (i>0&&b._ms<=sorted[i-1]._ms)||
   b.closed===false||![b.open,b.high,b.low,b.close].every(finite)||
   Number(b.high)<Math.max(Number(b.open),Number(b.close))||
   Number(b.low)>Math.min(Number(b.open),Number(b.close))))
   return reject("INVALID_OR_DUPLICATE_DAILY_CANDLE");
 const groups=new Map();
 for(const b of sorted){const k=start(b._ms,timeframe);if(!groups.has(k))groups.set(k,[]);groups.get(k).push(b);}
 const bars=[],gaps=[];
 for(const [begin,rows] of groups){
   const finish=end(begin,timeframe);
   if(finish>asOfMs)continue;
   const internal=rows.slice(1).map((b,i)=>(b._ms-rows[i]._ms)/day);
   const first=(rows[0]._ms-begin)/day,last=(finish-rows.at(-1)._ms)/day;
   const min=timeframe==="1w"?4:15;
   if(rows.length<min || first>(timeframe==="1w"?2:5)||
       last>(timeframe==="1w"?4:5)||internal.some(x=>x>4)){
     gaps.push({period:new Date(begin).toISOString(),sourceDays:rows.length,
       maximumGapDays:internal.length?Math.max(...internal):null});
     continue;
   }
   bars.push({time:begin/1000,open:Number(rows[0].open),
     high:Math.max(...rows.map(x=>Number(x.high))),
     low:Math.min(...rows.map(x=>Number(x.low))),
     close:Number(rows.at(-1).close),
     volume:rows.reduce((n,x)=>n+(finite(x.volume)?Number(x.volume):0),0),
     closed:true,sourceDayCount:rows.length,sourceId:provenance.sourceId,
     rolloverMethod:provenance.rolloverMethod});
 }
 // Any missing/partial period is an explicit gap: do not pretend continuity.
 if(gaps.length)return {available:false,reasonCodes:["INCOMPLETE_SOURCE_PERIODS"],
    gaps,bars:[],shadowOnly:true,noAnchorPromotion:true};
 if(bars.length<5)return reject("AGGREGATE_HISTORY_INSUFFICIENT");
 return {available:true,reasonCodes:[],bars,sourceDayCount:sorted.length,
   shadowOnly:true,noAnchorPromotion:true,source:provenance.sourceId};
}
