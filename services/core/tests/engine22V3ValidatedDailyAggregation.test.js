import test from "node:test";
import assert from "node:assert/strict";
import {aggregateValidatedEsDailyHistory as aggregate} from "../logic/engine22/v3/aggregateValidatedDailyHistory.js";
const provenance={symbol:"ES",continuousVerified:true,rolloverMethod:"TEST_VERIFIED_ROLLOVER",sessionCalendar:"TEST_WEEKDAYS",sourceId:"TEST_ONLY"};
const dates=[];
for(let t=Date.UTC(2026,0,5);t<Date.UTC(2026,8,1);t+=86400000){
 const day=new Date(t).getUTCDay();if(day>0&&day<6)dates.push({
  time:t/1000,open:100,high:106,low:96,close:101,volume:100,closed:true});
}
test("no weekly or monthly authority without continuous ES rollover provenance",()=>{
 assert.equal(aggregate({dailyBars:dates,timeframe:"1w"}).available,false);
 assert.ok(aggregate({dailyBars:dates,timeframe:"1w"}).reasonCodes.includes("CONTINUOUS_ROLLOVER_PROVENANCE_REQUIRED"));
});
test("construct only full confirmed calendar periods using actual daily OHLC",()=>{
 for(const tf of ["1w","1mo"]){
  const r=aggregate({dailyBars:dates,provenance,timeframe:tf,asOfMs:Date.UTC(2026,8,5)});
  assert.equal(r.available,true,JSON.stringify(r));
  assert.ok(r.bars.length>=5);
  assert.ok(r.bars.every(b=>b.open===100&&b.high===106&&b.low===96&&b.close===101));
  assert.ok(r.bars.every(b=>b.closed&&b.sourceDayCount>0));
  assert.equal(r.noAnchorPromotion,true);
 }
});
test("historical gaps must block aggregation, never fill missing bars",()=>{
 const withGap=dates.filter(b=>b.time*1000<Date.UTC(2026,1,1)||b.time*1000>Date.UTC(2026,1,12));
 const r=aggregate({dailyBars:withGap,provenance,timeframe:"1w",asOfMs:Date.UTC(2026,8,5)});
 assert.equal(r.available,false);
 assert.ok(r.reasonCodes.includes("INCOMPLETE_SOURCE_PERIODS"));
});
test("reject a single unverified live contract even with 159 daily candles",()=>{
 assert.equal(aggregate({dailyBars:dates,provenance:{...provenance,continuousVerified:false}}).available,false);
});
