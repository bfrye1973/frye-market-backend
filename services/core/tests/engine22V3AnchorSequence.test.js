import test from "node:test";
import assert from "node:assert/strict";
import {validateEngine22V3AnchorSequence as validate} from "../logic/engine22/v3/validateAnchorSequence.js";
const marks={
 W1_LOW:{price:7788.25,time:"2026-10-08 10:30"},
 W1_HIGH:{price:7852.75,time:"2026-10-09 14:00"},
 W2_LOW:{price:7827.25,time:"2026-10-09 06:30"}
};
test("owner's unresolved Submicro W2 chronology must be flagged",()=>{
 const r=validate({marks,timezoneOffset:"-07:00"});
 assert.equal(r.ok,false);
 assert.ok(r.errors.includes("W1_HIGH_BEFORE_W2_LOW_ORDER_VIOLATION"));
});
test("do not infer a timezone for human-supplied marks",()=>{
 assert.ok(validate({marks}).errors.includes("W1_LOW_TIMEZONE_OFFSET_REQUIRED"));
});
test("valid order passes without modifying price values",()=>{
 const revised=structuredClone(marks);
 revised.W2_LOW.time="2026-10-09 16:30";
 assert.equal(validate({marks:revised,timezoneOffset:"-07:00"}).ok,true);
});
test("reject off-tick ES prices",()=>{
 const revised=structuredClone(marks);
 revised.W1_LOW.price=7788.31;
 assert.ok(validate({marks:revised,timezoneOffset:"-07:00"}).errors.includes("W1_LOW_INVALID_PRICE"));
});
