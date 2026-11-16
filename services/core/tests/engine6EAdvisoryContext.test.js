import test from "node:test";
import assert from "node:assert/strict";
import {buildEngine6AdvisoryContext} from "../logic/engine6/6b-market-intelligence/buildEngine6AdvisoryContext.js";

test("Engine22 missing publication is a warning, never a permission denial",()=>{
  const snapshot={symbol:"ES",strategies:{"intraday_scalp@10m":{permission:{paper:{allowed:true,decision:"FAST_INTRADAY_PAPER_ALLOW"}}}}};
  const before=structuredClone(snapshot);
  const context=buildEngine6AdvisoryContext({snapshot});
  assert.equal(context.wave.available,false);
  assert.equal(context.noEntryVeto,true);
  assert.equal(context.noPermissionCreated,true);
  assert.deepEqual(snapshot,before);
});
test("Engine25 mixed and degraded Engine29 remain unscored advisory observations",()=>{
  const snapshot={symbol:"ES",strategies:{"intraday_scalp@10m":{engine25Context:{regime:"RISK_OFF",marketInternals:{alignment:{overall:"MIXED"}}},permission:{paper:{allowed:true}}}}};
  const result=buildEngine6AdvisoryContext({
    snapshot,
    engine25Participation:{timestamp:"2026-11-11T22:00:00Z",freshness:{intraday:{state:"STALE"}},participation:{distributionPressure:{state:"CAUTION",oneHourTrend:{state:"CAUTION"}}}},
    engine29Stress:{timestamp:"2026-11-11T22:00:00Z",dataDegraded:true,tacticalState:"DOWN",marketCharacter:{move:{liveCondition:{state:"ACCELERATING"}}}}
  });
  assert.equal(result.marketHealth.regime,"RISK_OFF");
  assert.equal(result.marketHealth.alignment,"MIXED");
  assert.equal(result.marketHealth.intradayFreshness,"STALE");
  assert.equal(result.intraday.dataDegraded,true);
  assert.equal(result.intraday.liveConditionDiagnosticOnly.state,"ACCELERATING");
  assert.equal(snapshot.strategies["intraday_scalp@10m"].permission.paper.allowed,true);
  assert.equal(Object.hasOwn(result,"decision"),false);
  assert.equal(Object.hasOwn(result,"score"),false);
});
