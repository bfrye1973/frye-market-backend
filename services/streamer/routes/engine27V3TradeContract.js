// Source-qualified individual ES futures trade conversion. No aggregation and no trading authority.
export const SOURCE = "POLYGON_DIRECT_ES_TRADE";
const finite=n=>typeof n==="number"&&Number.isFinite(n);
export function normalizeEngine27V3EsTrade(message,{resolvedSymbol,observedAt}={}){
 if(!/^ES[FGHJKMNQUVXZ][0-9]{1,2}$/.test(resolvedSymbol??""))return null;
 if((message?.ev??message?.event)!=="T"||message?.sym!==resolvedSymbol)return null;
 const price=message?.p, size=message?.s;
 if(!finite(price)||price<=0||!finite(size)||size<=0)return null;
 // Polygon futures trade timestamps can use seconds / milliseconds / microseconds / nanoseconds.
 // Unit must be unambiguous by magnitude; no wall-clock fallback.
 const raw=message?.t;
 if(!finite(raw)||raw<=0)return null;
 const unit=raw>=1e17?"ns":raw>=1e14?"us":raw>=1e12?"ms":raw>=1e9?"s":null;
 if(!unit)return null;
 const ms=unit==="ns"?Math.floor(raw/1e6):unit==="us"?Math.floor(raw/1e3):unit==="ms"?raw:raw*1000;
 const observed=Date.parse(observedAt??"");
 if(!Number.isFinite(observed)||!Number.isFinite(ms)||ms>observed+2000||observed-ms>30000)return null;
 return {type:"trade",source:SOURCE,symbol:"ES",resolvedSymbol,
   price,size,tradeTime:new Date(ms).toISOString(),observedAt,readOnly:true};
}
