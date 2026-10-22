#!/usr/bin/env node
// Engine 10 safe cutover readiness gate. READ ONLY.
// Uses original accepted evidence and latest Journal. Blocks if either changed.
import fs from "node:fs";
import crypto from "node:crypto";
import {planOctober22Classification,applyClassificationPlanToCopy} from "./logic/journal/oct22ClassificationMigration.js";
import {preflightMinorOpening} from "./logic/journal/minorOpeningPreflight.js";
import {buildRealPerformanceSections} from "./logic/journal/realPerformanceSections.js";
const file=process.env.ENGINE10_JOURNAL_READ_PATH||"/var/data/replay/journal/trade-journal.json";
const evidenceFile=process.env.ENGINE8_OCT22_OPENINGS_FILE;
if(!evidenceFile)throw Error("ENGINE8_OCT22_OPENINGS_FILE_REQUIRED");
const hash=b=>crypto.createHash("sha256").update(b).digest("hex");
const j=fs.readFileSync(file),e=fs.readFileSync(evidenceFile);
const journal=JSON.parse(j),evidence=JSON.parse(e);
if(!Array.isArray(journal)||evidence.schema!=="engine8.oct22OriginalSchwabOpeningEvidence.v1"||!Array.isArray(evidence.openings))throw Error("INVALID_EVIDENCE_OR_JOURNAL");
const expectedJournal="13757373ae6ed4f0b0cc0ea489269695cc33e89791972472a6450243375fada5";
const expectedEvidence="a4b3134268468f213288f808a3474f351a057a9f7394e46c90ff4786d967da15";
const currentJournalHash=hash(j),currentEvidenceHash=hash(e);
const six=evidence.openings.filter(f=>["SCHWAB_0747","SCHWAB_6380"].includes(f.brokerAccountLabel));
const plan=planOctober22Classification(journal,six);
const minor=evidence.openings.filter(f=>f.brokerAccountLabel==="SCHWAB_5671"&&String(f.brokerTransactionId)==="134209487262");
const minorResult=minor.length===1?preflightMinorOpening(journal,minor[0]):{ok:false,action:"BLOCK",reason:"MINOR_EVIDENCE_AMBIGUOUS"};
const candidate=plan.ok?applyClassificationPlanToCopy(journal,plan):null;
const sections=candidate?buildRealPerformanceSections(candidate):null;
const preserved=!!candidate&&journal.length===candidate.length&&journal.every((t,i)=>{
 const a=structuredClone(t),b=structuredClone(candidate[i]);
 for(const k of ["performanceGroup","performanceClassificationSource","performanceClassificationVersion"]){delete a[k];delete b[k];}
 return JSON.stringify(a)===JSON.stringify(b);
});
const ready=currentJournalHash===expectedJournal&&currentEvidenceHash===expectedEvidence&&plan.ok&&plan.changes.length===2&&minorResult.ok&&preserved&&sections?.unknownRealCampaigns.length===0;
console.log(JSON.stringify({schema:"engine10.cutoverReadiness.v1",ready,readOnly:true,journalHash:currentJournalHash,evidenceHash:currentEvidenceHash,classificationChanges:plan.changes.length,minorAction:minorResult.action,accountingPreserved:preserved,unknownCampaigns:sections?.unknownRealCampaigns.length??null,productionModified:false},null,2));
if(!ready)process.exitCode=2;
