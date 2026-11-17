import test from "node:test";
import assert from "node:assert/strict";
import { buildAndWriteEngine25NewsEvents } from "../jobs/updateEngine25NewsEvents.js";

test("Finlight REST is fail-closed without explicit opt-in, with zero provider calls", async () => {
  const old = process.env.ENGINE25_FINLIGHT_REST_ENABLED;
  delete process.env.ENGINE25_FINLIGHT_REST_ENABLED;
  let calls = 0;
  try {
    const out = await buildAndWriteEngine25NewsEvents({
      fetcher: async () => { calls++; throw Error("Should never contact provider"); },
    });
    assert.equal(out.ok,true);
    assert.equal(out.skipped,true);
    assert.equal(out.apiRequests,0);
    assert.equal(out.preservedExistingEvents,true);
    assert.equal(calls,0);
  } finally {
    if(old === undefined) delete process.env.ENGINE25_FINLIGHT_REST_ENABLED;
    else process.env.ENGINE25_FINLIGHT_REST_ENABLED=old;
  }
});
test("explicit false also prevents REST requests",async()=>{
  const old=process.env.ENGINE25_FINLIGHT_REST_ENABLED;
  process.env.ENGINE25_FINLIGHT_REST_ENABLED="false";
  try{
    const out=await buildAndWriteEngine25NewsEvents({fetcher:async()=>{throw Error("not expected")}});
    assert.equal(out.skipped,true);
    assert.equal(out.apiRequests,0);
  }finally{
    if(old===undefined) delete process.env.ENGINE25_FINLIGHT_REST_ENABLED;
    else process.env.ENGINE25_FINLIGHT_REST_ENABLED=old;
  }
});
