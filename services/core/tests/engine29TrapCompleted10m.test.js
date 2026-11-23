import test from "node:test";
import assert from "node:assert/strict";
import { detectEngine29TrapAuctionEvent } from "../logic/engine29/trapDetection/detectTrapAuctionEvent.js";

const t = 1_800_000_000_000;
const level = { id:"test-high",side:"HIGH",type:"FOUR_HOUR_SWING_HIGH",level:7800,lo:7800,hi:7800,eventEligible:true };
const bar = (time,open,high,low,close) => ({ time,open,high,low,close });
const detect = (bars,now) => detectEngine29TrapAuctionEvent({
  now, macroLiquidityMap:{levels:[level]},
  esAnchor:{liveMonitor:{bars},structure:{fastTactical:{bars:[]},tactical:{bars:[]}}}
});

test("forming reclaim cannot affect canonical auction", () => {
  const r = detect([bar(t,7798,7805,7796,7797)],t+9*60_000);
  assert.equal(r.trapSide,"NONE");
  assert.equal(r.liquidityEvent.state,"NO_LIQUIDITY_EVENT");
  assert.equal(r.tenMinuteEvidence.formingPresent,true);
  assert.equal(r.tenMinuteEvidence.completed,false);
});
test("completed bar becomes eligible only at candle close", () => {
  const bars=[bar(t,7798,7805,7796,7797)];
  assert.equal(detect(bars,t+9*60_000).liquidityEvent.state,"NO_LIQUIDITY_EVENT");
  const r=detect(bars,t+10*60_000);
  assert.notEqual(r.liquidityEvent.state,"NO_LIQUIDITY_EVENT");
  assert.equal(r.immediate10m.completed,true);
  assert.equal(r.immediate10m.forming,false);
});
test("forming bar cannot override latest completed ten-minute observation", () => {
  const a=bar(t,7798,7804,7797,7799);
  const b=bar(t+600_000,7799,7812,7790,7796);
  const r=detect([a,b],t+15*60_000);
  assert.equal(r.tenMinuteEvidence.completedBarTime,t);
  assert.equal(r.tenMinuteEvidence.formingBarTime,t+600_000);
  assert.equal(r.immediate10m.high,7804);
});
