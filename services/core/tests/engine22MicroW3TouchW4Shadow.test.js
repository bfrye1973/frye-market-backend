import test from "node:test";
import assert from "node:assert/strict";
import {assessMicroW3TouchW4Shadow as assess} from "../logic/engine22/microV2/assessMicroW3TouchW4Shadow.js";
const epoch=Date.UTC(2026,9,12,11,0);
const series=[7860,7870,7888,7876,7860,7853].map((close,i)=>({
 time:(epoch+i*600000)/1000,high:close+1,low:close-1,close,
}));
const transition={available:true,sourceCountId:"LEGACY-SUBMICRO-COUNT",
 anchors:{w2Low:7826.75,w2SourceTimestamp:new Date(epoch-600000).toISOString()},
 w3Up:{levels:[{key:"e1000",price:7887,status:"WATCH"}]}};
test("completed historical high retains W3 1.0 touch after price falls and flags only a W4 candidate",()=>{
 const x=assess({transition,bars:series,evaluationTimeMs:epoch+7*600000});
 assert.equal(x.available,true);
 assert.equal(x.w3OneToOne.touched,true);
 assert.equal(x.w3OneToOne.target,7887);
 assert.equal(x.w4DownCandidate,true);
 assert.equal(x.noAnchorPromotion,true);
 assert.equal(x.noPermissionCreated,true);
 assert.equal(transition.w3Up.levels[0].status,"WATCH");
});
test("missing W2 source timestamp cannot invent post-W2 touch",()=>{
 const x=assess({transition:{...transition,anchors:{w2Low:7826.75}},
 bars:series,evaluationTimeMs:epoch+7*600000});
 assert.equal(x.available,false);
 assert.ok(x.reasonCodes.includes("W2_SOURCE_CANDLE_TIMESTAMP_REQUIRED"));
});
test("forming candle touching target is excluded",()=>{
 const x=assess({transition,bars:series.slice(0,2).concat([
 {time:(epoch+2*600000)/1000,high:7890,low:7850,close:7888,closed:false}
 ]),evaluationTimeMs:epoch+5*600000});
 assert.equal(x.available,false);
 assert.equal(x.w3OneToOne,null);
});

test("uniquely price-matched confirmed W2 pivot is observational only, not canonical approval",()=>{
 const locked={...transition,
   anchors:{w2Low:7826.75},w2Down:{state:"LOCKED"}};
 const prices=[7850,7842,7826.75,7837,7840,7860,7870,7888,7876,7860,7853];
 const start=epoch-5*600000;
 const candles=prices.map((close,i)=>({
  time:(start+i*600000)/1000,high:close+1,
  low:i===2?7826.75:close-1,close:i===2?7827.75:close
 }));
 const result=assess({transition:locked,bars:candles,
   evaluationTimeMs:start+12*600000});
 assert.equal(result.w3OneToOne.touched,true);
 assert.equal(result.w3OneToOne.w2SourceQuality,"INFERRED_UNAPPROVED_PRICE_MATCHED_PIVOT");
 assert.equal(result.w4DownCandidate,true);
 assert.equal(result.noAnchorPromotion,true);
});
test("multiple confirmed W2 price-matched pivots fail closed rather than guessing",()=>{
 const locked={...transition,anchors:{w2Low:7826.75},w2Down:{state:"LOCKED"}};
 const lows=[7840,7835,7826.75,7835,7840,7835,7826.75,7835,7840,7887,7853,7840];
 const candles=lows.map((v,i)=>({time:(epoch+i*600000)/1000,
  high:v+2,low:v,close:v+1}));
 const x=assess({transition:locked,bars:candles,evaluationTimeMs:epoch+15*600000});
 assert.equal(x.available,false);
 assert.ok(x.reasonCodes.includes("AMBIGUOUS_W2_PIVOT_IDENTITY"));
});

test("historical completed post-peak wick low persists across rebounds for W4 fib touch evidence",()=>{
 const bars=[
  {time:epoch/1000,high:7870,low:7858,close:7865},
  {time:(epoch+600000)/1000,high:7880,low:7868,close:7875},
  {time:(epoch+1200000)/1000,high:7888,low:7870,close:7880},
  {time:(epoch+1800000)/1000,high:7878,low:7850,close:7860},
  {time:(epoch+2400000)/1000,high:7864,low:7848,close:7852},
  {time:(epoch+3000000)/1000,high:7869,low:7858,close:7865},
 ];
 const x=assess({transition,bars,evaluationTimeMs:epoch+7*600000});
 assert.equal(x.w4DownCandidate,true);
 assert.equal(x.w4CandidateEvidence.minimumPostPeakLow,7848);
 assert.equal(x.w4CandidateEvidence.sourceCountId,transition.sourceCountId);
 assert.equal(x.w4CandidateEvidence.minimumPostPeakClose,7852);
 assert.equal(x.w4CandidateEvidence.observationThroughTimestamp,
   new Date(epoch+3000000).toISOString());
 assert.equal(x.noAnchorPromotion,true);
 assert.equal(x.noExecution,true);
});

test("forming 10m candle cannot mark a W4 retracement touched",()=>{
 const bars=[
  ...series,
  {time:(epoch+6*600000)/1000,high:7865,low:7800,close:7820,closed:false},
 ];
 const x=assess({transition,bars,evaluationTimeMs:epoch+7*600000});
 assert.equal(x.w4CandidateEvidence.minimumPostPeakLow,7852);
 assert.ok(x.w4CandidateEvidence.minimumPostPeakLow>7839.75);
});
