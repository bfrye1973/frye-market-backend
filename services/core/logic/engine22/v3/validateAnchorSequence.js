// Engine22 V3 — validate owner-supplied anchor chronology without editing values.
// Times must have an explicit UTC offset or be ISO calendar local strings with an
// explicit provided zone offset; ambiguous dates must not be silently interpreted.
const integerTick=(n,tick)=>Math.abs(n/tick-Math.round(n/tick))<1e-8;
const anchors=["W1_LOW","W1_HIGH","W2_LOW","W3_HIGH","W4_LOW","W5_HIGH"];
export function validateEngine22V3AnchorSequence({marks=null,timezoneOffset=null,tickSize=0.25}={}){
 const errors=[];
 if(!marks||typeof marks!=="object"||Array.isArray(marks))
  return {ok:false,errors:["ANCHORS_REQUIRED"]};
 if(typeof tickSize!=="number"||!Number.isFinite(tickSize)||tickSize<=0)
  return {ok:false,errors:["INVALID_TICK_SIZE"]};
 const times=[];
 for(const key of anchors){
  const a=marks[key];if(a==null)continue;
  if(typeof a.price!=="number"||!Number.isFinite(a.price)||a.price<=0||
     !integerTick(a.price,tickSize)){errors.push(key+"_INVALID_PRICE");continue;}
  if(typeof a.time!=="string"){errors.push(key+"_TIME_REQUIRED");continue;}
  const s=a.time.trim().replace(" ","T");
  const hasOffset=/([zZ]|[+-]\d\d:\d\d)$/.test(s);
  if(!hasOffset && !/^[+-]\d\d:\d\d$/.test(timezoneOffset||""))
    {errors.push(key+"_TIMEZONE_OFFSET_REQUIRED");continue;}
  const iso=hasOffset?s:s+timezoneOffset;
  const parsed=Date.parse(iso);
  if(!Number.isFinite(parsed)){errors.push(key+"_INVALID_TIME");continue;}
  times.push({key,ms:parsed});
 }
 for(let i=1;i<times.length;i++)
  if(times[i].ms<=times[i-1].ms)
    errors.push(times[i-1].key+"_BEFORE_"+times[i].key+"_ORDER_VIOLATION");
 return {ok:errors.length===0,errors};
}
