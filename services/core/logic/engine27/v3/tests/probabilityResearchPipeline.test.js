import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {extractReplayResearchSeed} from "../probability/extractReplayResearchSeed.js";
import {labelEsOutcome} from "../probability/labelEsOutcome.js";
import {createResearchLedger} from "../probability/createResearchLedger.js";
const at="2026-10-26T18:00:00.000Z";
const replay={schema:"engine12.multiStrategyReplay.v1",snapshotTime:at,currentPrice:5800,
 strategies:{"intraday_scalp@10m":{}}};
test("reject missing exact ES contract rather than current root resolver",()=>{
 assert.equal(extractReplayResearchSeed(replay).available,false);
});
test("immutable research seed and outcome require same contract and future time",()=>{
 const seed=extractReplayResearchSeed(replay,{resolvedContract:"ESZ26",sourcePath:"/var/data/replay/es/2026-10-26/1100.json"});
 assert.equal(seed.id.startsWith("E27-ES10-"),true);
 assert.equal(seed.probabilities.up,null);
 assert.equal(labelEsOutcome(seed,[{contract:"ESH27",price:5810,observedAt:"2026-10-26T18:10:00Z"}]).available,false);
 assert.equal(labelEsOutcome(seed,[{contract:"ESZ26",price:5810,observedAt:"2026-10-26T18:09:59Z"}]).available,false);
 const outcome=labelEsOutcome(seed,[{contract:"ESZ26",price:5804,observedAt:"2026-10-26T18:10:00Z"}]);
 assert.equal(outcome.outcome,"UP");
 assert.equal(outcome.returnPoints,4);
 assert.equal(seed.probabilities.up,null);
});
test("duplicate predictions and labels survive new ledger instances",()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"engine27-prob-"));
 try{
  const seed=extractReplayResearchSeed(replay,{resolvedContract:"ESZ26"});
  const first=createResearchLedger({root});
  assert.equal(first.appendPrediction(seed).stored,true);
  const second=createResearchLedger({root});
  assert.equal(second.appendPrediction(seed).duplicate,true);
  const label=labelEsOutcome(seed,[{contract:"ESZ26",price:5800,observedAt:"2026-10-26T18:10:00Z"}]);
  assert.equal(second.appendOutcome(label).stored,true);
  assert.equal(first.appendOutcome(label).duplicate,true);
  assert.equal(second.readPredictions().length,1);
  assert.equal(second.readOutcomes().length,1);
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});
test("future outcomes cannot be backfilled from earlier prices",()=>{
 const seed=extractReplayResearchSeed(replay,{resolvedContract:"ESZ26"});
 assert.equal(labelEsOutcome(seed,[{contract:"ESZ26",price:5805,observedAt:"2026-10-26T18:09:00Z"}]).available,false);
});

test("research ledger refuses concurrent writer lock without altering history",()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"engine27-lock-"));
 try{
  const ledger=createResearchLedger({root});
  const seed=extractReplayResearchSeed(replay,{resolvedContract:"ESZ26"});
  fs.mkdirSync(path.join(root,"predictions.ndjson.lock"));
  assert.throws(()=>ledger.appendPrediction(seed),/RESEARCH_LEDGER_WRITER_BUSY/);
  assert.equal(ledger.readPredictions().length,0);
  fs.rmdirSync(path.join(root,"predictions.ndjson.lock"));
  assert.equal(ledger.appendPrediction(seed).stored,true);
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});
