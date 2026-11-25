import test from "node:test";import assert from "node:assert/strict";
import {buildEngine27MicroIntelligenceV1 as build} from "../logic/engine27/v2/buildMicroIntelligenceV1.js";
import {buildEngine27UnifiedMarketContextV1} from "../logic/engine27/v2/buildUnifiedMarketContextV1.js";
const working={degrees:{micro:{available:true,activeWave:"C",waveDirection:"DOWN",
 potentialCompletion:{levels:[{key:"e100",price:7593.25,status:"WATCH"},{key:"e786",price:7640.25,status:"WATCH"}]}},
 submicro:{available:true,waveDirection:"DOWN"},subminute:{available:true,waveDirection:"DOWN"}}};
test("Micro evaluates next owner objective and both neighbors",()=>{const x=build({working,price:7672,context:{tactical:{fresh:true,overallState:"DOWNSIDE_PRESSURE"},participation:{fresh:true,state:"NEUTRAL"}},reactions:{interpretation:{state:"MIXED",qqq:"ADVERSE",vix:"SUPPORTIVE"}}});assert.equal(x.nextObjective.price,7640.25);assert.equal(x.adjacency,"WORKING_DIRECTIONS_AGREE");assert.equal(x.positionThesis,"ENTRY_STRUCTURE_UNAVAILABLE");assert.equal(x.noExecution,true);});
test("without verified ES price cannot invent a next objective",()=>{const x=build({working});assert.equal(x.nextObjective,null);assert.equal(x.currentPrice,null);});
test("Engine29 is excluded on all degrees except Micro and Submicro",()=>{const x=buildEngine27UnifiedMarketContextV1({engine29:{overallState:"DOWNSIDE_PRESSURE",timestamp:"2026-10-25T20:00:00Z"},now:new Date("2026-10-25T20:05:00Z")});assert.equal(x.strategyReads.micro.engine29Status,"CURRENT");assert.equal(x.strategyReads.submicro.engine29Status,"CURRENT");for(const d of ["subminute","minute","minor","intermediate","primary"])assert.equal(x.strategyReads[d].engine29Status,"NOT_APPLICABLE_INTRADAY_ONLY");});
