// Offline DBO reconstruction tests (no network), including adversarial cases from the
// Engine 18D PR #400 review.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createDboBook,parseSnapshotPart,parseUpdate,parseEndEvent,decodeExact,
 encodeDboSnapshotRequest,encodeDboUpdatesRequest,UPDATE,SIDE} from '../logic/engine18/engine18RithmicDboBook.js';

const vb=n=>{n=BigInt(n);const b=[];do{let k=Number(n&127n);n>>=7n;if(n)k|=128;b.push(k)}while(n);return Buffer.from(b)};
const V=(f,x)=>Buffer.concat([vb(BigInt(f)*8n),vb(x)]);
const S=(f,x)=>{const b=Buffer.from(x);return Buffer.concat([vb(BigInt(f)*8n+2n),vb(b.length),b])};
const D=(f,x)=>{const b=Buffer.alloc(8);b.writeDoubleLE(x,0);return Buffer.concat([vb(BigInt(f)*8n+1n),b])};
const T=id=>V(154467,id);
const part=({seq,side,price,orders=[],final=false,rp='0',size32=false,sym='ESZ6',exch='CME',um})=>Buffer.concat([T(116),
 ...(um?[S(132760,um)]:[]),final?S(132766,rp):S(132764,'0'),...(sym?[S(110100,sym)]:[]),...(exch?[S(110101,exch)]:[]),
 ...(seq===undefined?[]:[V(112002,seq)]),...(side?[V(153612,side)]:[]),...(price!==undefined?[D(154405,price)]:[]),
 ...orders.map(o=>V(size32?154406:159009,o.size)),...orders.map(o=>V(153613,o.pri??1)),...orders.map(o=>S(149238,o.id))]);
const upd=(seq,entries,{sym='ESZ6',exch='CME'}={})=>Buffer.concat([T(160),S(110100,sym),S(110101,exch),
 ...(seq===null?[]:[V(112002,seq)]),
 ...entries.map(e=>V(110121,e.type)),...entries.map(e=>V(153612,e.side)),
 ...entries.map(e=>D(154405,e.price)),...entries.map(e=>V(159009,e.size??0)),...entries.map(e=>S(149238,e.id))]);
const P=f=>parseSnapshotPart(f),U=f=>parseUpdate(f);
const mk=(o={})=>createDboBook({symbol:'ESZ6',exchange:'CME',...o});
const SEED_LEVELS=[[SIDE.BID,7000,[['b1',5],['b2',3]]],[SIDE.BID,6990,[['b3',20]]],
 [SIDE.ASK,7000.25,[['a1',4]]],[SIDE.ASK,7050.25,[['a2',50]]]];
const seedParts=(seq,um)=>[...SEED_LEVELS.map(([side,price,os])=>P(part({seq,side,price,um,orders:os.map(([id,size])=>({id,size}))}))),
 P(part({seq,final:true,um}))];
const seed=(book,seq=100)=>{book.beginSnapshot();for(const p of seedParts(seq))book.onSnapshotPart(p)};
const verifyWith=(book,seq,levels=SEED_LEVELS)=>{
 for(const [side,price,os] of levels)book.onSnapshotPart(P(part({seq,side,price,orders:os.map(([id,size])=>({id,size}))})));
 book.onSnapshotPart(P(part({seq,final:true})))};

test('requests: full-book 115/117 without depth_price, with echoed request id; ES/CME only',()=>{
 const s=decodeExact(encodeDboSnapshotRequest({symbol:'ESZ6',exchange:'CME',requestId:'snap-1'}));
 assert.equal(s.get(154467)[0],115n);assert.equal(s.get(154405),undefined);assert.equal(s.get(132760)[0].toString(),'snap-1');
 const u=decodeExact(encodeDboUpdatesRequest({symbol:'ESZ6',exchange:'CME',subscribe:false}));
 assert.equal(u.get(154467)[0],117n);assert.equal(u.get(100000)[0],2n);
 assert.throws(()=>encodeDboSnapshotRequest({symbol:'NQZ6',exchange:'CME'}));
});

