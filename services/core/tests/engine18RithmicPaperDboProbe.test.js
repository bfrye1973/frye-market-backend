// Offline Step B tests: a scripted fake gateway keeps a TRUE book and streams real-shaped frames.
import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {runPaperDboStepB,verifyStepBEnvironment,evaluateStepB,STEP_B_SEND_ALLOWLIST} from '../logic/engine18/engine18RithmicPaperDboProbe.js';
import {decodeExact} from '../logic/engine18/engine18RithmicDboBook.js';

const vb=n=>{n=BigInt(n);const b=[];do{let k=Number(n&127n);n>>=7n;if(n)k|=128;b.push(k)}while(n);return Buffer.from(b)};
const V=(f,x)=>Buffer.concat([vb(BigInt(f)*8n),vb(x)]);
const S=(f,x)=>{const b=Buffer.from(x);return Buffer.concat([vb(BigInt(f)*8n+2n),vb(b.length),b])};
const D=(f,x)=>{const b=Buffer.alloc(8);b.writeDoubleLE(x,0);return Buffer.concat([vb(BigInt(f)*8n+1n),b])};
const T=id=>V(154467,id);
const PAPER='Rithmic Paper Trading',DE='wss://rprotocol-de.rithmic.com:443',GW='wss://paper-chi.rithmic.com:443';
const ENV={RITHMIC_PAPER_CONNECT_ENABLED:'YES',RITHMIC_PAPER_DBO_ENABLED:'YES',RITHMIC_PAPER_USER:'pu',
 RITHMIC_PAPER_PASSWORD:'pp-secret',RITHMIC_PAPER_DISCOVERY_URI:'rprotocol-de.rithmic.com:443',
 RITHMIC_PAPER_GATEWAY_NAME:'Chicago Area'};
const ok=S(132766,'0');
let PASSING=null; // a fully passing result, mutated below per Engine 18D counterexample

