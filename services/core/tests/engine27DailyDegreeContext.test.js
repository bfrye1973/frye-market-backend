import test from "node:test";
import assert from "node:assert/strict";
import {buildEngine27WorkingSevenDegrees} from "../logic/engine27/v2/buildWorkingSevenDegrees.js";
const owner={version:"engine22.minuteW2RetracementOwner.v1",activeWave:"W2",direction:"DOWN"};
const e22={currentWavelength:{degrees:{minute:{ownerMinuteW2Retracement:owner}}},degreeStates:{
 minor:{activeWave:"W5",direction:"UP"},intermediate:{activeWave:"W3",direction:"UP"},primary:{activeWave:"W5",direction:"UP"}}};
const day=86400000,base=Date.parse("2026-09-15T00:00:00Z");
const daily=Array.from({length:28},(_,i)=>({time:base+i*day,close:7500+(i<10?i*12:i<20?120-(i-10)*5:70+(i-20)*3),completed:true}));
const snapshot={now:new Date(base+29*day).toISOString(),marketMeter:{layers:{emaPosture:{daily:{bars:daily},tenMinute:{bars:[]},oneHour:{bars:[]},fourHour:{bars:[]}}}},
 strategies:{"intraday_scalp@10m":{engine22WaveStrategy:e22}}};
test("four higher strategies use only daily close windows, with separate sizes",()=>{
 const o=buildEngine27WorkingSevenDegrees({snapshot});
 for(const [degree,count] of [["minute",2],["minor",5],["intermediate",10],["primary",20]]){
  const x=o.degrees[degree].directionAssessment;
  assert.equal(x.timeframe,"1d");assert.equal(x.lookback,count);
  assert.equal(x.evidence,"COMPLETED_DAILY_WINDOW");
 }
});
test("missing daily history cannot silently fall back to 10m/1h/4h",()=>{
 const s=structuredClone(snapshot);s.marketMeter.layers.emaPosture.daily.bars=[];
 for(const d of ["tenMinute","oneHour","fourHour"])s.marketMeter.layers.emaPosture[d].bars=daily;
 const o=buildEngine27WorkingSevenDegrees({snapshot:s});
 for(const d of ["minute","minor","intermediate","primary"])
  assert.equal(o.degrees[d].directionAssessment.status,"UNCONFIRMED");
});
