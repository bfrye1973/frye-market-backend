import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { buildDegreeStates } from "../logic/engine22/wave/buildDegreeStates.js";
import { buildCurrentWavelength } from "../logic/engine22/wave/buildCurrentWavelength.js";
import { buildEngine2ChartOverlayV1 } from "../logic/engine2/buildEngine2ChartOverlayV1.js";

test("published Engine22 builder output integrates with five-degree chart adapter", () => {
  const raw=JSON.parse(fs.readFileSync(new URL("../data/waves/active/active-wave-state-es.json",import.meta.url),"utf8"));
  const degreeStates=buildDegreeStates({activeStructures:raw.activeStructures,currentPrice:7800});
  const currentWavelength=buildCurrentWavelength({symbol:"ES",currentPrice:7800,degreeStates});
  const snapshot={symbol:"ES",strategies:{"intraday_scalp@10m":{engine22WaveStrategy:{degreeStates,currentWavelength}}}};
  const output=buildEngine2ChartOverlayV1(snapshot);
  assert.equal(output.ok,true);
  assert.deepEqual(Object.keys(output.degrees),["primary","intermediate","minor","minute","micro"]);
  assert.equal(output.degrees.micro.provenance.structuralSource,"engine22WaveStrategy.currentWavelength.degrees.micro");
  assert.notEqual(output.degrees.micro.provenance.structuralSource,"engine22WaveStrategy.degreeStates.subminute");
  assert.ok(output.degrees.micro.lines.length>0,"Micro should have independently published projected levels");
  for(const degree of ["primary","intermediate","minor","minute"]) {
    assert.equal(output.degrees[degree].provenance.structuralSource,`engine22WaveStrategy.degreeStates.${degree}`);
    const active=degreeStates[degree]?.activeFibModel;
    if(active?.active===true && active.levels && typeof active.levels==="object") {
      const sourcePrices=Object.values(active.levels).map(v=>typeof v==="object"?v?.price:v)
        .map(Number).filter(v=>Number.isFinite(v)&&v>0);
      for(const level of output.degrees[degree].lines.filter(l=>l.kind==="FIB")) {
        assert.ok(sourcePrices.includes(level.price),`${degree} unexpected fib price ${level.price}`);
      }
    }
  }
  assert.equal(output.degrees.micro.wave.authorityConflict,true);
});
