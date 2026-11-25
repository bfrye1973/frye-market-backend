#!/usr/bin/env node
// Engine 10: guarded cutover candidate preparation. NO PRODUCTION WRITES.
// Builds a complete candidate and private backup in an isolated workspace.
// Actual live replacement must be separately authorized after writer quiescence.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {planOctober22Classification,applyClassificationPlanToCopy} from "./logic/journal/oct22ClassificationMigration.js";
import {preflightMinorOpening} from "./logic/journal/minorOpeningPreflight.js";
const JOURNAL=process.env.ENGINE10_JOURNAL_READ_PATH||"/var/data/replay/journal/trade-journal.json";
const EVIDENCE=process.env.ENGINE8_OCT22_OPENINGS_FILE;
const EXPECTED_JOURNAL="13757373ae6ed4f0b0cc0ea489269695cc33e89791972472a6450243375fada5";
const EXPECTED_EVIDENCE="a4b3134268468f213288f808a3474f351a057a9f7394e46c90ff4786d967da15";
const sha=b=>crypto.createHash("sha256").update(b).digest("hex");
if(!EVIDENCE)throw Error("ENGINE8_OCT22_OPENINGS_FILE_REQUIRED");
const j=fs.readFileSync(JOURNAL),e=fs.readFileSync(EVIDENCE);
if(sha(j)!==EXPECTED_JOURNAL)throw Error("STOP_LIVE_JOURNAL_CHANGED");
if(sha(e)!==EXPECTED_EVIDENCE)throw Error("STOP_EVIDENCE_CHANGED");
const trades=JSON.parse(j),evidence=JSON.parse(e);
if(!Array.isArray(trades)||evidence.schema!=="engine8.oct22OriginalSchwabOpeningEvidence.v1"||evidence.cutoverUtc!=="2026-10-22T07:00:00.000Z"||!Array.isArray(evidence.openings))throw Error("INVALID_INPUT_SCHEMA");
const expected=new Map([["SCHWAB_0747",3],["SCHWAB_6380",3],["SCHWAB_5671",1]]);
const counts=Object.fromEntries([...expected.keys()].map(k=>[k,evidence.openings.filter(f=>f.brokerAccountLabel===k).length]));
if(evidence.openings.length!==7||evidence.openings.some(f=>!expected.has(f.brokerAccountLabel))||[...expected].some(([k,n])=>counts[k]!==n))throw Error("WRONG_EVIDENCE_POPULATION");
const six=evidence.openings.filter(f=>f.brokerAccountLabel!=="SCHWAB_5671");
const plan=planOctober22Classification(trades,six);
if(!plan.ok||plan.changes.length!==2||new Set(plan.changes.map(c=>c.performanceGroup)).size!==2||!plan.changes.some(c=>c.performanceGroup==="MICRO")||!plan.changes.some(c=>c.performanceGroup==="SUBMICRO"))throw Error("CLASSIFICATION_PLAN_FAILED");
const minor=evidence.openings.find(f=>f.brokerAccountLabel==="SCHWAB_5671");
const minorResult=preflightMinorOpening(trades,minor);
if(!minorResult.ok)throw Error("MINOR_PREFLIGHT_FAILED:"+minorResult.reason);
const candidate=applyClassificationPlanToCopy(trades,plan);
if(candidate.length!==trades.length)throw Error("CAMPAIGN_COUNT_CHANGED");
for(let i=0;i<trades.length;i++){
 const a=structuredClone(trades[i]),b=structuredClone(candidate[i]);
 for(const key of ["performanceGroup","performanceClassificationSource","performanceClassificationVersion"]){delete a[key];delete b[key];}
 if(JSON.stringify(a)!==JSON.stringify(b))throw Error("UNAUTHORIZED_ACCOUNTING_CHANGE");
}
const candidateBytes=Buffer.from(JSON.stringify(candidate,null,2)+"\n");
const stamp=new Date().toISOString().replace(/[:.]/g,"-");
const workspace=path.join(process.env.ENGINE10_CUTOVER_WORKSPACE||"/var/data/replay/journal-recovery-sandbox",`seven-real-prepared-${stamp}`);
fs.mkdirSync(workspace,{recursive:false,mode:0o700});
const write=(name,bytes)=>{const file=path.join(workspace,name);fs.writeFileSync(file,bytes,{flag:"wx",mode:0o600});return {path:file,sha256:sha(fs.readFileSync(file))};};
const backup=write("original-journal.json",j);
const proposed=write("candidate-journal.json",candidateBytes);
const report={schema:"engine10.sevenRealPreparedCandidate.v1",preparedAt:new Date().toISOString(),productionModified:false,original:backup,candidate:proposed,originalCampaigns:trades.length,candidateCampaigns:candidate.length,classificationChanges:plan.changes.map(c=>({tradeId:c.tradeId,from:c.previousPerformanceGroup,to:c.performanceGroup})),minorAction:minorResult.action,accountCounts:counts,notice:"NO LIVE JOURNAL REPLACEMENT; NO MINOR INGESTION; NO WATERMARK CHANGE"};
write("manifest.json",Buffer.from(JSON.stringify(report,null,2)+"\n"));
console.log(JSON.stringify(report,null,2));
