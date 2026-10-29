// Engine27 V6 — single-worker, bounded shared OHLC request gate.
// The recorder must fail closed rather than queue unbounded provider requests.
export function createCandleRequestGate({maxPerMinute=2,minSpacingMs=15000,now=()=>Date.now()}={}){
 if(!Number.isInteger(maxPerMinute)||maxPerMinute<1||maxPerMinute>6||
    !Number.isInteger(minSpacingMs)||minSpacingMs<0||minSpacingMs>60000)
  throw Error("INVALID_CANDLE_RATE_POLICY");
 let hits=[],last=-Infinity,inFlight=false,blocked=0;
 async function execute(fn){
  const tick=now();
  hits=hits.filter(t=>tick-t<60000);
  if(inFlight||hits.length>=maxPerMinute||tick-last<minSpacingMs){
   blocked++;return {available:false,reason:"CANDLE_REQUEST_BACKPRESSURE",retryAfterMs:Math.max(
    0,hits.length>=maxPerMinute?60000-(tick-hits[0]):0,
    tick-last<minSpacingMs?minSpacingMs-(tick-last):0)};
  }
  inFlight=true;hits.push(tick);last=tick;
  try{return await fn();}finally{inFlight=false}
 }
 return Object.freeze({execute,status:()=>({requestsLastMinute:hits.filter(t=>now()-t<60000).length,
  maxPerMinute,blocked,inFlight})});
}