// True exchange book: id -> {side,price,size}
function exchange({dropOne=false,noSnapshotSeq=false}={}){
 const book=new Map();let seq=1000,n=0;
 for(let i=0;i<20;i++){book.set('b'+i,{side:1,price:7000-i*0.25*4,size:1+i});book.set('a'+i,{side:2,price:7000.25+i*0.25*4,size:2+i})}
 const step=()=>{seq++;n++;const ids=[...book.keys()];const pick=ids[n%ids.length];const o=book.get(pick);
  let e;
  if(n%3===0){book.delete(pick);e={type:3,id:pick,...o}}
  else if(n%3===1){const id='n'+n;const no={side:o.side,price:o.price,size:3};book.set(id,no);e={type:1,id,...no}}
  else{o.size+=1;e={type:2,id:pick,...o}}
  if(dropOne&&n===4)return null; // simulate a lost NEW (gap); 'n4' is never touched again
  return Buffer.concat([T(160),S(110100,'ESZ6'),S(110101,'CME'),V(112002,seq),V(110121,e.type),
   V(153612,e.side),D(154405,e.price),V(159009,e.size),V(153613,seq),S(149238,e.id)])};
 const snapshot=(um)=>{const lv=new Map();for(const [id,o] of book){const k=o.side+':'+o.price;
   if(!lv.has(k))lv.set(k,{side:o.side,price:o.price,orders:[]});lv.get(k).orders.push({id,...o})}
  const echo=um?[S(132760,um)]:[];
  const sq=noSnapshotSeq?[]:[V(112002,seq)];
  const parts=[...lv.values()].map(l=>Buffer.concat([T(116),...echo,S(132764,'0'),S(110100,'ESZ6'),S(110101,'CME'),...sq,V(153612,l.side),
   D(154405,l.price),...l.orders.map(o=>V(159009,o.size)),...l.orders.map(()=>V(153613,1)),...l.orders.map(o=>S(149238,o.id))]));
  parts.push(Buffer.concat([T(116),...echo,ok,...sq]));return parts};
 const top=()=>{let bid=-Infinity,ask=Infinity;for(const o of book.values()){if(o.side===1)bid=Math.max(bid,o.price);else ask=Math.min(ask,o.price)}
  return Buffer.concat([T(151),V(149138,3),D(100022,bid),V(159000,1),D(100025,ask),V(159002,1)])};
 return {step,snapshot,top};
}
function fake({noSnapshotSeq=false,dropOne=false,dboRp='0',garbage=false,stallVerify=false,wrongSymbolAt=null,straySubAck=false,race=true,errorOnLogout=false}={}){
 const log={sends:[]};const ex=exchange({dropOne,noSnapshotSeq});
 class W extends EventEmitter{constructor(url){super();this.url=url;this.timers=[];queueMicrotask(()=>this.emit('open'))}
  r(b){queueMicrotask(()=>{if(!this.closed)this.emit('message',b)})}
  send(buf){const m=decodeExact(buf);const id=Number(m.get(154467)[0]);const um=m.get(132760)?.[0]?.toString();log.sends.push({url:this.url,id});
   if(this.url===DE){if(id===16)this.r(Buffer.concat([T(17),ok,S(153628,PAPER)]));
    if(id===20)this.r(Buffer.concat([T(21),ok,S(153628,PAPER),S(153640,'Chicago Area'),S(153641,'paper-chi.rithmic.com:443')]));return}
   if(id===16)return this.r(Buffer.concat([T(17),ok,S(153628,PAPER)]));
   if(id===10){const hb=Buffer.alloc(8);hb.writeDoubleLE(60,0);return this.r(Buffer.concat([T(11),ok,vb(153633n*8n+1n),hb]))}
   if(id===18)return this.r(Buffer.concat([T(19),ok]));
   if(id===100&&!this.md){this.md=true;return this.r(Buffer.concat([T(101),ok]))}
   if(id===117&&!this.sub){this.sub=true;
    if(straySubAck)this.r(Buffer.concat([T(118),S(132760,'someone-else'),S(132766,'9')]));
    this.r(Buffer.concat([T(118),...(um?[S(132760,um)]:[]),S(132766,dboRp)]));
    if(dboRp!=='0')return;let k=0;
    this.timers.push(setInterval(()=>{const f=ex.step();if(f)this.r(f);k++;
     if(garbage&&k===20)this.r(Buffer.from([0xff,0xff,0xff]));
     if(wrongSymbolAt&&k===wrongSymbolAt)this.r(Buffer.concat([T(160),S(110100,'ESH7'),S(110101,'CME'),V(112002,1),V(110121,1),V(153612,1),D(154405,7000),V(159009,1),S(149238,'x')]));
     if(Math.random()<0.3)this.r(ex.top())},5));return}
   if(id===115){this.snaps=(this.snaps||0)+1;if(stallVerify&&this.snaps>1)return;
    // race: one update is in flight when the snapshot is taken; the snapshot already contains it
    // (LAST_INCLUDED). Its sequence EQUALS the snapshot sequence, so the semantics get measured.
    if(race&&this.sub){const f=ex.step();if(f)this.r(f)}
    for(const p of ex.snapshot(um))this.r(p);return}
   if(id===12){this.timers.forEach(clearInterval);if(errorOnLogout)return queueMicrotask(()=>this.emit('error',new Error('x')));return this.r(Buffer.concat([T(13),ok]))}}
  close(){this.closed=true;this.timers.forEach(clearInterval)}terminate(){this.close()}}
 return {W,log};
}

test('Step B needs its own DBO flag in addition to the Paper flag',()=>{
 assert.throws(()=>verifyStepBEnvironment({...ENV,RITHMIC_PAPER_DBO_ENABLED:'NO'}),/DBO probe disabled/);
 assert.ok(verifyStepBEnvironment(ENV));
});