test('decoder keeps u64 exact and accepts both size tags and packed arrays',()=>{
 const huge=18446744073709551615n;
 const p=P(part({seq:huge,side:SIDE.BID,price:7000,orders:[{id:'x',size:7,pri:huge}]}));
 assert.equal(p.seq,huge);assert.equal(p.priorities[0],huge);assert.equal(p.sizes[0],7n);
 assert.equal(P(part({seq:1,side:SIDE.ASK,price:7001,orders:[{id:'y',size:9}],size32:true})).sizes[0],9n);
 const pk=Buffer.concat([T(160),V(112002,6),Buffer.concat([vb(110121n*8n+2n),vb(2),Buffer.from([1,3])]),
  Buffer.concat([vb(153612n*8n+2n),vb(2),Buffer.from([1,2])]),D(154405,7000),D(154405,7001),
  V(159009,1),V(159009,2),S(149238,'a'),S(149238,'b')]);
 const u=parseUpdate(pk);assert.equal(u.aligned,true);assert.deepEqual(u.entries.map(e=>e.type),[1,3]);
});

test('multipart snapshot completes only on the final rp_code message',()=>{
 const b=mk();b.beginSnapshot();
 b.onSnapshotPart(P(part({seq:10,side:SIDE.BID,price:7000,orders:[{id:'b1',size:1}]})));
 assert.equal(b.state,'SEEDING');b.onSnapshotPart(P(part({seq:10,final:true})));
 assert.equal(b.state,'VALID');assert.equal(b.orderCount,1);assert.equal(b.lastSeq,'10');
 const r=mk();r.beginSnapshot();r.onSnapshotPart(P(part({seq:1,side:1,price:7000,orders:[{id:'q',size:1}]})));
 r.onSnapshotPart(P(part({final:true,rp:'7'})));assert.equal(r.state,'INVALID');assert.equal(r.reason,'SNAPSHOT_REJECTED_7');
});

test('BLOCKER 2: invalid snapshots are rejected, never seeded (both modes)',()=>{
 const cases=[
  ['SNAPSHOT_DUPLICATE_ORDER_ID',[part({seq:1,side:1,price:7000,orders:[{id:'d',size:1}]}),part({seq:1,side:1,price:6999,orders:[{id:'d',size:2}]})]],
  ['SNAPSHOT_BAD_SIZE',[part({seq:1,side:1,price:7000,orders:[{id:'z',size:0}]})]],
  ['SNAPSHOT_BADPRICE',[part({seq:1,side:1,price:0,orders:[{id:'z',size:1}]})]],
  ['SNAPSHOT_BADPRICE',[part({seq:1,side:1,price:NaN,orders:[{id:'z',size:1}]})]],
  ['SNAPSHOT_OFFTICK',[part({seq:1,side:1,price:7000.1,orders:[{id:'z',size:1}]})]],
  ['SNAPSHOT_BAD_SIDE',[part({seq:1,side:3,price:7000,orders:[{id:'z',size:1}]})]],
  ['SNAPSHOT_BAD_ORDER_ID',[part({seq:1,side:1,price:7000,orders:[{id:'',size:1}]})]],
  ['SNAPSHOT_EMPTY',[]],
  ['SNAPSHOT_NO_SEQUENCE',[part({side:1,price:7000,orders:[{id:'z',size:1}]})]],
  ['SNAPSHOT_SEQUENCE_INCONSISTENT',[part({seq:1,side:1,price:7000,orders:[{id:'a',size:1}]}),part({seq:2,side:2,price:7001,orders:[{id:'b',size:1}]})]],
  ['WRONG_INSTRUMENT',[part({seq:1,side:1,price:7000,sym:'ESH7',orders:[{id:'a',size:1}]})]],
 ];
 for(const mode of ['STRICT','OBSERVE'])for(const [why,parts] of cases){
  const b=mk({mode});b.beginSnapshot();for(const f of parts)b.onSnapshotPart(P(f));
  b.onSnapshotPart(P(part({seq:why==='SNAPSHOT_NO_SEQUENCE'?undefined:1,final:true})));
  assert.equal(b.state,'INVALID',mode+' '+why);assert.equal(b.reason,why,mode+' '+why);
 }
});

test('BLOCKER 2: INVALID is never overwritten; failure history survives an explicit reseed',()=>{
 const b=mk();seed(b);b.onUpdate(U(upd(105,[{type:UPDATE.NEW,side:1,price:6995,size:1,id:'z'}])));
 assert.equal(b.state,'INVALID');
 b.onSnapshotPart(P(part({seq:200,final:true})));
 b.onUpdate(U(upd(106,[{type:UPDATE.NEW,side:1,price:6994,size:1,id:'y'}])));
 assert.equal(b.state,'INVALID');assert.equal(b.stats().unsolicitedParts,1);assert.equal(b.stats().anomalies.ignoredInvalid,1);
 seed(b,300);assert.equal(b.state,'VALID');
 assert.ok(b.failures.some(f=>f.reason==='SEQUENCE_GAP'),'prior failure retained');
});

