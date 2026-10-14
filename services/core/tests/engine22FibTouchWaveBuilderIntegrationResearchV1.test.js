import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const source=fs.readFileSync(new URL("../logic/engine22/wave/buildEngine22WaveStrategy.js",import.meta.url),"utf8");
test("production wave strategy builder publishes seven-degree shadow without overriding canonical output",()=>{
 assert.match(source,/import \{ previewSevenDegreeTouchSnapshotV1 \}/);
 assert.match(source,/const sevenDegreeTouchResearch = previewSevenDegreeTouchSnapshotV1\(/);
 assert.match(source,/sevenDegreeTouchResearch,\s*engine22V3NodeEvidence,/);
 assert.match(source,/degreeStates: publishedDegreeStates,/);
 assert.match(source,/engine22Display: publishedEngine22Display,/);
 assert.match(source,/currentWavelength: publishedCurrentWavelength,/);
});
test("shadow input is optional and publication is isolated",()=>{
 assert.match(source,/engine22TouchResearchModels \?\? \{\}/);
 assert.match(source,/context\.engine22TouchResearchObservations/);
 assert.doesNotMatch(source,/persistSevenDegreeFibTouch/);
});