test('end-to-end: seed, live updates, repeated re-snapshot verifications all match; BBO cross-check',async()=>{
 const {W,log}=fake();
 const r=await runPaperDboStepB({env:ENV,WebSocketImpl:W,durationMs:1600,verifyEveryMs:400});
 assert.equal(r.stopReason,'WINDOW_COMPLETE');assert.equal(r.authenticated,true);
 assert.equal(r.dboSubscriptionAccepted,true);
 const v=r.observeBook.stats.verifications;
 assert.ok(v.length>=2,'verifications '+v.length);assert.ok(v.every(x=>x.match),JSON.stringify(v));
 assert.equal(r.observeBook.stats.anomalies.misaligned,0);
 assert.equal(r.strictBook.state,'VALID');assert.equal(r.verdict,'STEP_B_BOOK_VERIFIED',JSON.stringify(r.failedChecks));assert.ok(r.verifiedBook);assert.equal(r.dboAckCorrelation,'ECHOED');
 assert.equal(r.dboEntitlement,'OBSERVED');assert.equal(r.bboEntitlement,'OBSERVED');
 assert.ok(r.bboCrossCheck.compared>0);assert.equal(r.bboCrossCheck.mismatch,0);
 assert.ok(r.coverage.bid.rows.length===4&&r.coverage.ask.rows.length===4);
 assert.ok(log.sends.every(s=>STEP_B_SEND_ALLOWLIST.includes(s.id)));
 const ids=log.sends.filter(s=>s.url===GW).map(s=>s.id);
 assert.ok(ids.indexOf(117)<ids.indexOf(115),'subscribe before snapshot');
 assert.deepEqual(ids.slice(-3),[117,100,12]); // unsubscribe DBO, unsubscribe BBO, logout
 assert.ok(!JSON.stringify(r).includes('pp-secret'));
 assert.equal(r.observeBook.stats.semanticsResolved,'LAST_INCLUDED');assert.equal(r.checks.snapshotSemanticsMeasured,true);
 assert.equal(r.checks.heartbeatClean,true);assert.equal(r.checks.cleanLogout,true);assert.equal(r.checks.cleanShutdown,true);
 assert.equal(r.checks.freshTwoSidedCoverage,true);assert.equal(r.acceptance.verdict,'STEP_B_BOOK_VERIFIED');
 assert.equal(r.diagnosticReceipt.note,'diagnostic only; not an acceptance claim');
 PASSING=r;
});

test('a lost update is caught: STRICT book invalid on gap, OBSERVE verification shows the mismatch',async()=>{
 const {W}=fake({dropOne:true});
 const r=await runPaperDboStepB({env:ENV,WebSocketImpl:W,durationMs:1200,verifyEveryMs:400});
 assert.equal(r.strictBook.state,'INVALID');assert.equal(r.strictBook.reason,'SEQUENCE_GAP');
 assert.ok(r.observeBook.stats.gaps>=1);
 assert.ok(r.observeBook.stats.verifications.some(x=>!x.match),'first verification after the lost message must mismatch');
 assert.equal(r.verdict,'STEP_B_FAIL');
});

test('DBO subscription rejected -> closes cleanly, dboEntitlement NOT_OBSERVED',async()=>{
 const {W}=fake({dboRp:'5'});
 const r=await runPaperDboStepB({env:ENV,WebSocketImpl:W,durationMs:1500,verifyEveryMs:500});
 assert.equal(r.stopReason,'DBO_SUBSCRIPTION_REJECTED');assert.equal(r.dboSubscriptionRpCode,'5');
 assert.equal(r.dboEntitlement,'NOT_OBSERVED');
});

test('BLOCKER 1: garbage frame -> cleanFrames false -> FAIL even if the book matches',async()=>{
 const {W}=fake({garbage:true});
 const r=await runPaperDboStepB({env:ENV,WebSocketImpl:W,durationMs:1200,verifyEveryMs:300});
 assert.ok(r.invalidFrames>=1);assert.equal(r.checks.cleanFrames,false);assert.equal(r.verdict,'STEP_B_FAIL');
 assert.equal(r.verifiedBook,null);
});

