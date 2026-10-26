// Isolated shadow-only Polygon live observer: 2 connections, no subscriptions to all symbols.
// QQQ: T.QQQ STOCK trades. VIX: V.I:VIX INDEX VALUES (no fictional VIX trades).
import WebSocket from "ws";
import {inspectDirectCrossMarketTick,applyDirectCrossMarketTick,presentDirectCrossMarketState}
 from "../../core/logic/engine27/v3/livePriceObserver/projectDirectCrossMarketTick.js";
const ROOTS=Object.freeze([
 {symbol:"QQQ",url:"wss://socket.polygon.io/stocks",topic:"T.QQQ"},
 {symbol:"VIX",url:"wss://socket.polygon.io/indices",topic:"V.I:VIX"}
]);
export function createCrossMarketLiveObserver({apiKey,enabled=true,Socket=WebSocket,clock=()=>Date.now()}={}){
 const records={QQQ:null,VIX:null},statuses={QQQ:"NOT_STARTED",VIX:"NOT_STARTED"};
 const reasons={QQQ:null,VIX:null};
 const sessions=[];
 let stopped=false;
 function startOne(source){
  const session={socket:null,retry:null,count:0,authenticated:false};sessions.push(session);
  const connect=()=>{
   if(stopped||session.socket)return;
   if(!enabled||!apiKey){statuses[source.symbol]="PROVIDER_NOT_CONFIGURED";return}
   statuses[source.symbol]="CONNECTING";
   let ws;try{ws=new Socket(source.url)}catch{schedule();return}
   session.socket=ws;session.authenticated=false;
   ws.on("open",()=>{ws.send(JSON.stringify({action:"auth",params:apiKey}))});
   ws.on("message",buf=>{
    let messages;try{messages=JSON.parse(String(buf))}catch{return}
    for(const m of Array.isArray(messages)?messages:[messages]){
     if(m?.ev==="status"){
      if(m.status==="auth_success"&&!session.authenticated){
       session.authenticated=true;session.count=0;statuses[source.symbol]="CONNECTED";
       ws.send(JSON.stringify({action:"subscribe",params:source.topic}));
      }else if(m.status==="auth_failed"||m.status==="max_connections"){
       statuses[source.symbol]=m.status==="auth_failed"?"AUTH_FAILED":"SUBSCRIPTION_LIMIT";
       reasons[source.symbol]=statuses[source.symbol];try{ws.close()}catch{}
      }else if(m.status==="error"){
       statuses[source.symbol]="PROVIDER_REJECTED";reasons[source.symbol]="PROVIDER_STATUS_ERROR";
      }
      continue;
     }
     if(!session.authenticated)continue;
     const inspected=inspectDirectCrossMarketTick(m,clock());
     if(inspected.ok&&inspected.tick.symbol===source.symbol){
      records[source.symbol]=applyDirectCrossMarketTick(records[source.symbol],inspected.tick,clock());
     }
    }
   });
   ws.on("error",()=>{if(statuses[source.symbol]==="CONNECTED")statuses[source.symbol]="SOURCE_ERROR"});
   ws.on("close",()=>{if(session.socket!==ws)return;session.socket=null;session.authenticated=false;
    if(stopped)return;
    if(!["AUTH_FAILED","SUBSCRIPTION_LIMIT","PROVIDER_REJECTED"].includes(statuses[source.symbol]))
     statuses[source.symbol]="DISCONNECTED";
    schedule();
   });
  };
  const schedule=()=>{
   if(stopped||session.retry)return;
   const delay=Math.min(30000,1000*2**Math.min(session.count++,5));
   session.retry=setTimeout(()=>{session.retry=null;connect()},delay);
   session.retry.unref?.();
  };
  connect();
 }
 return Object.freeze({
  start(){if(stopped)return;for(const source of ROOTS)startOne(source)},
  status(){return Object.fromEntries(ROOTS.map(s=>[s.symbol,{
   ...presentDirectCrossMarketState(records[s.symbol],statuses[s.symbol],clock()),
   source:s.symbol==="QQQ"?"POLYGON_STOCK_TRADE":"POLYGON_INDEX_VALUE",
   sourceSymbol:s.symbol==="QQQ"?"QQQ":"I:VIX",
   reason:reasons[s.symbol],noExecution:true}]))},
  stop(){stopped=true;for(const s of sessions){if(s.retry)clearTimeout(s.retry);s.socket?.close?.()}},
 });
}
