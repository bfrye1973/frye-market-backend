// Pure, bounded read-only cross-market event contract for Engine27 V3 Micro.
// QQQ is a stock TRADE (T); VIX is a calculated INDEX VALUE (V), never a trade.
const decimal=x=>typeof x==="number"&&Number.isFinite(x)?x:
 typeof x==="string"&&/^(?:[0-9]+)(?:\.[0-9]+)?$/.test(x)&&Number.isFinite(Number(x))?Number(x):null;
export function inspectDirectCrossMarketTick(message,receivedAtMs=Date.now()){
 const q=message?.ev==="T"&&message?.sym==="QQQ";
 const v=message?.ev==="V"&&message?.T==="I:VIX";
 if(!q&&!v)return {ok:false,reason:"UNEXPECTED_SYMBOL_OR_EVENT"};
 const price=decimal(q?message.p:message.val);
 const sourceMs=message.t;
 if(price===null||price<=0||!Number.isSafeInteger(sourceMs)||sourceMs<946684800000||sourceMs>receivedAtMs+10000)
  return {ok:false,reason:"INVALID_PRICE_OR_TIMESTAMP"};
 return {ok:true,tick:{symbol:q?"QQQ":"VIX",source:q?"POLYGON_STOCK_TRADE":"POLYGON_INDEX_VALUE",
  sourceSymbol:q?"QQQ":"I:VIX",price,sourceTime:new Date(sourceMs).toISOString(),sourceMs,
  observedAt:new Date(receivedAtMs).toISOString(),lagMs:receivedAtMs-sourceMs,
  sourceLatencyQualified:receivedAtMs-sourceMs<=20000,
  noExecution:true}};
}
export function applyDirectCrossMarketTick(previous,tick,receivedAtMs=Date.now()){
 if(!tick||!["QQQ","VIX"].includes(tick.symbol))return previous??null;
 if(previous?.sourceMs>=tick.sourceMs)return previous;
 const previousPrice=previous?.price??null;
 const delta=previousPrice===null?null:Number((tick.price-previousPrice).toFixed(5));
 return {symbol:tick.symbol,price:tick.price,source:tick.source,sourceSymbol:tick.sourceSymbol,
  sourceTime:tick.sourceTime,sourceMs:tick.sourceMs,observedAt:tick.observedAt,
  lagMs:tick.lagMs,sourceLatencyQualified:tick.sourceLatencyQualified,
  lastMovePoints:delta,movement:delta===null?"INITIAL_OBSERVATION":delta>0?"UP":delta<0?"DOWN":"UNCHANGED",
  state:tick.sourceLatencyQualified?"PRICE_OBSERVED":"PROVIDER_DELAYED",
  noExecution:true};
}
export function presentDirectCrossMarketState(record,connection,nowMs=Date.now()){
 if(!record)return {available:false,state:connection??"WAITING_FOR_FIRST_EVENT",price:null,
  sourceTime:null,movement:null,lagSeconds:null,noExecution:true};
 const age=nowMs-record.sourceMs;
 const fresh=connection==="CONNECTED"&&age>=0&&age<=15000&&record.sourceLatencyQualified;
 return {available:fresh,state:fresh?"LIVE":connection!=="CONNECTED"?connection:record.sourceLatencyQualified?"STALE":"DELAYED",
  price:fresh?record.price:null,sourceTime:record.sourceTime,
  movement:fresh?record.movement:null,lagSeconds:age>=0?Math.floor(age/1000):null,noExecution:true};
}
