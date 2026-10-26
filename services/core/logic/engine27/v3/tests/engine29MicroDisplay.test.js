import test from "node:test";import assert from "node:assert/strict";
import {projectEngine29Micro as run} from "../marketConfirmation/projectEngine29Micro.js";
const now=Date.parse("2026-10-26T13:20:00Z");
const source={ok:true,data:{timestamp:"2026-10-26T13:19:00Z",dataDegraded:true,missingConfirmations:["CREDIT"],
 structuralState:"BROAD_DETERIORATION",tacticalState:"CAUTION",fastTacticalState:"STABILIZING",
 marketCharacter:{move:{moveCharacter:"NO_ACTIVE_MOVE",direction:"FLAT"},liquidity:{state:"NO_LIQUIDITY_EVENT"},trap:{state:"NO_ACTIVE_TRAP"},squeezeCampaign:{state:"SQUEEZE_TRANSITIONED_TO_BROAD_MOVE"}},
 groups:{headlineIndex:{structural:{state:"WEAKENING"},tactical:{state:"BREAKING"},fastTactical:{state:"SEVERE_STRESS"}},
 breadth:{structural:{state:"BREAKING"},tactical:{state:"WEAKENING"},fastTactical:{state:"WEAKENING"}}}}};
test("owner group keys project eight rows, context present but degraded unqualified",()=>{
 const r=run(source,true,now);assert.equal(r.rows.length,8);
 assert.equal(r.rows[0].label,"Indexes");assert.equal(r.rows[0].structural,"WEAKENING");
 assert.equal(r.rows[0].hourly,"BREAKING");assert.equal(r.rows[0].thirtyMinute,"SEVERE_STRESS");
 assert.equal(r.rows[2].structural,null);assert.equal(r.sourceCurrent,true);
 assert.equal(r.present,true);assert.equal(r.quality,"DEGRADED");assert.equal(r.qualified,false);
 assert.deepEqual(r.missingConfirmations,["CREDIT"]);assert.equal(r.noExecution,true);
});
test("missing publication is not market confirmation",()=>{const r=run(null,true,now);assert.equal(r.present,false);assert.equal(r.qualified,false);assert.equal(r.rows.every(x=>x.structural===null),true)});
test("stale otherwise healthy publication cannot qualify",()=>{const x=structuredClone(source);x.data.dataDegraded=false;x.data.timestamp="2026-10-26T13:10:00Z";const r=run(x,true,now);assert.equal(r.quality,"STALE");assert.equal(r.qualified,false)});
test("fresh healthy data still needs official owner approval",()=>{const x=structuredClone(source);x.data.dataDegraded=false;assert.equal(run(x,false,now).qualified,false);assert.equal(run(x,true,now).qualified,true)});
test("read-only projection never mutates canonical record",()=>{const x=structuredClone(source);run(source,false,now);assert.deepEqual(source,x)});
