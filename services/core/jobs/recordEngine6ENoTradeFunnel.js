// Run only in an explicitly isolated diagnostic environment.
// This job never calls the executor, broker, management, permission or journal writers.
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {buildNoTradeFunnel} from "../logic/engine6/6e-funnel/buildNoTradeFunnel.js";
import {appendFunnelCycle} from "../logic/engine6/6e-funnel/funnelDiagnosticStore.js";
const dirname=path.dirname(fileURLToPath(import.meta.url));
const input=process.env.ENGINE6E_ES_SNAPSHOT_FILE||path.resolve(dirname,"../data/strategy-snapshot-es.json");
const output=process.env.ENGINE6E_FUNNEL_DIR;
const forbidden=path.resolve(dirname,"../data");
if(process.env.ENGINE6E_FUNNEL_DIAGNOSTICS_ENABLED!=="1"){
  console.log(JSON.stringify({ok:true,skipped:true,reason:"DIAGNOSTIC_WRITES_NOT_ENABLED"}));
  process.exit(0);
}
if(!output || path.resolve(output)===forbidden || path.resolve(output).startsWith(forbidden+path.sep)){
  throw new Error("ISOLATED_FUNNEL_DIR_REQUIRED");
}
const snapshot=JSON.parse(fs.readFileSync(input,"utf8"));
const record=buildNoTradeFunnel(snapshot); // no assumed order creation
const stored=appendFunnelCycle(record,{root:output});
console.log(JSON.stringify({ok:true,mode:"DIAGNOSTICS_ONLY",date:stored.date,
  firstFailedGate:record.firstFailedGate,state:record.firstFailureState,candidateId:record.candidateId,
  noTradingWrites:true,noBrokerCalls:true}));
