import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {appendFunnelCycle,readFunnelCycles,summarizeFunnelCycles,validFunnelDate,funnelDate} from "../logic/engine6/6e-funnel/funnelDiagnosticStore.js";

test("strict date validation blocks paths and impossible dates",()=>{
  assert.equal(validFunnelDate("2026-11-11"),true);
  assert.equal(validFunnelDate("2026-02-31"),false);
  assert.equal(validFunnelDate("../2026-11-11"),false);
  assert.equal(funnelDate("2026-11-11T22:00:00Z"),"2026-11-11");
});
test("append-only isolated records and candidate-aware summary",()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"engine6e-funnel-"));
  try{
    const record={schema:"engine6e.noTradeFunnel.v1",readOnly:true,snapshotTime:"2026-11-11T22:00:00Z",candidateId:"A",zoneId:"Z",firstFailedGate:"G3",gates:[{gate:"G0",state:"PASS"},{gate:"G1",state:"PASS"},{gate:"G2",state:"PASS"},{gate:"G3",state:"WAIT",reason:"REACTION_PENDING"}]};
    appendFunnelCycle(record,{root:dir});
    appendFunnelCycle({...record,snapshotTime:"2026-11-11T22:01:00Z"},{root:dir});
    const events=readFunnelCycles("2026-11-11",{root:dir});
    assert.equal(events.length,2);
    const summary=summarizeFunnelCycles(events,"2026-11-11");
    assert.equal(summary.cycles,2);
    assert.equal(summary.distinctCandidates,1);
    assert.equal(summary.stoppedAtGate.G3,2);
    assert.equal(summary.distinctCandidatesReachingGate.G1,1);
    assert.equal(summary.last20.length,2);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test("cannot append a forged trading record",()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),"engine6e-invalid-"));
  try{assert.throws(()=>appendFunnelCycle({schema:"other",readOnly:false},{root:dir,date:"2026-11-11"}),/INVALID_FUNNEL_RECORD/);}
  finally{fs.rmSync(dir,{recursive:true,force:true});}
});
