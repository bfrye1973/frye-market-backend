import test from "node:test";import assert from "node:assert/strict";
import {evaluateMarketConfirmation} from "../marketConfirmation/evaluateMarketConfirmation.js";
import {projectQqqVixStatus} from "../marketConfirmation/projectQqqVixStatus.js";
const levels={instruments:{QQQ:{available:true,symbol:"QQQ",lastCandleTime:"2026-10-26T11:00:00Z",levels:[{low:550,high:560}]},VIX:{available:true,symbol:"I:VIX",lastCandleTime:"2026-10-26T11:00:00Z",levels:[{low:16,high:17}]}}};
const make=(open,event)=>({sourceSymbol:"QQQ",timeframe:"1h",lastCompletedAt:open,events:[{event,source:"POLYGON_DIRECT_1h",time:open}]});
const args={degree:"micro",symbol:"ES",crossMarketLevels:levels,evaluatedAt:"2026-10-26T13:40:00Z"};
test("source uses completed close rather than producer's open timestamp",()=>{
 const open="2026-10-26T11:30:00Z";
 const q=make(open,"DEFENSE_CANDIDATE");
 const x=evaluateMarketConfirmation({...args,crossMarketReactions:{instruments:{QQQ:q}}});
 assert.equal(x.sources.qqq.availability,"CURRENT");
 assert.equal(x.sources.qqq.state,"CANDIDATE_REACTION_ONLY");
 assert.equal(x.sources.qqq.completedCloseAt,"2026-10-26T12:30:00.000Z");
 const view=projectQqqVixStatus(x,levels,{instruments:{QQQ:q}});
 assert.equal(view.qqq.lastHourlyCandleCloseAt,"2026-10-26T12:30:00.000Z");
 assert.equal(view.qqq.qualification,"CONTEXT_ONLY");
});
test("incomplete hourly candle cannot qualify",()=>{
 const q=make("2026-10-26T13:00:00Z","RECLAIM_CONFIRMED");
 const x=evaluateMarketConfirmation({...args,crossMarketReactions:{instruments:{QQQ:q}}});
 assert.equal(x.sources.qqq.state,"REACTIONS_STALE");
});
test("older than 90m since completed close remains stale",()=>{
 const q=make("2026-10-26T10:00:00Z","BREAKDOWN_CONFIRMED");
 const x=evaluateMarketConfirmation({...args,crossMarketReactions:{instruments:{QQQ:q}}});
 assert.equal(x.sources.qqq.state,"REACTIONS_STALE");
});
test("direct VIX independently confirms only verified completed events",()=>{
 const v={...make("2026-10-26T12:00:00Z","BREAKDOWN_CONFIRMED"),sourceSymbol:"I:VIX"};
 const x=evaluateMarketConfirmation({...args,crossMarketReactions:{instruments:{VIX:v}}});
 assert.equal(x.sources.vix.state,"CONFIRMED_REACTION_OBSERVED");
 assert.equal(x.sources.vix.confirmedEvents.length,1);
 assert.equal(x.noExecution,true);
});
test("untrusted QQQ source never confirms and projection shows absent VIX",()=>{
 const q=make("2026-10-26T12:00:00Z","RECLAIM_CONFIRMED");
 q.events[0].source="PROXY";
 const x=evaluateMarketConfirmation({...args,crossMarketReactions:{instruments:{QQQ:q}}});
 assert.equal(x.sources.qqq.state,"NO_QUALIFIED_REACTION");
 const view=projectQqqVixStatus(x,levels,{instruments:{QQQ:q}});
 assert.equal(view.vix.hourlySourcePresent,false);
});
