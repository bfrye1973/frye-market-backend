// Offline DBO reconstruction tests (no network).
import test from 'node:test';
import assert from 'node:assert/strict';
import {createDboBook,parseSnapshotPart,parseUpdate,parseEndEvent,decodeExact,
 encodeDboSnapshotRequest,encodeDboUpdatesRequest,UPDATE,SIDE} from '../logic/engine18/engine18RithmicDboBook.js';

const vb=n=>{n=BigInt(n);const b=[];do{let k=Number(n&127n);n>>=7n;if(n)k|=128;b.push(k)}while(n);return Buffer.from(b)};
const V=(f,x)=>Buffer.concat([vb(BigInt(f)*8n),vb(x)]);
const S=(f,x)=>{const b=Buffer.from(x);return Buffer.concat([vb(BigInt(f)*8n+2n),vb(b.length),b])};
const D=(f,x)=>{const b=Buffer.alloc(8);b.writeDoubleLE(x,0);return Buffer.concat([vb(BigInt(f)*8n+1n),b])};
const T=id=>V(154467,id);
// 116 part: one price level with orders [{id,size,pri}]
const part=({seq,side,price,orders=[],final=false,rp='0',size32=false})=>Buffer.concat([T(116),
 final?S(132766,rp):S(132764,'0'),S(110100,'ESZ6'),S(110101,'CME'),...(seq===undefined?[]:[V(112002,seq)]),
 ...(side?[V(153612,side)]:[]),...(price!==undefined?[D(154405,price)]:[]),
 ...orders.map(o=>V(size32?154406:159009,o.size)),...orders.map(o=>V(153613,o.pri??1)),
 ...orders.map(o=>S(149238,o.id))]);
// 160 update with entries [{type,side,price,size,id}]
const upd=(seq,entries)=>Buffer.concat([T(160),S(110100,'ESZ6'),S(110101,'CME'),V(112002,seq),
 ...entries.map(e=>V(110121,e.type)),...entries.map(e=>V(153612,e.side)),
 ...entries.map(e=>D(154405,e.price)),...entries.filter(e=>e.size!==undefined).map(e=>V(159009,e.size)),
 ...entries.map(e=>S(149238,e.id))]);
const P=f=>parseSnapshotPart(f),U=f=>parseUpdate(f);
const seed=(book,seq=100)=>{book.beginSnapshot();
 book.onSnapshotPart(P(part({seq,side:SIDE.BID,price:7000,orders:[{id:'b1',size:5},{id:'b2',size:3}]})));
 book.onSnapshotPart(P(part({seq,side:SIDE.BID,price:6990,orders:[{id:'b3',size:20}]})));
 book.onSnapshotPart(P(part({seq,side:SIDE.ASK,price:7000.25,orders:[{id:'a1',size:4}]})));
 book.onSnapshotPart(P(part({seq,side:SIDE.ASK,price:7050.25,orders:[{id:'a2',size:50}]})));
 book.onSnapshotPart(P(part({seq,final:true})));};

test('requests: full-book 115/117 without depth_price; ES/CME only',()=>{
 const s=decodeExact(encodeDboSnapshotRequest({symbol:'ESZ6',exchange:'CME'}));
 assert.equal(s.get(154467)[0],115n);assert.equal(s.get(154405),undefined);
 const u=decodeExact(encodeDboUpdatesRequest({symbol:'ESZ6',exchange:'CME',subscribe:false}));
 assert.equal(u.get(154467)[0],117n);assert.equal(u.get(100000)[0],2n);
 assert.throws(()=>encodeDboSnapshotRequest({symbol:'NQZ6',exchange:'CME'}));
});

test('decoder keeps u64 priority/sequence exact and accepts both size tags and packed arrays',()=>{
 const huge=18446744073709551615n;
 const p=P(part({seq:huge,side:SIDE.BID,price:7000,orders:[{id:'x',size:7,pri:huge}]}));
 assert.equal(p.seq,huge);assert.equal(p.priorities[0],huge);assert.equal(p.sizes[0],7n);
 const p32=P(part({seq:1,side:SIDE.ASK,price:7001,orders:[{id:'y',size:9}],size32:true}));
 assert.equal(p32.sizes[0],9n);
 // packed update_type / side
 const packed=Buffer.concat([T(160),V(112002,5),S(110121,'')]); // empty packed field tolerated
 assert.equal(parseUpdate(packed).count,0);
 const pk=Buffer.concat([T(160),V(112002,6),
  Buffer.concat([vb(110121n*8n+2n),vb(2),Buffer.from([1,3])]),
  Buffer.concat([vb(153612n*8n+2n),vb(2),Buffer.from([1,2])]),
  D(154405,7000),D(154405,7001),V(159009,1),V(159009,2),S(149238,'a'),S(149238,'b')]);
 const u=parseUpdate(pk);assert.equal(u.aligned,true);assert.deepEqual(u.entries.map(e=>e.type),[1,3]);
});

