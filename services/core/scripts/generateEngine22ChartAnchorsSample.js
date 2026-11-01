import { writeFileSync, mkdirSync } from "node:fs";
import { buildEngine22WaveStrategy } from "../logic/engine22/wave/buildEngine22WaveStrategy.js";
import { buildCurrentWavelength } from "../logic/engine22/wave/buildCurrentWavelength.js";
import { buildAuthorizedWorkingStructureV1 } from "../logic/engine22/wave/buildAuthorizedWorkingStructureV1.js";
import { buildEngine22ChartAnchorsV1 } from "../logic/engine22/wave/buildEngine22ChartAnchorsV1.js";

// Generated from actual Engine22 builders, not a captured deployed strategy snapshot.
// Do not claim live publication or historical point-in-time evidence.
const currentWavelength=buildCurrentWavelength({symbol:"ES",currentPrice:7558.25});
const degreeStates={minor:{activeWave:"W5",direction:"UP"},intermediate:{activeWave:"W3",direction:"UP"},primary:{activeWave:"W5",direction:"UP"}};
const authorizedWorkingStructure=buildAuthorizedWorkingStructureV1({currentWavelength,degreeStates});
const chartAnchors=buildEngine22ChartAnchorsV1({currentWavelength,authorizedWorkingStructure,metadata:{degreeStates}});
const output={strategies:{"intraday_scalp@10m":{engine22WaveStrategy:{authorizedWorkingStructure,chartAnchors}}}};
mkdirSync("services/core/artifacts/engine22g",{recursive:true});
writeFileSync("services/core/artifacts/engine22g/chart-anchors-generated.json",JSON.stringify(output,null,2)+"\n");
console.log(JSON.stringify({schema:chartAnchors.schema,selectionRevision:chartAnchors.selectionRevision,degreeCount:Object.keys(chartAnchors.degrees).length,submicroScenarios:chartAnchors.degrees.submicro.scenarios.length,subminuteFibGroups:chartAnchors.degrees.subminute.fibGroups.length,plotAllowed:chartAnchors.plotAllowed}));

const runtime=buildEngine22WaveStrategy({
  symbol:"ES",marketType:"FUTURES",strategyId:"intraday_scalp@10m",tf:"10m",
  currentPrice:7558.25,
  engine2State:{subminute:{activeWave:"W3",direction:"UP",stage:"ACTIVE",
    marks:{W1:{low:{price:7671.5,time:"2026-10-01"},high:{price:7805,time:"2026-10-02"},status:"CONFIRMED"}}}},
});
if (!runtime.chartAnchors) throw new Error("STRATEGY_CHART_ANCHORS_MISSING");
if (runtime.chartAnchors.modelFingerprint !== runtime.authorizedWorkingStructure?.modelFingerprint)
  throw new Error("STRATEGY_MODEL_FINGERPRINT_MISMATCH");
if (runtime.chartAnchors.evidenceFingerprint !== runtime.authorizedWorkingStructure?.evidenceFingerprint)
  throw new Error("STRATEGY_EVIDENCE_FINGERPRINT_MISMATCH");
if (runtime.chartAnchors.plotAllowed !== false) throw new Error("PLOT_GATE_BROKEN");
writeFileSync("services/core/artifacts/engine22g/chart-anchors-strategy-generated.json",
 JSON.stringify({strategies:{"intraday_scalp@10m":{engine22WaveStrategy:runtime}}},null,2)+"\\n");
console.log("STRATEGY_WRAPPER_CHART_CONSISTENCY_OK");
