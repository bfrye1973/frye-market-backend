import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {previewOwnerSheetAnchorsV1} from "../logic/engine22/history/previewOwnerSheetAnchorsV1.js";
const fixture=JSON.parse(readFileSync(new URL("../logic/engine22/history/fixtures/ownerSheetAnchorsNov8V1.json",import.meta.url),"utf8"));
test("all seven degrees and original source row references remain available",()=>{
 const view=previewOwnerSheetAnchorsV1(fixture);
 assert.deepEqual(Object.keys(view.summary.byDegree).sort(),["primary","intermediate","minor","minute","subminute","micro","submicro"].sort());
 assert.equal(view.summary.total,32);
 assert.equal(view.records.length,32);
 assert.ok(view.records.every(r=>r.sourceWorkbookId===fixture.workbookId&&r.sourceRow>=2));
 assert.equal(view.records.find(r=>r.degree==="primary").rowReference,"Primary!A2:F2");
});
test("research and archived counts are distinct and never owner-approved automatically",()=>{
 const view=previewOwnerSheetAnchorsV1(fixture);
 assert.equal(view.records.find(r=>r.sourceTab==="Minor Original Archive").sourceStatus,"ARCHIVE");
 assert.equal(view.records.find(r=>r.sourceTab==="Minor W1-W2 Proposed").sourceStatus,"RESEARCH");
 assert.ok(view.records.every(r=>r.permanentNodeId===null&&r.plotAllowed===false&&r.publishedAtUtc===null&&r.ownerApprovalReference===null));
 assert.equal(view.ownerApprovalGranted,false);
});
test("unknown Micro high date and candidate Minor low time remain unresolved",()=>{
 const view=previewOwnerSheetAnchorsV1(fixture);
 const micro=view.records.find(r=>r.sourceTab==="Micro W1-W2 Proposed"&&r.label==="W1 ending high");
 assert.equal(micro.ownerDateArizona,"UNKNOWN");
 assert.equal(micro.ownerEsPrice,7469.75);
 assert.equal(micro.timestampEligibleForReview,false);
 const minor=view.records.find(r=>r.label==="W2 observed low candidate");
 assert.equal(minor.ownerTimeArizona,"UNKNOWN");
 assert.equal(minor.timestampEligibleForReview,false);
});
test("different Minute and Minor August 14 times are preserved, not auto-reconciled",()=>{
 const view=previewOwnerSheetAnchorsV1(fixture);
 const minute=view.records.find(r=>r.sourceTab==="Minute ABC Proposed"&&r.label==="A starting high");
 const minor=view.records.find(r=>r.sourceTab==="Minor W1-W2 Proposed"&&r.label==="W1 ending high");
 assert.equal(minute.ownerTimeArizona,"07:00");
 assert.equal(minor.ownerTimeArizona,"03:00");
 assert.ok(minute.warnings.includes("OWNER_SOURCE_RECONCILIATION_REQUIRED"));
});
test("source rows cannot be duplicated or silently changed to off-tick prices",()=>{
 const duplicate=structuredClone(fixture);
 duplicate.tabs[0].rows.push(structuredClone(duplicate.tabs[0].rows[0]));
 assert.throws(()=>previewOwnerSheetAnchorsV1(duplicate),/DUPLICATE_SOURCE_ROW/);
 const offTick=structuredClone(fixture);
 offTick.tabs[0].rows[0][5]="3200.13";
 assert.throws(()=>previewOwnerSheetAnchorsV1(offTick),/PRICE_TICK/);
});
test("historical source reference is not historical-as-of publication approval",()=>{
 const view=previewOwnerSheetAnchorsV1(fixture);
 const primary=view.records.find(r=>r.degree==="primary");
 assert.equal(primary.sourceStatus,"HISTORICAL_REFERENCE");
 assert.equal(primary.verifiedMarketAtUtc,null);
 assert.equal(primary.publishedAtUtc,null);
 assert.equal(primary.plotAllowed,false);
});
