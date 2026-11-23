import test from "node:test";
import assert from "node:assert/strict";
import { selectEngine29ReplayContext } from "../logic/engine29/replayContextSelection.js";

const context = Object.freeze({
 schema:"engine29.downstreamContext.v1",
 timestamp:"2026-11-23T17:00:00.000Z",
 lanes:{parentMove:{direction:"UP"},trap:{eligibleForEngine4:false}},
});
test("ES replay selects the exact original live downstream object",()=>{
 const selected=selectEngine29ReplayContext({downstreamContext:context},"2026-11-23T17:00:01.000Z");
 assert.strictEqual(selected,context);
 assert.deepEqual(selected.lanes.trap,{eligibleForEngine4:false});
});
test("ES replay fails closed against future Engine29 output",()=>{
 assert.equal(selectEngine29ReplayContext({downstreamContext:context},"2026-11-23T16:59:59.000Z"),null);
});
test("ES replay fails closed on invalid or missing observation times",()=>{
 assert.equal(selectEngine29ReplayContext({downstreamContext:{...context,timestamp:null}},"2026-11-23T17:01:00.000Z"),null);
 assert.equal(selectEngine29ReplayContext({downstreamContext:context},null),null);
 assert.equal(selectEngine29ReplayContext({}, "2026-11-23T17:01:00.000Z"),null);
});
test("ES replay fails closed for unsupported schema",()=>{
 assert.equal(selectEngine29ReplayContext({downstreamContext:{...context,schema:"unknown"}},"2026-11-23T17:01:00.000Z"),null);
});
