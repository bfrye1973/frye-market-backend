// Engine 10 — production cutover preflight, READ ONLY.
// Never writes Journal, changes Schwab orders, or advances watermarks.
// Fails closed if live Journal or private evidence changed since acceptance.
import fs from "node:fs";
import crypto from "node:crypto";
import {planOctober22Classification,applyClassificationPlanToCopy} from "./logic/journal/oct22ClassificationMigration.js";
import {preflightMinorOpening} from "./logic/journal/minorOpeningPreflight.js";
import {buildRealPerformanceSections} from "./logic/journal/realPerformanceSections.js";

const acceptedJournalHash="13757373ae6ed4f0b0cc0ea489269695cc33e89791972472a6450243375fada5";
const acceptedEvidenceHash="a4b3134268468f213288f808a3474f351a057a9f7394e46c90ff4786d967da15";
const journalPath=process.env.ENGINE10_JOURNAL_READ_PATH||"/var/data/replay/journal/trade-journal.json";
const evidencePath=process.env.ENGINE8_OCT22_OPENINGS_FILE;
if(!evidencePath)throw Error("ENGINE8_OCT22_OPENINGS_FILE_REQUIRED");
const sha=bytes=>crypto.createHash("sha256").update(bytes).digest("hex");
const journalBytes=fs.readFileSync(journalPath),evidenceBytes=fs.readFileSync(evidencePath);
const journalHash=sha(journalBytes),evidenceHash=sha(evidenceBytes);
const journal=JSON.parse(journalBytes),evidence=JSON.parse(evidenceBytes);
if(!Array.isArray(journal)||evidence.schema!=="engine8.oct22OriginalSchwabOpeningEvidence.v1"||!Array.isArray(evidence.openings))throw Error("INVALID_INPUT_SCHEMA");
const openings=evidence.openings.filter(f=>["SCHWAB_0747","SCHWAB_6380"].includes(f.brokerAccountLabel));
const plan=planOctober22Classification(journal,openings);
const minor=evidence.openings.filter(f=>f.brokerAccountLabel==="SCHWAB_5671"&&String(f.brokerTransactionId)==="134209487262");
const minorResult=minor.length===1?preflightMinorOpening(journal,minor[0]):{ok:false,action:"BLOCK",reason:"MINOR_EVIDENCE_AMBIGUOUS"};
const candidate=plan.ok?applyClassificationPlanToCopy(journal,plan):null;
const reporting=candidate?buildRealPerformanceSections(candidate):null;
const currentReal=journal.filter(t=>t.accountMode==="REAL");
const candidateReal=candidate?.filter(t=>t.accountMode==="REAL")||[];
const preserved=!!candidate&&journal.length===candidate.length&&journal.every((t,i)=>{
 const original=structuredClone(t),updated=structuredClone(candidate[i]);
 for(const field of ["performanceGroup","performanceClassificationSource","performanceClassificationVersion"]){delete original[field];delete updated[field];}
 return JSON.stringify(original)===JSON.stringify(updated);
});
const result={
 schema:"engine10.sevenRealCutoverPreflight.v1",readOnly:true,
 journalHash,evidenceHash,
 journalMatchesAcceptedBaseline:journalHash===acceptedJournalHash,
 evidenceMatchesAcceptedBaseline:evidenceHash===acceptedEvidenceHash,
 journalCampaigns:journal.length,realCampaigns:currentReal.length,
 plannedClassificationChanges:plan.changes.length,
 classificationPlanOk:plan.ok,
 migrationPreservesEveryOtherField:preserved,
 minorAction:minorResult.action,minorOk:minorResult.ok,
 allRealCampaigns:reporting?.allReal.campaigns??null,
 unknownRealCampaigns:reporting?.unknownRealCampaigns.length??null,
 productionModified:false,
};
result.readyForControlledCutover=result.journalMatchesAcceptedBaseline&&result.evidenceMatchesAcceptedBaseline&&plan.ok&&preserved&&minorResult.ok&&reporting?.unknownRealCampaigns.length===0&&candidateReal.length===currentReal.length;
console.log(JSON.stringify(result,null,2));
if(!result.readyForControlledCutover)process.exitCode=2;
