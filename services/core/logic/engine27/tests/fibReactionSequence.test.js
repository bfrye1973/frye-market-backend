import test from "node:test";
import assert from "node:assert/strict";
import {studyFibReactionSequence} from "../waveObservation/studyFibReactionSequence.js";
const asOf="2026-10-28T19:00:00Z";
const levels=[{key:"r382",label:"0.382",price:7770,status:"TOUCHED",touchedAt:"2026-10-28T17:00:00Z"},
 {key:"r500",label:"0.500",price:7760,status:"WATCH"},
 {key:"r618",label:"0.618",price:7750,status:"WATCH"},
 {key:"r786",label:"0.786",price:7740,status:"WATCH"}];
const bars=[
 {open:7775,high:7778,low:7757,close:7766,closedAt:"2026-10-28T18:10:00Z",completed:true},
 {open:7766,high:7768,low:7748,close:7762,closedAt:"2026-10-28T18:20:00Z",completed:true}
];
test("collects all levels touched, including wick-only 0.618 and reclaim",()=>{
 const r=studyFibReactionSequence({bars,levels,asOf,direction:"DOWN"});
 assert.equal(r.available,true);
 assert.deepEqual(r.contacts.filter(x=>x.closedAt===bars[1].closedAt).map(x=>x.key),["r618","r500"]);
 const touch=r.contacts.find(x=>x.key==="r618");
 assert.equal(touch.wickOnly,true);
 assert.equal(touch.reclaimedUp,true);
 assert.equal(touch.officialStatus,"WATCH");
 assert.equal(r.deepestRatioReached.ratio,.618);
});
test("does not invent order among multiple fib levels within one candle",()=>{
 const r=studyFibReactionSequence({bars,levels,asOf,direction:"DOWN"});
 assert.equal(r.intrabarOrderKnown,false);
 assert.equal(r.exactLastIntrabarContact,null);
 assert.equal(r.lastContactCandidates.length,2);
});
test("rejects forming, future and contradictory candle geometry",()=>{
 assert.equal(studyFibReactionSequence({bars:[{...bars[0],completed:false}],levels,asOf,direction:"UP"}).available,false);
 assert.equal(studyFibReactionSequence({bars:[{...bars[0],closedAt:"2026-10-28T21:00:00Z"}],levels,asOf,direction:"UP"}).available,false);
 assert.equal(studyFibReactionSequence({bars:[{...bars[0],low:7790}],levels,asOf,direction:"UP"}).available,false);
});
test("no contact is a valid observation, no asserted completion",()=>{
 const r=studyFibReactionSequence({bars:[{open:7801,high:7805,low:7798,close:7802,closedAt:"2026-10-28T18:10:00Z",completed:true}],levels,asOf,direction:"DOWN"});
 assert.equal(r.available,true);assert.equal(r.contacts.length,0);assert.equal(r.completionConfirmed,false);
});
