// Explicitly started, in-memory, shared single consumer of the protected trade SSE.
// Does not start automatically, does not contact Polygon directly and never writes files/orders.
import {createTradeSseParser} from "./parseTradeSse.js";
import {createMicroTradeConsumer} from "./createMicroTradeConsumer.js";
let activeRunner=null;
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export function createTradeIngestionRunner({url,token,readInputs,onObservation,fetchStream=fetch,clock=()=>new Date().toISOString()}={}){
 if(typeof url!=="string"||!url.startsWith("https://")||!url.includes("/stream/futures/trades-v3")||
 typeof token!=="string"||!token||typeof fetchStream!=="function")throw new TypeError("AUTHORIZED_READ_ONLY_TRADE_SOURCE_REQUIRED");
 const consumer=createMicroTradeConsumer({readInputs,onObservation});
 let running=false,abort=null,retryCount=0,connected=false;
 async function run(){
  if(activeRunner&&activeRunner!==api)throw new Error("ONLY_ONE_SHARED_TRADE_CONSUMER_PER_PROCESS");
  activeRunner=api;running=true;
  try{
   while(running){
    connected=false;consumer.reconnect();
    abort=new AbortController();
    const parser=createTradeSseParser();let lastBytes=Date.now();
    const watchdog=setInterval(()=>{if(Date.now()-lastBytes>45000)abort?.abort()},5000);
    try{
     const response=await fetchStream(url,{headers:{"X-Engine27-V3-Read-Token":token,Accept:"text/event-stream"},signal:abort.signal,cache:"no-store"});
     if(!response?.ok||!response.body)throw new Error("TRADE_SOURCE_HTTP_UNAVAILABLE");
     const decoder=new TextDecoder();
     for await(const bytes of response.body){
      if(!running)break;
      lastBytes=Date.now();
      const parsed=parser.push(decoder.decode(bytes,{stream:true}));
      if(parsed.error)throw new Error(parsed.error);
      for(const event of parsed.events){
       if(event?.type==="snapshot"&&event?.source==="POLYGON_DIRECT_ES_TRADE"){
        connected=consumer.connect(event.resolvedSymbol)==="CONNECTED";retryCount=0;
       }else if(event?.type==="status"&&event.ok===false){
        connected=false;consumer.disconnect(event.reasonCode??"SOURCE_DISCONNECTED");
       }else if(connected&&event?.type==="trade"){
        consumer.ingest(event,clock());
       }
      }
     }
    }catch{/* Intentional: disconnect is represented in state, not thrown to trading pipeline. */}
    finally{clearInterval(watchdog);abort?.abort();consumer.disconnect("SOURCE_GAP_OR_RECONNECT");connected=false}
    if(!running)break;
    await pause(Math.min(30000,1000*(2**Math.min(retryCount++,5))));
   }
  }finally{running=false;abort=null;if(activeRunner===api)activeRunner=null}
 }
 const api=Object.freeze({run,stop(){running=false;abort?.abort()},status(){return consumer.getState()}});
 return api;
}
