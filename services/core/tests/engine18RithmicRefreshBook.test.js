import test from 'node:test';
import assert from 'node:assert/strict';
import {createRefreshBook,createSyncModeSelector,createEngine18Book,parseExchangeTime,roundKeyLevels,
 SYNC_MODES,QUALITY,LABELS} from '../logic/engine18/engine18RithmicRefreshBook.js';
import {parseKeyLevels} from '../logic/engine18/engine18RithmicPaperDboProbe.js';

const S={symbol:'ESZ6',exchange:'CME'};
const clock=(t=1_000_000)=>{const c={t,now:()=>c.t,adv:ms=>{c.t+=ms}};return c};
// synthetic parsed frames (shape of parseSnapshotPart / parseUpdate)
const part=(id,side,price,ids,sizes,seq=null)=>({final:false,rpCode:null,more:true,seq,side,price,ids,sizes:sizes.map(BigInt),
 priorities:[],aligned:true,dataBearing:true,userMsg:id,...S});
const fin=(id,rp='0')=>({final:true,rpCode:rp,more:false,seq:null,side:null,price:null,ids:[],sizes:[],priorities:[],aligned:true,dataBearing:false,userMsg:id,symbol:null,exchange:null});
const upd=(entries,seq=null,extra={})=>({seq,aligned:true,dataBearing:true,count:entries.length,...S,...extra,
 entries:entries.map(([type,side,price,size,orderId])=>({type,side,price,size:size==null?null:BigInt(size),priority:null,orderId,prevPrice:null}))});
// book as {orderId:[side,price,qty]} -> snapshot parts (one part per order)
const sendSnap=(b,id,book)=>{for(const [oid,[side,price,q]] of Object.entries(book))b.onSnapshotPart(part(id,side,price,[oid],[q]));b.onSnapshotPart(fin(id))};
const BASE={a:[1,7000,10],b:[1,6999.75,5],c:[2,7000.25,8],d:[2,7000.5,4]};
const mk=(c,o={})=>createRefreshBook({...S,now:c.now,refreshEveryMs:60000,matchStreakK:3,...o});
const refresh=(b,c,id,book,ms=60000)=>{c.adv(ms);assert.equal(b.refreshDue(),true);assert.equal(b.beginRefresh(id),true);sendSnap(b,id,book)};

test('seed, then matching refreshes -> RECONCILED; label only after K matches; never verified',()=>{
 const c=clock(),b=mk(c);assert.equal(b.quality(),QUALITY.UNSEEDED);
 assert.equal(b.beginRefresh('s1'),true);sendSnap(b,'s1',BASE);
 assert.equal(b.quality(),QUALITY.SEEDED);assert.equal(b.label(),LABELS.DIAGNOSTIC);assert.equal(b.orderCount,4);
 c.adv(1000);b.onUpdate(upd([[2,1,7000,12,'a']]));                      // a: 10 -> 12
 const cur={...BASE,a:[1,7000,12]};
 refresh(b,c,'s2',cur);assert.equal(b.quality(),QUALITY.RECONCILED);assert.equal(b.label(),LABELS.DIAGNOSTIC);
 refresh(b,c,'s3',cur);assert.equal(b.label(),LABELS.DIAGNOSTIC);
 refresh(b,c,'s4',cur);assert.equal(b.label(),LABELS.RECONCILED);
 const L=b.liquidity();assert.equal(L.verified,false);assert.equal(L.label,'EMPIRICALLY_RECONCILED_UNVERIFIED');
 assert.equal(L.boundary,'UNKNOWN_NO_VENDOR_SEQUENCE');assert.equal(L.exactMatchRate,1);assert.equal(L.overlapTolerantMatchRate,1);assert.equal(L.quality,'RECONCILED');
 assert.deepEqual(L.labelBlockedBy,[]);assert.ok(L.streakObservedMs>=180000);
 assert.ok(!JSON.stringify(L).includes('"VERIFIED"'));
});