test('BLOCKER 2: instrument validated on every DBO frame; correlation by echoed request id',()=>{
 const b=mk();seed(b);
 b.onUpdate(U(upd(101,[{type:UPDATE.NEW,side:1,price:6995,size:1,id:'z'}],{sym:'ESH7'})));
 assert.equal(b.state,'INVALID');assert.equal(b.stats().anomalies.wrongInstrument,1);
 const c=mk();c.beginSnapshot('snap-1');
 c.onSnapshotPart(P(part({seq:5,side:1,price:7000,um:'snap-OTHER',orders:[{id:'x',size:1}]})));
 for(const p of seedParts(5,'snap-1'))c.onSnapshotPart(p);
 assert.equal(c.state,'VALID');assert.equal(c.orderCount,5);
 assert.equal(c.stats().mismatchedParts,1);assert.equal(c.stats().correlatedParts,5);
 const e=mk();seed(e);e.onEndEvent(parseEndEvent(Buffer.concat([T(161),S(110100,'ESH7'),V(112002,100)])));
 assert.equal(e.state,'INVALID');
});

test('buffered seed: overlap (<= snapshot seq) dropped, later ones replayed through checks',()=>{
 const b=mk();b.beginSnapshot();
 b.onUpdate(U(upd(99,[{type:UPDATE.NEW,side:1,price:6999,size:1,id:'old'}])));
 b.onUpdate(U(upd(100,[{type:UPDATE.NEW,side:1,price:6998,size:1,id:'dup'}])));
 b.onUpdate(U(upd(101,[{type:UPDATE.NEW,side:1,price:6997,size:2,id:'n1'}])));
 for(const p of seedParts(100))b.onSnapshotPart(p);
 const s=b.stats();assert.equal(s.droppedOverlap,2);assert.equal(s.replayedAfterSeed,1);
 assert.equal(b.orderCount,6);assert.equal(b.lastSeq,'101');assert.equal(b.state,'VALID');
 const g=mk();g.beginSnapshot();g.onUpdate(U(upd(103,[{type:UPDATE.NEW,side:1,price:6997,size:2,id:'n1'}])));
 for(const p of seedParts(100))g.onSnapshotPart(p);
 assert.equal(g.state,'INVALID');assert.equal(g.reason,'SEQUENCE_GAP');
});

test('NEW / CHANGE (size and price move) / DELETE maintain exact per-order state',()=>{
 const b=mk();seed(b);
 b.onUpdate(U(upd(101,[{type:UPDATE.CHANGE,side:1,price:7000,size:2,id:'b1'}])));
 b.onUpdate(U(upd(102,[{type:UPDATE.CHANGE,side:1,price:6999.75,size:3,id:'b2'}])));
 b.onUpdate(U(upd(103,[{type:UPDATE.DELETE,side:2,price:7000.25,id:'a1'},{type:UPDATE.NEW,side:2,price:7000.5,size:6,id:'a3'}])));
 const {bid,ask}=b.levels();
 assert.equal(bid.get(28000).qty,2);assert.equal(bid.get(27999).qty,3);
 assert.equal(ask.has(28001),false);assert.equal(ask.get(28002).qty,6);
 assert.deepEqual(b.top(),{bid:7000,ask:7000.5,bidQty:2,askQty:6});assert.equal(b.state,'VALID');
});

test('STRICT fails closed on gap, out-of-order, missing sequence, unknown order; OBSERVE counts',()=>{
 const g=mk();seed(g);g.onUpdate(U(upd(105,[{type:UPDATE.NEW,side:1,price:6995,size:1,id:'z'}])));
 assert.equal(g.reason,'SEQUENCE_GAP');
 const o=mk();seed(o);o.onUpdate(U(upd(99,[{type:UPDATE.DELETE,side:1,price:7000,id:'b1'}])));
 assert.equal(o.reason,'ANOMALY_outOfOrder');
 const m=mk();seed(m);m.onUpdate(U(upd(null,[{type:UPDATE.DELETE,side:1,price:7000,id:'b1'}])));
 assert.equal(m.reason,'ANOMALY_missingSequence');
 const c=mk();seed(c);c.onUpdate(U(upd(101,[{type:UPDATE.CHANGE,side:1,price:7000,size:1,id:'ghost'}])));
 assert.equal(c.reason,'ANOMALY_changeMissing');
 const ob=mk({mode:'OBSERVE'});seed(ob);
 ob.onUpdate(U(upd(105,[{type:UPDATE.NEW,side:1,price:6995,size:1,id:'z'}])));
 ob.onUpdate(U(upd(105,[{type:UPDATE.DELETE,side:1,price:6995,id:'z'}])));
 const s=ob.stats();assert.equal(ob.state,'VALID');assert.equal(s.gaps,1);assert.equal(s.gapTotal,'4');assert.equal(s.equalSeq,1);
 assert.ok(ob.failures.some(f=>f.reason==='SEQUENCE_GAP'),'OBSERVE still records the failure');
});

