// Source-specific Massive/Polygon Futures WebSocket T contract.
// https://massive.com/docs/websocket/futures/trades — t is Unix milliseconds; q is
// ticker-unique, increasing trade sequence (gaps are valid). Unlike Futures REST,
// do NOT normalize nanoseconds or infer units by magnitude.
export const SOURCE="POLYGON_DIRECT_ES_TRADE";
const validNumber=n=>typeof n==="number"&&Number.isFinite(n);
export function normalizeEngine27V3EsTrade(message,{resolvedSymbol,observedAt}={}){
 if(!/^ES[FGHJKMNQUVXZ][0-9]{1,2}$/.test(resolvedSymbol??""))return null;
 if(message?.ev!=="T"||message?.sym!==resolvedSymbol)return null;
 if(!validNumber(message.p)||message.p<=0||!Number.isSafeInteger(message.s)||message.s<=0)return null;
 const raw=message.t;
 if(!Number.isSafeInteger(raw)||raw<1e12||raw>=1e13)return null; // strict Unix MS
 if(!Number.isSafeInteger(message.q)||message.q<0)return null;
 const observed=Date.parse(observedAt??"");
 if(!Number.isFinite(observed)||raw>observed+2000||observed-raw>30000)return null;
 return {ok:true,type:"trade",source:SOURCE,symbol:"ES",resolvedSymbol,
  price:message.p,size:message.s,tradeTime:new Date(raw).toISOString(),
  eventId:String(message.q),observedAt,readOnly:true};
}
