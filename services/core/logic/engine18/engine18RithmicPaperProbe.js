// Engine 18D — Rithmic PAPER TRADING Step A probe (auth + BBO/LastTrade only).
//
// Scope: disabled by default, finite (<=120 s of market data), read-only TICKER_PLANT.
// NO order plant, NO DBO (115/117), NO recorder, NO persistence, NO trading templates.
// Test-system modules are imported for shared protobuf helpers only; their Test
// lock (verifyTestEnvironment) is untouched and never used here.
//
// Protocol references (two independent public sources; official RAPI kit not in repo):
//  - Vendor .proto files bundled in async_rithmic (protocol_buffers/source/*.proto):
//    request_login, response_login (heartbeat_interval 153633), request/response_heartbeat,
//    request_logout, request_market_data_update (update_bits 154211, LAST_TRADE=1, BBO=2),
//    best_bid_offer (151), last_trade (150), forced_logout (77).
//  - rithmic-rs 3.x generated protos (src/rti.rs) incl. RequestRithmicSystemGatewayInfo (20)
//    / ResponseRithmicSystemGatewayInfo (21: gateway_name 153640, gateway_uri 153641).
//    Template 20/21 is corroborated by ONE public source only — treat as UNVERIFIED-RAPI.
import WebSocket from 'ws';
import {decodeFields,encodeSystemInfoRequest,parseSystemInfo,PROTOCOL_FIELDS,
 RITHMIC_TEST_ENDPOINT,encodeTickerPlantLogin,parseLogin} from './engine18RithmicTestProbe.js';
import {encodeConformanceHeartbeat,CONFORMANCE_APP_NAME} from './engine18RithmicConformanceTest.js';

export const PAPER_SYSTEM_NAME='Rithmic Paper Trading';
// Reuse the exact conformance-approved brfr: app name.
export const PAPER_APP_NAME=CONFORMANCE_APP_NAME;
// Only vendor-provided hostname already in the codebase. Used for discovery only:
// system list (16, unauthenticated) and gateway list (20), which requires a logged-in
// session (rithmic-rs exposes it only on a connected plant). Discovery logs in with the
// existing, already-approved Rithmic TEST credentials to the Test system it was approved
// for. Paper credentials are NEVER sent here.
export const DISCOVERY_GATEWAY=RITHMIC_TEST_ENDPOINT;
export const ES_TICK=0.25;
export const MAX_STEP_A_MS=120000;
export const TEMPLATES=Object.freeze({login:10,loginResp:11,logout:12,logoutResp:13,
 systemInfo:16,systemInfoResp:17,heartbeat:18,heartbeatResp:19,gatewayInfo:20,
 gatewayInfoResp:21,forcedLogout:77,marketData:100,marketDataResp:101,lastTrade:150,bbo:151});
// Every template this module is allowed to SEND. Anything else is a defect.
export const SEND_ALLOWLIST=Object.freeze([10,12,16,18,20,100]);
const F=Object.freeze({...PROTOCOL_FIELDS,rqHandlerRpCode:132764,gatewayName:153640,
 gatewayUri:153641,symbol:110100,exchange:110101,request:100000,updateBits:154211,
 presenceBits:149138,clearBits:154571,isSnapshot:110121,bidPrice:100022,bidSize:100030,
 bidSize64:159000,askPrice:100025,askSize:100031,askSize64:159002,tradePrice:100006,
 tradeSize:100178,tradeSize64:159008,aggressor:112003,ssboe:150100,usecs:150101});
const UPDATE_BITS={LAST_TRADE:1,BBO:2};

// --- protobuf wire helpers (same encoding as the conformance module) ---
const uvar=n=>{if(!Number.isSafeInteger(n)||n<0)throw Error('invalid protobuf integer');
 const a=[];do{const b=n%128;n=Math.floor(n/128);a.push(n?b|128:b)}while(n);return Buffer.from(a)};
const str=(field,value)=>{const b=Buffer.from(value,'utf8');
 return Buffer.concat([uvar(field*8+2),uvar(b.length),b])};
const num=(field,value)=>Buffer.concat([uvar(field*8),uvar(value)]);
const strings=(f,k)=>(f[k]||[]).filter(Buffer.isBuffer).map(x=>x.toString('utf8'));
const first=(f,k)=>f[k]?.[0];
const dbl=(f,k)=>{const x=first(f,k);if(!Buffer.isBuffer(x)||x.length!==8)return null;
 const v=x.readDoubleLE(0);return Number.isFinite(v)?v:null};