test('misaligned update arrays are rejected, never guessed',()=>{
 const b=mk();seed(b);
 const bad=Buffer.concat([T(160),S(110100,'ESZ6'),S(110101,'CME'),V(112002,101),V(110121,1),V(110121,1),
  V(153612,1),D(154405,7000),V(159009,1),S(149238,'q')]);
 const u=parseUpdate(bad);assert.equal(u.aligned,false);b.onUpdate(u);
 assert.equal(b.reason,'ANOMALY_misaligned');
});

test('BLOCKER 3: LAST_INCLUDED detected; reseed exact; later updates replayed',()=>{
 const b=mk({mode:'OBSERVE'});seed(b,100);
 b.onUpdate(U(upd(101,[{type:UPDATE.CHANGE,side:1,price:7000,size:4,id:'b1'}])));
 assert.equal(b.beginVerification(),true);
 b.onUpdate(U(upd(102,[{type:UPDATE.DELETE,side:1,price:7000,id:'b2'}])));
 b.onUpdate(U(upd(103,[{type:UPDATE.NEW,side:2,price:7001,size:2,id:'a9'}])));
 verifyWith(b,102,[[SIDE.BID,7000,[['b1',4]]],[SIDE.BID,6990,[['b3',20]]],[SIDE.ASK,7000.25,[['a1',4]]],[SIDE.ASK,7050.25,[['a2',50]]]]);
 const v=b.stats().verifications[0];
 assert.equal(v.diffBeforeEqualSeq.total,1);assert.equal(v.diffAfterEqualSeq.total,0);
 assert.equal(v.semantics,'LAST_INCLUDED');assert.equal(v.match,true);
 assert.equal(b.orderCount,5);assert.equal(b.lastSeq,'103');assert.equal(b.verifying,false);
});

test('BLOCKER 3: NEXT_EXPECTED detected; equal-seq updates replayed AFTER reseed, not dropped',()=>{
 const b=mk({mode:'OBSERVE'});seed(b,100);
 b.beginVerification();
 b.onUpdate(U(upd(101,[{type:UPDATE.CHANGE,side:1,price:7000,size:9,id:'b1'}])));
 b.onUpdate(U(upd(102,[{type:UPDATE.DELETE,side:1,price:7000,id:'b2'}])));
 verifyWith(b,102,[[SIDE.BID,7000,[['b1',9],['b2',3]]],[SIDE.BID,6990,[['b3',20]]],[SIDE.ASK,7000.25,[['a1',4]]],[SIDE.ASK,7050.25,[['a2',50]]]]);
 const v=b.stats().verifications[0];
 assert.equal(v.semantics,'NEXT_EXPECTED');assert.equal(v.match,true);
 assert.equal(b.orderCount,4,'b2 deleted by the replayed equal-seq update');assert.equal(b.lastSeq,'102');
 assert.equal(b.state,'VALID');
});

test('BLOCKER 3: both comparisons matching is reported AMBIGUOUS, never inferred',()=>{
 const b=mk({mode:'OBSERVE'});seed(b,100);
 b.beginVerification();
 b.onUpdate(U(upd(100,[{type:UPDATE.NEW,side:1,price:6980,size:1,id:'t'},{type:UPDATE.DELETE,side:1,price:6980,id:'t'}])));
 verifyWith(b,100);
 assert.equal(b.stats().verifications[0].semantics,'AMBIGUOUS');assert.equal(b.stats().semantics.AMBIGUOUS,1);
});

test('BLOCKER 3: verification replay runs sequence checks (gap inside replay -> STRICT INVALID)',()=>{
 const b=mk();seed(b,100);b.beginVerification();
 b.onUpdate(U(upd(104,[{type:UPDATE.NEW,side:1,price:6995,size:1,id:'z'}])));
 verifyWith(b,105,[...SEED_LEVELS,[SIDE.BID,6995,[['z',1]]]]);
 assert.equal(b.state,'INVALID');assert.ok(b.failures.some(f=>f.reason==='SEQUENCE_GAP'));
});

