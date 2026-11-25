// Engine 18D Step B — bounded, read-only Rithmic Paper DBO (full-depth) verification probe.
// Requires BOTH RITHMIC_PAPER_CONNECT_ENABLED=YES and RITHMIC_PAPER_DBO_ENABLED=YES.
// Sends only: 16/20 (discovery), 10 login, 18 heartbeat, 100 BBO|LastTrade, 117 DBO updates,
// 115 DBO snapshot, 12 logout. No order plant, no recording, no persistence; summary output only.
import WebSocket from 'ws';
import {discoverPaperGateway,verifyPaperEnvironment,encodePaperLogin,parsePaperLogin,
 encodeMarketDataRequest,encodeLogout,parseInbound,createStepASummary,TEMPLATES,
 PAPER_SYSTEM_NAME} from './engine18RithmicPaperProbe.js';
import {encodeConformanceHeartbeat} from './engine18RithmicConformanceTest.js';
import {createDboBook,encodeDboSnapshotRequest,encodeDboUpdatesRequest,parseSnapshotPart,
 parseUpdate,parseEndEvent,parseUpdatesAck,templateOf} from './engine18RithmicDboBook.js';
import {decodeFields} from './engine18RithmicTestProbe.js';

export const STEP_B_SEND_ALLOWLIST=Object.freeze([10,12,16,18,20,100,115,117]);
export const MAX_STEP_B_MS=300000;
const socketOpts={rejectUnauthorized:true,perMessageDeflate:false,maxPayload:4*1024*1024};

export function verifyStepBEnvironment(env){
 const cfg=verifyPaperEnvironment(env);
 if(env.RITHMIC_PAPER_DBO_ENABLED!=='YES')throw Error('Rithmic Paper DBO probe disabled');
 return cfg;
}
export function evaluateStepB(r){
 const o=r.observeBook||{},a=o.stats?.anomalies||{},v=o.stats?.verifications||[];
 const checks={
  authenticated:r.authenticated===true,
  dboSubscriptionAccepted:r.dboSubscriptionAccepted===true,
  snapshotCompleted:(o.stats?.snapshotsCompleted??0)>=1,
  updatesReceived:(o.stats?.updates??0)>0,
  atLeastTwoVerifications:v.length>=2,
  allVerificationsMatch:v.length>0&&v.every(x=>x.match),
  noStructuralAnomalies:(a.misaligned??1)===0&&(a.offTick??1)===0&&(a.badSide??1)===0&&(a.badSize??1)===0,
  fullWindow:r.stopReason==='WINDOW_COMPLETE',
 };
 return {checks,verdict:Object.values(checks).every(Boolean)?'STEP_B_BOOK_VERIFIED':'STEP_B_FAIL',
  // Distinct entitlements: BBO (Step A) vs DBO (this step).
  bboEntitlement:r.market?.bbo>0?'OBSERVED':'NOT_OBSERVED',
  dboEntitlement:r.dboSubscriptionAccepted&&(o.stats?.snapshotsCompleted??0)>0?'OBSERVED':'NOT_OBSERVED',
  strictBookSurvived:r.strictBook?.state==='VALID'};
}

