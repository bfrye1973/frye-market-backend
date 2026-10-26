// Polygon shared stream: pure in-process event fanout contract.
// No socket, provider credentials, network, disk, trading or automatic startup.
const ALLOWED = new Map([["T.SPY",{"ev":"T","sym":"SPY"}],["T.QQQ",{"ev":"T","sym":"QQQ"}],["AM.SPY",{"ev":"AM","sym":"SPY"}],["AM.QQQ",{"ev":"AM","sym":"QQQ"}],["V.I:VIX",{"ev":"V","T":"I:VIX"}]]);
export function createSharedMarketEventBus({maxListenersPerTopic=16}={}){
 const registry=new Map([...ALLOWED.keys()].map(k=>[k,new Set()]));
 const allowedTopic=t=>ALLOWED.has(t)||/^(?:T|AM)\.[A-Z][A-Z0-9.]{0,9}$/.test(t);
 let sequence=0;
 function subscribe(topic,listener){
  if(!allowedTopic(topic)||typeof listener!=="function")throw Error("UNSUPPORTED_TOPIC_OR_LISTENER");
  if(!registry.has(topic)){
   if(registry.size>=64)throw Error("MAX_DISTINCT_TOPICS");
   registry.set(topic,new Set());
  }
  const set=registry.get(topic);if(set.size>=maxListenersPerTopic)throw Error("MAX_LISTENERS");
  set.add(listener);let active=true;
  return ()=>{if(active){active=false;set.delete(listener)}};
 }
 function publish(topic,event,source="POLYGON_DIRECT",receivedAt=Date.now()){
  const expected=ALLOWED.get(topic)??(/^(T|AM)\.([A-Z][A-Z0-9.]{0,9})$/.exec(topic)?
    {ev:topic.split(".")[0],sym:topic.slice(topic.indexOf(".")+1)}:null);
  if(!expected||!event||typeof event!=="object"||
   event.ev!==expected.ev||
   (expected.sym&&event.sym!==expected.sym)||
   (expected.T&&event.T!==expected.T)||
   !Number.isFinite(receivedAt))
    return {accepted:false,reason:"SYMBOL_OR_EVENT_MISMATCH"};
  sequence++;
  const envelope=Object.freeze({topic,source,sequence,receivedAt,event:Object.freeze({...event})});
  let accepted=0,exceptions=0;
  for(const fn of registry.get(topic)){
   try{fn(envelope);accepted++}catch{exceptions++}
  }
  return {accepted:true,sequence,subscribersNotified:accepted,subscriberErrors:exceptions};
 }
 return Object.freeze({
  subscribe,publish,
  diagnostics:()=>({sequence,subscribers:Object.fromEntries([...registry].map(([k,s])=>[k,s.size]))})
 });
}