test('drift (a missed update) is detected at refresh, counted unexplained, and corrected by replacement',()=>{
 const c=clock(),b=mk(c);b.beginRefresh('s1');sendSnap(b,'s1',BASE);
 // the exchange added order e and deleted d, but we never received those updates
 const truth={a:BASE.a,b:BASE.b,c:BASE.c,e:[2,7001,30]};
 refresh(b,c,'s2',truth);
 assert.equal(b.quality(),QUALITY.DRIFT_CORRECTED);assert.equal(b.label(),LABELS.DIAGNOSTIC);
 const h=b.stats().history.at(-1);assert.equal(h.match,false);assert.equal(h.diff.missingInBook,1);assert.equal(h.diff.extraInBook,1);
 assert.equal(h.diff.unexplained,2);assert.equal(b.orderCount,4);
 const L=b.liquidity();assert.equal(L.suppressed,false);assert.equal(L.ask.rows[0].observedQtyTouchToPrice,8+30); // corrected book
 refresh(b,c,'s3',truth);assert.equal(b.quality(),QUALITY.RECONCILED);assert.equal(b.stats().matchStreak,1);
});

test('18D ruling 1: disagreeing orders touched mid-snapshot are AMBIGUOUS_OVERLAP; snapshot-only evidence kept separate',()=>{
 const c=clock(),b=mk(c);b.beginRefresh('s1');sendSnap(b,'s1',BASE);
 c.adv(60000);assert.equal(b.beginRefresh('s2'),true);
 b.onSnapshotPart(part('s2',1,7000,['a'],[10]));
 b.onUpdate(upd([[3,1,6999.75,null,'b']]));          // b deleted while snapshot in flight
 b.onUpdate(upd([[1,2,7000.75,7,'f']]));             // f added while in flight
 // snapshot still shows b and lacks f: which is newer cannot be established
 for(const [oid,[side,price,q]] of Object.entries({b:BASE.b,c:BASE.c,d:BASE.d}))b.onSnapshotPart(part('s2',side,price,[oid],[q]));
 b.onSnapshotPart(fin('s2'));
 const h=b.stats().history.at(-1);assert.equal(h.diff.ambiguousOverlap,2);assert.equal(h.diff.unexplained,0);
 assert.equal(h.match,true);assert.equal(h.exactMatch,false);assert.equal(h.diff.explained,undefined);
 assert.equal(b.quality(),QUALITY.OVERLAP_AMBIGUOUS);assert.equal(b.stats().matchStreak,0);
 const L=b.liquidity();assert.equal(L.evidence,'MIXED_ESTIMATE');assert.equal(L.ambiguousOverlap.orders,2);
 assert.equal(L.bid.rows[0].observedQtyTouchToPrice,10);          // estimate: latest received (b deleted)
 assert.equal(L.ask.rows[0].observedQtyTouchToPrice,8+4+7);       // estimate: f kept
 assert.equal(L.snapshotOnly.evidence,'SNAPSHOT_ONLY');
 assert.equal(L.snapshotOnly.bid[0].observedQtyTouchToPrice,10+5); // snapshot version of b kept separately
 assert.equal(L.snapshotOnly.ask[0].observedQtyTouchToPrice,8+4);
 assert.equal(L.exactMatchRate,0);assert.equal(L.overlapTolerantMatchRate,1);
 // a later live event for an ambiguous order supersedes both versions
 b.onUpdate(upd([[1,2,7000.75,7,'f']]));assert.equal(b.stats().driftSignals.newExisting,1);assert.equal(b.ambiguousCount,1);
});

test('18D ruling 1: an unusable overlapping update never drops or alters a genuine snapshot order',()=>{
 const c=clock(),b=mk(c);b.beginRefresh('s1');sendSnap(b,'s1',BASE);
 c.adv(60000);b.beginRefresh('s2');
 b.onUpdate(upd([[2,1,6999.5,null,'g']]));           // CHANGE without size for an unknown order: unusable
 b.onUpdate(upd([[3,2,7002,null,'zz']]));            // DELETE of an absent order: unusable
 sendSnap(b,'s2',{...BASE,g:[1,6999.5,9],zz:[2,7002,3]});
 assert.equal(b.orderCount,6);                        // g and zz kept from the snapshot
 const L=b.liquidity();assert.equal(L.bid.rows[0].observedQtyTouchToPrice,10+5+9);
 assert.equal(b.stats().driftSignals.changeMissingUnusable,1);
});

test('stale: no refresh within 2x the interval suppresses values (quality + label still reported)',()=>{
 const c=clock(),b=mk(c);b.beginRefresh('s1');sendSnap(b,'s1',BASE);
 c.adv(119000);assert.equal(b.quality(),QUALITY.SEEDED);
 c.adv(2000);assert.equal(b.quality(),QUALITY.STALE);
 const L=b.liquidity();assert.equal(L.suppressed,true);assert.equal(L.reason,'STALE');assert.equal(L.label,LABELS.DIAGNOSTIC);
 assert.ok(L.lastRefreshAgeMs>120000);
});

