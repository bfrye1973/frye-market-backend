import test from "node:test";
import assert from "node:assert/strict";
import {buildEngine3V5Shadow} from "../logic/engine3/v5/buildEngine3V5Shadow.js";
const candidate={active:true,symbol:"ES",strategyId:"intraday_scalp@10m",
 laneId:"minute",candidateId:"C",zoneId:"Z",currentPrice:7334,
 entryZone:{id:"Z",lo:7290,hi:7348}};
const handoff={active:true,candidateId:"C",zoneId:"Z",
 authorizeEngine3Evaluation:true,candidateIdentityValid:true,strategyContextValid:true};
for(const direction of ["LONG","SHORT"]){
 test("real v5 builder honors verified Engine10 "+direction+" lock without Engine4/6 authority",()=>{
  const result=buildEngine3V5Shadow({
   engine26LocationCandidate:candidate,engine26ReactionHandoff:handoff,
   previousCanonical:{direction:direction==="LONG"?"SHORT":"LONG",candidateId:"C"},
   bars1m:[],bars5m:[],bars10m:[],
   evaluationTimeMs:Date.parse("2026-11-17T17:00:00Z"),
   openTradeActive:true,lockedTradeDirection:direction,shadowMode:false,
  });
  assert.equal(result.tradeLifecycle.tradeDirectionLockActive,true);
  assert.equal(result.tradeLifecycle.lockedTradeDirection,direction);
  assert.equal(result.stateMachine.direction,direction);
  assert.equal(result.persistence.preTradeDirectionReleased,false);
  assert.equal(result.safety.noPermissionCreated,true);
  assert.equal(result.safety.engine6Authority,false);
 });
}
test("existing v5 builder leaves direction lock inactive without OPEN PAPER lifecycle",()=>{
 const result=buildEngine3V5Shadow({
  engine26LocationCandidate:candidate,engine26ReactionHandoff:handoff,
  previousCanonical:{direction:"SHORT",candidateId:"C"},
  bars1m:[],bars5m:[],bars10m:[],
  evaluationTimeMs:Date.parse("2026-11-17T17:00:00Z"),
  openTradeActive:false,lockedTradeDirection:"NEUTRAL",shadowMode:false,
 });
 assert.equal(result.tradeLifecycle.tradeDirectionLockActive,false);
});
