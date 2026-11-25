import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {buildDegreeStates} from "../logic/engine22/wave/buildDegreeStates.js";
import {buildEngine22Display} from "../logic/engine22/wave/buildEngine22Display.js";
import {buildEngine22WorkingWaveNodesV1} from "../logic/engine22/wave/buildEngine22WorkingWaveNodesV1.js";

const source=JSON.parse(readFileSync(new URL("../data/waves/active/active-wave-state-es.json",import.meta.url),"utf8"));
const states=buildDegreeStates({activeStructures:source.activeStructures});
const packet=buildEngine22WorkingWaveNodesV1({
  symbol:"ES",degreeStates:states,currentWavelength:{symbol:"ES",degrees:{}}
});
const display=buildEngine22Display({degreeStates:states,currentWavelength:{degrees:{}}});
const expected={
  primary:[
    ["W1 LOW",2440,"2020-04-01 08:00 AZ"],
    ["W1 HIGH",4806,"2022-01-04 10:00 AZ"],
    ["W2",3504,"2022-10-13 09:00 AZ"],
    ["W3",6157,"2025-02-19 09:00 AZ"],
    ["W4",4825,"2025-04-07 07:00 AZ"],
  ],
  intermediate:[
    ["W1 LOW",4877,"2025-04-09 07:00 AZ"],
    ["W1 HIGH",7044,"2026-01-28 10:00 AZ"],
    ["W2",6345,"2026-03-31 03:00 AZ"],
  ]
};
test("latest owner Current-sheet values reach Strategy-card marks and existing Engine2 node packet",()=>{
  for(const degree of ["primary","intermediate"]){
    const nodes=packet.degrees[degree].nodes;
    assert.deepEqual(nodes.map(n=>[n.label,n.price,n.ownerArizonaTime]),expected[degree]);
    assert(nodes.every(n=>n.marketAtUtc?.endsWith("Z")&&n.sourceRevision&&n.noExecution));
    assert.equal(packet.degrees[degree].coverageStatus,"VALIDATED_RESEARCH_NODES");
  }
  assert.equal(display.degrees.primary.rows.find(r=>r.label==="W1").value,"2440.00 → 4806.00");
  assert.equal(display.degrees.intermediate.rows.find(r=>r.label==="W1").value,"4877.00 → 7044.00");
  assert.equal(display.degrees.primary.rows.find(r=>r.label==="W4").value.includes("4825.00"),true);
});
test("Minute/Subminute remain empty and no owner count is promoted",()=>{
  assert.equal(packet.degrees.minute.nodes.length,0);
  assert.equal(packet.degrees.subminute.nodes.length,0);
  assert.equal(packet.ownerCountPromotion,false);
  assert.equal(packet.noExecution,true);
});
