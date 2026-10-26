import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {selectEngine25HistoricalFeatures} from "../probability/selectEngine25HistoricalFeatures.js";
import {readCanonicalReplayWindow} from "../probability/readCanonicalReplayWindow.js";
const at="2026-10-26T18:10:00Z";
const row={sourceTimestamp:"2026-10-26T18:00:00Z",generatedAt:"2026-10-26T18:01:00Z",
 archivedAt:"2026-10-26T18:02:00Z",completeCanonicalSet:true,coveragePct:80,
 stocksWithVolume:4000,advancingBreadthPct:60,decliningBreadthPct:40,
 volumeImbalance:12,strongSectorCount:7,weakSectorCount:2};
test("Engine25 original known-as-of 10m and 30m archive rows are selected",()=>{
 const x=selectEngine25HistoricalFeatures({predictionTimestamp:at,tenMinute:[row],thirtyMinute:[row]});
 assert.equal(x.features.tenMinute.available,true);
 assert.equal(x.features.tenMinute.breadthImbalance,20);
 assert.equal(x.features.thirtyMinute.sectorImbalance,5);
 assert.equal(x.fullHistoricalBlendAvailable,false);
});
test("later archival publication is not known at prediction time",()=>{
 const x=selectEngine25HistoricalFeatures({predictionTimestamp:at,tenMinute:[{...row,archivedAt:"2026-10-26T18:11:00Z"}]});
 assert.equal(x.features.tenMinute.available,false);
});
test("insufficient coverage is not neutralized",()=>{
 const x=selectEngine25HistoricalFeatures({predictionTimestamp:at,tenMinute:[{...row,coveragePct:0}]});
 assert.equal(x.features.tenMinute.reason,"INSUFFICIENT_PARTICIPATION_COVERAGE");
});
test("stale archive is unavailable",()=>{
 const x=selectEngine25HistoricalFeatures({predictionTimestamp:"2026-10-26T19:00:00Z",tenMinute:[row]});
 assert.equal(x.features.tenMinute.reason,"STALE_ARCHIVE");
});
test("read-only replay scan refuses inferred ES root contract and accepts explicit identity",()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),"e27-replay-"));
 try{
  const dir=path.join(root,"2026-10-26");fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir,"1100.json"),JSON.stringify({schema:"engine12.multiStrategyReplay.v1",
   snapshotTime:"2026-10-26T18:00:00Z",currentPrice:5800,strategies:{"intraday_scalp@10m":{}}}));
  const absent=readCanonicalReplayWindow({root,date:"2026-10-26"});
  assert.equal(absent.scanned,1);assert.equal(absent.seeds.length,0);
  const verified=readCanonicalReplayWindow({root,date:"2026-10-26",contractBySnapshot:()=>"ESZ26"});
  assert.equal(verified.seeds.length,1);
  assert.equal(verified.historicalForecastsGenerated,false);
 }finally{fs.rmSync(root,{recursive:true,force:true})}
});
