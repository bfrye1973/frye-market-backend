import test from "node:test";import assert from "node:assert/strict";
import {assembleSnapshotMarketSources as assemble} from "../marketConfirmation/assembleSnapshotMarketSources.js";
import {evaluateMarketConfirmation} from "../marketConfirmation/evaluateMarketConfirmation.js";
const at="2026-10-25T23:00:00Z";
const market={
 symbol:"ES",ok:true,engine25Context:{ok:true,regime:"CAUTION",updatedAt:"2026-10-25T22:55:00Z"},
 engine27Strategies:{
  engine27UnifiedMarketContext:{tactical:{source:"ENGINE29_CROSS_MARKET_STRESS",available:true,
   fresh:true,dataDegraded:false,timestamp:"2026-10-25T22:57:00Z",overallState:"NO_ACTIVE_MOVE",
   oneHour:"WATCH",liquidity:"THIN",trap:"NONE"}},
  engine27CrossMarketLevels:{schema:"engine27.crossMarketSource.v1",available:true,
   instruments:{QQQ:{available:true,symbol:"QQQ",lastCandleTime:"2026-10-24T20:00:00Z",levels:[{low:600,high:601}]},
   VIX:{available:true,symbol:"I:VIX",lastCandleTime:"2026-10-24T20:00:00Z",levels:[{low:20,high:21}]}}},
  engine27LiveCrossMarketReactions:{schema:"engine27.liveCrossMarketReactions.v1",instruments:{
   QQQ:{sourceSymbol:"QQQ",timeframe:"1h",lastCompletedAt:"2026-10-25T22:00:00Z",events:[]},
   VIX:{sourceSymbol:"I:VIX",timeframe:"1h",lastCompletedAt:"2026-10-25T22:00:00Z",events:[]}}},
  engine27EsInstitutionalContext:{symbol:"ES",available:true,institutionalParents:[],negotiatedZones:[]}
 }};
test("canonical ES snapshot maps explicit Engine25, Engine29 and crossmarket inputs",()=>{
 const x=assemble(market);
 assert.equal(x.engine25.regime,"CAUTION");
 assert.equal(x.engine29.overallState,"NO_ACTIVE_MOVE");
 assert.equal(x.crossMarketLevels.instruments.QQQ.symbol,"QQQ");
 assert.equal(x.crossMarketReactions.instruments.VIX.sourceSymbol,"I:VIX");
 assert.equal(x.esInstitutionalContext.symbol,"ES");
});
test("market evaluation reads canonical producer inputs, not invented neutral labels",()=>{
 const x=assemble(market);
 const out=evaluateMarketConfirmation({evaluatedAt:at,...x});
 assert.equal(out.sources.engine25.state,"CAUTION");
 assert.equal(out.sources.engine29.state,"NO_ACTIVE_MOVE");
 assert.equal(out.sources.qqq.state,"NO_QUALIFIED_REACTION");
 assert.equal(out.sources.vix.state,"NO_QUALIFIED_REACTION");
});
test("missing producer fields all fail closed",()=>{
 const x=assemble({symbol:"ES",engine27Strategies:{}});
 assert.equal(x.engine25,null);
 assert.equal(x.engine29,null);
 assert.equal(x.crossMarketLevels,null);
 assert.equal(x.crossMarketReactions,null);
 assert.equal(x.esInstitutionalContext,null);
 assert.equal(x.sourceEvidence.reasonCodes.length,5);
});
test("stale Engine29 summary never becomes neutral context",()=>{
 const x=assemble({...market,engine27Strategies:{...market.engine27Strategies,
 engine27UnifiedMarketContext:{tactical:{source:"ENGINE29_CROSS_MARKET_STRESS",
   available:true,fresh:false,overallState:"NO_ACTIVE_MOVE",timestamp:at}}}});
 assert.equal(x.engine29,null);
});
test("does not accept a SPY source as an ES market context",()=>{
 const x=assemble({...market,symbol:"SPY"});assert.equal(x.engine25,null);assert.equal(x.sourceEvidence.available,false);
});
test("original snapshot is immutable",()=>{
 const before=structuredClone(market);assemble(market);assert.deepEqual(market,before);
});
