// Engine 10 — offline, read-only seven-account cutover verification.
// Run on Render only after Engine 8 exports verified opening identities into
// a private file. No production writes, broker orders, or watermark changes.
import fs from "node:fs";
import crypto from "node:crypto";
import {planOctober22Classification,applyClassificationPlanToCopy} from "./logic/journal/oct22ClassificationMigration.js";
import {preflightMinorOpening} from "./logic/journal/minorOpeningPreflight.js";
import {buildRealPerformanceSections} from "./logic/journal/realPerformanceSections.js";
const journalPath=process.env.ENGINE10_JOURNAL_READ_PATH||"/var/data/replay/journal/trade-journal.json";
const evidencePath=process.env.ENGINE8_OCT22_OPENINGS_FILE;
if(!evidencePath)throw Error("ENGINE8_OCT22_OPENINGS_FILE_REQUIRED");
const source=fs.readFileSync(journalPath),trades=JSON.parse(source);
const evidence=JSON.parse(fs.readFileSync(evidencePath,"utf8"));
if(!Array.isArray(trades)||evidence.schema!=="engine8.oct22OriginalSchwabOpeningEvidence.v1"||!Array.isArray(evidence.openings)||evidence.cutoverUtc!=="2026-10-22T07:00:00.000Z")throw Error("INVALID_EVIDENCE_SCHEMA_OR_CUTOVER");
const sha=crypto.createHash("sha256").update(source).digest("hex");
const six=evidence.openings.filter(f=>["SCHWAB_0747","SCHWAB_6380"].includes(f.brokerAccountLabel));
const plan=planOctober22Classification(trades,six);
const minor=evidence.openings.filter(f=>f.brokerAccountLabel==="SCHWAB_5671"&&String(f.brokerTransactionId)==="134209487262");
const minorResult=minor.length===1?preflightMinorOpening(trades,minor[0]):{ok:false,action:"BLOCK",reason:"MINOR_EVIDENCE_MISSING_OR_AMBIGUOUS"};
const copy=plan.ok?applyClassificationPlanToCopy(trades,plan):null;
const sections=copy?buildRealPerformanceSections(copy):null;
const unchanged=copy&&trades.every((t,i)=>{
 const before=structuredClone(t),after=structuredClone(copy[i]);
 delete before.performanceGroup;delete before.performanceClassificationSource;delete before.performanceClassificationVersion;
 delete after.performanceGroup;delete after.performanceClassificationSource;delete after.performanceClassificationVersion;
 return JSON.stringify(before)===JSON.stringify(after);
});
const result={schema:"engine10.oct22OfflineAcceptance.v1",readOnly:true,journalSha256:sha,verifiedOpeningRecords:evidence.openings.length,legacyOpeningRecords:six.length,plan,minorResult,accountingFieldsUnchanged:!!unchanged,sections:sections?{allReal:sections.allReal,unknownRealCampaigns:sections.unknownRealCampaigns,groups:Object.fromEntries(Object.entries(sections.sections).map(([k,v])=>[k,{campaigns:v.campaigns,netRealized:v.netRealized}]))}:null,productionModified:false};
result.pass=plan.ok&&six.length===6&&minor.length===1&&minorResult.ok&&unchanged&&sections.unknownRealCampaigns.length===0;
console.log(JSON.stringify(result,null,2));
if(!result.pass)process.exitCode=2;