const int=(f,k)=>{const x=first(f,k);return Number.isSafeInteger(x)?x:null};
const okCodes=c=>c.length>=1&&c[0]==='0';
const safeCode=c=>typeof c==='string'&&/^\d{1,6}$/.test(c)?c:'OTHER';

// --- configuration (separate from Test; no Test fallback) ---
export function verifyPaperEnvironment(env){
 if(env.RITHMIC_PAPER_CONNECT_ENABLED!=='YES')throw Error('Rithmic Paper connection disabled');
 const user=env.RITHMIC_PAPER_USER,password=env.RITHMIC_PAPER_PASSWORD;
 if(typeof user!=='string'||!user||typeof password!=='string'||!password)
  throw Error('missing Rithmic Paper credentials (RITHMIC_PAPER_USER/RITHMIC_PAPER_PASSWORD)');
 if(env.RITHMIC_PAPER_SYSTEM_NAME&&env.RITHMIC_PAPER_SYSTEM_NAME!==PAPER_SYSTEM_NAME)
  throw Error('only Rithmic Paper Trading is permitted');
 const symbol=env.RITHMIC_PAPER_SYMBOL||'ESZ6';
 if(!/^ES[HMUZ]\d$/.test(symbol))throw Error('explicit outright ES contract required');
 const gatewayName=env.RITHMIC_PAPER_GATEWAY_NAME||null;
 if(gatewayName!==null&&!/^[A-Za-z0-9 ._()-]{1,64}$/.test(gatewayName))
  throw Error('invalid gateway name');
 const pinnedUri=env.RITHMIC_PAPER_GATEWAY_URI?normalizeGatewayUri(env.RITHMIC_PAPER_GATEWAY_URI):null;
 // Discovery host. Default = Test kit gateway (serves only Rithmic Test, so it needs a Test
 // login and may still refuse 20). A multi-system rprotocol host (validated *.rithmic.com:443)
 // can be named instead; it is queried WITHOUT credentials.
 const discoveryUri=env.RITHMIC_PAPER_DISCOVERY_URI?normalizeGatewayUri(env.RITHMIC_PAPER_DISCOVERY_URI):null;
 const unauthDiscovery=discoveryUri!==null&&discoveryUri!==RITHMIC_TEST_ENDPOINT;
 // Discovery-only login on the Test system. Never used for the Paper session.
 const discoveryUser=env.RITHMIC_TEST_USER,discoveryPassword=env.RITHMIC_TEST_PASSWORD;
 if(!unauthDiscovery&&(!discoveryUser||!discoveryPassword))
  throw Error('missing discovery login (RITHMIC_TEST_USER/RITHMIC_TEST_PASSWORD on Rithmic Test)');
 return {user,password,symbol,exchange:'CME',gatewayName,pinnedUri,discoveryUri,unauthDiscovery,
  discoveryUser,discoveryPassword};
}

// Accepts 'host.rithmic.com:443' or 'wss://host.rithmic.com:443'. Rejects anything
// that is not a bare *.rithmic.com host on 443 (no path, query, credentials).
export function normalizeGatewayUri(raw){
 if(typeof raw!=='string'||raw.length>200)throw Error('invalid gateway uri');
 const text=/^[a-z]+:\/\//i.test(raw)?raw:`wss://${raw}`;
 let u;try{u=new URL(text)}catch{throw Error('invalid gateway uri')}
 if(u.protocol!=='wss:')throw Error('gateway must use wss');
 if(u.username||u.password||u.search||u.hash||(u.pathname&&u.pathname!=='/'))
  throw Error('gateway uri must be host:port only');
 if(!/^[a-z0-9-]+(\.[a-z0-9-]+)*\.rithmic\.com$/i.test(u.hostname))
  throw Error('gateway host must be a rithmic.com host');
 if(u.port&&u.port!=='443')throw Error('gateway port must be 443');
 return `wss://${u.hostname.toLowerCase()}:443`;
}

