import test from "node:test";
import assert from "node:assert/strict";
import {buildStructureMarketWarning as evaluate} from "../logic/engine27/confirmation/buildStructureMarketWarning.js";
const asOfUtc="2026-10-29T15:00:00.000Z";
const degrees=Object.fromEntries(["submicro","micro","subminute","minute","minor","intermediate","primary"].map(d=>[d,{available:true,activeWave:"D",direction:"UP",selectionStatus:"OWNER_SELECTED_WORKING",stage:"DEVELOPING"}]));
const wave={schema:"engine22.authorizedWorkingStructure.v1",mode:"READ_ONLY",status:"COMPLETE_WORKING_SELECTION",noExecution:true,noWaveTransition:true,degrees};
const source={sourceTimestamp:"2026-10-29T14:55:00.000Z",provenance:{reconstructed:false}};
const packet={ok:true,schema:"engine25.confirmationPacket.v1",mode:"LIVE",asOfUtc,
 sources:{esMaster:source,fourHour:{...source,completedBar:{completed:true}},reconstructedEod:{...source,sourceTimestamp:"2026-10-28T22:00:00.000Z"}},
 tradePermissionShadow:{score:40.58,directionalBias:"BEARISH",state:"BEARISH_SHORTS_FAVORED"}};
const run=(w=wave,p=packet,extra={})=>evaluate({wavePublication:w,packet:p,asOfUtc,...extra});
test("bullish structure conflicts with bearish market",()=>assert.equal(run().state,"STRUCTURE_MARKET_CONFLICT"));
test("bullish structure supported by bullish market",()=>assert.equal(run(wave,{...packet,tradePermissionShadow:{score:70,directionalBias:"BULLISH"}}).state,"MARKET_SUPPORTS_UPSIDE_CANDIDATE"));
test("bearish structure supported by bearish market",()=>assert.equal(run({...wave,degrees:{...degrees,subminute:{...degrees.subminute,direction:"DOWN"}}}).state,"MARKET_SUPPORTS_DOWNSIDE_CANDIDATE"));
test("bearish structure conflicts with bullish market",()=>assert.equal(run({...wave,degrees:{...degrees,subminute:{...degrees.subminute,direction:"DOWN"}}},{...packet,tradePermissionShadow:{score:70,directionalBias:"BULLISH"}}).state,"STRUCTURE_MARKET_CONFLICT"));
test("mixed market remains unconfirmed",()=>assert.equal(run(wave,{...packet,tradePermissionShadow:{score:52,directionalBias:"MIXED"}}).state,"BULLISH_UNCONFIRMED"));
test("missing packet fails closed",()=>assert.equal(run(wave,null).state,"INSUFFICIENT_CONFIRMATION"));
test("stale packet fails closed",()=>assert.equal(run(wave,{...packet,asOfUtc:"2026-10-29T14:00:00Z"}).state,"INSUFFICIENT_CONFIRMATION"));
test("lower-degree disagreement highlighted",()=>{const result=run({...wave,degrees:{...degrees,micro:{...degrees.micro,direction:"DOWN"},submicro:{...degrees.submicro,direction:"DOWN"}}});assert.deepEqual(result.lowerDegreeConflicts,["submicro","micro"]);});
test("wave completion not inferred from market agreement",()=>assert.equal(run(wave,{...packet,tradePermissionShadow:{score:70,directionalBias:"BULLISH"}}).wave.completionConfirmed,false));
test("future source rejected",()=>assert.equal(run(wave,{...packet,sources:{...packet.sources,esMaster:{...source,sourceTimestamp:"2026-10-29T15:01:00Z"}}}).state,"INSUFFICIENT_CONFIRMATION"));
test("incomplete 4H rejected",()=>assert.equal(run(wave,{...packet,sources:{...packet.sources,fourHour:{...source,completedBar:{completed:false}}}}).state,"INSUFFICIENT_CONFIRMATION"));
test("October 29 reconstructed 40.58 example never claimed live",()=>{const p={...packet,mode:"HISTORICAL_REPLAY",sources:{...packet.sources,esMaster:{...source,provenance:{reconstructed:true}}}};const result=run(wave,p,{mode:"HISTORICAL_REPLAY"});assert.equal(result.state,"STRUCTURE_MARKET_CONFLICT");assert.equal(result.provenance,"RETROSPECTIVE_RESEARCH_NOT_ORIGINAL_WARNING");});
