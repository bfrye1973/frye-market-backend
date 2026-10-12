// Exact-production-commit differential test. Must only run in ephemeral CI.
// Baseline and candidate run with identical deterministic input; separate temp storage.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";
const root=process.env.RUNNER_TEMP;
if(!root || !path.isAbsolute(root) || root.startsWith("/var/data") || root.startsWith("/opt/render"))
 throw new Error("ISOLATED_CI_RUNNER_REQUIRED");
const base=process.env.ENGINE22_BASE_CHECKOUT;
const head=process.env.GITHUB_WORKSPACE;
if(!base || !head || !fs.existsSync(path.join(base,"services/core/logic/engine22/wave/buildEngine22WaveStrategy.js")))
 throw new Error("EXACT_BASE_CHECKOUT_REQUIRED");
const baselineSha="9cee0f86682ea65e8182467c2049ec98b31643d0";
const now=Date.parse("2026-10-11T12:00:00Z");
const invocation=`
import {pathToFileURL} from "node:url";
const source=process.argv[1];
const {buildEngine22WaveStrategy}=await import(pathToFileURL(source).href);
const originalNow=Date.now;
Date.now=()=>${now};
try {
 const result=buildEngine22WaveStrategy({symbol:"ES",marketType:"FUTURES",strategyId:"intraday_scalp@10m",tf:"10m",currentPrice:7835,engine2State:{subminute:{activeWave:"W3",direction:"UP",stage:"ACTIVE",marks:{W1:{low:{price:7671.5,time:"2026-10-01"},high:{price:7805,time:"2026-10-02"},status:"CONFIRMED"}}}}});
 process.stdout.write(JSON.stringify(result));
} finally { Date.now=originalNow; }
`;
function run(rootDir,name){
 const tmp=path.join(root,"engine22-compare-"+name);
 fs.mkdirSync(tmp,{recursive:true});
 const env={...process.env,
  ENGINE22_MICRO_RUNTIME_STATE_PATH:path.join(tmp,"wave-runtime.json"),
  ENGINE22_WAVE_RUNTIME_STATE_PATH:path.join(tmp,"runtime.json"),
  ENGINE22_MICRO_V2_STATE_DIR:path.join(tmp,"micro-v2"),
  ENGINE22_WAVE_RUNTIME_STATE_DISABLE_WRITE:"1",
  ENGINE22_MICRO_REPLAY_ROOT:path.join(tmp,"replay"),
  REPLAY_DATA_DIR:tmp,
  ENGINE22_V3_SHADOW_COMPARE_ONLY:"1",
 };
 const module=path.join(rootDir,"services/core/logic/engine22/wave/buildEngine22WaveStrategy.js");
 const child=spawnSync(process.execPath,["--input-type=module","-e",invocation,module],{
  env,cwd:path.join(rootDir,"services/core"),encoding:"utf8",maxBuffer:8*1024*1024,timeout:30000
 });
 if(child.status!==0)throw new Error(name+"_BUILD_FAILED: "+(child.stderr||child.stdout).slice(0,1500));
 return JSON.parse(child.stdout);
}
const before=run(base,"baseline");
const after=run(head,"candidate");
const protectedKeys=["degreeStates","engine22Display","currentWavelength","microExecutionContext",
 "waveOpportunity","currentLifecycleState","activeFibModel","tradeDecision","tradeContextSummary",
 "topCandidate","action","bias"];
const differences=protectedKeys.filter(k=>JSON.stringify(before[k]??null)!==JSON.stringify(after[k]??null));
const report={type:"ENGINE22_V3_EXACT_COMMIT_COMPARISON",productionSha:baselineSha,
 input:{symbol:"ES",strategyId:"intraday_scalp@10m",tf:"10m",currentPrice:7835},
 timestamp:"2026-10-11T12:00:00Z",protectedKeys,
 differences,unchanged:differences.length===0,
 oldMicroHistoryMigrated:false,shadowOnly:true,productionDiskAccessed:false};
const out=path.join(root,"engine22-v3-exact-commit-compare.json");
fs.writeFileSync(out,JSON.stringify(report,null,2)+"\n",{flag:"wx"});
console.log(JSON.stringify(report));
if(differences.length)process.exitCode=1;