// --- discovery messages ---
export function encodeGatewayInfoRequest(systemName=PAPER_SYSTEM_NAME){
 return Buffer.concat([num(F.templateId,TEMPLATES.gatewayInfo),str(F.systemName,systemName)]);
}
export function parseGatewayInfo(frame){
 const f=decodeFields(frame);
 if(first(f,F.templateId)!==TEMPLATES.gatewayInfoResp)throw Error('unexpected gateway-info template');
 const rpCodes=strings(f,F.rpCode),names=strings(f,F.gatewayName),uris=strings(f,F.gatewayUri);
 if(names.length!==uris.length)throw Error('gateway name/uri count mismatch');
 return {accepted:okCodes(rpCodes),rpCode:safeCode(rpCodes[0]),
  systemName:strings(f,F.systemName)[0]??null,
  gateways:names.map((name,i)=>({name,uri:uris[i]}))};
}
// Picks exactly one vendor-discovered gateway. Never invents one.
export function selectGateway({gateways,preferredName=null,pinnedUri=null}){
 const valid=[],rejected=[];
 for(const g of gateways){try{valid.push({name:g.name,uri:normalizeGatewayUri(g.uri)})}
  catch{rejected.push(g.name)}}
 let pick=valid;
 if(pinnedUri)pick=pick.filter(g=>g.uri===pinnedUri);
 if(preferredName)pick=pick.filter(g=>g.name===preferredName);
 const names=valid.map(g=>g.name);
 if(pick.length===1)return {ok:true,gateway:pick[0],source:pinnedUri?'DISCOVERED_AND_PINNED':
  preferredName?'DISCOVERED_BY_NAME':'DISCOVERED_SINGLE',names,rejected};
 return {ok:false,reason:pick.length?'GATEWAY_AMBIGUOUS_SET_RITHMIC_PAPER_GATEWAY_NAME':
  valid.length?'GATEWAY_PREFERENCE_NOT_DISCOVERED':'NO_VALID_GATEWAY_DISCOVERED',names,rejected};
}

// --- session messages ---
export function encodePaperLogin({user,password},infraType=1){
 if(infraType!==1&&infraType!==3)throw Error('TICKER_PLANT(1) or HISTORY_PLANT(3) only');
 if(typeof user!=='string'||!user||typeof password!=='string'||!password)
  throw Error('Rithmic Paper credentials required');
 // aggregated_quotes (153644) intentionally NOT sent: un-aggregated feed required.
 return Buffer.concat([num(F.templateId,TEMPLATES.login),str(F.templateVersion,'5.55'),
  str(F.user,user),str(F.password,password),str(F.appName,PAPER_APP_NAME),
  str(F.appVersion,'0.1.0'),str(F.systemName,PAPER_SYSTEM_NAME),
  num(F.infraType,infraType)]); // 1=TICKER_PLANT, 3=HISTORY_PLANT
}
export function parsePaperLogin(frame){
 const f=decodeFields(frame);
 if(first(f,F.templateId)!==TEMPLATES.loginResp)throw Error('unexpected login template');
 const codes=strings(f,F.rpCode),hb=dbl(f,F.heartbeatInterval);
 return {accepted:codes.length===1&&codes[0]==='0',rpCode:safeCode(codes[0]),
  heartbeatSec:hb!==null&&hb>0&&hb<=300?hb:null};
}
export function encodeMarketDataRequest({symbol,exchange,subscribe}){
 if(!/^ES[HMUZ]\d$/.test(symbol)||exchange!=='CME')throw Error('ES/CME only');
 return Buffer.concat([num(F.templateId,TEMPLATES.marketData),str(F.symbol,symbol),
  str(F.exchange,exchange),num(F.request,subscribe?1:2),
  num(F.updateBits,UPDATE_BITS.LAST_TRADE|UPDATE_BITS.BBO)]);
}
export const encodeLogout=()=>num(F.templateId,TEMPLATES.logout);

