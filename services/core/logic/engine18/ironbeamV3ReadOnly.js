// Ironbeam API v3, read-only Engine 18 research adapter.
// Based on owner's OpenAPI v3 specification. REST market/depth is aggregated MBP,
// not evidence of individual MBO adds/cancels. No order/risk/account endpoints.
// Credentials must be injected through environment configuration, never checked in.
const BASE="https://api.ironbeamapi.com";
const PATHS=Object.freeze({
  login:"/v3/auth/login",
  depth:"/v3/market/depth",
  quotes:"/v3/market/quotes",
  trades:"/v3/market/trades"
});
export const IRONBEAM_V3_RESEARCH_SCHEMA="engine18.ironbeamV3Research.v1";
const ES=/^XCME:ES\.[HMUZ]\d{2}$/;

export function normalizeIronbeamEsSymbol(symbol) {
  const sym=String(symbol||"").toUpperCase().trim();
  const full=sym.startsWith("XCME:")?sym:`XCME:${sym}`;
  if(!ES.test(full)) throw Error("ENGINE18_IRONBEAM_INVALID_ES_SYMBOL");
  return full;
}
export function makeIronbeamV3ReadOnlyClient({apiKey,fetchImpl=fetch,baseUrl=BASE}={}) {
  if(typeof apiKey!=="string"||!apiKey.trim()) throw Error("ENGINE18_IRONBEAM_API_KEY_REQUIRED");
  // The host is fixed to Ironbeam production by default; tests may inject a fake fetch.
  if(baseUrl!==BASE) throw Error("ENGINE18_IRONBEAM_HOST_LOCKED");
  let token=null;
  async function call(path,{symbol,from}={}) {
    if(!["depth","quotes","trades"].includes(path)) throw Error("ENGINE18_READ_ONLY_ROUTE_REQUIRED");
    if(!token) throw Error("ENGINE18_IRONBEAM_NOT_AUTHENTICATED");
    const url=new URL(PATHS[path],BASE);
    url.searchParams.set("symbols",normalizeIronbeamEsSymbol(symbol));
    if(path==="trades"&&from!==undefined) {
      if(!Number.isSafeInteger(from)||from<0) throw Error("ENGINE18_INVALID_TRADE_CURSOR");
      url.searchParams.set("from",String(from));
    }
    const res=await fetchImpl(url.toString(),{
      method:"GET",headers:{Authorization:`Bearer ${token}`,Accept:"application/json"},
      signal:AbortSignal.timeout(7000)
    });
    if(!res.ok) throw Error(`ENGINE18_IRONBEAM_HTTP_${res.status}`);
    const value=await res.json();
    if(value?.status==="ERROR") throw Error("ENGINE18_IRONBEAM_MARKET_DATA_ERROR");
    return value;
  }
  return Object.freeze({
    async authenticate(){
      const res=await fetchImpl(BASE+PATHS.login,{
        method:"POST",headers:{"Content-Type":"application/json",Accept:"application/json"},
        body:JSON.stringify({apikey:apiKey}),signal:AbortSignal.timeout(7000)
      });
      if(!res.ok) throw Error(`ENGINE18_IRONBEAM_AUTH_HTTP_${res.status}`);
      const value=await res.json();
      if(value?.status!=="OK"||typeof value.token!=="string"||!value.token) throw Error("ENGINE18_IRONBEAM_AUTH_FAILED");
      token=value.token;
      return {authenticated:true}; // Never return or log JWT.
    },
    getDepth(symbol){return call("depth",{symbol});},
    getTrades(symbol,from){return call("trades",{symbol,from});},
    getQuotes(symbol){return call("quotes",{symbol});},
    // No order, account, risk or trading functionality exists in this client.
  });
}
export function normalizeIronbeamDepth(response,expectedSymbol) {
  const symbol=normalizeIronbeamEsSymbol(expectedSymbol);
  const rows=Array.isArray(response?.depths)?response.depths.filter(x=>x.exchSym===symbol):[];
  if(rows.length!==1) return {schema:IRONBEAM_V3_RESEARCH_SCHEMA,symbol,usable:false,reason:"DEPTH_MISSING_OR_AMBIGUOUS",levels:[]};
  const d=rows[0];
  function side(rows,side) {
    if(!Array.isArray(rows)) return [];
    return rows.map(x=>{
      const price=Number(x.price),size=Number(x.size),orderCount=Number(x.orderCount),at=Number(x.time);
      if(!Number.isFinite(price)||price<=0||!Number.isSafeInteger(size)||size<0||
         !Number.isSafeInteger(orderCount)||orderCount<0||!Number.isSafeInteger(at)||at<=0)
        throw Error("ENGINE18_IRONBEAM_INVALID_DEPTH_LEVEL");
      const ticks=Math.round(price/0.25);
      if(Math.abs(ticks*0.25-price)>1e-8) throw Error("ENGINE18_IRONBEAM_OFF_TICK_PRICE");
      return {side,priceTicks:ticks,price,quantity:size,orderCount,updatedAtUnixMs:at,
        observedSource:"AGGREGATED_DEPTH",individualOrderIds:false};
    });
  }
  const bids=side(d.bids,"BID").sort((a,b)=>b.priceTicks-a.priceTicks);
  const asks=side(d.asks,"ASK").sort((a,b)=>a.priceTicks-b.priceTicks);
  const crossed=!!(bids.length&&asks.length&&bids[0].priceTicks>=asks[0].priceTicks);
  return {schema:IRONBEAM_V3_RESEARCH_SCHEMA,symbol,source:"IRONBEAM_V3_REST_DEPTH",
    usable:!crossed && (bids.length>0||asks.length>0),crossed,levels:[...bids,...asks],
    isSnapshot:!!d.isSnapshot,delayedStatus:"NOT_ATTESTED",noExecution:true,
    limitations:["Aggregated market-by-price, not individual MBO event stream",
      "Entitlement may serve delayed market data without an error",
      "Must verify freshness against clock and exchange session before publishing live signals"]};
}
export function normalizeIronbeamTrades(response,expectedSymbol) {
  const symbol=normalizeIronbeamEsSymbol(expectedSymbol);
  const trades=Array.isArray(response?.trades)?response.trades.filter(t=>t.exchSym===symbol):[];
  return trades.map(t=>{
    const price=Number(t.price),quantity=Number(t.size),sendTime=Number(t.sendTime);
    if(!Number.isFinite(price)||price<=0||!Number.isSafeInteger(quantity)||quantity<=0||
       !Number.isSafeInteger(sendTime)||sendTime<=0) throw Error("ENGINE18_IRONBEAM_INVALID_TRADE");
    return {symbol,price,quantity,sendTimeUnixMs:sendTime,
      sequence:t.sequenceNumber==null?null:String(t.sequenceNumber),
      tradeId:t.tradeId==null?null:String(t.tradeId),
      aggressorSide:t.aggressorSide===1?"BUY":t.aggressorSide===2?"SELL":"UNKNOWN",
      evidence:"EXECUTED_TRADE",source:"IRONBEAM_V3_REST_TRADES"};
  });
}
