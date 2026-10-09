import test from "node:test";
import assert from "node:assert/strict";
import { buildMicroWaveSequence } from "../logic/engine22/wave/buildMicroWaveSequence.js";

const w1 = { timeframe:"5m", closed:true, close:7840, localPivot:7850,
  anchorRejection:true, swingBreak:true, displacement:true,
  displacementQuality:"HIGH", bodyToRange:0.8, sourceTimestamp:"2026-10-08T21:30:00Z" };
const w2 = { timeframe:"5m", closed:true, close:7829, localPivot:7820,
  anchorRejection:true, validRetracementReaction:true,
  swingBreak:true, displacement:true, displacementQuality:"HIGH",
  bodyToRange:0.8, sourceTimestamp:"2026-10-08T22:00:00Z" };

test("W1 projection remains unconfirmed without structural evidence",()=>{
  const r=buildMicroWaveSequence({currentPrice:7850,candidateW1High:7864});
  assert.equal(r.activeWave,"W1");
  assert.equal(r.w1Completion.state,"DEVELOPING");
  assert.equal(r.projectedW2.length,0);
  assert.equal(r.projectedW1[1].price,7849);
});
test("Manual boolean alone cannot bypass 5m wave confirmation",()=>{
  const r=buildMicroWaveSequence({candidateW1High:7864,confirmedW1High:7864,w1CompletionConfirmed:true,w1ConfirmationSource:"MANUAL"});
  assert.equal(r.activeWave,"W1");
  assert.equal(r.w2TargetsAvailable,false);
});
test("One-minute evidence never confirms",()=>{
  const r=buildMicroWaveSequence({candidateW1High:7864,w1Evidence5m:{...w1,timeframe:"1m"}});
  assert.equal(r.w1Completion.state,"DEVELOPING");
});
test("Unclosed 5m candle never confirms",()=>{
  const r=buildMicroWaveSequence({candidateW1High:7864,w1Evidence5m:{...w1,closed:false}});
  assert.equal(r.w1Completion.state,"DEVELOPING");
});
test("5m rejection and pivot break without confirmation remains candidate",()=>{
  const r=buildMicroWaveSequence({candidateW1High:7864,w1Evidence5m:{...w1,swingBreak:false,displacement:false}});
  assert.equal(r.w1Completion.state,"COMPLETION_CANDIDATE");
  assert.equal(r.activeWave,"W1");
});
test("5m swing break with strong displacement confirms W1",()=>{
  const r=buildMicroWaveSequence({candidateW1High:7864,w1Evidence5m:w1});
  assert.equal(r.w1Completion.state,"COMPLETION_CANDIDATE");
  assert.equal(r.activeWave,"W1");
  assert.ok(r.w1Completion.reasonCodes.includes("FIVE_MIN_DISPLACEMENT"));
  assert.equal(r.projectedW2.find(x=>x.label==="0.500").price,7824);
});
test("structural candidate can confirm W1, lock, and unlock W2",()=>{
  const candidate=buildMicroWaveSequence({candidateW1High:7864,w1Evidence5m:w1});
  assert.equal(candidate.w1Completion.state,"COMPLETION_CANDIDATE");
  const confirmed=buildMicroWaveSequence({candidateW1High:7864,w1PriorState:"COMPLETION_CANDIDATE",w1Evidence5m:w1});
  assert.equal(confirmed.w1Completion.state,"CONFIRMED");
  assert.equal(confirmed.w2TargetsAvailable,true);
  assert.equal(confirmed.activeWave,"W1");
  const locked=buildMicroWaveSequence({candidateW1High:7900,w1PriorState:"CONFIRMED",lockedW1High:7864});
  assert.equal(locked.w1Completion.state,"LOCKED");
  assert.equal(locked.activeWave,"W2");
  assert.equal(locked.confirmedW1High,7864);
});

test("two consecutive 5m closes also confirm",()=>{
  const r=buildMicroWaveSequence({candidateW1High:7864,w1PriorState:"COMPLETION_CANDIDATE",
    w1Evidence5m:{...w1,swingBreak:false,displacement:false,consecutiveClosesBeyondPivot:2}});
  assert.equal(r.w1Completion.state,"CONFIRMED");
  assert.ok(r.w1Completion.reasonCodes.includes("TWO_CLOSE_CONFIRMATION"));
});
test("confirmed without frozen anchor does not lock",()=>{
  const r=buildMicroWaveSequence({candidateW1High:7864,w1PriorState:"CONFIRMED"});
  assert.equal(r.w1Completion.state,"CONFIRMED");
});
test("locked high never repaints",()=>{
  const r=buildMicroWaveSequence({candidateW1High:7900,w1PriorState:"LOCKED",lockedW1High:7864,w1Evidence5m:w1});
  assert.equal(r.w1Completion.state,"LOCKED");
  assert.equal(r.confirmedW1High,7864);
  assert.equal(r.projectedW2.find(x=>x.label==="0.500").price,7824);
});
test("W2 requires candidate, then confirmed, then locked before W3 watch",()=>{
  const base={w1PriorState:"LOCKED",lockedW1High:7864,confirmedW2Low:7825,w2Evidence5m:w2};
  const first=buildMicroWaveSequence(base);
  assert.equal(first.w2Completion.state,"COMPLETION_CANDIDATE");
  assert.equal(first.activeWave,"W2");
  const second=buildMicroWaveSequence({...base,w2PriorState:"COMPLETION_CANDIDATE"});
  assert.equal(second.w2Completion.state,"CONFIRMED");
  assert.equal(second.activeWave,"W2");
  const third=buildMicroWaveSequence({...base,w2PriorState:"CONFIRMED",lockedW2Low:7825});
  assert.equal(third.w2Completion.state,"LOCKED");
  assert.equal(third.activeWave,"W3_WATCH");
});
test("W2 bounce without structural proof cannot complete",()=>{
  const r=buildMicroWaveSequence({
    w1PriorState:"LOCKED",lockedW1High:7864,confirmedW2Low:7825,
    w2Evidence5m:{...w2,validRetracementReaction:false}
  });
  assert.equal(r.activeWave,"W2");
});