// --- inbound market data ---
const size=(f,k64,k32)=>int(f,k64)??int(f,k32);
// Gateway timestamp in microseconds (ssboe*1e6+usecs; < 2^53 until year 2255) or null.
const gwTs=f=>{const a=int(f,F.ssboe),b=int(f,F.usecs);return a===null?null:a*1e6+(b??0)};
export function parseInbound(frame){
 const f=decodeFields(frame),id=first(f,F.templateId);
 if(id===TEMPLATES.bbo)return {kind:'BBO',presence:int(f,F.presenceBits),clear:int(f,F.clearBits),
  snapshot:int(f,F.isSnapshot)===1,bid:dbl(f,F.bidPrice),bidSize:size(f,F.bidSize64,F.bidSize),
  ask:dbl(f,F.askPrice),askSize:size(f,F.askSize64,F.askSize),ts:gwTs(f)};
 if(id===TEMPLATES.lastTrade)return {kind:'TRADE',presence:int(f,F.presenceBits),snapshot:int(f,F.isSnapshot)===1,
  price:dbl(f,F.tradePrice),size:size(f,F.tradeSize64,F.tradeSize),aggressor:int(f,F.aggressor),ts:gwTs(f)};
 if(id===TEMPLATES.heartbeatResp)return {kind:'HEARTBEAT',accepted:okCodes(strings(f,F.rpCode))||!strings(f,F.rpCode).length};
 if(id===TEMPLATES.marketDataResp){const c=strings(f,F.rpCode);
  return {kind:'SUBSCRIPTION',accepted:okCodes(c),rpCode:safeCode(c[0])}}
 if(id===TEMPLATES.forcedLogout)return {kind:'FORCED_LOGOUT'};
 if(id===TEMPLATES.logoutResp){const c=strings(f,F.rpCode);return {kind:'LOGOUT',accepted:okCodes(c),rpCode:c.length?safeCode(c[0]):null}}
 if(id===TEMPLATES.loginResp)return {kind:'LOGIN'};
 return {kind:'OTHER',templateId:Number.isSafeInteger(id)?id:null};
}

// --- Step A measurement (no raw persistence; summary only) ---
const onTick=p=>Math.abs(p/ES_TICK-Math.round(p/ES_TICK))<1e-6;
export function createStepASummary({now=Date.now,sampleEveryMs=10000}={}){
 const s={startMs:null,endMs:null,bbo:0,bboSnapshots:0,trades:0,tradeSnapshots:0,
  lastTradeNonTradeUpdates:0,lastTradeUnknownPresence:0,tradeVolume:0,aggressor:{buy:0,sell:0,unknown:0},twoSided:0,
  spreadTicks:{one:0,two:0,threePlus:0,lockedOrCrossed:0},
  // Synchronized = both sides' latest values carry the SAME gateway timestamp (same event).
  syncedSpreadTicks:{one:0,two:0,threePlus:0,lockedOrCrossed:0},syncedObservations:0,
  oneSidedBboUpdates:0,bidTs:null,askTs:null,nonTickPrices:0,
  outOfRangePrices:0,minTrade:null,maxTrade:null,bid:null,ask:null,last:null,samples:[],nextSampleMs:null};
 const price=p=>{if(p===null)return;if(!onTick(p))s.nonTickPrices++;if(p<1000||p>20000)s.outOfRangePrices++};
 return {
  start(){s.startMs=now();s.nextSampleMs=s.startMs},
  observe(m){
   const t=now();
   if(m.kind==='BBO'){
    s.bbo++;if(m.snapshot)s.bboSnapshots++;
    if(m.clear&1){s.bid=null;s.bidTs=null}if(m.clear&2){s.ask=null;s.askTs=null}
    const hasBid=m.bid!=null&&(m.presence==null||(m.presence&1)!==0);
    const hasAsk=m.ask!=null&&(m.presence==null||(m.presence&2)!==0);
    if(hasBid){price(m.bid);s.bid=m.bid;s.bidTs=m.ts??null}
    if(hasAsk){price(m.ask);s.ask=m.ask;s.askTs=m.ts??null}
    if(hasBid!==hasAsk)s.oneSidedBboUpdates++;
    const bucket=(h,k)=>{if(k<=0)h.lockedOrCrossed++;else if(k===1)h.one++;else if(k===2)h.two++;else h.threePlus++};
    if(s.bid!==null&&s.ask!==null){s.twoSided++;const k=Math.round((s.ask-s.bid)/ES_TICK);
     bucket(s.spreadTicks,k);
     const synced=(hasBid&&hasAsk)||(s.bidTs!==null&&s.bidTs===s.askTs);
     if(synced){s.syncedObservations++;bucket(s.syncedSpreadTicks,k)}}
   }else if(m.kind==='TRADE'){
    // presence bit LAST_TRADE(1) marks an actual trade; other LastTrade messages carry
    // only volume / net change / VWAP updates and are not trades.
    // A LastTrade with NO presence bits has undocumented semantics: counted separately as unknown,
    // never as a trade.
    if(m.presence===null||m.presence===undefined){s.lastTradeUnknownPresence++;return}
    if((m.presence&1)===0){s.lastTradeNonTradeUpdates++;return}
    s.trades++;if(m.snapshot)s.tradeSnapshots++;
    if(m.price!==null){price(m.price);s.last=m.price;
     s.minTrade=s.minTrade===null?m.price:Math.min(s.minTrade,m.price);
     s.maxTrade=s.maxTrade===null?m.price:Math.max(s.maxTrade,m.price);}
    if(m.size!==null)s.tradeVolume+=m.size;
    if(m.aggressor===1)s.aggressor.buy++;else if(m.aggressor===2)s.aggressor.sell++;else s.aggressor.unknown++;
   }
   if(s.startMs!==null&&t>=s.nextSampleMs&&s.samples.length<13){
    s.samples.push({utc:new Date(t).toISOString().slice(0,19)+'Z',
     elapsedS:Math.round((t-s.startMs)/1000),bid:s.bid,ask:s.ask,last:s.last});
    s.nextSampleMs+=sampleEveryMs;}
  },
  finish(){s.endMs=now();const secs=Math.max(1,(s.endMs-s.startMs)/1000);
   const {nextSampleMs,bidTs,askTs,...out}=s;
   return {...out,observedMs:s.endMs-s.startMs,
    bboPerSec:Math.round(s.bbo/secs*100)/100,tradesPerSec:Math.round(s.trades/secs*100)/100,
    oneTickShare:s.twoSided?Math.round(s.spreadTicks.one/s.twoSided*1000)/1000:null,
    syncedOneTickShare:s.syncedObservations?Math.round(s.syncedSpreadTicks.one/s.syncedObservations*1000)/1000:null};}
 };
}
export function evaluateStepA(r){
 const m=r.market||{};
 const checks={
  discoveredPaperGateway:r.gatewaySource!==null,
  authenticated:r.authenticated===true,
  heartbeatAcked:r.heartbeat.acks>=1&&r.heartbeat.rejects===0,
  subscriptionAccepted:r.subscriptionAccepted===true,
  fullWindow:r.stopReason==='WINDOW_COMPLETE',
  bboRateOver1PerSec:(m.bboPerSec??0)>1,
  tradesPresent:(m.trades??0)>0,
  // Judged only on synchronized two-sided observations (>=30 needed); threshold unchanged.
  mostlyOneTickSpread:(m.syncedObservations??0)>=30&&(m.syncedOneTickShare??0)>=0.8,
  noLockedOrCrossed:(m.syncedSpreadTicks?.lockedOrCrossed??1)===0,
  pricesTickAligned:(m.nonTickPrices??1)===0&&(m.outOfRangePrices??1)===0,
 };
 const pass=Object.values(checks).every(Boolean);
 // Chart/Ironbeam 0-1 tick comparison is done externally from market.samples.
 return {checks,verdict:pass?'STEP_A_PASS_PENDING_CHART_MATCH':'STEP_A_FAIL',
  chartMatch:'PENDING_EXTERNAL_COMPARISON',bookValid:false,dboTested:false};
}