test('crossed or locked book -> INVALID, values suppressed; a clean refresh recovers',()=>{
 const c=clock(),b=mk(c);b.beginRefresh('s1');sendSnap(b,'s1',BASE);
 b.onUpdate(upd([[1,1,7000.5,3,'x']]));               // bid at the ask -> locked/crossed
 b.checkCrossed();assert.equal(b.quality(),QUALITY.INVALID);
 const L=b.liquidity();assert.equal(L.suppressed,true);assert.equal(L.reason,'BOOK_CROSSED_OR_LOCKED');
 refresh(b,c,'s2',BASE);assert.notEqual(b.quality(),QUALITY.INVALID);assert.equal(b.liquidity().suppressed,false);
 // a crossed SNAPSHOT is rejected and never becomes the baseline
 c.adv(60000);b.beginRefresh('s3');sendSnap(b,'s3',{...BASE,z:[1,7001,1]});
 assert.equal(b.stats().history.at(-1).reason,'SNAPSHOT_CROSSED_OR_LOCKED');assert.equal(b.orderCount,4);
});

test('scheduler: one request in flight, 15 s minimum gap, refresh interval floor, timeout frees the slot',()=>{
 const c=clock();assert.throws(()=>mk(c,{refreshEveryMs:10000}),/>= 15000/);
 const b=mk(c);assert.equal(b.refreshDue(),true);assert.equal(b.beginRefresh('s1'),true);
 assert.equal(b.refreshDue(),false);assert.equal(b.beginRefresh('s2'),false);   // in flight
 sendSnap(b,'s1',BASE);c.adv(5000);assert.equal(b.beginRefresh('s2'),false);   // min gap
 c.adv(11000);assert.equal(b.refreshDue(),false);                                // baseline still fresh
 c.adv(45000);assert.equal(b.refreshDue(),true);assert.equal(b.beginRefresh('s2'),true);
 c.adv(21000);assert.equal(b.refreshDue(),true);                                 // timed out -> slot freed
 assert.equal(b.stats().refreshTimeouts,1);
 // parts for another request id are ignored
 b.beginRefresh('s3');b.onSnapshotPart(part('zz',1,7000,['q'],[1]));assert.equal(b.stats().mismatchedParts,1);
});

test('sync-mode seam: sequenced only with 112002 on snapshot AND updates; any unsequenced frame -> refresh mode',()=>{
 const s1=createSyncModeSelector({minUpdates:3});
 s1.observeSnapshotPart(part('a',1,7000,['o'],[1],5n));s1.observeSnapshotPart({...fin('a'),seq:5n});
 for(let i=0;i<3;i++)s1.observeUpdate(upd([[1,1,7000,1,'o'+i]],BigInt(6+i)));
 assert.equal(s1.decide().mode,SYNC_MODES.SEQUENCED);
 const {syncMode,book}=createEngine18Book({syncMode:s1.decide().mode,...S});assert.equal(syncMode,'SEQUENCED');
 assert.equal(typeof book.beginVerification,'function');                       // the existing #400/#414 book
 const s2=createSyncModeSelector({minUpdates:3});
 s2.observeSnapshotPart(part('a',1,7000,['o'],[1],5n));s2.observeSnapshotPart(fin('a'));
 s2.observeUpdate(upd([[1,1,7000,1,'x']],null));                               // live Nov 26 layout
 for(let i=0;i<5;i++)s2.observeUpdate(upd([[1,1,7000,1,'o'+i]],BigInt(9+i)));
 assert.equal(s2.decide().mode,SYNC_MODES.UNSEQUENCED_REFRESH);                // sticky
 assert.equal(createEngine18Book({syncMode:s2.decide().mode,...S}).book.syncMode,'UNSEQUENCED_REFRESH');
 assert.equal(createSyncModeSelector().decide().mode,null);                      // no evidence yet
 assert.throws(()=>createEngine18Book({}),/syncMode/);
});

