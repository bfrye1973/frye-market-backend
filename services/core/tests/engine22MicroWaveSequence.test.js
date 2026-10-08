import test from "node:test";
import assert from "node:assert/strict";
import { buildMicroWaveSequence } from "../logic/engine22/wave/buildMicroWaveSequence.js";

test("Micro starts as unconfirmed W1 with provisional high targets", () => {
  const result = buildMicroWaveSequence({currentPrice:7850});
  assert.equal(result.activeWave, "W1");
  assert.equal(result.w2TargetsAvailable, false);
  assert.deepEqual(result.projectedW2, []);
  assert.equal(result.origin,7784);
  assert.equal(result.projectedW1[1].price,7849);
});
test("Candidate W1 high never activates Wave 2", () => {
  const result = buildMicroWaveSequence({currentPrice:7850,candidateW1High:7864.25});
  assert.equal(result.activeWave, "W1");
  assert.equal(result.confirmedW1High,null);
});
test("Explicit valid W1 confirmation unlocks Wave 2 retracement geometry", () => {
  const result = buildMicroWaveSequence({
    currentPrice:7830,confirmedW1High:7864,w1CompletionConfirmed:true,
    w1ConfirmationSource:"VALIDATED_5M_REVERSAL",
  });
  assert.equal(result.activeWave,"W2");
  assert.equal(result.w2TargetsAvailable,true);
  assert.equal(result.projectedW2.length,5);
  assert.equal(result.projectedW2.find(x=>x.label==="0.500").price,7824);
});
test("Missing confirmation provenance fails closed", () => {
  const result = buildMicroWaveSequence({confirmedW1High:7864,w1CompletionConfirmed:true});
  assert.equal(result.activeWave,"W1");
  assert.equal(result.w2TargetsAvailable,false);
});
test("W3 not activated unless Wave 2 separately confirmed", () => {
  const result=buildMicroWaveSequence({
    confirmedW1High:7864,w1CompletionConfirmed:true,w1ConfirmationSource:"VALIDATED_5M_REVERSAL",
    confirmedW2Low:7825,
  });
  assert.equal(result.activeWave,"W2");
});