// --- transport ---
function guardedSend(ws,buf,sentLog){
 const id=decodeFields(buf)[F.templateId]?.[0];
 if(!SEND_ALLOWLIST.includes(id))throw Error('template not allowed by Paper Step A');
 sentLog.push(id);ws.send(buf);
}
function closeQuietly(ws){if(!ws)return;try{ws.removeAllListeners?.('message')}catch{}
 try{ws.close()}catch{}try{ws.terminate?.()}catch{}}
const socketOpts={rejectUnauthorized:true,perMessageDeflate:false,maxPayload:1024*1024};
// One request, first matching response, then close. Unauthenticated discovery only.
async function requestOnce({WebSocketImpl,url,request,expect,decode,timeoutMs,sent}){
 const ws=new WebSocketImpl(url,socketOpts);let timer;
 try{return await new Promise((resolve,reject)=>{
  let done=false;const finish=(e,v)=>{if(done)return;done=true;clearTimeout(timer);e?reject(e):resolve(v)};
  timer=setTimeout(()=>finish(Error('DISCOVERY_TIMEOUT')),timeoutMs);
  ws.on('error',()=>finish(Error('DISCOVERY_SOCKET_ERROR')));
  ws.on('close',()=>finish(Error('DISCOVERY_SOCKET_CLOSED')));
  ws.on('open',()=>{try{guardedSend(ws,request,sent)}catch{finish(Error('DISCOVERY_SEND_FAILED'))}});
  ws.on('message',data=>{let id;try{id=decodeFields(data)[F.templateId]?.[0]}catch{return finish(Error('DISCOVERY_FRAME_INVALID'))}
   if(id!==expect)return;try{finish(null,decode(data))}catch{finish(Error('DISCOVERY_RESPONSE_INVALID'))}});
 })}finally{clearTimeout(timer);closeQuietly(ws)}
}