test('multipart snapshot completes only on the final rp_code message',()=>{
 const b=createDboBook();b.beginSnapshot();
 b.onSnapshotPart(P(part({seq:10,side:SIDE.BID,price:7000,orders:[{id:'b1',size:1}]})));
 assert.equal(b.state,'SEEDING');
 b.onSnapshotPart(P(part({seq:10,final:true})));
 assert.equal(b.state,'VALID');assert.equal(b.orderCount,1);assert.equal(b.lastSeq,'10');
 const r=createDboBook();r.beginSnapshot();r.onSnapshotPart(P(part({final:true,rp:'7'})));
 assert.equal(r.state,'INVALID');assert.match(r.reason,/SNAPSHOT_REJECTED_7/);
});

test('buffered updates: overlap (<= snapshot seq) dropped, later ones replayed in order',()=>{
 const b=createDboBook();b.beginSnapshot();
 b.onUpdate(U(upd(99,[{type:UPDATE.NEW,side:SIDE.BID,price:6999,size:1,id:'old'}])));
 b.onUpdate(U(upd(100,[{type:UPDATE.NEW,side:SIDE.BID,price:6998,size:1,id:'dup'}])));
 b.onUpdate(U(upd(101,[{type:UPDATE.NEW,side:SIDE.BID,price:6997,size:2,id:'n1'}])));
 b.onSnapshotPart(P(part({seq:100,side:SIDE.BID,price:7000,orders:[{id:'b1',size:5}]})));
 b.onSnapshotPart(P(part({seq:100,final:true})));
 const s=b.stats();assert.equal(s.droppedOverlap,2);assert.equal(s.replayedAfterSeed,1);
 assert.equal(b.orderCount,2);assert.equal(b.lastSeq,'101');assert.equal(b.state,'VALID');
});

test('NEW / CHANGE (size and price move) / DELETE maintain exact per-order state',()=>{
 const b=createDboBook();seed(b);
 b.onUpdate(U(upd(101,[{type:UPDATE.CHANGE,side:SIDE.BID,price:7000,size:2,id:'b1'}])));
 b.onUpdate(U(upd(102,[{type:UPDATE.CHANGE,side:SIDE.BID,price:6999.75,size:3,id:'b2'}])));
 b.onUpdate(U(upd(103,[{type:UPDATE.DELETE,side:SIDE.ASK,price:7000.25,size:0,id:'a1'},
  {type:UPDATE.NEW,side:SIDE.ASK,price:7000.5,size:6,id:'a3'}])));
 const {bid,ask}=b.levels();
 assert.equal(bid.get(28000).qty,2);assert.equal(bid.get(27999).qty,3);
 assert.equal(ask.has(28001),false);assert.equal(ask.get(28002).qty,6);
 assert.deepEqual(b.top(),{bid:7000,ask:7000.5,bidQty:2,askQty:6});
 assert.equal(b.state,'VALID');
});

test('STRICT fails closed on gap, out-of-order, unknown order; OBSERVE counts and continues',()=>{
 const g=createDboBook();seed(g);g.onUpdate(U(upd(105,[{type:UPDATE.NEW,side:SIDE.BID,price:6995,size:1,id:'z'}])));
 assert.equal(g.state,'INVALID');assert.equal(g.reason,'SEQUENCE_GAP');
 const o=createDboBook();seed(o);o.onUpdate(U(upd(99,[{type:UPDATE.DELETE,side:SIDE.BID,price:7000,id:'b1'}])));
 assert.equal(o.reason,'SEQUENCE_OUT_OF_ORDER');
 const c=createDboBook();seed(c);c.onUpdate(U(upd(101,[{type:UPDATE.CHANGE,side:SIDE.BID,price:7000,size:1,id:'ghost'}])));
 assert.equal(c.reason,'ANOMALY_changeMissing');
 const ob=createDboBook({mode:'OBSERVE'});seed(ob);
 ob.onUpdate(U(upd(105,[{type:UPDATE.NEW,side:SIDE.BID,price:6995,size:1,id:'z'}])));
 ob.onUpdate(U(upd(105,[{type:UPDATE.DELETE,side:SIDE.BID,price:6995,id:'z'}])));
 const s=ob.stats();assert.equal(ob.state,'VALID');assert.equal(s.gaps,1);assert.equal(s.gapTotal,'4');assert.equal(s.equalSeq,1);
});

test('misaligned update arrays are rejected, never guessed',()=>{
 const b=createDboBook();seed(b);
 const bad=Buffer.concat([T(160),V(112002,101),V(110121,1),V(110121,1),V(153612,1),D(154405,7000),
  V(159009,1),S(149238,'q')]);
 const u=parseUpdate(bad);assert.equal(u.aligned,false);b.onUpdate(u);
 assert.equal(b.state,'INVALID');assert.equal(b.reason,'ANOMALY_misaligned');
});

