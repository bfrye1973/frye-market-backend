// Source-specific Massive futures websocket T event (t=Unix MS, q=per-ticker sequence).
// No guessed conversions. Rejections are shape-only; diagnostics never disclose raw trades.
export const SOURCE="POLYGON_DIRECT_ES_TRADE";
const finite=n=>typeof n==="number"&&Number.isFinite(n);
export function inspectEngine27V3EsTrade(message,{resolvedSymbol,observedAt}={}){
 const shape={eventType:typeof message?.ev,symbolType:typeof message?.sym,priceType:typeof message?.p,
  sizeType:typeof message?.s,timeType:typeof message?.t,sequenceType:typeof message?.q};
 const reject=reasonCode=>({ok:false,reasonCode,shape});
 if(!/^ES[FGHJKMNQUVXZ][0-9]{1,2}$/.test(resolvedSymbol??""))return reject("ES_CONTRACT_UNVERIFIED");
 if(message?.ev!=="T")return reject("NOT_FUTURES_TRADE");
 if(message?.sym!==resolvedSymbol)return reject("CONTRACT_MISMATCH");
 // Observed on live staging (2026-10-26): Polygon T.p arrives as a numeric string.
 // Match existing Backend2 getTradePrice numeric-coercion semantics, but accept
 // ONLY a strict unsigned decimal, never symbols, exponentials or unit guessing.
 const p=message.p;
 const price=finite(p)?p:(typeof p==="string"&&/^[0-9]+(?:[.][0-9]+)?$/.test(p.trim())?Number(p.trim()):NaN);
 if(!finite(price)||price<=0)return reject("INVALID_FUTURES_TRADE_PRICE");
 if(!Number.isSafeInteger(message.s)||message.s<=0)return reject("INVALID_FUTURES_TRADE_SIZE");
 if(!Number.isSafeInteger(message.t)||message.t<1e12||message.t>=1e13)return reject("INVALID_FUTURES_TRADE_TIMESTAMP_MS");
 if(!Number.isSafeInteger(message.q)||message.q<0)return reject("INVALID_FUTURES_TRADE_SEQUENCE");
 const observed=Date.parse(observedAt??"");
 if(!Number.isFinite(observed))return reject("OBSERVATION_TIME_UNAVAILABLE");
 const lagMs=observed-message.t;
 if(lagMs< -2000)return reject("FUTURE_FUTURES_TRADE");
 if(lagMs>30000)return reject("DELAYED_FUTURES_TRADE_GT_30S");
 return {ok:true,reasonCode:null,shape,lagMs,
  trade:{ok:true,type:"trade",source:SOURCE,symbol:"ES",resolvedSymbol,
   price,size:message.s,tradeTime:new Date(message.t).toISOString(),
   eventId:String(message.q),observedAt,readOnly:true}};
}
export function normalizeEngine27V3EsTrade(message,params={}){
 return inspectEngine27V3EsTrade(message,params).trade??null;
}