test('BLOCKER 1/2: wrong-instrument update -> STRICT invalid, continuity false, FAIL',async()=>{
 const {W}=fake({wrongSymbolAt:30});
 const r=await runPaperDboStepB({env:ENV,WebSocketImpl:W,durationMs:1200,verifyEveryMs:300});
 assert.equal(r.strictBook.state,'INVALID');assert.equal(r.checks.continuity,false);
 assert.equal(r.checks.noStructuralAnomalies,false);assert.equal(r.verdict,'STEP_B_FAIL');
});

test('BLOCKER 1: verification still pending at deadline -> grace, then FAIL (never silently passes)',async()=>{
 const {W}=fake({stallVerify:true});
 const r=await runPaperDboStepB({env:ENV,WebSocketImpl:W,durationMs:1000,verifyEveryMs:300,verifyGraceMs:300});
 assert.equal(r.verificationPendingAtClose,true);assert.equal(r.checks.noIncompleteVerification,false);
 assert.equal(r.verdict,'STEP_B_FAIL');
});

test('BLOCKER 2: a stray ACK for another request is ignored; the correlated ACK decides',async()=>{
 const {W}=fake({straySubAck:true});
 const r=await runPaperDboStepB({env:ENV,WebSocketImpl:W,durationMs:1200,verifyEveryMs:300});
 assert.equal(r.uncorrelatedAcks,1);assert.equal(r.dboAckCorrelation,'ECHOED');assert.equal(r.dboSubscriptionAccepted,true);
});

test('BLOCKER 3: the STRICT shadow gets its own periodic comparisons',async()=>{
 const {W}=fake();
 const r=await runPaperDboStepB({env:ENV,WebSocketImpl:W,durationMs:1300,verifyEveryMs:300});
 assert.ok(r.strictBook.stats.verifications.length>=2);assert.ok(r.strictBook.stats.verifications.every(v=>v.match));
 assert.equal(r.strictBook.stats.failures.length,0);
});

