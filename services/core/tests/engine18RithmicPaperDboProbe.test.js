// Offline Step B tests: a scripted fake gateway keeps a TRUE book and streams real-shaped frames.
import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {runPaperDboStepB,verifyStepBEnvironment,STEP_B_SEND_ALLOWLIST} from '../logic/engine18/engine18RithmicPaperDboProbe.js';
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

// True exchange book: id -> {side,price,size}
function exchange({dropOne=false}={}){
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
 const snapshot=()=>{const lv=new Map();for(const [id,o] of book){const k=o.side+':'+o.price;
   if(!lv.has(k))lv.set(k,{side:o.side,price:o.price,orders:[]});lv.get(k).orders.push({id,...o})}
  const parts=[...lv.values()].map(l=>Buffer.concat([T(116),S(132764,'0'),V(112002,seq),V(153612,l.side),
   D(154405,l.price),...l.orders.map(o=>V(159009,o.size)),...l.orders.map(()=>V(153613,1)),...l.orders.map(o=>S(149238,o.id))]));
  parts.push(Buffer.concat([T(116),ok,V(112002,seq)]));return parts};
 const top=()=>{let bid=-Infinity,ask=Infinity;for(const o of book.values()){if(o.side===1)bid=Math.max(bid,o.price);else ask=Math.min(ask,o.price)}
  return Buffer.concat([T(151),V(149138,3),D(100022,bid),V(159000,1),D(100025,ask),V(159002,1)])};
 return {step,snapshot,top};
}
function fake({dropOne=false,dboRp='0'}={}){
 const log={sends:[]};const ex=exchange({dropOne});
 class W extends EventEmitter{constructor(url){super();this.url=url;this.timers=[];queueMicrotask(()=>this.emit('open'))}
  r(b){queueMicrotask(()=>{if(!this.closed)this.emit('message',b)})}
  send(buf){const id=Number(decodeExact(buf).get(154467)[0]);log.sends.push({url:this.url,id});
   if(this.url===DE){if(id===16)this.r(Buffer.concat([T(17),ok,S(153628,PAPER)]));
    if(id===20)this.r(Buffer.concat([T(21),ok,S(153628,PAPER),S(153640,'Chicago Area'),S(153641,'paper-chi.rithmic.com:443')]));return}
   if(id===16)return this.r(Buffer.concat([T(17),ok,S(153628,PAPER)]));
   if(id===10){const hb=Buffer.alloc(8);hb.writeDoubleLE(60,0);return this.r(Buffer.concat([T(11),ok,vb(153633n*8n+1n),hb]))}
   if(id===18)return this.r(Buffer.concat([T(19),ok]));
   if(id===100&&!this.md){this.md=true;return this.r(Buffer.concat([T(101),ok]))}
   if(id===117&&!this.sub){this.sub=true;this.r(Buffer.concat([T(118),S(132766,dboRp)]));
    if(dboRp!=='0')return;
    this.timers.push(setInterval(()=>{const f=ex.step();if(f)this.r(f);if(Math.random()<0.3)this.r(ex.top())},5));return}
   if(id===115){for(const p of ex.snapshot())this.r(p);return}
   if(id===12){this.timers.forEach(clearInterval);return this.r(Buffer.concat([T(13),ok]))}}
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
 assert.equal(r.strictBook.state,'VALID');assert.equal(r.verdict,'STEP_B_BOOK_VERIFIED');
 assert.equal(r.dboEntitlement,'OBSERVED');assert.equal(r.bboEntitlement,'OBSERVED');
 assert.ok(r.bboCrossCheck.compared>0);assert.equal(r.bboCrossCheck.mismatch,0);
 assert.ok(r.coverage.bid.rows.length===4&&r.coverage.ask.rows.length===4);
 assert.ok(log.sends.every(s=>STEP_B_SEND_ALLOWLIST.includes(s.id)));
 const ids=log.sends.filter(s=>s.url===GW).map(s=>s.id);
 assert.ok(ids.indexOf(117)<ids.indexOf(115),'subscribe before snapshot');
 assert.deepEqual(ids.slice(-3),[117,100,12]); // unsubscribe DBO, unsubscribe BBO, logout
 assert.ok(!JSON.stringify(r).includes('pp-secret'));
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