test('key-level readings and stub exclusion (far placeholder orders stay in the book, out of span metrics)',()=>{
 const c=clock(),b=mk(c);b.beginRefresh('s1');
 sendSnap(b,'s1',{...BASE,k1:[1,6950,40],k2:[1,6950,25],stubB:[1,1500,1],stubA:[2,743240,2],r:[2,7050,60]});
 const L=b.liquidity({keyLevels:[{name:'KEY_6950',price:6950},{name:'KEY_7050',price:7050},{name:'EMPTY',price:6900}]});
 assert.equal(L.stubExclusion.excludedOrders,2);assert.equal(L.stubExclusion.excludedQty,3);assert.equal(b.orderCount,9);
 assert.equal(L.bid.farthestObserved,6950);assert.equal(L.ask.farthestObserved,7050);
 const [k6950,k7050,empty]=L.keyLevels;
 assert.equal(k6950.bidQty,65);assert.equal(k6950.bidOrders,2);assert.equal(k6950.where,'AT_OR_BELOW_BID');assert.equal(k6950.distanceFromTouchPts,50);
 assert.equal(k7050.askQty,60);assert.equal(k7050.where,'AT_OR_ABOVE_ASK');
 assert.equal(empty.observation,'NOT_OBSERVED');assert.equal(empty.bidQty,null);
 assert.equal(L.quality,'SEEDED');assert.equal(L.label,LABELS.DIAGNOSTIC);assert.equal(typeof L.lastRefreshAgeMs,'number');
 const rk=roundKeyLevels(7243.375);assert.ok(rk.some(k=>k.price===7000));assert.ok(rk.some(k=>k.price===7450));assert.ok(!rk.some(k=>k.price===6950));
});

test('bounded memory with ~7,000-order books: one running book, history capped, touched set capped',()=>{
 const c=clock(),b=mk(c,{historyMax:5});
 const big={};for(let i=0;i<3500;i++){big['b'+i]=[1,7000-(i%400)*0.25,1+(i%7)];big['a'+i]=[2,7000.25+(i%400)*0.25,1+(i%5)]}
 const t0=Date.now();b.beginRefresh('s0');sendSnap(b,'s0',big);
 for(let k=1;k<=8;k++){c.adv(60000);b.beginRefresh('s'+k);
  for(let j=0;j<50;j++)b.onUpdate(upd([[2,1,7000-(j%400)*0.25,9,'b'+j]]));
  for(const [oid,[side,price,q]] of Object.entries(big))b.onSnapshotPart(part('s'+k,side,price,[oid],[q]));b.onSnapshotPart(fin('s'+k))}
 assert.equal(b.orderCount,7000);assert.ok(b.stats().history.length<=5);assert.ok(Date.now()-t0<5000);
 const tiny=mk(clock(),{maxOrders:3});tiny.beginRefresh('x');
 for(const [oid,[side,price,q]] of Object.entries(BASE))tiny.onSnapshotPart(part('x',side,price,[oid],[q]));tiny.onSnapshotPart(fin('x'));
 assert.equal(tiny.stats().history.at(-1).reason,'ORDER_LIMIT');assert.equal(tiny.orderCount,0);
});

test('structural defects: data-bearing update missing instrument -> INVALID; bad side breaks the streak',()=>{
 const c=clock(),b=mk(c);b.beginRefresh('s1');sendSnap(b,'s1',BASE);
 refresh(b,c,'s2',BASE);refresh(b,c,'s3',BASE);assert.equal(b.stats().matchStreak,2);
 b.onUpdate(upd([[2,9,7000,1,'a']]));assert.equal(b.stats().matchStreak,0);assert.equal(b.stats().structural.badSide,1);
 b.onUpdate(upd([[2,1,7000,1,'a']],null,{symbol:null}));assert.equal(b.quality(),QUALITY.INVALID);
 assert.equal(b.liquidity().reason,'INSTRUMENT_missingInstrument');
 // a snapshot from the wrong instrument is rejected
 c.adv(60000);b.beginRefresh('s4');b.onSnapshotPart({...part('s4',1,7000,['a'],[1]),symbol:'NQZ6'});b.onSnapshotPart(fin('s4'));
 assert.equal(b.stats().history.at(-1).reason,'SNAPSHOT_INSTRUMENT');
});

