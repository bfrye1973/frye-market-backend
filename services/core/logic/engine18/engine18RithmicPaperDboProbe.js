// Engine 18D Step B — bounded, read-only Rithmic Paper DBO (full-depth) verification probe.
// Requires BOTH RITHMIC_PAPER_CONNECT_ENABLED=YES and RITHMIC_PAPER_DBO_ENABLED=YES.
// Sends only: 16/20 (discovery), 10 login, 18 heartbeat, 100 BBO|LastTrade, 117 DBO updates,
// 115 DBO snapshot, 12 logout. No order plant, no recording, no persistence; summary output only.
//
// Output separates a DIAGNOSTIC RECEIPT (what was observed) from a VERIFIED-BOOK claim, which
// is made only when every integrity check passes (see evaluateStepB).
import WebSocket from 'ws';
import {discoverPaperGateway,verifyPaperEnvironment,encodePaperLogin,parsePaperLogin,
 encodeMarketDataRequest,encodeLogout,parseInbound,createStepASummary,TEMPLATES,
 PAPER_SYSTEM_NAME} from './engine18RithmicPaperProbe.js';
import {encodeConformanceHeartbeat} from './engine18RithmicConformanceTest.js';
import {createDboBook,encodeDboSnapshotRequest,encodeDboUpdatesRequest,parseSnapshotPart,
 parseUpdate,parseEndEvent,parseUpdatesAck,templateOf,decodeExact} from './engine18RithmicDboBook.js';
import {decodeFields} from './engine18RithmicTestProbe.js';
import {createRefreshBook,createSyncModeSelector,parseExchangeTime,roundKeyLevels} from './engine18RithmicRefreshBook.js';

export const STEP_B_SEND_ALLOWLIST=Object.freeze([10,12,16,18,20,100,115,117]);
export const MAX_STEP_B_MS=300000;
const socketOpts={rejectUnauthorized:true,perMessageDeflate:false,maxPayload:4*1024*1024};
const STRUCTURAL=['misaligned','offTick','badPrice','badSize','badSide','badOrderId','missingSequence',
 'outOfOrder','wrongInstrument','missingInstrument','newExisting','changeMissing','deleteMissing'];
export const CONTINUITY_BASIS='MEASURED: zero sequence gaps + every re-snapshot matched + snapshot-boundary semantics measured; '+
 'vendor batch/sequence semantics are NOT vendor-proven (a message lost inside a shared-sequence batch is not detectable)';