// Discovery session on the Test gateway: Test login -> 20 -> logout. Short, no data.
async function discoverGatewaysWithLogin({WebSocketImpl,url,user,password,timeoutMs,sent,out}){
 const ws=new WebSocketImpl(url,socketOpts);let timer;
 try{return await new Promise((resolve,reject)=>{
  let done=false,loggedIn=false;
  const finish=(e,v)=>{if(done)return;done=true;clearTimeout(timer);
   if(loggedIn)try{guardedSend(ws,encodeLogout(),sent)}catch{}e?reject(e):resolve(v)};
  timer=setTimeout(()=>finish(Error(loggedIn?'GATEWAY_INFO_TIMEOUT':'DISCOVERY_LOGIN_TIMEOUT')),timeoutMs);
  ws.on('error',()=>finish(Error('DISCOVERY_SOCKET_ERROR')));
  ws.on('close',()=>finish(Error('DISCOVERY_SOCKET_CLOSED')));
  ws.on('open',()=>{try{guardedSend(ws,encodeTickerPlantLogin({user,password}),sent)}
   catch{finish(Error('DISCOVERY_SEND_FAILED'))}});
  ws.on('message',data=>{let id;try{id=decodeFields(data)[F.templateId]?.[0]}catch{return finish(Error('DISCOVERY_FRAME_INVALID'))}
   if(id===TEMPLATES.loginResp&&!loggedIn){let L;try{L=parseLogin(data)}catch{return finish(Error('DISCOVERY_LOGIN_INVALID'))}
    out.discoveryLoginRpCode=safeCode(L.rpCodes[0]);
    if(!(L.rpCodes.length===1&&L.rpCodes[0]==='0'))return finish(Error('DISCOVERY_LOGIN_REJECTED'));
    loggedIn=true;try{guardedSend(ws,encodeGatewayInfoRequest(),sent)}catch{finish(Error('DISCOVERY_SEND_FAILED'))}return}
   if(id===TEMPLATES.gatewayInfoResp){try{finish(null,parseGatewayInfo(data))}catch{finish(Error('GATEWAY_INFO_INVALID'))}}
  });
 })}finally{clearTimeout(timer);closeQuietly(ws)}
}

// Steps 1-3: discover and validate the Paper gateway. Mutates r.discovery / r.gateway*.
// Returns {ok:true,gateway} or {ok:false,reason}. Paper credentials are never used here.
export async function discoverPaperGateway({cfg,WebSocketImpl=WebSocket,discoveryGateway=DISCOVERY_GATEWAY,
 discoveryTimeoutMs=8000,sent,r,status=()=>{}}){
 if(cfg.discoveryUri)discoveryGateway=cfg.discoveryUri;
 const fail=reason=>({ok:false,reason});
 // 1) Unauthenticated system list on the known vendor gateway.
 let sys;
 try{sys=await requestOnce({WebSocketImpl,url:discoveryGateway,request:encodeSystemInfoRequest(),
  expect:TEMPLATES.systemInfoResp,decode:parseSystemInfo,timeoutMs:discoveryTimeoutMs,sent})}
 catch(e){return fail('SYSTEM_INFO_'+e.message)}
 r.discovery.paperListedOnDiscoveryGateway=sys.systems.includes(PAPER_SYSTEM_NAME);
 r.discovery.mode=cfg.unauthDiscovery?'UNAUTHENTICATED_MULTI_SYSTEM_HOST':'TEST_LOGIN_ON_KIT_GATEWAY';
 r.discovery.host=new URL(discoveryGateway).hostname;
 let gi;
 if(cfg.unauthDiscovery){
  // 2a) Multi-system host must itself list Paper; ask 20 with no credentials.
  if(!r.discovery.paperListedOnDiscoveryGateway)return fail('PAPER_SYSTEM_NOT_LISTED');
  try{gi=await requestOnce({WebSocketImpl,url:discoveryGateway,request:encodeGatewayInfoRequest(),
   expect:TEMPLATES.gatewayInfoResp,decode:parseGatewayInfo,timeoutMs:discoveryTimeoutMs,sent})}
  catch(e){return fail('GATEWAY_INFO_'+e.message)}
 }else{
  // 2b) Kit gateway: a Test gateway may list just its own system; 21 is the authority.
  if(!sys.systems.includes('Rithmic Test'))return fail('DISCOVERY_TEST_SYSTEM_NOT_LISTED');
  status('DISCOVERY_LOGIN');
  try{gi=await discoverGatewaysWithLogin({WebSocketImpl,url:discoveryGateway,user:cfg.discoveryUser,
   password:cfg.discoveryPassword,timeoutMs:Math.max(discoveryTimeoutMs,10000),sent,out:r.discovery})}
  catch(e){return fail(e.message)}
 }
 r.discovery.gatewayInfoRpCode=gi.rpCode;
 if(!gi.accepted)return fail('GATEWAY_INFO_REJECTED');
 if(gi.systemName!==null&&gi.systemName!==PAPER_SYSTEM_NAME)return fail('GATEWAY_INFO_SYSTEM_MISMATCH');
 const sel=selectGateway({gateways:gi.gateways,preferredName:cfg.gatewayName,pinnedUri:cfg.pinnedUri});
 r.discovery.gatewayNames=sel.names;r.discovery.rejectedGatewayNames=sel.rejected;
 if(!sel.ok)return fail(sel.reason);
 r.gatewaySource=sel.source;r.gatewayName=sel.gateway.name;r.gatewayHost=new URL(sel.gateway.uri).hostname;

 // 3) Confirm the selected gateway itself lists the Paper system.
 try{sys=await requestOnce({WebSocketImpl,url:sel.gateway.uri,request:encodeSystemInfoRequest(),
  expect:TEMPLATES.systemInfoResp,decode:parseSystemInfo,timeoutMs:discoveryTimeoutMs,sent})}
 catch(e){r.gatewaySource=null;return fail('SELECTED_SYSTEM_INFO_'+e.message)}
 r.discovery.paperListedOnSelectedGateway=sys.systems.includes(PAPER_SYSTEM_NAME);
 if(!r.discovery.paperListedOnSelectedGateway){r.gatewaySource=null;return fail('PAPER_NOT_LISTED_ON_SELECTED_GATEWAY')}

 return {ok:true,gateway:sel.gateway};
}