// ---------- Engine 18D Nov 26 re-audit: verdict counterexamples (each passed on 03a945fe0) ----------
const mutate=f=>{assert.ok(PASSING,'end-to-end test must run first');const r=structuredClone(PASSING);f(r);return evaluateStepB(r)};
test('18D#1: no coverage / stale coverage -> FAIL',()=>{
 assert.equal(evaluateStepB(structuredClone(PASSING)).verdict,'STEP_B_BOOK_VERIFIED','baseline');
 const a=mutate(r=>{r.coverage=null});assert.equal(a.verdict,'STEP_B_FAIL');assert.ok(a.failedChecks.includes('freshTwoSidedCoverage'));
 const b=mutate(r=>{r.coverage={suppressed:true,reason:'STALE'}});assert.equal(b.verdict,'STEP_B_FAIL');
 const c=mutate(r=>{r.coverage.ask=null});assert.equal(c.verdict,'STEP_B_FAIL');assert.equal(c.verifiedBook,null);
});
test('18D#1: heartbeats never acknowledged -> FAIL',()=>{
 const a=mutate(r=>{r.heartbeat={sent:4,acks:0,rejects:0}});assert.equal(a.verdict,'STEP_B_FAIL');assert.ok(a.failedChecks.includes('heartbeatClean'));
 const b=mutate(r=>{r.heartbeat={sent:6,acks:2,rejects:0}});assert.equal(b.verdict,'STEP_B_FAIL');
});
test('18D#1: no logout ack / rejected logout / socket error while closing -> FAIL',()=>{
 assert.equal(mutate(r=>{r.logoutAcked=false}).verdict,'STEP_B_FAIL');
 assert.ok(mutate(r=>{r.logoutRpCode='7'}).failedChecks.includes('cleanLogout'));
 assert.ok(mutate(r=>{r.shutdown.socketErrorDuringClose=true}).failedChecks.includes('cleanShutdown'));
});
test('18D#1: socket error during close keeps WINDOW_COMPLETE but fails cleanShutdown (end-to-end)',async()=>{
 const {W}=fake({errorOnLogout:true});
 const r=await runPaperDboStepB({env:ENV,WebSocketImpl:W,durationMs:1300,verifyEveryMs:300});
 assert.equal(r.stopReason,'WINDOW_COMPLETE');assert.equal(r.shutdown.socketErrorDuringClose,true);
 assert.equal(r.checks.cleanShutdown,false);assert.equal(r.checks.cleanLogout,false);assert.equal(r.verdict,'STEP_B_FAIL');
});
test('18D#3: AMBIGUOUS / NO_EQUAL_SEQUENCE_UPDATES only -> semantics not measured -> FAIL',()=>{
 const a=mutate(r=>{for(const b of [r.observeBook,r.strictBook])b.stats.semanticsResolved=null});
 assert.equal(a.verdict,'STEP_B_FAIL');assert.ok(a.failedChecks.includes('snapshotSemanticsMeasured'));
 const {W}=fake({race:false}); // no update ever equals a snapshot sequence
 return runPaperDboStepB({env:ENV,WebSocketImpl:W,durationMs:1300,verifyEveryMs:300}).then(r=>{
  assert.ok(r.observeBook.stats.verifications.every(v=>v.match));assert.equal(r.observeBook.state,'UNVERIFIED');
  assert.equal(r.checks.snapshotSemanticsMeasured,false);assert.equal(r.coverage,null);
  assert.equal(r.coverageSuppressedReason,'BOOK_UNVERIFIED');assert.equal(r.verdict,'STEP_B_FAIL');});
});
test('18D#3: a sequence gap with every snapshot matching -> FAIL (equality is not continuity)',()=>{
 const a=mutate(r=>{r.observeBook.stats.gaps=1});assert.equal(a.verdict,'STEP_B_FAIL');assert.ok(a.failedChecks.includes('continuity'));
});
test('18D#2: crossed/locked book or data frames without instrument -> FAIL',()=>{
 assert.ok(mutate(r=>{r.observeBook.stats.crossedStates=1}).failedChecks.includes('noCrossedOrLockedBook'));
 assert.ok(mutate(r=>{r.observeBook.crossedOrLocked=true}).failedChecks.includes('noCrossedOrLockedBook'));
 assert.ok(mutate(r=>{r.observeBook.stats.anomalies.missingInstrument=1}).failedChecks.includes('noStructuralAnomalies'));
});