test('BLOCKER 3: mismatch is a recorded failure; STRICT stays INVALID, OBSERVE reseeds',()=>{
 for(const mode of ['STRICT','OBSERVE']){
  const b=mk({mode});seed(b,100);b.beginVerification();
  b.onSnapshotPart(P(part({seq:150,side:1,price:7000,orders:[{id:'b1',size:9}]})));
  b.onSnapshotPart(P(part({seq:150,final:true})));
  const v=b.stats().verifications[0];assert.equal(v.match,false);assert.equal(v.semantics,'NO_EQUAL_SEQUENCE_UPDATES');
  assert.ok(b.failures.some(f=>f.reason==='VERIFICATION_MISMATCH'));
  assert.equal(b.state,mode==='STRICT'?'INVALID':'VALID');
 }
});

test('reconnect resets to UNSEEDED; updates ignored until reseeded',()=>{
 const b=mk();seed(b);b.reset();assert.equal(b.state,'UNSEEDED');assert.equal(b.orderCount,0);
 b.onUpdate(U(upd(200,[{type:UPDATE.NEW,side:1,price:7000,size:1,id:'x'}])));
 assert.equal(b.orderCount,0);assert.equal(b.stats().anomalies.ignoredUnseeded,1);
 seed(b,300);assert.equal(b.state,'VALID');assert.equal(b.orderCount,5);
});

test('bounded memory: order and buffer limits fail closed',()=>{
 const b=mk({maxOrders:2});b.beginSnapshot();
 b.onSnapshotPart(P(part({seq:1,side:1,price:7000,orders:[{id:'1',size:1},{id:'2',size:1},{id:'3',size:1}]})));
 b.onSnapshotPart(P(part({seq:1,final:true})));assert.equal(b.reason,'ORDER_LIMIT');
 const q=mk({maxBuffered:1});q.beginSnapshot();
 q.onUpdate(U(upd(1,[{type:UPDATE.NEW,side:1,price:7000,size:1,id:'a'}])));
 q.onUpdate(U(upd(2,[{type:UPDATE.NEW,side:1,price:7000,size:1,id:'b'}])));
 assert.equal(q.reason,'BUFFER_LIMIT');
});

test('BLOCKER 4: coverage reports observed orders only; absent prices NOT_OBSERVED; side-touch basis',()=>{
 const b=mk();seed(b);const c=b.coverage([10,20,50]);
 assert.equal(c.suppressed,false);assert.equal(c.completenessProven,false);assert.equal(c.distanceBasis,'SIDE_TOUCH');
 assert.equal(c.bid.touch,'BEST_BID');assert.equal(c.bid.best,7000);assert.equal(c.ask.best,7000.25);
 const b10=c.bid.rows[0];assert.equal(b10.price,6990);assert.equal(b10.observation,'OBSERVED_ORDERS');
 assert.equal(b10.observedQtyAtPrice,20);assert.equal(b10.observedQtyTouchToPrice,28);
 const a20=c.ask.rows[1];assert.equal(a20.price,7020.25);assert.equal(a20.observation,'NOT_OBSERVED');
 assert.equal(a20.observedQtyAtPrice,null,'absent inside span is NOT zero');assert.equal(a20.targetWithinObservedSpan,true);
});

test('BLOCKER 4: coverage suppressed when INVALID, seeding, verifying or stale',()=>{
 let t=1000;const b=mk({now:()=>t});
 b.beginSnapshot();assert.equal(b.coverage().reason,'SEEDING');
 for(const p of seedParts(100))b.onSnapshotPart(p);assert.equal(b.coverage().suppressed,false);
 b.beginVerification();assert.equal(b.coverage().reason,'VERIFICATION_IN_PROGRESS');verifyWith(b,100);
 t+=20000;assert.equal(b.coverage(undefined,{maxAgeMs:10000}).reason,'STALE');
 b.onUpdate(U(upd(105,[{type:UPDATE.NEW,side:1,price:6995,size:1,id:'z'}])));assert.equal(b.coverage().reason,'BOOK_INVALID');
});

test('end events are counted only',()=>{
 const b=mk();seed(b,100);b.onEndEvent(parseEndEvent(Buffer.concat([T(161),S(110100,'ESZ6'),S(110101,'CME'),V(112002,100)])));
 assert.equal(b.stats().endEvents,1);assert.equal(b.stats().endEventSeqMatches,1);
});