// Sanitized wire-layout diagnostics: per DBO template, how many frames carried each field TAG NUMBER
// (counts only: no values, no raw bytes), plus where sequence_number (112002) appeared.
const LAYOUT_TEMPLATES=new Set([116,118,160,161]);
export function createLayoutRecorder(){
 const t={},seq={snapshotParts:0,snapshotPartsWithSeq:0,snapshotDataPartsWithSeq:0,snapshotFinalParts:0,snapshotFinalPartsWithSeq:0,
  updates:0,updatesWithSeq:0,endEvents:0,endEventsWithSeq:0};
 return {
  observe(id,frame,{final=false,dataBearing=null}={}){if(!LAYOUT_TEMPLATES.has(id))return;
   const m=decodeExact(frame);const e=t[id]??={frames:0,tagFrames:{}};e.frames++;
   for(const k of m.keys())e.tagFrames[k]=(e.tagFrames[k]||0)+1;
   const has=m.has(112002);
   if(id===116){seq.snapshotParts++;if(has)seq.snapshotPartsWithSeq++;if(has&&dataBearing)seq.snapshotDataPartsWithSeq++;
    if(final){seq.snapshotFinalParts++;if(has)seq.snapshotFinalPartsWithSeq++}}
   if(id===160){seq.updates++;if(has)seq.updatesWithSeq++}
   if(id===161){seq.endEvents++;if(has)seq.endEventsWithSeq++}},
  result(){return {note:'field tag numbers and counts only; no values',templates:t,sequenceField112002:seq}},
 };
}
export function verifyStepBEnvironment(env){
 const cfg=verifyPaperEnvironment(env);
 if(env.RITHMIC_PAPER_DBO_ENABLED!=='YES')throw Error('Rithmic Paper DBO probe disabled');
 return {...cfg,keyLevels:parseKeyLevels(env.RITHMIC_PAPER_KEY_LEVELS)};
}
// Owner key levels for Plan B readings, e.g. "7000,7211" (prices only; max 32; ES tick-aligned).
export function parseKeyLevels(text){
 if(text==null||text==='')return [];
 const out=[];for(const raw of String(text).split(',').slice(0,32)){const v=Number(raw.trim());
  if(!Number.isFinite(v)||v<1000||v>20000||Math.abs(v/0.25-Math.round(v/0.25))>1e-9)throw Error('invalid key level');
  out.push({name:'KEY_'+v,price:v})}return out;
}
export function evaluateStepB(r){
 const o=r.observeBook||{},s=r.strictBook||{},os=o.stats||{},ss=s.stats||{};
 const ov=os.verifications||[],sv=ss.verifications||[],hb=r.heartbeat||{},c=r.coverage;
 const anomaliesZero=st=>STRUCTURAL.every(k=>(st.anomalies?.[k]??1)===0);
 const resolved=x=>x==='LAST_INCLUDED'||x==='NEXT_EXPECTED';
 // Acceptance (fail-closed). Diagnostic observations are reported separately below and never
 // substitute for any of these checks.
 const checks={
  authenticated:r.authenticated===true,
  heartbeatClean:(hb.acks??0)>=1&&hb.rejects===0&&(hb.sent??0)-(hb.acks??0)<=1,
  dboSubscriptionAcceptedAndCorrelated:r.dboSubscriptionAccepted===true&&r.dboAckCorrelation!=='UNCORRELATED',
  seeded:(os.snapshotsCompleted??0)>=1,
  updatesReceived:(os.updates??0)>0,
  cleanFrames:r.invalidFrames===0,
  finalObserveBookValid:o.state==='VALID',
  atLeastTwoCompletedVerifications:ov.filter(v=>v.completed).length>=2,
  noIncompleteVerification:ov.every(v=>v.completed)&&!r.verificationPendingAtClose,
  allVerificationsMatch:ov.length>0&&ov.every(v=>v.match),
  // AMBIGUOUS / NO_EQUAL_SEQUENCE_UPDATES alone never pass: boundary semantics must be measured.
  snapshotSemanticsMeasured:resolved(os.semanticsResolved)&&(os.semanticsConflicts??1)===0&&
   resolved(ss.semanticsResolved)&&ss.semanticsResolved===os.semanticsResolved,
  noStructuralAnomalies:anomaliesZero(os),
  noCrossedOrLockedBook:(os.crossedStates??1)===0&&(ss.crossedStates??1)===0&&o.crossedOrLocked===false,
  // Continuity: zero gaps in the update stream AND the fail-closed STRICT shadow survived with its own
  // periodic comparisons all matching. Snapshot equality alone is not treated as continuity proof.
  continuity:(os.gaps??1)===0&&(ss.gaps??1)===0&&s.state==='VALID'&&(ss.failures?.length??1)===0&&
   sv.length>0&&sv.every(v=>v.match),
  freshTwoSidedCoverage:!!c&&c.suppressed===false&&!!c.bid&&!!c.ask,
  fullWindow:r.stopReason==='WINDOW_COMPLETE',
  cleanLogout:r.logoutAcked===true&&r.logoutRpCode==='0',
  cleanShutdown:r.shutdown?.socketErrorDuringClose===false&&r.shutdown?.closedBeforeLogoutAck===false,
 };
 const verified=Object.values(checks).every(Boolean);
 const failedChecks=Object.entries(checks).filter(([,ok])=>!ok).map(([k])=>k);
 // Boundary unknown (unsequenced snapshots) but the evidence reconciles: label it, never VERIFIED.
 const uv=ov.filter(v=>v.unsequenced);
 const empiricallyReconciled=!verified&&(os.unsequencedSnapshots??0)>0&&!(o.candidateLimited)&&
  checks.authenticated&&checks.heartbeatClean&&checks.dboSubscriptionAcceptedAndCorrelated&&checks.seeded&&
  checks.updatesReceived&&checks.cleanFrames&&checks.noStructuralAnomalies&&checks.noCrossedOrLockedBook&&
  checks.noIncompleteVerification&&checks.fullWindow&&checks.cleanLogout&&checks.cleanShutdown&&
  (os.gaps??1)===0&&uv.length>=1&&ov.every(v=>v.match)&&o.state==='UNVERIFIED';
 const verdict=verified?'STEP_B_BOOK_VERIFIED':empiricallyReconciled?'EMPIRICALLY_RECONCILED_UNVERIFIED':'STEP_B_FAIL';
 return {checks,failedChecks,verdict,
  acceptance:{verdict,failedChecks,continuityBasis:CONTINUITY_BASIS,
   boundary:(os.unsequencedSnapshots??0)>0?'UNKNOWN_UNSEQUENCED_SNAPSHOT':'MEASURED_OR_NOT_REACHED'},
  verifiedBook:verified?{coverage:c,orders:o.orders,lastSeq:o.lastSeq,snapshotSemantics:os.semanticsResolved}:null,
  diagnosticReceipt:{observedSemantics:os.semantics??null,semanticsResolved:os.semanticsResolved??null,
   verifications:ov.length,gaps:os.gaps??null,equalSeq:os.equalSeq??null,endEvents:os.endEvents??null,
   crossedStates:os.crossedStates??null,unsequencedSnapshots:os.unsequencedSnapshots??null,
   unsequencedSeeds:os.unsequencedSeeds??null,unsequencedVerifications:os.unsequencedVerifications??null,
   candidateRejectedForDefects:os.candidateRejectedForDefects??null,dboFrames:r.dboFrames??null,
   wireLayout:r.wireLayout??null,diagnosticCoverage:r.diagnosticCoverage??null,heartbeat:hb,logoutRpCode:r.logoutRpCode??null,shutdown:r.shutdown??null,
   coverageSuppressedReason:r.coverageSuppressedReason??null,note:'diagnostic only; not an acceptance claim'},
  // Distinct entitlements: BBO (Step A) vs DBO (this step).
  bboEntitlement:r.market?.bbo>0?'OBSERVED':'NOT_OBSERVED',
  // Entitlement = DBO data actually received (snapshot parts or updates), independent of book validity.
  dboEntitlement:r.dboSubscriptionAccepted&&((r.dboFrames?.snapshotParts??r.snapshotParts??0)>0||(r.dboFrames?.updates??0)>0)?'OBSERVED':'NOT_OBSERVED'};
}