test('live Nov 26 shape: snapshot WITHOUT sequence -> no longer dead at seed; still never verified; layout + entitlement reported',async()=>{
 const {W}=fake({noSnapshotSeq:true});
 const r=await runPaperDboStepB({env:ENV,WebSocketImpl:W,durationMs:1600,verifyEveryMs:400});
 assert.equal(r.stopReason,'WINDOW_COMPLETE');
 assert.notEqual(r.observeBook.state,'INVALID',JSON.stringify(r.observeBook.stats.failures));
 assert.equal(r.observeBook.reason,'SNAPSHOT_UNSEQUENCED');assert.equal(r.observeBook.stats.unsequencedSnapshots>=1,true);
 assert.ok(r.observeBook.stats.updates>0,'updates are applied, not ignored');
 const v=r.observeBook.stats.verifications;assert.ok(v.length>=2&&v.every(x=>x.unsequenced&&x.match),JSON.stringify(v));
 // acceptance is never granted without measured semantics: boundary unknown + reconciled evidence is LABELED, not verified
 assert.equal(r.verdict,'EMPIRICALLY_RECONCILED_UNVERIFIED');assert.equal(r.acceptance.boundary,'UNKNOWN_UNSEQUENCED_SNAPSHOT');assert.ok(r.failedChecks.includes('snapshotSemanticsMeasured'));
 assert.ok(r.failedChecks.includes('finalObserveBookValid'));assert.equal(r.verifiedBook,null);assert.equal(r.coverage,null);
 // entitlement reflects DBO data received, independent of validity
 assert.equal(r.dboEntitlement,'OBSERVED');assert.ok(r.dboFrames.updates>0&&r.dboFrames.snapshotParts>0);
 // sanitized wire layout: tag numbers + counts only
 const L=r.wireLayout;assert.equal(L.sequenceField112002.snapshotPartsWithSeq,0);assert.ok(L.sequenceField112002.updatesWithSeq>0);
 assert.equal(L.templates['116'].tagFrames['112002'],undefined);assert.ok(L.templates['160'].tagFrames['112002']>0);
 assert.ok(Object.values(L.templates).every(t=>Object.values(t.tagFrames).every(n=>Number.isInteger(n))));
 assert.ok(!JSON.stringify(L).includes('ESZ6'),'no values in the layout');
 // diagnostic coverage is labeled and lives only in the receipt
 const d=r.diagnosticReceipt.diagnosticCoverage;assert.equal(d.verified,false);assert.equal(d.label,'DIAGNOSTIC_NOT_VERIFIED');
 // Plan B (unsequenced periodic refresh) rides the same frames and snapshot requests
 const pb=r.planB;assert.equal(pb.syncModeDecision.mode,'UNSEQUENCED_REFRESH');
 assert.ok(pb.stats.refreshesCompleted>=1,JSON.stringify(pb.stats.history));assert.equal(pb.liquidity.verified,false);
 assert.ok(['EMPIRICALLY_RECONCILED_UNVERIFIED','DIAGNOSTIC_NOT_VERIFIED'].includes(pb.liquidity.label));
 assert.equal(pb.stats.exchangeTime.usedForPlacement,false);assert.ok(Array.isArray(pb.liquidity.keyLevels)||pb.liquidity.suppressed);
 assert.ok(r.snapshotRequests<=Math.ceil(1600/400)+1,'Plan B adds no extra snapshot requests');
});
test('dboEntitlement OBSERVED when DBO data arrives even if the book is invalid',()=>{
 assert.ok(PASSING);const r=structuredClone(PASSING);r.observeBook.state='INVALID';r.observeBook.stats.snapshotsCompleted=0;
 assert.equal(evaluateStepB(r).dboEntitlement,'OBSERVED');
 r.dboFrames={snapshotParts:0,updates:0,endEvents:0};r.snapshotParts=0;assert.equal(evaluateStepB(r).dboEntitlement,'NOT_OBSERVED');
});

test('EMPIRICALLY_RECONCILED_UNVERIFIED is never granted when the candidate search hit its limit, a gap occurred, or a resnapshot mismatched',async()=>{
 const {W}=fake({noSnapshotSeq:true});
 const r=await runPaperDboStepB({env:ENV,WebSocketImpl:W,durationMs:1600,verifyEveryMs:400});
 assert.equal(evaluateStepB(r).verdict,'EMPIRICALLY_RECONCILED_UNVERIFIED');
 const lim=structuredClone(r);lim.observeBook.candidateLimited=true;assert.equal(evaluateStepB(lim).verdict,'STEP_B_FAIL');
 const gap=structuredClone(r);gap.observeBook.stats.gaps=1;assert.equal(evaluateStepB(gap).verdict,'STEP_B_FAIL');
 const mis=structuredClone(r);mis.observeBook.stats.verifications.at(-1).match=false;assert.equal(evaluateStepB(mis).verdict,'STEP_B_FAIL');
 for(const x of [r,lim,gap,mis])assert.equal(evaluateStepB(x).verifiedBook,null);
});