export async function runPaperDboStepB({env=process.env,WebSocketImpl=WebSocket,durationMs=180000,
 verifyEveryMs=45000,now=Date.now,loginTimeoutMs=15000,discoveryTimeoutMs=8000,onStatus=()=>{}}={}){
 const cfg=verifyStepBEnvironment(env); // throws before any network activity
 if(!Number.isSafeInteger(durationMs)||durationMs<1000||durationMs>MAX_STEP_B_MS)throw Error('invalid bounded Step B window');
 if(!Number.isSafeInteger(verifyEveryMs)||verifyEveryMs<200||verifyEveryMs>durationMs)throw Error('invalid verification interval');
 const sent=[];
 const r={schema:'engine18.rithmicPaperDboStepB.v1',readOnly:true,trading:false,recording:false,
  system:PAPER_SYSTEM_NAME,symbol:cfg.symbol,exchange:cfg.exchange,phase:'DISCOVERY',
  discovery:{},gatewaySource:null,gatewayName:null,gatewayHost:null,authenticated:false,
  loginRpCode:null,heartbeat:{sent:0,acks:0,rejects:0},bboSubscriptionAccepted:false,
  dboSubscriptionAccepted:false,dboSubscriptionRpCode:null,snapshotRequests:0,seedMs:null,
  snapshotParts:0,forcedLogout:false,logoutAcked:false,invalidFrames:0,otherTemplates:{},
  bboCrossCheck:{compared:0,match:0,mismatch:0,samples:[]},stopReason:null,sentTemplates:sent,
  market:null,observeBook:null,strictBook:null,coverageAtSeed:null,coverage:null};
 const status=p=>{r.phase=p;onStatus({phase:p})};
 const done=reason=>{r.stopReason=reason;r.phase='STOPPED';onStatus({phase:'STOPPED',stopReason:reason});
  return {...r,...evaluateStepB(r)}};

 const disc=await discoverPaperGateway({cfg,WebSocketImpl,discoveryTimeoutMs,sent,r,status});
 if(!disc.ok)return done(disc.reason);

 status('AUTHENTICATING');
 const observe=createDboBook({mode:'OBSERVE'}),strict=createDboBook({mode:'STRICT'});
 const summary=createStepASummary({now});
 let ws,hb,loginT,windowT,logoutT,hardT,verifyT,t115=null,verifyInFlight=false,started=false;
 const reason=await new Promise(resolve=>{
  let finished=false,closing=false;
  const snap=()=>{r.observeBook={state:observe.state,reason:observe.reason,orders:observe.orderCount,
   lastSeq:observe.lastSeq,stats:observe.stats()};
   r.strictBook={state:strict.state,reason:strict.reason,orders:strict.orderCount,stats:strict.stats()}};
  const finish=why=>{if(finished)return;finished=true;
   for(const t of [loginT,windowT,logoutT,hardT])clearTimeout(t);clearInterval(hb);clearInterval(verifyT);
   if(started&&r.market===null)r.market=summary.finish();
   snap();if(observe.state==='VALID')r.coverage=observe.coverage();
   try{ws?.removeAllListeners?.('message');ws?.close();ws?.terminate?.()}catch{}resolve(why)};
  const send=buf=>{const id=decodeFields(buf)[154467]?.[0];
   if(!STEP_B_SEND_ALLOWLIST.includes(id)){finish('TEMPLATE_NOT_ALLOWED');return false}
   try{ws.send(buf);sent.push(id);return true}catch{finish('SEND_FAILED');return false}};
  const sym={symbol:cfg.symbol,exchange:cfg.exchange};
  const closeOut=why=>{if(closing)return;closing=true;clearInterval(hb);clearInterval(verifyT);
   r.stopReason=why;if(started)r.market=summary.finish();
   snap();if(observe.state==='VALID')r.coverage=observe.coverage();
   send(encodeDboUpdatesRequest({...sym,subscribe:false}));
   send(encodeMarketDataRequest({...sym,subscribe:false}));send(encodeLogout());
   logoutT=setTimeout(()=>finish(why),2000)};
  const requestVerification=()=>{if(closing||verifyInFlight)return;
   if(observe.beginVerification()){verifyInFlight=true;r.snapshotRequests++;send(encodeDboSnapshotRequest(sym))}};
  hardT=setTimeout(()=>finish('HARD_DEADLINE'),loginTimeoutMs+durationMs+30000);
  loginT=setTimeout(()=>finish('LOGIN_TIMEOUT'),loginTimeoutMs);
  try{ws=new WebSocketImpl(disc.gateway.uri,socketOpts)}catch{return finish('SESSION_SOCKET_FAILED')}
  ws.on('error',()=>finish(closing?r.stopReason:'SESSION_SOCKET_ERROR'));
  ws.on('close',()=>finish(closing?r.stopReason:'SESSION_SOCKET_CLOSED'));
  ws.on('open',()=>send(encodePaperLogin(cfg)));
  ws.on('message',data=>{
   let id;try{id=templateOf(data)}catch{r.invalidFrames++;return}
   try{
    if(id===TEMPLATES.loginResp){if(r.authenticated)return finish('DUPLICATE_LOGIN_RESPONSE');
     const L=parsePaperLogin(data);r.loginRpCode=L.rpCode;clearTimeout(loginT);
     if(!L.accepted)return finish('LOGIN_REJECTED');
     r.authenticated=true;status('SEEDING');
     if(send(encodeConformanceHeartbeat()))r.heartbeat.sent++;
     hb=setInterval(()=>{if(send(encodeConformanceHeartbeat()))r.heartbeat.sent++},
      Math.max(1000,Math.min(30000,Math.floor((L.heartbeatSec||10)*650))));
     send(encodeMarketDataRequest({...sym,subscribe:true}));summary.start();started=true;
     observe.beginSnapshot();strict.beginSnapshot(); // buffer BEFORE subscribing
     send(encodeDboUpdatesRequest({...sym,subscribe:true}));
     t115=now();r.snapshotRequests++;send(encodeDboSnapshotRequest(sym));
     windowT=setTimeout(()=>closeOut('WINDOW_COMPLETE'),durationMs);
     verifyT=setInterval(requestVerification,verifyEveryMs);
     return}
    if(!r.authenticated)return;
    if(id===116){const p=parseSnapshotPart(data);r.snapshotParts++;
     if(verifyInFlight){observe.onSnapshotPart(p);if(p.final){verifyInFlight=false;
       if(observe.state==='VALID')r.coverage=observe.coverage()}}
     else{const wasSeeding=observe.state==='SEEDING';observe.onSnapshotPart(p);strict.onSnapshotPart(p);
      if(p.final&&wasSeeding){r.seedMs=now()-t115;if(observe.state==='VALID'){status('STREAMING');
       r.coverageAtSeed=observe.coverage()}}}
     return}
    if(id===118){const a=parseUpdatesAck(data);r.dboSubscriptionRpCode=a.rpCode;
     if(a.accepted)r.dboSubscriptionAccepted=true;else closeOut('DBO_SUBSCRIPTION_REJECTED');return}
    if(id===160){const u=parseUpdate(data);if(!closing){observe.onUpdate(u);strict.onUpdate(u)}return}
    if(id===161){const e=parseEndEvent(data);observe.onEndEvent(e);strict.onEndEvent(e);return}
    const m=parseInbound(data);
    if(m.kind==='HEARTBEAT'){if(m.accepted)r.heartbeat.acks++;else{r.heartbeat.rejects++;closeOut('HEARTBEAT_REJECTED')}return}
    if(m.kind==='SUBSCRIPTION'){if(!closing){if(m.accepted)r.bboSubscriptionAccepted=true;else closeOut('BBO_SUBSCRIPTION_REJECTED')}return}
    if(m.kind==='FORCED_LOGOUT'){r.forcedLogout=true;if(!closing){closing=true;r.stopReason='FORCED_LOGOUT'}return finish('FORCED_LOGOUT')}
    if(m.kind==='LOGOUT'){r.logoutAcked=true;if(closing)finish(r.stopReason);return}
    if(m.kind==='BBO'||m.kind==='TRADE'){if(closing)return;summary.observe(m);
     // Book top vs BBO, only on messages carrying both sides (same event), book VALID, not verifying.
     if(m.kind==='BBO'&&m.bid!=null&&m.ask!=null&&(m.presence==null||(m.presence&3)===3)&&
      observe.state==='VALID'&&!observe.verifying){
      const t=observe.top();r.bboCrossCheck.compared++;
      if(t.bid===m.bid&&t.ask===m.ask)r.bboCrossCheck.match++;
      else{r.bboCrossCheck.mismatch++;if(r.bboCrossCheck.samples.length<8)
       r.bboCrossCheck.samples.push({bbo:[m.bid,m.ask],book:[t.bid,t.ask]})}}
     return}
    const k=String(id);r.otherTemplates[k]=(r.otherTemplates[k]||0)+1;
   }catch{r.invalidFrames++}
  });
 });
 return done(reason);
}

if(process.argv[1]&&import.meta.url===new URL('file://'+process.argv[1]).href){
 runPaperDboStepB().then(x=>process.stdout.write('RITHMIC_PAPER_DBO_RESULT '+JSON.stringify(x)+'\n'),
  e=>{const off=/disabled/.test(e?.message||'');
   process.stderr.write(off?'RITHMIC_PAPER_DBO_DISABLED\n':'RITHMIC_PAPER_DBO_FAILED (sanitized)\n');process.exitCode=off?0:1});
}
