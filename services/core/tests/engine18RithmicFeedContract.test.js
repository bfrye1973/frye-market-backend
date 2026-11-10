import test from "node:test";
import assert from "node:assert/strict";
import { assessEngine18Feed, normalizeEngine18FeedEnvelope } from "../logic/engine18/rithmicFeedContract.js";
const now=1794300000000;
const valid={provider:"RITHMIC",contractSymbol:"ESZ26",connected:true,authenticated:true,
  entitlementMbo:true,subscriptionActive:true,snapshotSeeded:true,
  sequenceContinuous:true,lastMarketEventUnixMs:now-400,nowUnixMs:now,marketOpen:true};
test("feed is untrusted until all readiness gates are satisfied",()=>{
  const pass=assessEngine18Feed(valid);
  assert.equal(pass.liquidityDataUsable,true);
  assert.equal(pass.noExecution,true);
  const incomplete=assessEngine18Feed({...valid,entitlementMbo:false,snapshotSeeded:false});
  assert.equal(incomplete.liquidityDataUsable,false);
  assert.ok(incomplete.reasons.includes("MBO_NOT_ENTITLED"));
  assert.ok(incomplete.reasons.includes("BOOK_NOT_SEEDED"));
});
test("stale, future and disconnected feeds cannot generate trusted liquidity",()=>{
  for(const change of [{connected:false},{lastMarketEventUnixMs:now-30000},{lastMarketEventUnixMs:now+1000},{sequenceContinuous:false},{marketOpen:false}]){
    assert.equal(assessEngine18Feed({...valid,...change}).liquidityDataUsable,false);
  }
});
test("normalized packets require explicit provider, contract, version, and precise timestamps",()=>{
 const packet={provider:"RITHMIC",adapterVersion:"engine18.normalized.v1",kind:"TRADE",
  contractSymbol:"ESZ26",eventTimeNs:"1794300000123456789"};
 const result=normalizeEngine18FeedEnvelope(packet);
 assert.equal(result.noExecution,true);
 assert.ok(Object.isFrozen(result));
 assert.throws(()=>normalizeEngine18FeedEnvelope({...packet,provider:"UNKNOWN"}),/PROVIDER/);
 assert.throws(()=>normalizeEngine18FeedEnvelope({...packet,contractSymbol:"ES"}),/CONTRACT/);
 assert.throws(()=>normalizeEngine18FeedEnvelope({...packet,eventTimeNs:1794300000123456789}),/TIME/);
});
