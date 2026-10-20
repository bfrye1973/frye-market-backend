import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createEngine6ApprovedPaperPermissionLock } from "../logic/engine6/6d-paper-permission/buildApprovedPaperPermissionLock.js";
const stamp="2026-10-20T17:30:00.000Z";
const factory=()=>createEngine6ApprovedPaperPermissionLock(()=>stamp);
const approved=(direction="SHORT")=>({permission:"ALLOW",paper:{decision:"FAST_INTRADAY_PAPER_ALLOW",allowed:true,paperAllowed:true,direction,candidateId:"C1",zoneId:"Z1",reasonCodes:["ORIGINAL"]}});
test("no remembered GO returns the original object without mutation",()=>{
 const lock=factory();const p={permission:"STAND_DOWN",paper:{allowed:false}};
 assert.equal(lock.applyEngine6ApprovedPaperPermissionLock(p),p);
});
test("approval deep-copies and restores exactly the existing PAPER fields",()=>{
 const lock=factory();const p=approved();lock.rememberEngine6ApprovedPaperPermission(p);
 p.paper.reasonCodes.push("LATER_MUTATION");
 const out=lock.applyEngine6ApprovedPaperPermissionLock({permission:"STAND_DOWN",paper:{decision:"WAIT",allowed:false,warnings:["W1"]}});
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
 a.rememberEngine6ApprovedPaperPermission({paper:{...approved().paper,allowed:false}});
 const p={permission:"WAIT"};
 assert.equal(a.applyEngine6ApprovedPaperPermissionLock(p),p);
 a.rememberEngine6ApprovedPaperPermission(approved());
 assert.equal(b.applyEngine6ApprovedPaperPermissionLock(p),p);
 assert.notEqual(a.applyEngine6ApprovedPaperPermissionLock(p),p);
});
test("a later qualifying GO replaces the existing same-invocation lock",()=>{
 const lock=factory();lock.rememberEngine6ApprovedPaperPermission(approved("SHORT"));
 lock.rememberEngine6ApprovedPaperPermission({...approved("LONG"),paper:{...approved("LONG").paper,candidateId:"C2"}});
 const out=lock.applyEngine6ApprovedPaperPermissionLock({paper:{}});
 assert.equal(out.paper.direction,"LONG");assert.equal(out.paper.candidateId,"C2");
 assert.equal(out.paper.paperLongAllowed,true);assert.equal(out.paper.paperShortAllowed,false);
});
test("snapshot now delegates exactly two existing calls to the factory",()=>{
 const source=readFileSync(new URL("../jobs/buildStrategySnapshot.js",import.meta.url),"utf8");
 assert.match(source,/createEngine6ApprovedPaperPermissionLock\(nowIso\)/);
 assert.equal((source.match(/rememberEngine6ApprovedPaperPermission\(/g)||[]).length,2);
 assert.equal((source.match(/applyEngine6ApprovedPaperPermissionLock\(/g)||[]).length,2);
 assert.equal(source.includes("let engine6ApprovedPaperPermissionLock = null;"),false);
});