export async function runPaperDboStepB({env=process.env,WebSocketImpl=WebSocket,durationMs=180000,
 verifyEveryMs=45000,verifyGraceMs=10000,now=Date.now,loginTimeoutMs=15000,discoveryTimeoutMs=8000,onStatus=()=>{}}={}){
 const cfg=verifyStepBEnvironment(env); // throws before any network activity
 if(!Number.isSafeInteger(durationMs)||durationMs<1000||durationMs>MAX_STEP_B_MS)throw Error('invalid bounded Step B window');
 if(!Number.isSafeInteger(verifyEveryMs)||verifyEveryMs<200||verifyEveryMs>durationMs)throw Error('invalid verification interval');
 const sent=[];
 const r={schema:'engine18.rithmicPaperDboStepB.v3',readOnly:true,trading:false,recording:false,
  system:PAPER_SYSTEM_NAME,symbol:cfg.symbol,exchange:cfg.exchange,phase:'DISCOVERY',
  discovery:{},gatewaySource:null,gatewayName:null,gatewayHost:null,authenticated:false,
  loginRpCode:null,heartbeat:{sent:0,acks:0,rejects:0},bboSubscriptionAccepted:false,
  dboSubscriptionAccepted:false,dboSubscriptionRpCode:null,dboAckCorrelation:null,uncorrelatedAcks:0,
  snapshotRequests:0,seedMs:null,snapshotParts:0,verificationPendingAtClose:false,
  forcedLogout:false,logoutAcked:false,logoutRpCode:null,shutdown:{socketErrorDuringClose:false,closedBeforeLogoutAck:false},
  invalidFrames:0,otherTemplates:{},dboFrames:{snapshotParts:0,updates:0,endEvents:0},wireLayout:null,diagnosticCoverage:null,
  bboCrossCheck:{compared:0,match:0,mismatch:0,samples:[],note:'diagnostic only; CME BBO may include implied prices'},
  stopReason:null,sentTemplates:sent,market:null,observeBook:null,strictBook:null,coverageAtSeed:null,coverage:null,coverageSuppressedReason:null,
  planB:null};
 const status=p=>{r.phase=p;onStatus({phase:p})};
 const done=reason=>{r.stopReason=reason;r.phase='STOPPED';onStatus({phase:'STOPPED',stopReason:reason});
  return {...r,...evaluateStepB(r)}};

 const disc=await discoverPaperGateway({cfg,WebSocketImpl,discoveryTimeoutMs,sent,r,status});
 if(!disc.ok)return done(disc.reason);

 status('AUTHENTICATING');
 // Rithmic Paper has returned snapshots without sequence_number: seed only by the conservative
 // boundary search (never VALID; acceptance still requires measured semantics).
 const bookOpts={symbol:cfg.symbol,exchange:cfg.exchange,now,unsequencedSnapshots:'BOUNDARY_SEARCH'};
 const layout=createLayoutRecorder();
 const observe=createDboBook({...bookOpts,mode:'OBSERVE'}),strict=createDboBook({...bookOpts,mode:'STRICT'});
 const books=[observe,strict];
 // Plan B (owner decision Nov 26): unsequenced periodic-refresh book, fed the same frames and the
 // same snapshot requests (no extra requests). Never VERIFIED; see engine18RithmicRefreshBook.js.
 const minRefreshMs=Math.min(15000,verifyEveryMs);
 const planB=createRefreshBook({symbol:cfg.symbol,exchange:cfg.exchange,now,minRefreshMs,refreshEveryMs:Math.max(minRefreshMs,verifyEveryMs)});
 const syncSel=createSyncModeSelector();
 const summary=createStepASummary({now});
 let ws,hb,loginT,windowT,logoutT,hardT,verifyT,graceT,t115=null,snapSeq=0,snapInFlight=null,started=false;
 const reason=await new Promise(resolve=>{
  let finished=false,closing=false,windowOver=false;
  const snap=()=>{for(const b of books)b.checkCrossed();
   r.observeBook={state:observe.state,reason:observe.reason,orders:observe.orderCount,
   lastSeq:observe.lastSeq,crossedOrLocked:observe.crossedOrLocked,candidateLimited:observe.candidateLimited,stats:observe.stats()};
   r.strictBook={state:strict.state,reason:strict.reason,orders:strict.orderCount,crossedOrLocked:strict.crossedOrLocked,stats:strict.stats()}};
  // Coverage is captured once, at window end (before unsubscribe/logout), and only if publishable.
  const capturePlanB=()=>{const t=observe.top(),mid=t.bid!=null&&t.ask!=null?(t.bid+t.ask)/2:null;
   r.planB={syncModeDecision:syncSel.decide(),liquidity:planB.liquidity({keyLevels:[...roundKeyLevels(mid),...(cfg.keyLevels||[])]}),stats:planB.stats()}};
  const captureCoverage=()=>{capturePlanB();const c=observe.coverage();r.coverage=c.suppressed?null:c;r.coverageSuppressedReason=c.suppressed?c.reason:null;
   r.diagnosticCoverage=observe.coverage(undefined,{diagnostic:true});r.wireLayout=layout.result()};
  const finish=why=>{if(finished)return;finished=true;
   for(const t of [loginT,windowT,logoutT,hardT,graceT])clearTimeout(t);clearInterval(hb);clearInterval(verifyT);
   if(started&&r.market===null)r.market=summary.finish();
   if(snapInFlight)r.verificationPendingAtClose=true;
   if(!closing){snap();captureCoverage()}
   try{ws?.removeAllListeners?.('message');ws?.close();ws?.terminate?.()}catch{}resolve(why)};
  const send=buf=>{const id=decodeFields(buf)[154467]?.[0];
   if(!STEP_B_SEND_ALLOWLIST.includes(id)){finish('TEMPLATE_NOT_ALLOWED');return false}
   try{ws.send(buf);sent.push(id);return true}catch{finish('SEND_FAILED');return false}};
  const sym={symbol:cfg.symbol,exchange:cfg.exchange};
  const closeOut=why=>{if(closing)return;closing=true;clearInterval(hb);clearInterval(verifyT);clearTimeout(graceT);
   r.stopReason=why;if(started)r.market=summary.finish();
   if(snapInFlight)r.verificationPendingAtClose=true;
   snap();captureCoverage();
   send(encodeDboUpdatesRequest({...sym,subscribe:false,requestId:'dbo-unsub'}));
   send(encodeMarketDataRequest({...sym,subscribe:false}));send(encodeLogout());
   logoutT=setTimeout(()=>finish(why),2000)};
  // Window end: let an in-flight verification finish (bounded grace) so the last comparison completes.
  const endWindow=()=>{windowOver=true;clearInterval(verifyT);
   if(!snapInFlight)return closeOut('WINDOW_COMPLETE');
   graceT=setTimeout(()=>closeOut('WINDOW_COMPLETE'),verifyGraceMs)};
  const requestVerification=()=>{if(closing||windowOver||snapInFlight)return;
   const id='snap-'+(++snapSeq);let any=false;
   for(const b of books)if(b.beginVerification(id))any=true;
   if(planB.beginRefresh(id))any=true;
   if(any){snapInFlight=id;r.snapshotRequests++;send(encodeDboSnapshotRequest({...sym,requestId:id}))}};
  hardT=setTimeout(()=>finish('HARD_DEADLINE'),loginTimeoutMs+durationMs+verifyGraceMs+30000);
  loginT=setTimeout(()=>finish('LOGIN_TIMEOUT'),loginTimeoutMs);
  try{ws=new WebSocketImpl(disc.gateway.uri,socketOpts)}catch{return finish('SESSION_SOCKET_FAILED')}
  // Shutdown evidence is reported separately: a socket error/close while closing keeps the stop
  // reason but fails the cleanShutdown / cleanLogout checks.
  ws.on('error',()=>{if(closing)r.shutdown.socketErrorDuringClose=true;finish(closing?r.stopReason:'SESSION_SOCKET_ERROR')});
  ws.on('close',()=>{if(closing&&!r.logoutAcked)r.shutdown.closedBeforeLogoutAck=true;finish(closing?r.stopReason:'SESSION_SOCKET_CLOSED')});
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
     const seedId='snap-'+(++snapSeq);
     for(const b of books)b.beginSnapshot(seedId); // buffer BEFORE subscribing
     planB.beginRefresh(seedId);
     snapInFlight=seedId;
     send(encodeDboUpdatesRequest({...sym,subscribe:true,requestId:'dbo-sub'}));
     t115=now();r.snapshotRequests++;send(encodeDboSnapshotRequest({...sym,requestId:seedId}));
     windowT=setTimeout(endWindow,durationMs);
     verifyT=setInterval(requestVerification,verifyEveryMs);
     return}
    if(!r.authenticated)return;
    if(id===116){const p=parseSnapshotPart(data);r.snapshotParts++;r.dboFrames.snapshotParts++;
     layout.observe(116,data,{final:p.final,dataBearing:p.dataBearing});
     const seeding=observe.state==='SEEDING';
     for(const b of books)b.onSnapshotPart(p);
     planB.onSnapshotPart(p);syncSel.observeSnapshotPart(p);
     if(p.final&&(p.userMsg==null||p.userMsg===snapInFlight)){
      snapInFlight=null;
      if(seeding){r.seedMs=now()-t115;if(observe.state==='VALID'||observe.state==='UNVERIFIED'){status('STREAMING');
       const c=observe.coverage();r.coverageAtSeed=c.suppressed?null:c}}
      if(windowOver&&!closing)closeOut('WINDOW_COMPLETE')}
     return}
    if(id===118){const a=parseUpdatesAck(data);layout.observe(118,data);
     if(a.userMsg==='dbo-unsub')return;
     if(a.userMsg!=null&&a.userMsg!=='dbo-sub'){r.uncorrelatedAcks++;return}
     if(r.dboAckCorrelation)return; // only the first matching ack counts
     r.dboAckCorrelation=a.userMsg==='dbo-sub'?'ECHOED':'UNECHOED_SINGLE_OUTSTANDING';
     r.dboSubscriptionRpCode=a.rpCode;
     if(a.accepted)r.dboSubscriptionAccepted=true;else closeOut('DBO_SUBSCRIPTION_REJECTED');return}
    if(id===160){const u=parseUpdate(data);r.dboFrames.updates++;layout.observe(160,data);syncSel.observeUpdate(u);
     if(!closing){for(const b of books)b.onUpdate(u);let et=null;try{et=parseExchangeTime(data)}catch{}planB.onUpdate(u,{exchangeTime:et})}return}
    if(id===161){const e=parseEndEvent(data);r.dboFrames.endEvents++;layout.observe(161,data);for(const b of books)b.onEndEvent(e);return}
    const m=parseInbound(data);
    if(m.kind==='HEARTBEAT'){if(m.accepted)r.heartbeat.acks++;else{r.heartbeat.rejects++;closeOut('HEARTBEAT_REJECTED')}return}
    if(m.kind==='SUBSCRIPTION'){if(!closing){if(m.accepted)r.bboSubscriptionAccepted=true;else closeOut('BBO_SUBSCRIPTION_REJECTED')}return}
    if(m.kind==='FORCED_LOGOUT'){r.forcedLogout=true;if(!closing){closing=true;r.stopReason='FORCED_LOGOUT'}return finish('FORCED_LOGOUT')}
    if(m.kind==='LOGOUT'){r.logoutAcked=true;r.logoutRpCode=m.rpCode??null;if(closing)finish(r.stopReason);return}
    if(m.kind==='BBO'||m.kind==='TRADE'){if(closing)return;summary.observe(m);
     if(m.kind==='BBO'&&m.bid!=null&&m.ask!=null&&(m.presence==null||(m.presence&3)===3)&&
      (observe.state==='VALID'||observe.state==='UNVERIFIED')&&!observe.snapshotPending){
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
