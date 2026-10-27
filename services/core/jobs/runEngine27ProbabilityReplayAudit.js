// Engine27 read-only replay audit: no writes, no model retraining, no orders.
// Run from services/core: ENGINE27_REPLAY_AUDIT_DATE=YYYY-MM-DD node jobs/runEngine27ProbabilityReplayAudit.js
import fs from "node:fs";
import path from "node:path";
import {readCanonicalReplayWindow} from "../logic/engine27/v3/probability/readCanonicalReplayWindow.js";
import {backtestReplayOutcomes} from "../logic/engine27/v3/probability/backtestReplayOutcomes.js";
const date=process.env.ENGINE27_REPLAY_AUDIT_DATE??"";
const root=process.env.REPLAY_DATA_DIR?path.join(process.env.REPLAY_DATA_DIR,"replay","es"):"/var/data/replay/es";
const exact=process.env.ENGINE27_REPLAY_AUDIT_EXACT_CONTRACT??"";
if(!/^\d{4}-\d{2}-\d{2}$/.test(date)){
 console.log(JSON.stringify({ok:false,reason:"DATE_REQUIRED_YYYY_MM_DD"}));process.exitCode=1;
}else{
 const folder=path.join(root,date);
 if(!fs.existsSync(folder)){
  console.log(JSON.stringify({ok:false,reason:"REPLAY_DATE_NOT_FOUND",date}));process.exitCode=1;
 }else{
  const names=fs.readdirSync(folder).filter(x=>/^\d{4}\.json$/.test(x)).sort().slice(0,500);
  const snapshots=[],unreadable=[];
  for(const name of names){
   try{snapshots.push(JSON.parse(fs.readFileSync(path.join(folder,name),"utf8")))}
   catch{unreadable.push(name)}
  }
  // An explicit contract is a research assertion requiring independent verification.
  // Without it, fail closed: do not use today's ES root contract.
  const contractBySnapshot=()=>/^ES[FGHJKMNQUVXZ]\d{1,2}$/.test(exact)?exact:null;
  const report=backtestReplayOutcomes({snapshots,contractBySnapshot});
  console.log(JSON.stringify({schema:"engine27.v3.probabilityReplayAuditReport.v1",
   date,readOnly:true,exactContractAssertion:exact||null,
   contractIdentityIndependentlyVerified:false,
   marketOutcomeResearchOnly:true,unreadable,
   scanned:report.totalSnapshots,eligibleSeeds:report.eligibleSeeds,
   labeledOutcomes:report.labeledOutcomes,outcomeCounts:report.outcomeCounts,
   rejected:report.rejected.slice(0,20),
   probabilities:report.probabilities,accuracy:report.accuracy,
   calibration:report.calibration,noExecution:true},null,2));
 }
}