test('exchange timestamps are diagnostics only (monotonicity + gap buckets), never used for placement',()=>{
 const uv=n=>{const a=[];do{const x=n%128;n=Math.floor(n/128);a.push(n?x|128:x)}while(n);return Buffer.from(a)};
 const fld=(f,v)=>Buffer.concat([uv(f*8),uv(v)]);
 const frame=(s,u)=>Buffer.concat([fld(154467,160),fld(150400,s),fld(150401,u)]);
 const e1=parseExchangeTime(frame(1795705309,100)),e2=parseExchangeTime(frame(1795705309,600)),e0=parseExchangeTime(frame(1795705308,999999));
 assert.equal(e2.ns-e1.ns,500000n);assert.equal(parseExchangeTime(fld(154467,160)),null);
 const c=clock(),b=mk(c);b.beginRefresh('s1');sendSnap(b,'s1',BASE);
 b.onUpdate(upd([[2,1,7000,11,'a']]),{exchangeTime:e1});b.onUpdate(upd([[2,1,7000,12,'a']]),{exchangeTime:e2});
 b.onUpdate(upd([[2,1,7000,13,'a']]),{exchangeTime:e0});b.onUpdate(upd([[2,1,7000,14,'a']]),{exchangeTime:null});
 const x=b.stats().exchangeTime;assert.equal(x.observed,3);assert.equal(x.backwards,1);assert.equal(x.missing,1);
 assert.equal(x.gapBuckets.lt1ms,1);assert.equal(x.usedForPlacement,false);
});

test('owner key levels from env are validated',()=>{
 assert.deepEqual(parseKeyLevels('7000, 7211'),[{name:'KEY_7000',price:7000},{name:'KEY_7211',price:7211}]);
 assert.deepEqual(parseKeyLevels(undefined),[]);
 assert.throws(()=>parseKeyLevels('7000.1'),/invalid key level/);assert.throws(()=>parseKeyLevels('abc'),/invalid key level/);
});

// ---- 18D Plan B rulings (Nov 26) ----
import {createAutoSyncBook,PLANB_LIVE} from '../logic/engine18/engine18RithmicRefreshBook.js';

test('18D ruling 2: label needs 3 exact clean matches over >=180 s at the approved 60 s cadence; any failure resets the streak',()=>{
 // faster cadence (test timing) can never earn the label even with 3 exact matches
 const c0=clock(),f=mk(c0,{refreshEveryMs:20000,minRefreshMs:1000,testTiming:true});f.beginRefresh('s1');sendSnap(f,'s1',BASE);
 for(const id of ['s2','s3','s4'])refresh(f,c0,id,BASE,20000);
 assert.equal(f.stats().matchStreak,3);assert.equal(f.label(),LABELS.DIAGNOSTIC);
 assert.ok(f.liquidity().labelBlockedBy.includes('CADENCE_NOT_APPROVED'));
 assert.ok(f.liquidity().labelBlockedBy.some(x=>x.startsWith('OBSERVATION_UNDER')));
 // approved cadence: earns it, then each failure kind resets the streak
 const c=clock(),b=mk(c);b.beginRefresh('s1');sendSnap(b,'s1',BASE);
 for(const id of ['s2','s3','s4'])refresh(b,c,id,BASE);assert.equal(b.label(),LABELS.RECONCILED);
 b.noteFailure('DISCONNECT');assert.equal(b.stats().matchStreak,0);assert.equal(b.label(),LABELS.DIAGNOSTIC);
 refresh(b,c,'s5',BASE);refresh(b,c,'s6',BASE);
 c.adv(60000);b.beginRefresh('s7');c.adv(21000);assert.equal(b.refreshDue(),true); // timeout freed the slot
 assert.equal(b.stats().matchStreak,0);assert.equal(b.stats().refreshTimeouts,1);
 assert.equal(b.beginRefresh('s8'),true);b.onSnapshotPart(fin('s8','5'));           // rejected refresh
 assert.equal(b.stats().matchStreak,0);
 refresh(b,c,'s9',BASE);assert.equal(b.stats().matchStreak,1);
 // an unexplained near-touch difference is not exact -> reset
 refresh(b,c,'s10',{...BASE,a:[1,7000,11]});assert.equal(b.stats().matchStreak,0);assert.equal(b.quality(),QUALITY.DRIFT_CORRECTED);
 const L=b.liquidity();assert.ok(L.overlapTolerantMatchRate<1&&L.exactMatchRate<1);assert.equal(L.verified,false);
});

