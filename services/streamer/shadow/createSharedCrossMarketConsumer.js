// Read-only QQQ/VIX internal SSE consumer: zero Polygon provider sockets.
// Auth token goes only in Authorization header, never URL or client response.
import {inspectDirectCrossMarketTick,applyDirectCrossMarketTick,presentDirectCrossMarketState}
 from "../../core/logic/engine27/v3/livePriceObserver/projectDirectCrossMarketTick.js";
// Separate connected transport from observation freshness. An index can be connected
// but not publish new values on every dashboard refresh. Never call an old value LIVE.
export function presentSharedCrossMarketFeed(record,connection,key,reason=null,nowMs=Date.now()){
 const live=presentDirectCrossMarketState(record,connection,nowMs);
 const age=record?.sourceMs&&nowMs>=record.sourceMs?nowMs-record.sourceMs:null;
 const connected=connection==="CONNECTED";
 const lastObservationUsable=age!==null&&age<=120000&&
   record?.sourceLatencyQualified===true&&Number.isFinite(record?.price);
 return {...live,
  connectionState:connection,
  freshnessState:live.available?"CURRENT":connected?(record?"WAITING_FOR_NEXT_UPDATE":"AWAITING_FIRST_UPDATE"):"SOURCE_UNAVAILABLE",
  lastObservedPrice:lastObservationUsable?record.price:null,
  lastObservedAgeSeconds:lastObservationUsable?Math.floor(age/1000):null,
  source:key==="QQQ"?"POLYGON_STOCK_TRADE":"POLYGON_INDEX_VALUE",
  sourceSymbol:key==="QQQ"?"QQQ":"I:VIX",reason,noExecution:true};
}
export function createSharedCrossMarketConsumer({baseUrl,token,onTick=null,enabled=true,
 fetcher=fetch,clock=()=>Date.now()}={}){
 const statuses={QQQ:"NOT_STARTED",VIX:"NOT_STARTED"},reasons={QQQ:null,VIX:null};
 const records={QQQ:null,VIX:null};const controllers={QQQ:null,VIX:null};
 let stopped=false;
 function status(){return Object.fromEntries(["QQQ","VIX"].map(k=>[k,
  presentSharedCrossMarketFeed(records[k],statuses[k],k,reasons[k],clock())]))}
 async function run(key){
  let tries=0;
  while(!stopped){
   if(!enabled||!baseUrl||!token){statuses[key]="RELAY_NOT_CONFIGURED";break}
   const controller=new AbortController();controllers[key]=controller;
   statuses[key]="CONNECTING";reasons[key]=null;
   try{
    const url=new URL(baseUrl);
    if(url.protocol!=="https:"||!url.hostname.endsWith(".onrender.com"))
     throw Error("UNTRUSTED_RELAY_ENDPOINT");
    const response=await fetcher(url.origin+"/stream/shared/observations/"+key,{
     headers:{Authorization:"Bearer "+token,Accept:"text/event-stream"},
     signal:controller.signal,cache:"no-store"});
    if(response.status===401||response.status===403){statuses[key]="RELAY_AUTH_FAILED";break}
    if(!response.ok||!response.body)throw Error("RELAY_UNAVAILABLE");
    let buffer="";tries=0;
    for await(const chunk of response.body){
     if(stopped)break;
     buffer+=new TextDecoder().decode(chunk,{stream:true});
     if(buffer.length>131072)throw Error("RELAY_FRAME_LIMIT");
     let end;
     while((end=buffer.indexOf("\n\n"))>=0){
      const frame=buffer.slice(0,end);buffer=buffer.slice(end+2);
      for(const line of frame.split("\n")){
       if(!line.startsWith("data: "))continue;
       let item;try{item=JSON.parse(line.slice(6))}catch{continue}
       if(item.symbol!==key)continue;
       if(item.type==="source"){
        const ownerState=item.state;
        statuses[key]=ownerState==="CONNECTED"?"CONNECTED":ownerState??"RELAY_UNAVAILABLE";
        reasons[key]=ownerState==="CONNECTED"?null:item.reason??ownerState??"OWNER_UNAVAILABLE";
       }else if(item.type==="tick"){
        const inspected=inspectDirectCrossMarketTick(item.tick,clock());
        if(!inspected.ok||inspected.tick.symbol!==key)continue;
        records[key]=applyDirectCrossMarketTick(records[key],inspected.tick,clock());
        if(typeof onTick==="function")try{onTick(inspected.tick)}catch{}
       }
      }
     }
    }
    if(!stopped){statuses[key]="RELAY_DISCONNECTED";reasons[key]=statuses[key]}
   }catch(e){
    if(stopped)break;
    statuses[key]="RELAY_DISCONNECTED";reasons[key]=
     e?.message==="UNTRUSTED_RELAY_ENDPOINT"?"INVALID_RELAY_ORIGIN":"RELAY_UNAVAILABLE";
   }finally{controllers[key]=null}
   if(stopped)break;
   await new Promise(resolve=>{const timer=setTimeout(resolve,Math.min(30000,1000*2**Math.min(tries++,5)));timer.unref?.()});
  }
 }
 return Object.freeze({start(){if(stopped)return;for(const key of ["QQQ","VIX"])void run(key)},
  status,stop(){stopped=true;for(const c of Object.values(controllers))c?.abort()}});
}
