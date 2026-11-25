// Isolated CI-only ES snapshot proof. Writes only to explicit RUNNER_TEMP output.
// Never imports or executes buildStrategySnapshot.js (which has side effects).
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {buildEngine22V3OwnerBootstrap} from "../logic/engine22/v3/buildOwnerBootstrap.js";
import {buildEngine22V3ShadowSnapshot} from "../logic/engine22/v3/buildShadowSnapshot.js";
import {buildEngine22V3ContractProjection} from "../logic/engine22/v3/compareProtectedContracts.js";
const outRoot=process.env.RUNNER_TEMP;
if(!outRoot || !path.isAbsolute(outRoot) || outRoot.startsWith("/var/data") ||
 outRoot.startsWith("/opt/render"))throw new Error("ISOLATED_RUNNER_TEMP_REQUIRED");
const sourcePath=fileURLToPath(new URL("../data/waves/active/active-wave-state-es.json",import.meta.url));
const raw=fs.readFileSync(sourcePath);
const manual=JSON.parse(raw.toString("utf8"));
const initialized=buildEngine22V3OwnerBootstrap({activeWaveState:manual});
if(!initialized.available)throw new Error("BOOTSTRAP_FAILED:"+initialized.reasonCodes);
const shadow=buildEngine22V3ShadowSnapshot({canonical:initialized.canonical});
if(!shadow.available)throw new Error("SHADOW_FAILED:"+shadow.reasonCodes);
const projection=buildEngine22V3ContractProjection({shadow});
if(!projection.available)throw new Error("PROJECTION_FAILED:"+projection.reasonCodes);
const keys=["intraday_submicro","micro","subminute","minute","minor","intermediate","primary"];
if(keys.some(k=>!projection.degreeStates[k]))throw new Error("MISSING_DEGREE");
const report={audit:"ENGINE22_V3_ISOLATED_SNAPSHOT_PROOF",shadowOnly:true,
 sourceFile:"services/core/data/waves/active/active-wave-state-es.json",
 historyMigration:"DEFERRED",originalMicroDiskRead:false,
 canonical:initialized.canonical,
 engine22V3Shadow:shadow,engine22V3Projection:projection,
 protectedLegacyOutputReplaced:false,noTradingActions:true};
const dest=path.join(outRoot,"engine22-v3-snapshot-proof.json");
fs.writeFileSync(dest,JSON.stringify(report,null,2)+"\n",{flag:"wx"});
console.log("ISOLATED_V3_SNAPSHOT_PROOF_PASS",dest);
