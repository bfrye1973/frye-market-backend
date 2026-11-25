import test from "node:test";
import assert from "node:assert/strict";
import {assessEngine22V3ImpulseGeometry as assess} from "../logic/engine22/v3/assessImpulseGeometry.js";
const marks={
 W1_LOW:{price:7675,time:"2026-10-01T07:00:00-07:00"},
 W1_HIGH:{price:7805,time:"2026-10-02T07:00:00-07:00"},
 W2_LOW:{price:7757.75,time:"2026-10-05T03:00:00-07:00"},
 W3_HIGH:{price:7897.75,time:"2026-10-06T07:00:00-07:00"},
 W4_LOW:{price:7782.75,time:"2026-10-08T07:00:00-07:00"},
};
test("owner's Micro overlap remains provisional, not confirmed standard impulse",()=>{
 const r=assess({anchors:marks});
 assert.equal(r.valid,false);
 assert.equal(r.overlap,true);
 assert.ok(r.errors.includes("W1_W4_OVERLAP_STANDARD_IMPULSE"));
});
test("an overlap classification is not silently promoted to impulse",()=>{
 const r=assess({anchors:marks,classification:"UNCLASSIFIED"});
 assert.equal(r.valid,true);
 assert.equal(r.standardImpulseConfirmed,false);
});
test("missing W5 is valid as partial structural context, not completed impulse",()=>{
 const m={...marks,W4_LOW:{price:7825,time:marks.W4_LOW.time}};
 const r=assess({anchors:m});
 assert.equal(r.valid,true);
 assert.equal(r.standardImpulseConfirmed,false);
});
test("chronologically inconsistent anchors are rejected",()=>{
 const m={...marks,W2_LOW:{price:7757.75,time:"2026-10-01T00:00:00-07:00"}};
 assert.ok(assess({anchors:m}).errors.includes("OUT_OF_SEQUENCE_ANCHOR_TIME"));
});
