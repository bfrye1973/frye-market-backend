import test from "node:test";
import assert from "node:assert/strict";
import {ENGINE22_SEVEN_DEGREES, inspectSevenDegreeDisplay} from "../logic/engine22/research/inspectSevenDegreeDisplayV1.js";

test("all seven independently available even when source omits degrees", () => {
 const out=inspectSevenDegreeDisplay({degrees:{micro:{levels:[]}}});
 assert.equal(Object.keys(out.degrees).length,7);
 assert.deepEqual(Object.keys(out.degrees),ENGINE22_SEVEN_DEGREES);
 assert.equal(out.degrees.subminute.available,false);
 assert.equal(out.degrees.micro.available,true);
 assert.deepEqual(out.degrees.micro.reasonCodes,["NO_PRICE_BEARING_LEVELS","TOUCH_EVIDENCE_UNAVAILABLE"]);
});
test("price alone cannot forge a verified touch",()=>{
 const result=inspectSevenDegreeDisplay({degrees:{micro:{levels:[{key:"r618",price:7800,status:"TOUCHED"}]}}});
 const row=result.degrees.micro.levels[0];
 assert.equal(row.reportedStatus,"TOUCHED");
 assert.equal(row.status,"WATCH");
 assert.equal(row.evidenceStatus,"REPORTED_TOUCH_UNVERIFIED");
});
test("verified source metadata permits display of Engine22-published touch only",()=>{
 const evidence={activeWave:"W2",modelKey:"m1",sourceCountId:"c1",seriesId:"ESZ6",
 touchEvidenceAvailable:true,levels:[{key:"r618",price:7800,status:"TOUCHED",
 firstTouchedAt:"2026-10-14T13:30:00Z",firstTouchedBarId:"bar-17"}]};
 const out=inspectSevenDegreeDisplay({degrees:{micro:evidence}});
 assert.equal(out.degrees.micro.levels[0].status,"TOUCHED");
 assert.equal(out.degrees.submicro.available,false);
});
test("a provisional subminute model remains marked provisional regardless of its prices",()=>{
 const out=inspectSevenDegreeDisplay({degrees:{subminute:{provisional:true,
 levels:[{price:7800,key:"e1000",status:"WATCH"}]}}});
 assert.ok(out.degrees.subminute.reasonCodes.includes("PROVISIONAL_FIB_GEOMETRY"));
 assert.equal(out.degrees.subminute.levels[0].status,"WATCH");
});
test("blank node prices cannot become fabricated levels",()=>{
 const out=inspectSevenDegreeDisplay({degrees:{primary:{levels:[{key:"w5",price:null},{key:"w4",price:5000}]}}});
 assert.equal(out.degrees.primary.levels.length,1);
 assert.equal(out.degrees.primary.levels[0].price,5000);
});
test("no permission, geometry, identity or side effects",()=>{
 const original={minor:{activeWave:"W5",levels:[{price:7900,status:"WATCH"}]}};
 const copy=JSON.stringify(original);
 const out=inspectSevenDegreeDisplay({degrees:original});
 assert.equal(JSON.stringify(original),copy);
 assert.equal(out.noExecution,true);
 assert.equal(out.noCanonicalPromotion,true);
 assert.equal(out.scope,"SHADOW_RESEARCH_ONLY");
});
