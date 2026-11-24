import test from "node:test";
import assert from "node:assert/strict";
import {attestCompleted5mBreakout as attest} from "../logic/engine3/v6/attestCompleted5mBreakout.js";
const t=Date.parse("2026-11-24T15:00:00Z"),m=60000;
const zone={low:7138,high:7210.75,midline:7174.5};
const b=(open,close,high,low,closeTimeMs)=>({open,close,high,low,closeTimeMs});
const touch=b(7204,7208,7210,7200,t-5*m);
const long=b(7213,7220,7224,7212,t);
const shortTouch=b(7142,7140,7146,7138,t-5*m);
const short=b(7134,7130,7135,7129,t);
const run=(bars,dir="LONG",more={})=>attest({
 completed5mEligible:bars,zone,direction:dir,
 activationStartedAtMs:t-11*m,evaluationTimeMs:t,...more});
test("full-body LONG outside zone is attested only after completed authorized interaction",()=>{
 const x=run([touch,long]);
 assert.equal(x.status,"VERIFIED_COMPLETED_5M_BREAK");
 assert.equal(x.breakoutContext.direction,"LONG");
 assert.equal(x.breakoutContext.edge,7210.75);
 assert.equal(x.breakoutContext.source,"COMPLETED_5M_FULL_BODY_BREAK");
 assert.equal(x.noPermissionCreated,true);
});
test("symmetric full-body SHORT is attested",()=>{
 const x=run([shortTouch,short],"SHORT");
 assert.equal(x.status,"VERIFIED_COMPLETED_5M_BREAK");
 assert.equal(x.breakoutContext.edge,7138);
});
test("partial-body LONG crossing upper edge cannot attest",()=>{
 assert.equal(run([touch,b(7209,7220,7224,7207,t)]).breakoutContext,null);
});
test("wick-only zone edge break cannot attest",()=>{
 assert.equal(run([touch,b(7208,7209,7216,7206,t)]).breakoutContext,null);
});
test("bar closed after evaluation is unavailable",()=>{
 assert.equal(run([touch,b(7213,7220,7224,7212,t+m)]).breakoutContext,null);
});
test("predirector bar closed before authorization is unavailable",()=>{
 assert.equal(run([touch,long],"LONG",{activationStartedAtMs:t-m}).breakoutContext,null);
});
test("no preceding zone interaction cannot attest body breakout",()=>{
 assert.equal(run([b(7240,7245,7248,7238,t-5*m),long]).breakoutContext,null);
});
test("no side or missing authorization does not attest",()=>{
 assert.equal(run([touch,long],"NEUTRAL").breakoutContext,null);
 assert.equal(run([touch,long],"LONG",{activationStartedAtMs:null}).breakoutContext,null);
});
