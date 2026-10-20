import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createEngine6ApprovedPaperPermissionLock } from "../logic/engine6/6d-paper-permission/buildApprovedPaperPermissionLock.js";
const stamp="2026-10-20T17:30:00.000Z";
const factory=()=>createEngine6ApprovedPaperPermissionLock(()=>stamp);
const candidate=(overrides={})=>({candidateId:"C1",zoneId:"Z1",active:true,status:"ACTIVE",candidateLifecycleStartTime:"L1",...overrides});
const context=(c=candidate(),h={})=>({candidate:c,reactionHandoff:{candidateId:c.candidateId,zoneId:c.zoneId,evaluationAuthorized:true,...h}});
const approved=(direction="SHORT")=>({permission:"ALLOW",paper:{decision:"FAST_INTRADAY_PAPER_ALLOW",allowed:true,paperAllowed:true,direction,candidateId:"C1",zoneId:"Z1",reasonCodes:["ORIGINAL"]}});
test("no remembered GO returns the original object without mutation",()=>{
 const lock=factory();const p={permission:"STAND_DOWN",paper:{allowed:false}};
 assert.equal(lock.applyEngine6ApprovedPaperPermissionLock(p),p);
});
test("approval deep-copies and restores exactly the existing PAPER fields",()=>{
 const lock=factory();const p=approved();lock.rememberEngine6ApprovedPaperPermission(p,context());
 p.paper.reasonCodes.push("LATER_MUTATION");
 const out=lock.applyEngine6ApprovedPaperPermissionLock({permission:"STAND_DOWN",paper:{decision:"WAIT",allowed:false,warnings:["W1"]}},context());
 assert.equal(out.permission,"REDUCE");
 assert.equal(out.paper.decision,"FAST_INTRADAY_PAPER_ALLOW");
 assert.equal(out.paper.allowed,true);assert.equal(out.paper.paperAllowed,true);
 assert.equal(out.paper.locked,true);assert.equal(out.paper.lockedAt,stamp);
 assert.equal(out.paper.paperShortAllowed,true);assert.equal(out.paper.paperLongAllowed,false);
 assert.equal(out.paper.candidateId,"C1");assert.equal(out.paper.zoneId,"Z1");
 assert.deepEqual(out.paper.blockers,[]);
 assert.deepEqual(out.paper.reasonCodes,["ORIGINAL","ENGINE6_APPROVED_PERMISSION_LOCK_ACTIVE","DOWNSTREAM_PERMISSION_DOWNGRADE_BLOCKED"]);
 assert.deepEqual(out.paper.warnings,["W1","ENGINE6_APPROVED_PERMISSION_LOCK_ACTIVE"]);
 assert.equal(out.realExecutionAllowed,false);assert.equal(out.paper.brokerExecutionAllowed,false);
});
test("invalid GO is ignored; each invocation has independent lock lifetime",()=>{
 const a=factory(),b=factory();
 a.rememberEngine6ApprovedPaperPermission({paper:{...approved().paper,allowed:false}},context());
 const p={permission:"WAIT"};
 assert.equal(a.applyEngine6ApprovedPaperPermissionLock(p,context()),p);
 a.rememberEngine6ApprovedPaperPermission(approved(),context());
 assert.equal(b.applyEngine6ApprovedPaperPermissionLock(p,context()),p);
 assert.notEqual(a.applyEngine6ApprovedPaperPermissionLock(p,context()),p);
});
test("a later qualifying GO replaces the existing same-invocation lock",()=>{
 const lock=factory();lock.rememberEngine6ApprovedPaperPermission(approved("SHORT"),context());
 lock.rememberEngine6ApprovedPaperPermission({...approved("LONG"),paper:{...approved("LONG").paper,candidateId:"C2"}},context(candidate({candidateId:"C2"})));
 const out=lock.applyEngine6ApprovedPaperPermissionLock({paper:{}},context(candidate({candidateId:"C2"})));
 assert.equal(out.paper.direction,"LONG");assert.equal(out.paper.candidateId,"C2");
 assert.equal(out.paper.paperLongAllowed,true);assert.equal(out.paper.paperShortAllowed,false);
});
test("snapshot delegates one final approval call after Stage4 classification",()=>{
 const source=readFileSync(new URL("../jobs/buildStrategySnapshot.js",import.meta.url),"utf8");
 assert.match(source,/createEngine6ApprovedPaperPermissionLock\(nowIso\)/);
 assert.equal((source.match(/rememberEngine6ApprovedPaperPermission\(/g)||[]).length,1);
 assert.equal((source.match(/applyEngine6ApprovedPaperPermissionLock\(/g)||[]).length,2);
 assert.equal(source.includes("let engine6ApprovedPaperPermissionLock = null;"),false);
});

test("same candidate repeated recalculation preserves GO",()=>{const l=factory();l.rememberEngine6ApprovedPaperPermission(approved(),context());for(let i=0;i<3;i++)assert.equal(l.applyEngine6ApprovedPaperPermissionLock({paper:{allowed:false}},context()).paper.allowed,true);});
test("different candidate or zone cannot inherit GO",()=>{const l=factory();l.rememberEngine6ApprovedPaperPermission(approved(),context());for(const c of [candidate({candidateId:"C2"}),candidate({zoneId:"Z2"})]){const p={paper:{allowed:false}};assert.equal(l.applyEngine6ApprovedPaperPermissionLock(p,context(c)),p);}});
test("invalidation and current completion reject old GO",()=>{const l=factory();l.rememberEngine6ApprovedPaperPermission(approved(),context());for(const c of [candidate({invalidatedAt:stamp}),candidate({status:"COMPLETED"}),candidate({invalidationFacts:{completedCloseInvalidationConfirmed:true}}),candidate({zoneMemorySummary:{currentCandidateId:"C1",lifecycleStatus:"COMPLETED"}})]){const p={paper:{allowed:false}};assert.equal(l.applyEngine6ApprovedPaperPermissionLock(p,context(c)),p);}});
test("historical memory completion does not block fresh active candidate",()=>{const l=factory();const c=candidate({zoneMemorySummary:{currentCandidateId:"OLD",objectiveCompletedAt:stamp,lifecycleStatus:"COMPLETED"}});l.rememberEngine6ApprovedPaperPermission(approved(),context(c));assert.equal(l.applyEngine6ApprovedPaperPermissionLock({paper:{}},context(c)).paper.allowed,true);});
test("generation mismatch rejects restoration; revoked reaction authorization preserves existing GO",()=>{const l=factory();l.rememberEngine6ApprovedPaperPermission(approved(),context());const p={paper:{allowed:false}};assert.equal(l.applyEngine6ApprovedPaperPermissionLock(p,context(candidate({candidateLifecycleStartTime:"L2"}))),p);assert.equal(l.applyEngine6ApprovedPaperPermissionLock(p,context(candidate(),{evaluationAuthorized:false})).paper.allowed,true);});
test("fresh candidate can independently remember own GO",()=>{const l=factory();l.rememberEngine6ApprovedPaperPermission(approved(),context());const c=candidate({candidateId:"C2"});const p={...approved(),paper:{...approved().paper,candidateId:"C2"}};l.rememberEngine6ApprovedPaperPermission(p,context(c));assert.equal(l.applyEngine6ApprovedPaperPermissionLock({paper:{}},context(c)).paper.candidateId,"C2");});

test("new GO without current Engine26A reaction authorization is rejected",()=>{const l=factory();l.rememberEngine6ApprovedPaperPermission(approved(),context(candidate(),{evaluationAuthorized:false}));const p={paper:{allowed:false}};assert.equal(l.applyEngine6ApprovedPaperPermissionLock(p,context()),p);});
test("weakened context and normal inactive transition do not revoke already approved candidate",()=>{const l=factory();l.rememberEngine6ApprovedPaperPermission(approved(),context());const c=candidate({active:false,status:"TRAVELING"});const p={paper:{allowed:false},marketPressure:"WEAKENING"};const o=l.applyEngine6ApprovedPaperPermissionLock(p,context(c,{evaluationAuthorized:false}));assert.equal(o.paper.allowed,true);assert.equal(o.paper.direction,"SHORT");});
test("new candidate with terminal status cannot remember approval",()=>{const l=factory();l.rememberEngine6ApprovedPaperPermission(approved(),context(candidate({status:"COMPLETED"})));const p={paper:{allowed:false}};assert.equal(l.applyEngine6ApprovedPaperPermissionLock(p,context()),p);});
