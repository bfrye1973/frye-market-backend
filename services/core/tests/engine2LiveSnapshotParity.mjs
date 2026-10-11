// Read-only LIVE published ES snapshot parity. No broker writes, secrets, or account data output.
import assert from "node:assert/strict";
import { buildEngine2ChartOverlayV1, validateEngine2ChartOverlayV1 } from "../logic/engine2/buildEngine2ChartOverlayV1.js";

const url = "https://frye-market-backend-1.onrender.com/api/v1/dashboard-snapshot?symbol=ES";
const response = await fetch(url, {signal:AbortSignal.timeout(45000),headers:{Accept:"application/json"}});
assert.equal(response.ok,true,"Published ES dashboard snapshot must be readable");
const snapshot = await response.json();
const owner = snapshot?.strategies?.["intraday_scalp@10m"]?.engine22WaveStrategy;
assert.ok(owner?.degreeStates && owner?.currentWavelength, "Published Engine22 structural output required");
const chart = buildEngine2ChartOverlayV1(snapshot,"ES");
const checked = validateEngine2ChartOverlayV1(chart);
assert.deepEqual(checked.errors,[],"Adapter output must satisfy v1 contract");
const records = [];
for(const degree of ["primary","intermediate","minor","minute","micro"]) {
  const block = chart.degrees[degree];
  assert.equal(block.degree,degree);
  assert.equal(block.sourceDegree,degree);
  const source = degree === "micro" ? owner.currentWavelength?.degrees?.micro : owner.degreeStates?.[degree];
  assert.equal(block.provenance.fallbackUsed,false);
  if(!source) {assert.equal(block.drawable,false);records.push({degree,sourceAvailable:false});continue;}
  if(degree==="micro") {
    const levelPrices=(Array.isArray(source.levels)?source.levels:Object.values(source.levels||{}))
      .map(v=>typeof v==="object"?Number(v.price):Number(v)).filter(Number.isFinite);
    for(const line of block.lines.filter(l=>l.kind==="FIB"))
      assert.ok(levelPrices.includes(line.price),"Unpublished Micro fib price in chart: "+line.price);
    const referencePrices=[...(source.microSequence?.projectedW1||[]),...(source.microSequence?.projectedW2||[])]
      .map(v=>Number(v?.price)).filter(Number.isFinite);
    for(const line of block.lines.filter(l=>l.kind==="FIB_CONTEXT"))
      assert.ok(line.referenceOnly===true && referencePrices.includes(line.price),
        "Unpublished or misidentified Micro historical reference: "+line.price);
    assert.match(block.provenance.structuralSource,/currentWavelength.degrees.micro/);
  } else {
    const active = source.activeFibModel?.active===true ? source.activeFibModel : null;
    const levelPrices=(Array.isArray(active?.levels)?active.levels:Object.values(active?.levels||{}))
      .map(v=>typeof v==="object"?Number(v.price):Number(v)).filter(Number.isFinite);
    for(const line of block.lines.filter(l=>l.kind==="FIB"))
      assert.ok(levelPrices.includes(line.price),"Unpublished "+degree+" fib price in chart: "+line.price);
  }
  records.push({degree,sourceAvailable:true,drawable:block.drawable,
    marks:block.marks.length,levels:block.lines.filter(l=>l.kind==="FIB").length,
    historicalFibReferences:block.lines.filter(l=>l.kind==="FIB_CONTEXT").length,
    reason:block.reason||null,
    activeWave:source.activeWave||null,
    activeFibActive:source.activeFibModel?.active ?? null,
    activeFibModelType:source.activeFibModel?.modelType||null,
    microProjectedW1:source.microSequence?.projectedW1?.length ?? null,
    microProjectedW2:source.microSequence?.projectedW2?.length ?? null});
}
console.log("LIVE_ENGINE22_SNAPSHOT_PARITY_PASS",JSON.stringify({
  schema:chart.schemaVersion,sourceMode:owner.currentWavelength?.sourceMode||null,
  authorityConflict:chart.snapshot?.authorityConflict,records
}));
