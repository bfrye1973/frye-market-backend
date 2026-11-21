import {createEngine18Level2ZoneReader} from "./ironbeamV2Level2Zones.js";
// One-shot, read-only Ironbeam v2 DEMO streaming acceptance check.
// Never log/request/return credentials, JWT, stream ID, WSS URL or raw market packets.
const HOST="https://demo.ironbeamapi.com";
const SYMBOL="XCME:ES.Z26";
const PATHS={quotes:"quotes",depth:"depths",trades:"trades"};
export async function probeIronbeamV2DemoStream({
  username,password,apikey,fetchImpl=fetch,WebSocketImpl=globalThis.WebSocket,
  observationMs=14000
}={}) {
  const zoneReader=createEngine18Level2ZoneReader({minObservations:3,allowDelayedResearch:true});
  const result={provider:"IRONBEAM_V2_DEMO",symbol:SYMBOL,readOnly:true,noExecution:true,
    auth:false,streamCreated:false,websocketOpened:false,
    subscriptions:{quotes:null,depth:null,trades:null},
    frames:{quotes:0,depth:0,trades:0,pings:0,other:0},
    marketDataObserved:false,liveEntitlementConfirmed:false,mboConfirmed:false,reason:null,
    depthParsing:{accepted:0,rejected:0,reasons:{}}};
  if(!username||!password||!apikey){result.reason="MISSING_CREDENTIALS";return result;}
  if(typeof WebSocketImpl!=="function"){result.reason="WEBSOCKET_UNAVAILABLE";return result;}
  if(!Number.isInteger(observationMs)||observationMs<1000||observationMs>30000)throw Error("ENGINE18_INVALID_PROBE_WINDOW");
  const safeFetch=async (path,token,method="GET",body=null)=>{
    try{
      const res=await fetchImpl(HOST+path,{method,headers:{
        Accept:"application/json",...(body?{"Content-Type":"application/json"}:{}),
        ...(token?{Authorization:"Bearer "+token}:{})
      },...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(7000)});
      let json=null;try{json=await res.json();}catch{}
      return {ok:res.ok&&json?.status!=="ERROR",status:res.status,json};
    }catch{return {ok:false,status:null,json:null};}
  };
  const auth=await safeFetch("/v2/auth",null,"POST",{username,password,apiKey:apikey});
  if(!auth.ok||!auth.json?.token){result.reason="AUTH_FAILED";result.authHttpStatus=auth.status;return result;}
  result.auth=true;
  const token=auth.json.token;
  const create=await safeFetch("/v2/stream/create",token);
  if(!create.ok||typeof create.json?.streamId!=="string"||!create.json.streamId) {
    result.reason="STREAM_CREATE_FAILED";result.createHttpStatus=create.status;return result;
  }
  result.streamCreated=true;
  const streamId=create.json.streamId;
  const wsUrl="wss://demo.ironbeamapi.com/v2/stream/"+encodeURIComponent(streamId)+"?token="+encodeURIComponent(token);
  const ws=new WebSocketImpl(wsUrl);
  const closed=()=>{try{ws.close();}catch{}};
  // Do not log websocket error objects: they may contain token-bearing URLs.
  const waitOpen=new Promise(resolve=>{
    let settled=false;
    const settle=x=>{if(!settled){settled=true;resolve(x);}};
    ws.addEventListener("open",()=>settle(true),{once:true});
    ws.addEventListener("error",()=>settle(false),{once:true});
    ws.addEventListener("close",()=>settle(false),{once:true});
    setTimeout(()=>settle(false),5000);
  });
  const opened=await waitOpen;
  if(!opened){closed();result.reason="WEBSOCKET_OPEN_FAILED";return result;}
  result.websocketOpened=true;
  ws.addEventListener("message",e=>{
    try{
      const payload=JSON.parse(typeof e.data==="string"?e.data:String(e.data));
      for(const [k,v] of Object.entries({quotes:"q",depth:"d",trades:"tr",pings:"p"})) {
        if(payload?.[v]!=null)result.frames[k]++;
      }
      if(payload?.d!=null){
        const ingested=zoneReader.observe(payload);
        if(ingested.accepted) result.depthParsing.accepted++;
        else{
          result.depthParsing.rejected++;
          const reason=ingested.reason||"UNKNOWN";
          result.depthParsing.reasons[reason]=(result.depthParsing.reasons[reason]||0)+1;
        }
      }
      if(!["q","d","tr","p"].some(k=>payload?.[k]!=null)) result.frames.other++;
    }catch{result.frames.other++;}
  });
  for(const [name,path] of Object.entries(PATHS)){
    const r=await safeFetch("/v2/market/"+path+"/subscribe/"+encodeURIComponent(streamId)+"?symbols="+encodeURIComponent(SYMBOL),token);
    result.subscriptions[name]={ok:r.ok,httpStatus:r.status};
  }
  await new Promise(resolve=>setTimeout(resolve,observationMs));
  result.marketDataObserved=(result.frames.quotes+result.frames.depth+result.frames.trades)>0;
  result.reason=result.marketDataObserved?null:"NO_MARKET_FRAMES_IN_OBSERVATION_WINDOW";
  const zones=zoneReader.snapshot({feedTier:"UNVERIFIED"});
  result.liquidityResearch={usable:zones.usable,reason:zones.reason,
    images:zones.images,zoneCount:zones.zones.length,
    // This is a protected diagnostic log, but do not publish raw market data
    // on a public endpoint or label delayed demo levels as trading signals.
    topZones:zones.zones.slice(0,5).map(z=>({side:z.side,price:z.price,
      visibleContracts:z.visibleContracts,observedInImages:z.observedInImages})),
    lastExchangeMs:zones.lastExchangeMs,ageMs:zones.ageMs,
    displayOnly:true,level3:false};
  closed();
  return result;
}