test('18D ruling 3: hard 15 s minimum, approved defaults, crossed output suppressed even mid-snapshot, memory limit after merge, own midpoint',()=>{
 const c=clock();assert.throws(()=>createRefreshBook({...S,now:c.now,minRefreshMs:5000,refreshEveryMs:5000}),/hard minimum/);
 assert.equal(PLANB_LIVE.refreshEveryMs,60000);assert.equal(PLANB_LIVE.hardMinRefreshMs,15000);assert.equal(PLANB_LIVE.windowMs,300000);
 const b=mk(c);b.beginRefresh('s1');sendSnap(b,'s1',BASE);assert.equal(b.midpoint(),7000.125);
 c.adv(60000);b.beginRefresh('s2');                       // in flight: periodic cross-check is skipped
 b.onUpdate(upd([[1,1,7001,3,'x']]));                     // bid above best ask -> crossed
 const L=b.liquidity();assert.equal(L.suppressed,true);assert.equal(L.reason,'BOOK_CROSSED_OR_LOCKED');assert.equal(b.midpoint(),null);
 // memory: snapshot + ambiguous overlap counted together
 const c2=clock(),m=mk(c2,{maxOrders:5});m.beginRefresh('s1');sendSnap(m,'s1',BASE);
 c2.adv(60000);m.beginRefresh('s2');m.onUpdate(upd([[1,2,7003,1,'n1']]));      // running 5 orders, touched n1
 sendSnap(m,'s2',{...BASE,n2:[2,7004,1]});                                   // snapshot 5 orders; merged 5 + ambiguous 2 > 5
 assert.equal(m.quality(),QUALITY.INVALID);assert.equal(m.stats().invalidReason,'ORDER_LIMIT');
 assert.equal(m.stats().history.at(-1).reason,'ORDER_LIMIT_AFTER_MERGE');
});

const seqPart=(id,side,price,ids,sizes,seq)=>part(id,side,price,ids,sizes,BigInt(seq));
test('18D sequence mode: SEQUENCED only on full evidence and must pass its own acceptance; disappearing sequence -> invalidate and reseed',()=>{
 const c=clock(),a=createAutoSyncBook({...S,now:c.now,minUpdates:3});
 assert.equal(a.beginRefresh('s1'),true);
 for(const [oid,[side,price,q]] of Object.entries(BASE))a.onSnapshotPart(seqPart('s1',side,price,[oid],[q],100));
 a.onSnapshotPart(fin('s1'));
 for(let k=0;k<3;k++)a.onUpdate(upd([[2,1,7000,11+k,'a']],101+k));
 let s=a.status();assert.equal(s.syncMode,'SEQUENCED');assert.ok(a.sequenced);
 assert.equal(s.verifiedEligible,false);            // sequenced book has not seeded from its own snapshot yet
 assert.equal(a.refresh.label(),LABELS.DIAGNOSTIC);
 a.onUpdate(upd([[2,1,7000,20,'a']],null));          // sequence disappears
 s=a.status();assert.equal(s.syncMode,'UNSEQUENCED_REFRESH');assert.equal(s.downgrade.reason,'SEQUENCE_DISAPPEARED');
 assert.equal(a.sequenced,null);assert.equal(s.seqInvalidations.length,1);assert.equal(s.verifiedEligible,false);
 assert.equal(a.refresh.quality(),QUALITY.INVALID);assert.equal(a.refresh.stats().invalidReason,'SEQUENCE_DISAPPEARED');
 assert.equal(a.refresh.refreshDue(),true);assert.equal(a.refresh.orderCount,0);   // must reseed
 c.adv(15000);assert.equal(a.beginRefresh('s2'),true);sendSnap(a.refresh,'s2',BASE);assert.equal(a.refresh.quality(),QUALITY.SEEDED);
});

test('18D ruling 4: exchange timestamps never change placement',()=>{
 const c=clock(),b1=mk(c),b2=mk(c);for(const b of [b1,b2]){b.beginRefresh('s1');sendSnap(b,'s1',BASE)}
 const u=upd([[2,1,7000,15,'a']]);
 b1.onUpdate(u,{exchangeTime:{ns:5n,hasUsecs:true,hasNsecs:true}});b2.onUpdate(u,{exchangeTime:{ns:1n,hasUsecs:true,hasNsecs:true}});
 b1.onUpdate(upd([[2,1,7000,16,'a']]),{exchangeTime:{ns:1n,hasUsecs:true,hasNsecs:true}}); // older exchange time still applied in arrival order
 b2.onUpdate(upd([[2,1,7000,16,'a']]),{exchangeTime:{ns:9n,hasUsecs:true,hasNsecs:true}});
 assert.deepEqual(b1.liquidity().bid.rows,b2.liquidity().bid.rows);
 assert.equal(b1.stats().exchangeTime.usedForPlacement,false);assert.equal(b1.stats().exchangeTime.backwards,1);
});
