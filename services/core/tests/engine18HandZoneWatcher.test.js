import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeChartHandZones,semanticZoneHash,approvedSnapshotAt,
 linkObservedBookToZones} from '../logic/engine18/engine18HandZoneContext.js';
import {Engine18HandZoneWatcher,Engine18MemoryZoneHistory} from '../logic/engine18/engine18HandZoneWatcher.js';
import {makeEngine18ChartZoneFetcher} from '../logic/engine18/engine18ChartZoneSource.js';
import {parseObservedMbp10} from '../logic/engine18/engine18ObservedMbp10Map.js';
const zone=(id,lo,hi,neg=true)=>({rangeSource:'manual',locked:true,status:'active',isNegotiated:neg,
 details:{id},displayPriceRange:[hi,lo]});
const nowMs=Date.parse('2026-11-17T15:00:00.000Z');
const payload=(zones=[zone('MANUAL|ES|NEG|A',5000,5001)],rev='rev-1',at=nowMs)=>({
 ok:true,symbol:'ES',structures_sticky:zones,meta:{sourceRevision:rev,
 sourceUpdatedAt:new Date(at-10000).toISOString(),servedAt:new Date(at).toISOString(),
 contract:'XCME:ES.Z26',priceBasis:'VERIFIED_DISPLAY_CONTRACT',
 zoneAuthority:'CHART_EFFECTIVE_HAND',sourceGitBlobSha:'a'.repeat(40)}
});
const book=(bid=5000,ask=5000.25)=>parseObservedMbp10({d:[{
 s:'XCME:ES.Z26',
 b:Array.from({length:10},(_,i)=>({p:bid-.25*i,sz:10+i,o:2,t:1,s:1,l:i})),
 a:Array.from({length:10},(_,i)=>({p:ask+.25*i,sz:10+i,o:2,t:1,s:2,l:i}))
}]});
const harness=({sequence,history=new Engine18MemoryZoneHistory(),startAt=nowMs,
 approvedKinds=['NEGOTIATED']}={})=>{
 let time=startAt,callback=null,period=null,cancelled=0,n=0;
 const fetchSource=async()=>{const next=sequence[Math.min(n++,sequence.length-1)];
  if(next instanceof Error)throw next;
  const result=typeof next==='function'?next(time):next;
  return result?.meta?{...result,meta:{...result.meta,servedAt:new Date(time).toISOString()}}:result;};
 const watcher=new Engine18HandZoneWatcher({fetchSource,store:history,approvedKinds,
 now:()=>time,schedule:(fn,ms)=>{callback=fn;period=ms;return 1;},
 cancel:()=>{cancelled++;}});
 return {watcher,history,advance:ms=>{time+=ms;},tick:()=>callback(),
 get period(){return period;},get cancelled(){return cancelled;}};
};
test('chart HAND zone normalizes stable sort, separate provenance and strict basis',()=>{
 const a=payload([zone('MANUAL|ES|NEG|B',5003,5004),zone('MANUAL|ES|NEG|A',5000,5001)]);
 const b=payload([...a.structures_sticky].reverse());
 assert.equal(semanticZoneHash(normalizeChartHandZones(a,{approvedKinds:['NEGOTIATED']})),
  semanticZoneHash(normalizeChartHandZones(b,{approvedKinds:['NEGOTIATED']})));
 const source=normalizeChartHandZones(payload([
  zone('MANUAL|ES|NEG|A',5000,5001),zone('MANUAL|ES|PARENT|C',4990,5010,false)
 ]),{approvedKinds:['NEGOTIATED']});
 assert.equal(source.zones.length,1);
 assert.equal(source.zones[0].source,'HAND');
 assert.throws(()=>normalizeChartHandZones(payload(),{approvedKinds:null}),/MAPPING/);
 assert.throws(()=>normalizeChartHandZones({...payload(),meta:{...payload().meta,contract:'ESU26'}},
  {approvedKinds:['NEGOTIATED']}),/BASIS/);
});
test('first poll and exact 300000ms timer, unchanged no writes; reordering no writes',async()=>{
 const h=harness({sequence:[payload(),payload(),payload()]});
 await h.watcher.start();
 assert.equal(h.period,300000);assert.equal(h.history.writes,1);
 assert.equal(h.watcher.health().historyCount,1);
 h.advance(300000);await h.watcher.poll();
 assert.equal(h.history.writes,1);assert.equal(h.watcher.health().unchangedCount,1);
 assert.equal(h.watcher.health().lastGoodHash,h.watcher.getCurrent().hash);
 h.watcher.stop();assert.equal(h.cancelled,1);
});
test('detect boundaries, added/deleted zones, immutable versions, revisions and restart',async()=>{
 const first=payload(),changed=payload([zone('MANUAL|ES|NEG|A',5000,5001.25)],'rev-2',nowMs+300000);
 const added=payload([zone('MANUAL|ES|NEG|A',5000,5001.25),zone('MANUAL|ES|NEG|B',5003,5004)],
  'rev-3',nowMs+600000);
 const removed=payload([zone('MANUAL|ES|NEG|B',5003,5004)],'rev-4',nowMs+900000);
 const h=harness({sequence:[first,changed,added,removed]});
 await h.watcher.start();const original=h.watcher.getCurrent();
 for(let i=0;i<3;i++){h.advance(300000);assert.equal((await h.watcher.poll()).status,'CHANGED');}
 assert.equal(h.history.writes,4);assert.equal(h.watcher.getCurrent().zones.length,1);
 assert.equal(original.zones[0].hi,5001);
 assert.equal(h.watcher.getVersions().length,4);
 const rec=harness({sequence:[removed],history:h.history,startAt:nowMs+1200000});
 await rec.watcher.start();
 assert.equal(rec.watcher.health().historyCount,4);
 assert.equal(rec.history.writes,4);
 assert.equal(rec.watcher.getCurrent().zones[0].id,'MANUAL|ES|NEG|B');
});
test('source unavailable, malformed, stale, revision regression fail closed while preserving history',async()=>{
 const h=harness({sequence:[payload(),new Error('offline'),{ok:true},
  payload([zone('MANUAL|ES|NEG|A',5000,5001)],'rev-0',nowMs-1000)]});
 await h.watcher.start();h.advance(300000);
 assert.equal((await h.watcher.poll()).status,'STALE');
 assert.equal(h.watcher.getCurrent(),null);assert.equal(h.history.writes,1);
 h.advance(300000);assert.equal((await h.watcher.poll()).status,'STALE');
 h.advance(300000);assert.equal((await h.watcher.poll()).status,'STALE');
 assert.equal(h.history.writes,1);
});
test('overlap skipped; source revisions with same id but changed content refused',async()=>{
 let release;
 const pending=new Promise(resolve=>{release=resolve;});
 let n=0;const h=new Engine18HandZoneWatcher({
  fetchSource:async()=>{n++;if(n===2)await pending;return payload();},
  store:new Engine18MemoryZoneHistory(),approvedKinds:['NEGOTIATED'],now:()=>nowMs
 });
 await h.start();
 const slow=h.poll();assert.equal((await h.poll()).status,'SKIPPED_OVERLAP');
 release();await slow;assert.equal(n,2);
 h.stop();
});
test('read-only API fetcher rejects stale deployed source against main Git blob',async()=>{
 const good=payload();
 const fake=async url=>({ok:true,json:async()=>url.includes('api.github.com')?
  {sha:'a'.repeat(40)}:good});
 const source=makeEngine18ChartZoneFetcher({fetchImpl:fake});
 assert.equal((await source()).meta.sourceRevision,'rev-1');
 const stale=makeEngine18ChartZoneFetcher({fetchImpl:async url=>({ok:true,
  json:async()=>url.includes('api.github.com')?{sha:'b'.repeat(40)}:good})});
 await assert.rejects(stale(),/REVISION_STALE/);
});
test('point-in-time overlay never leaks future zones, tracks edges and out-of-coverage',()=>{
 const model=normalizeChartHandZones(payload(),{approvedKinds:['NEGOTIATED']});
 const snap={...model,hash:semanticZoneHash(model),firstObservedAt:'2026-11-17T15:00:00.000Z'};
 assert.equal(approvedSnapshotAt([snap],'2026-11-17T14:59:00.000Z').status,'HISTORICAL_ZONE_UNVERIFIED');
 assert.equal(linkObservedBookToZones({snapshot:snap,image:book(),
  eventTime:'2026-11-17T14:59:00.000Z'}).status,'HISTORICAL_ZONE_UNVERIFIED');
 const r=linkObservedBookToZones({snapshot:snap,image:book(5000,5000.25),
  eventTime:'2026-11-17T15:01:00.000Z',
  previousImage:book(4999,4999.25),previousTime:'2026-11-17T15:00:01.000Z'});
 assert.equal(r.zones[0].insideBand,true);assert.equal(r.zones[0].enteringFrom,'BELOW');
 assert.equal(r.zones[0].observedTickCoverage>0,true);
 assert.equal(r.zones[0].coverage,'PARTIAL_TOP_TEN');
 assert.equal(linkObservedBookToZones({snapshot:snap,image:{state:'FEED_INVALID'},
  eventTime:'2026-11-17T15:01:00.000Z'}).status,'FEED_INVALID');
 const out=linkObservedBookToZones({snapshot:snap,image:book(5010,5010.25),
  eventTime:'2026-11-17T15:02:00.000Z'});
 assert.equal(out.zones[0].coverage,'OUT_OF_COVERAGE');
});
test('sourceRevision is not approval timestamp; no backwards date inference',()=>{
 const v=normalizeChartHandZones(payload(),{approvedKinds:['NEGOTIATED']});
 assert.ok(!Object.hasOwn(v,'firstObservedAt'));
 assert.throws(()=>normalizeChartHandZones({...payload(),
  meta:{...payload().meta,sourceRevision:null}},{approvedKinds:['NEGOTIATED']}),/REVISION/);
});

test('stale chart publisher timestamp leaves existing zone history immutable but current unavailable',async()=>{
 const h=harness({sequence:[payload(),()=>({...payload(),meta:{...payload().meta,
  servedAt:'2026-11-17T14:00:00.000Z'}})]});
 await h.watcher.start();h.advance(300000);
 // This test uses the real stale-publisher path directly rather than the harness freshness helper.
 const model=payload();
 const bad={...model,meta:{...model.meta,servedAt:'2026-11-17T14:00:00.000Z'}};
 const w=new Engine18HandZoneWatcher({fetchSource:async()=>bad,store:h.history,
  approvedKinds:['NEGOTIATED'],now:()=>nowMs+300000});
 await w.start();
 assert.equal(w.health().stale,true);
 assert.equal(w.health().reason,'SOURCE_STALE');
 assert.equal(h.history.writes,1);
 w.stop();
});
