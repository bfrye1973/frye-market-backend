import test from "node:test";
import assert from "node:assert/strict";
import {createMicroAlignmentAlertGate} from "../marketAlignment/createMicroAlignmentAlertGate.js";
const start=Date.parse("2026-10-26T16:00:00Z");
function event(n,bullish=true){
 const closedAt=new Date(start+n*300000).toISOString();
 return {schema:"engine27.v3.microFiveMinuteAlignmentEvent.v1",
  id:"MICRO-"+closedAt,closedAt,marketAligned:bullish,noExecution:true,
  ES:{state:bullish?"UP":"DOWN"},QQQ:{state:bullish?"UP":"DOWN"},
  VIX:{state:bullish?"DOWN":"UP"},microDirection:"DOWN",
  engine25Qualified:true,engine29Qualified:false};
}
test("no 1m alerts and no alert on first completed 5m bullish window",()=>{
 const gate=createMicroAlignmentAlertGate();
 assert.equal(gate.observe(event(0)),null);
 assert.equal(gate.status().oneMinuteAlertsEnabled,false);
 assert.equal(gate.status().latestAlert,null);
});
test("two consecutive 5m bullish windows create one informational 10m alert",()=>{
 const gate=createMicroAlignmentAlertGate();
 gate.observe(event(0));
 const alert=gate.observe(event(1));
 assert.equal(alert.type,"BULLISH_MARKET_ALIGNMENT_10M");
 assert.equal(alert.noExecution,true);
 assert.equal(alert.executionAuthorized,false);
 assert.equal(alert.microDirection,"DOWN");
 assert.equal(alert.engine29Qualified,false);
 assert.equal(gate.observe(event(1)),null);
 assert.equal(gate.observe(event(2)),null);
 assert.equal(gate.status().recent.length,1);
 assert.equal(gate.status().notificationsEnabled,false);
});
test("a broken alignment resets; a new two-window streak produces a new alert",()=>{
 const gate=createMicroAlignmentAlertGate();
 gate.observe(event(0));gate.observe(event(1));
 gate.observe(event(2,false));
 assert.equal(gate.status().active,false);
 assert.equal(gate.observe(event(3)),null);
 assert.ok(gate.observe(event(4)));
 assert.equal(gate.status().recent.length,2);
});
test("missing five-minute window cannot count as consecutive confirmation",()=>{
 const gate=createMicroAlignmentAlertGate();
 gate.observe(event(0));
 assert.equal(gate.observe(event(2)),null);
 assert.ok(gate.observe(event(3)));
});
test("missing or malformed evidence never triggers an alert",()=>{
 const gate=createMicroAlignmentAlertGate();
 assert.equal(gate.observe({...event(0),noExecution:false}),null);
 gate.observe(event(0));
 assert.equal(gate.observe({...event(1),VIX:{state:"UNAVAILABLE"}}),null);
 assert.equal(gate.status().recent.length,0);
});
