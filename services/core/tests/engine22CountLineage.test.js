import test from "node:test";
import assert from "node:assert/strict";
import {projectEngine22CountLineage as replay} from "../logic/engine22/history/projectCountLineage.js";
const common={instrumentContextId:"ES-CONTINUOUS-V1",degree:"MICRO"};
const e=(type,index,other={})=>({
 ...common,type,eventId:"event-"+index,idempotencyKey:"key-"+index,
 countId:"MICRO-V2-ORIGINAL-ID-771",revision:0,
 occurredAt:new Date(Date.UTC(2026,9,26,13,index)).toISOString(),...other
});
test("keeps original Micro V2 identity, count revision, and original provenance",()=>{
 const events=[e("COUNT_IMPORTED",0,{provenance:"MICRO_V2_ORIGINAL"}),
   e("OBSERVATION",1),e("COUNT_REVISED",2,{revision:1}),e("OBSERVATION",3,{revision:1})];
 const result=replay({...common,events});
 assert.equal(result.ok,true);assert.equal(result.counts[0].countId,"MICRO-V2-ORIGINAL-ID-771");
 assert.equal(result.counts[0].revision,1);assert.equal(result.counts[0].observations,2);
 assert.equal(result.counts[0].provenance,"MICRO_V2_ORIGINAL");
 assert.equal(result.activeCountId,null);
});
test("replayed duplicate idempotency key cannot duplicate history",()=>{
 const original=e("COUNT_IMPORTED",0);
 const result=replay({...common,events:[original,{...original}]});
 assert.equal(result.ok,true);assert.equal(result.eventsAccepted,1);
});
test("conflicting replay idempotency rejected",()=>{
 const a=e("COUNT_IMPORTED",0),b={...a,revision:1};
 assert.equal(replay({...common,events:[a,b]}).reason,"IDEMPOTENCY_CONFLICT");
});
test("revision jumps, out-of-order times and synthetic IDs rejected",()=>{
 assert.equal(replay({...common,events:[e("COUNT_IMPORTED",0),e("COUNT_REVISED",1,{revision:3})]}).reason,"REVISION_GAP_OR_REWRITE");
 assert.equal(replay({...common,events:[e("COUNT_IMPORTED",2),e("OBSERVATION",1)]}).reason,"OUT_OF_ORDER_EVENT");
 assert.equal(replay({...common,events:[e("COUNT_IMPORTED",0,{countId:"ES-V3-BASELINE-MICRO"})]}).reason,"SYNTHETIC_BASELINE_NOT_HISTORICAL_PROOF");
});
test("cross-degree and foreign count events cannot pollute current history",()=>{
 assert.equal(replay({...common,events:[e("COUNT_IMPORTED",0,{degree:"MINUTE"})]}).ok,false);
 assert.equal(replay({...common,events:[e("OBSERVATION",0)]}).reason,"UNKNOWN_COUNT_ID");
});
test("superseded identity preserved, later revisions refused",()=>{
 const events=[e("COUNT_IMPORTED",0),e("COUNT_REVISED",1,{revision:1}),
  e("COUNT_SUPERSEDED",2,{revision:1})];
 const done=replay({...common,events});
 assert.equal(done.ok,true);assert.equal(done.counts[0].superseded,true);
 assert.equal(replay({...common,events:[...events,e("COUNT_REVISED",3,{revision:2})]}).reason,"SUPERSEDED_COUNT_REVISION_BLOCKED");
});
test("caller records remain immutable",()=>{
 const events=[e("COUNT_IMPORTED",0),e("OBSERVATION",1)];
 const saved=structuredClone(events);replay({...common,events});assert.deepEqual(events,saved);
});
