// Presentation-only visibility for canonical QQQ / direct I:VIX hourly evidence.
// Uses the Engine27 V3 evaluator's own validated qualification state.
const iso=x=>typeof x==="string"&&Number.isFinite(Date.parse(x))?x:null;
const item=(key,market,levels,reactions)=>{
 const symbol=key==="VIX"?"I:VIX":"QQQ";
 const level=levels?.instruments?.[key];
 const reaction=reactions?.instruments?.[key];
 const contractOk=level?.symbol===symbol&&reaction?.sourceSymbol===symbol&&reaction?.timeframe==="1h";
 return {symbol:key,source:"POLYGON_DIRECT_1h",
  levelSourcePresent:level?.available===true&&level.symbol===symbol&&Array.isArray(level.levels)&&level.levels.length>0,
  lastLevelCandleAt:iso(level?.lastCandleTime),
  hourlySourcePresent:contractOk&&Array.isArray(reaction.events),
  lastHourlyCandleOpenAt:contractOk?iso(reaction.lastCompletedAt):null,
  lastHourlyCandleCloseAt:contractOk&&iso(reaction.lastCompletedAt)?
    new Date(Date.parse(reaction.lastCompletedAt)+3600000).toISOString():null,
  completedBars:Number.isInteger(reaction?.completedBars)?reaction.completedBars:null,
  state:market?.state??"UNAVAILABLE",availability:market?.availability??"UNAVAILABLE",
  qualification:market?.availability==="CURRENT"&&market?.state==="CONFIRMED_REACTION_OBSERVED"?
   "CONFIRMED_REACTION":market?.availability==="CURRENT"?"CONTEXT_ONLY":"NOT_CURRENT",
  candidateCount:Array.isArray(market?.candidateEvents)?market.candidateEvents.length:0,
  confirmedCount:Array.isArray(market?.confirmedEvents)?market.confirmedEvents.length:0,
  reasonCodes:Array.isArray(market?.reasonCodes)?market.reasonCodes.slice(0,5):[],
  noExecution:true};
};
export function projectQqqVixStatus(marketConfirmation=null,levels=null,reactions=null){
 return {schema:"engine27.v3.qqqVixSourceDisplay.v1",mode:"READ_ONLY",noExecution:true,
  qqq:item("QQQ",marketConfirmation?.sources?.qqq,levels,reactions),
  vix:item("VIX",marketConfirmation?.sources?.vix,levels,reactions)};
}
