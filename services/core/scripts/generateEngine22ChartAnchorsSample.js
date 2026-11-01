import { writeFileSync, mkdirSync } from "node:fs";
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


if(chartAnchors.modelFingerprint!==authorizedWorkingStructure.modelFingerprint) throw new Error("MODEL_FINGERPRINT_MISMATCH");
if(chartAnchors.evidenceFingerprint!==authorizedWorkingStructure.evidenceFingerprint) throw new Error("EVIDENCE_FINGERPRINT_MISMATCH");
if(chartAnchors.selectionRevision!==authorizedWorkingStructure.publicationRevision) throw new Error("SELECTION_REVISION_MISMATCH");
if(chartAnchors.plotAllowed!==false) throw new Error("PRICE_BASIS_GATE_BROKEN");
console.log("AUTHORITY_PUBLICATION_CONSISTENCY_OK");
