import test from "node:test";
import assert from "node:assert/strict";
import {NODE_EVENT_SCHEMA,validateNodeIdentityEvent,replayNodeIdentityEvents} from "../logic/engine22/history/nodeIdentityLedgerV1.js";
const base={schema:NODE_EVENT_SCHEMA,type:"NODE_RECORDED",eventId:"e-primary-1",nodeId:"p-w4-low",
 waveId:"p-w4",countId:"primary-owner",modelVersion:"primary.v1",degree:"primary",
 parentWaveId:null,sourceReference:"sheet-primary-row6",sourceFingerprint:"owner-2025",
 priceBasisId:"ES_UNADJUSTED_REQUIRES_VERIFICATION",contractSymbol:"ES",label:"W4 LOW",
 marketAt:"2025-04-09T14:00:00Z",publishedAt:"2026-11-08T19:00:00Z",price:5182,
 approvalStatus:"OWNER_APPROVED",lifecycle:"LOCKED",revision:1,
 supersedesEventId:null,supersedesNodeId:null};
const clone=(x,overrides={})=>({...structuredClone(x),...overrides});
const primary=()=>clone(base);
const child=()=>clone(base,{eventId:"e-intermediate-1",nodeId:"i-w2-low",waveId:"i-w2",countId:"primary-owner",
 degree:"intermediate",parentWaveId:"p-w4",label:"W2 LOW",price:6407,
 marketAt:"2026-03-30T10:00:00Z",modelVersion:"intermediate.v1",lifecycle:"CONFIRMED"});
test("permanent node record validates ES tick and explicit market/publication times",()=>{
 const e=validateNodeIdentityEvent(primary());
 assert.equal(e.nodeId,"p-w4-low");assert.equal(e.price,5182);
 assert.equal(e.publishedAt,"2026-11-08T19:00:00Z");
 assert.equal(e.marketAt,"2025-04-09T14:00:00Z");
});
test("separate parent degree and permanent node history stay intact",()=>{
 const result=replayNodeIdentityEvents([primary(),child()]);
 assert.equal(result.nodes.length,2);
 assert.equal(result.history.length,2);
 assert.equal(result.plotAllowed,false);
 assert.equal(result.noPermissionCreated,true);
});
test("idempotent repeated same event is not duplicated",()=>{
 assert.equal(replayNodeIdentityEvents([primary(),primary()]).eventCount,1);
});
test("conflicting duplicate event id rejects",()=>{
 assert.throws(()=>replayNodeIdentityEvents([primary(),clone(base,{price:5182.25})]),/EVENT_ID_CONFLICT/);
});
test("revision preserves the previous event and cannot mutate node identity",()=>{
 const changed=clone(base,{eventId:"e-primary-2",type:"NODE_STATUS_CHANGED",revision:2,
 supersedesEventId:base.eventId,approvalStatus:"SUPERSEDED",lifecycle:"SUPERSEDED"});
 const history=replayNodeIdentityEvents([primary(),changed]).history[0].revisions;
 assert.equal(history.length,2);assert.equal(history[0].lifecycle,"LOCKED");assert.equal(history[1].lifecycle,"SUPERSEDED");
 assert.throws(()=>replayNodeIdentityEvents([primary(),{...changed,countId:"different-count"}]),/IDENTITY_MUTATION/);
});
test("status-only cannot rewrite a pivot",()=>{
 const changed=clone(base,{eventId:"e-primary-2",type:"NODE_STATUS_CHANGED",revision:2,
 supersedesEventId:base.eventId,price:5182.25});
 assert.throws(()=>replayNodeIdentityEvents([primary(),changed]),/STATUS_REWROTE_ANCHOR/);
});
test("recount uses new count identity and explicit supersedes node",()=>{
 const old=clone(base,{eventId:"e-minor-old",nodeId:"minor-old",waveId:"minor-w1",countId:"minor-old-count",
 degree:"minor",parentWaveId:null,approvalStatus:"RESEARCH",lifecycle:"DEVELOPING",modelVersion:"minor-old.v1"});
 const newer=clone(old,{eventId:"e-minor-new",nodeId:"minor-new",countId:"minor-new-count",
 modelVersion:"minor-new.v1",supersedesNodeId:"minor-old",publishedAt:"2026-11-08T20:00:00Z"});
 const result=replayNodeIdentityEvents([old,newer]);
 assert.equal(result.eventCount,2);
 assert.equal(result.nodes.find(n=>n.nodeId==="minor-new").supersedesNodeId,"minor-old");
 assert.throws(()=>replayNodeIdentityEvents([old,{...newer,countId:"minor-old-count"}]),/SUPERSESSION_REQUIRES_NEW_COUNT/);
});
test("missing AZ coordinate remains nullable research but cannot be locked",()=>{
 const uncertain=clone(base,{marketAt:null,approvalStatus:"RESEARCH",lifecycle:"DEVELOPING",price:7325});
 assert.equal(validateNodeIdentityEvent(uncertain).marketAt,null);
 assert.throws(()=>validateNodeIdentityEvent({...uncertain,lifecycle:"LOCKED"}),/CONFIRMATION_REQUIRES_OWNER_APPROVAL_AND_TIME/);
});
test("price tick and parent reference safety",()=>{
 assert.throws(()=>validateNodeIdentityEvent(clone(base,{price:7321.7})),/PRICE_TICK/);
 assert.throws(()=>validateNodeIdentityEvent(clone(base,{parentWaveId:base.waveId})),/PARENT/);
});
test("child cannot be same or higher degree than known parent",()=>{
 const bad=clone(child(),{degree:"primary",nodeId:"other-primary",eventId:"e-other-primary"});
 assert.throws(()=>replayNodeIdentityEvents([primary(),bad]),/PARENT_DEGREE_ORDER/);
});
test("historical publication cannot be silently backdated by validation",()=>{
 const historical=clone(base,{eventId:"historical",nodeId:"historical",modelVersion:"archive.v1",
 publishedAt:"2026-11-08T20:00:00Z",marketAt:"2020-04-02T15:00:00Z",approvalStatus:"RESEARCH",
 lifecycle:"DEVELOPING"});
 const x=replayNodeIdentityEvents([historical]);
 assert.notEqual(x.nodes[0].publishedAt,x.nodes[0].marketAt);
});