// --- Step A orchestration ---
export async function runPaperStepA({env=process.env,WebSocketImpl=WebSocket,
 durationMs=MAX_STEP_A_MS,discoveryGateway=DISCOVERY_GATEWAY,now=Date.now,
 discoveryTimeoutMs=8000,loginTimeoutMs=15000,onStatus=()=>{}}={}){
 const cfg=verifyPaperEnvironment(env); // throws before ANY network activity
 if(!Number.isSafeInteger(durationMs)||durationMs<1000||durationMs>MAX_STEP_A_MS)
  throw Error('invalid bounded Step A window');
 const sent=[];
 const r={schema:'engine18.rithmicPaperStepA.v2',measurementVersion:'SYNCHRONIZED_SPREAD_PRESENCE_BIT_TRADES_V2',comparableOnlyWithSameMeasurementVersion:true,readOnly:true,trading:false,recording:false,
  system:PAPER_SYSTEM_NAME,symbol:cfg.symbol,exchange:cfg.exchange,phase:'DISCOVERY',
  discovery:{paperListedOnDiscoveryGateway:false,discoveryLoginRpCode:null,gatewayInfoRpCode:null,gatewayNames:[],
   rejectedGatewayNames:[],paperListedOnSelectedGateway:false},
  gatewaySource:null,gatewayName:null,gatewayHost:null,authenticated:false,loginRpCode:null,
  heartbeatSec:null,heartbeat:{sent:0,acks:0,rejects:0},subscriptionAccepted:false,
  subscriptionRpCode:null,forcedLogout:false,logoutAcked:false,otherTemplates:{},
  invalidFrames:0,stopReason:null,sentTemplates:sent,market:null};
 const stop=reason=>{r.stopReason=reason;r.phase='STOPPED';onStatus({phase:r.phase,stopReason:reason});
  return {...r,...evaluateStepA(r)}};
 const status=p=>{r.phase=p;onStatus({phase:p})};

 const disc=await discoverPaperGateway({cfg,WebSocketImpl,discoveryGateway,discoveryTimeoutMs,sent,r,status});
 if(!disc.ok)return stop(disc.reason);
 const sel={gateway:disc.gateway};

 // 4) One session socket: login, heartbeat, subscribe, bounded window, unsubscribe, logout.
 status('AUTHENTICATING');
 const summary=createStepASummary({now});
 let ws,hbTimer,loginTimer,windowTimer,logoutTimer,hardTimer;
 const result=await new Promise(resolve=>{
  let finished=false,closing=false,started=false;
  const finish=reason=>{if(finished)return;finished=true;
   for(const t of [loginTimer,windowTimer,logoutTimer,hardTimer])clearTimeout(t);clearInterval(hbTimer);
   if(r.market===null&&started)r.market=summary.finish();
   closeQuietly(ws);resolve(reason)};
  const send=buf=>{try{guardedSend(ws,buf,sent);return true}catch{finish('SEND_FAILED');return false}};
  const beat=()=>{if(send(encodeConformanceHeartbeat()))r.heartbeat.sent++};
  const beginClose=reason=>{if(closing)return;closing=true;clearInterval(hbTimer);
   if(started)r.market=summary.finish();r.stopReason=reason;
   send(encodeMarketDataRequest({symbol:cfg.symbol,exchange:cfg.exchange,subscribe:false}));
   send(encodeLogout());
   logoutTimer=setTimeout(()=>finish(reason),2000)};
  hardTimer=setTimeout(()=>finish('HARD_DEADLINE'),loginTimeoutMs+durationMs+10000);
  loginTimer=setTimeout(()=>finish('LOGIN_TIMEOUT'),loginTimeoutMs);
  try{ws=new WebSocketImpl(sel.gateway.uri,socketOpts)}catch{return finish('SESSION_SOCKET_FAILED')}
  ws.on('error',()=>finish(closing?r.stopReason:'SESSION_SOCKET_ERROR'));
  ws.on('close',()=>finish(closing?r.stopReason:'SESSION_SOCKET_CLOSED'));
  ws.on('open',()=>{send(encodePaperLogin(cfg))});
  ws.on('message',data=>{
   let m;try{m=parseInbound(data)}catch{r.invalidFrames++;return}
   if(m.kind==='LOGIN'){
    if(r.authenticated)return finish('DUPLICATE_LOGIN_RESPONSE');
    let L;try{L=parsePaperLogin(data)}catch{return finish('LOGIN_INVALID')}
    r.loginRpCode=L.rpCode;clearTimeout(loginTimer);
    if(!L.accepted)return finish('LOGIN_REJECTED');
    r.authenticated=true;r.heartbeatSec=L.heartbeatSec;status('STREAMING');
    beat(); // vendor expects a heartbeat right after login
    const every=Math.max(1000,Math.min(30000,Math.floor((L.heartbeatSec||10)*1000*0.65)));
    hbTimer=setInterval(beat,every);
    if(send(encodeMarketDataRequest({symbol:cfg.symbol,exchange:cfg.exchange,subscribe:true}))){
     summary.start();started=true;windowTimer=setTimeout(()=>beginClose('WINDOW_COMPLETE'),durationMs);}
    return;
   }
   if(!r.authenticated)return; // ignore pre-login noise
   if(m.kind==='HEARTBEAT'){if(m.accepted)r.heartbeat.acks++;else{r.heartbeat.rejects++;beginClose('HEARTBEAT_REJECTED')}return}
   if(m.kind==='SUBSCRIPTION'){if(closing)return;r.subscriptionRpCode=m.rpCode;
    if(m.accepted)r.subscriptionAccepted=true;else beginClose('SUBSCRIPTION_REJECTED');return}
   if(m.kind==='FORCED_LOGOUT'){r.forcedLogout=true;if(!closing){if(started)r.market=summary.finish();r.stopReason='FORCED_LOGOUT';closing=true}return finish('FORCED_LOGOUT')}
   if(m.kind==='LOGOUT'){r.logoutAcked=true;if(closing)return finish(r.stopReason);return}
   if(m.kind==='BBO'||m.kind==='TRADE'){if(!closing)summary.observe(m);return}
   const k=String(m.templateId);r.otherTemplates[k]=(r.otherTemplates[k]||0)+1;
  });
 });
 return stop(result);
}

// CLI: node engine18RithmicPaperProbe.js — requires RITHMIC_PAPER_CONNECT_ENABLED=YES.
if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
 runPaperStepA().then(x=>{process.stdout.write('RITHMIC_PAPER_STEP_A_RESULT '+JSON.stringify(x)+'\n')},
  e=>{const disabled=/disabled/.test(e?.message||'');
   process.stderr.write(disabled?'RITHMIC_PAPER_CONNECT_DISABLED\n':'RITHMIC_PAPER_STEP_A_FAILED (sanitized)\n');
   process.exitCode=disabled?0:1});
}