test('re-snapshot verification: match reported; equal-seq semantics distinguished; reseed exact',()=>{
 const b=createDboBook({mode:'OBSERVE'});seed(b,100);
 b.onUpdate(U(upd(101,[{type:UPDATE.CHANGE,side:SIDE.BID,price:7000,size:4,id:'b1'}])));
 assert.equal(b.beginVerification(),true);
 // arrives during verification: seq 102 is INCLUDED in the new snapshot (last-included semantics)
 b.onUpdate(U(upd(102,[{type:UPDATE.DELETE,side:SIDE.BID,price:7000,id:'b2'}])));
 b.onUpdate(U(upd(103,[{type:UPDATE.NEW,side:SIDE.ASK,price:7001,size:2,id:'a9'}])));
 const s2=102;
 b.onSnapshotPart(P(part({seq:s2,side:SIDE.BID,price:7000,orders:[{id:'b1',size:4}]})));
 b.onSnapshotPart(P(part({seq:s2,side:SIDE.BID,price:6990,orders:[{id:'b3',size:20}]})));
 b.onSnapshotPart(P(part({seq:s2,side:SIDE.ASK,price:7000.25,orders:[{id:'a1',size:4}]})));
 b.onSnapshotPart(P(part({seq:s2,side:SIDE.ASK,price:7050.25,orders:[{id:'a2',size:50}]})));
 b.onSnapshotPart(P(part({seq:s2,final:true})));
 const v=b.stats().verifications[0];
 assert.equal(v.diffBeforeEqualSeq.total,1);   // b2 still present before applying seq==S
 assert.equal(v.diffAfterEqualSeq.total,0);    // -> snapshot seq means "last included"
 assert.equal(v.match,true);
 assert.equal(b.orderCount,5);assert.equal(b.lastSeq,'103');assert.equal(b.verifying,false);
});

test('re-snapshot mismatch is detected and the book reseeds from the snapshot',()=>{
 const b=createDboBook({mode:'OBSERVE'});seed(b,100);
 b.beginVerification();
 b.onSnapshotPart(P(part({seq:150,side:SIDE.BID,price:7000,orders:[{id:'b1',size:9}]})));
 b.onSnapshotPart(P(part({seq:150,final:true})));
 const v=b.stats().verifications[0];
 assert.equal(v.match,false);assert.ok(v.diffAfterEqualSeq.extraInBook>=4);assert.equal(v.diffAfterEqualSeq.sizeMismatch,1);
 assert.equal(b.orderCount,1);assert.equal(b.lastSeq,'150');
});

test('reconnect resets to UNSEEDED; updates ignored until reseeded',()=>{
 const b=createDboBook();seed(b);b.reset();
 assert.equal(b.state,'UNSEEDED');assert.equal(b.orderCount,0);
 b.onUpdate(U(upd(200,[{type:UPDATE.NEW,side:SIDE.BID,price:7000,size:1,id:'x'}])));
 assert.equal(b.orderCount,0);assert.equal(b.stats().anomalies.ignoredUnseeded,1);
 seed(b,300);assert.equal(b.state,'VALID');assert.equal(b.orderCount,5);
});

test('bounded memory: order and buffer limits fail closed',()=>{
 const b=createDboBook({maxOrders:2});b.beginSnapshot();
 b.onSnapshotPart(P(part({seq:1,side:SIDE.BID,price:7000,orders:[{id:'1',size:1},{id:'2',size:1},{id:'3',size:1}]})));
 assert.equal(b.reason,'ORDER_LIMIT');
 const q=createDboBook({maxBuffered:1});q.beginSnapshot();
 q.onUpdate(U(upd(1,[{type:UPDATE.NEW,side:SIDE.BID,price:7000,size:1,id:'a'}])));
 q.onUpdate(U(upd(2,[{type:UPDATE.NEW,side:SIDE.BID,price:7000,size:1,id:'b'}])));
 assert.equal(q.reason,'BUFFER_LIMIT');
});

test('coverage: quantities only where observed; range flag is not a claim about every price',()=>{
 const b=createDboBook();seed(b);
 const c=b.coverage([10,20,50]);
 assert.equal(c.bid.best,7000);assert.equal(c.bid.farthest,6990);assert.equal(c.ask.farthest,7050.25);
 const b10=c.bid.rows[0];assert.equal(b10.price,6990);assert.equal(b10.withinObservedRange,true);
 assert.equal(b10.qtyAtPrice,20);assert.equal(b10.cumulativeQty,28);assert.equal(b10.levelsWithOrdersInRange,2);
 const b20=c.bid.rows[1];assert.equal(b20.withinObservedRange,false);assert.equal(b20.qtyAtPrice,null);assert.equal(b20.cumulativeQty,null);
 const a50=c.ask.rows[2];assert.equal(a50.price,7050.25);assert.equal(a50.qtyAtPrice,50);
 const a20=c.ask.rows[1];assert.equal(a20.withinObservedRange,true);assert.equal(a20.qtyAtPrice,0);
});

test('end events are counted only',()=>{
 const b=createDboBook();seed(b,100);
 b.onEndEvent(parseEndEvent(Buffer.concat([T(161),V(112002,100)])));
 assert.equal(b.stats().endEvents,1);assert.equal(b.stats().endEventSeqMatches,1);
});
