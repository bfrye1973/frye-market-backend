import test from "node:test";
import assert from "node:assert/strict";
import { WAVE_HISTORY_SCHEMA,validateWaveHistoryEvent,replayWaveHistory,chartNodeFromHistory } from "../logic/engine22/history/waveHistoryV1.js";
const original={schema:WAVE_HISTORY_SCHEMA,type:"WAVE_RECORDED",eventId:"event-1",waveId:"minor-w1-research",
 countId:"minor-research-20261105",modelVersion:"research.v1",revision:1,degree:"minor",
 parentWaveId:"intermediate-w3",lifecycle:"COMPLETION_CANDIDATE",
 approvalStatus:"RESEARCH_ONLY",sourceFingerprint:"owner-handoff-nov5",priceBasisId:"UNVERIFIED_ES_CONTINUOUS",
 contractSymbol:"ES",publishedAt:"2026-11-05T23:00:00Z",
 anchor:{label:"W1 END HIGH",price:7901.75,marketAt:"2026-08-14T10:00:00Z"},
 fibLevels:[],supersedesEventId:null};
const make = patches => structuredClone({...original,...patches});
test("research wave stays unapproved",()=>assert.equal(replayWaveHistory([make()]).waves[0].approvalStatus,"RESEARCH_ONLY"));
test("identical retry is idempotent",()=>assert.equal(replayWaveHistory([make(),make()]).eventCount,1));
test("conflicting duplicate ID fails",()=>assert.throws(()=>replayWaveHistory([make(),make({anchor:{...original.anchor,price:7902}})]),/CONFLICTING_EVENT_ID/));
test("revision updates work without deleting historical event",()=>{
 const next=make({eventId:"event-2",type:"WAVE_REVISED",revision:2,supersedesEventId:"event-1",anchor:{...original.anchor,price:7906.25}});
 const s=replayWaveHistory([make(),next]);assert.equal(s.eventCount,2);assert.equal(s.waves[0].anchor.price,7906.25);
});
test("out-of-order revision fails",()=>assert.throws(()=>replayWaveHistory([make({eventId:"event-2",revision:2,type:"WAVE_REVISED",supersedesEventId:"event-1"})]),/INITIAL_EVENT_MISSING/));
test("status-only change cannot rewrite pivot",()=>{
 const next=make({eventId:"event-2",type:"WAVE_STATUS_CHANGED",revision:2,supersedesEventId:"event-1",anchor:{...original.anchor,price:7906.25}});
 assert.throws(()=>replayWaveHistory([make(),next]),/STATUS_REWROTE_ANCHOR/);
});
test("research status cannot be claimed confirmed",()=>assert.throws(()=>validateWaveHistoryEvent(make({lifecycle:"CONFIRMED"})),/CONFIRMATION_REQUIRES_APPROVAL/));
test("missing historical timestamp is retained but cannot plot",()=>{
 const node=chartNodeFromHistory(make({anchor:{...original.anchor,marketAt:null}}));
 assert.equal(node.plotAllowed,false);assert.equal(node.reason,"MISSING_MARKET_TIMESTAMP");
});
test("approved historical anchor still requires ES view verification",()=>{
 const node=chartNodeFromHistory(make({approvalStatus:"OWNER_APPROVED"}));assert.equal(node.plotAllowed,false);
});
test("reject off-tick ES price",()=>assert.throws(()=>validateWaveHistoryEvent(make({anchor:{...original.anchor,price:7901.8}})),/ANCHOR/));
test("reject self parent",()=>assert.throws(()=>validateWaveHistoryEvent(make({parentWaveId:"minor-w1-research"})),/SELF_PARENT/));
