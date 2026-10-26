// Engine27 V3: ES up + QQQ up + direct VIX down = bullish environment observation.
// NEVER infer an Elliott wave transition or issue a trade permission.
// Pure observer with bounded 3-minute rolling trade/index-value history.
const T_WINDOW=180000,MIN_SPAN=20000,MAX_AGE=30000,MAX_ROWS=512;
const valid=(v)=>typeof v==="number"&&Number.isFinite(v);
const iso=t=>new Date(t).toISOString();
export function createMicroCrossMarketAlignment({clock=()=>Date.now()}={}){
 const series={ES:[],QQQ:[],VIX:[]};
 let lastSignal=null;
 const normalize=(symbol,price,at)=>{
  const ms=typeof at==="number"?at:Date.parse(at);
  const now=clock();
  if(!["ES","QQQ","VIX"].includes(symbol)||!valid(price)||price<=0||
    !Number.isFinite(ms)||ms>now+1000||now-ms>MAX_AGE)return null;
  return {at:ms,price};
 };
 function ingest(symbol,price,at){
  const point=normalize(symbol,price,at);
  if(!point)return false;
  const list=series[symbol],prior=list.at(-1);
  if(prior&&point.at<=prior.at)return false;
  list.push(point);
  while(list.length>MAX_ROWS||list[0]?.at<clock()-T_WINDOW)list.shift();
  return true;
 }
 function movement(symbol,now){
  const list=series[symbol].filter(p=>now-p.at<=T_WINDOW);
  const end=list.at(-1);
  if(!end||now-end.at>MAX_AGE)return {state:"UNAVAILABLE",reason:"NO_CURRENT_SOURCE",latestAt:end?iso(end.at):null};
  // Compare nearest eligible sample at least 20 seconds back.
  const start=[...list].reverse().find(p=>end.at-p.at>=MIN_SPAN);
  if(!start)return {state:"OBSERVING",reason:"INSUFFICIENT_TIME_SPAN",latestAt:iso(end.at)};
  const delta=Number((end.price-start.price).toFixed(symbol==="ES"?2:4));
  return {state:delta>0?"UP":delta<0?"DOWN":"FLAT",delta,from:start.price,to:end.price,
   intervalSeconds:Math.round((end.at-start.at)/1000),latestAt:iso(end.at),reason:null};
 }
 function assess({microDirection=null,neighbors=null,engine25Qualified=false,engine29Qualified=false}={}){
  const now=clock();const es=movement("ES",now),qqq=movement("QQQ",now),vix=movement("VIX",now);
  const marketAligned=es.state==="UP"&&qqq.state==="UP"&&vix.state==="DOWN";
  const contextReady=[es,qqq,vix].every(m=>["UP","DOWN","FLAT"].includes(m.state));
  const directionConflict=microDirection!=="LONG"; // NONE/SHORT require independent Engine22 authority
  // Grade separates shared price context from Engine22 and canonical confirmation ownership.
  const fullQualified=marketAligned&&!directionConflict&&engine25Qualified&&engine29Qualified;
  const state=fullQualified?"BULLISH_CONTEXT_AND_OWNERS_ALIGNED":
    marketAligned?"BULLISH_CROSS_MARKET_ALIGNMENT":
    contextReady?"NO_BULLISH_TRIO":"AWAITING_QUALIFIED_PRICE_HISTORY";
  const result={schema:"engine27.v3.microCrossMarketAlignment.v1",state,marketAligned,
   fullQualified,executionAuthorized:false,noExecution:true,alertEligible:marketAligned,
   alertType:marketAligned?"BULLISH_MARKET_ENVIRONMENT":null,
   waveAlignment:microDirection==="LONG"?"DIRECTION_COMPATIBLE":directionConflict?"MICRO_WAVE_NOT_LONG":"UNAVAILABLE",
   microDirection,neighbors:neighbors??null,
   qualifications:{engine25Qualified,engine29Qualified},
   evidence:{ES:es,QQQ:qqq,VIX:vix},
   reasons:marketAligned?(fullQualified?[]:[
    ...(directionConflict?["ENGINE22_MICRO_DIRECTION_NOT_LONG"]:[]),
    ...(!engine25Qualified?["ENGINE25_NOT_QUALIFIED"]:[]),
    ...(!engine29Qualified?["ENGINE29_NOT_QUALIFIED"]:[])
   ]):["THREE_MARKET_BULLISH_DIRECTION_NOT_ESTABLISHED"],
   at:iso(now)};
  if(marketAligned&&!lastSignal)lastSignal={at:iso(now),type:result.alertType,state:result.state};
  if(!marketAligned)lastSignal=null;
  return {...result,latestAlert:lastSignal};
 }
 return Object.freeze({ingest,assess,diagnostics:()=>Object.fromEntries(Object.entries(series).map(([k,v])=>[k,v.length]))});
}
