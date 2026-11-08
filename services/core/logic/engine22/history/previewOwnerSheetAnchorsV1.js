// Source-sheet import PREVIEW only. This intentionally generates no nodeId,
// countId, approval event, publishedAt, price-basis approval or plot permission.
const DEGREES=new Set(["PRIMARY","INTERMEDIATE","MINOR","MINUTE","SUBMINUTE","MICRO","SUBMICRO"]);
const unknown=x=>x==null||x===""||x==="UNKNOWN";
const validDate=x=>typeof x==="string"&&/^\d{4}-\d{2}-\d{2}$/.test(x)&&!Number.isNaN(Date.parse(x+"T00:00:00Z"));
const validTime=x=>typeof x==="string"&&/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(x);
const tick=x=>typeof x==="number"&&Number.isFinite(x)&&x>0&&Math.abs(x*4-Math.round(x*4))<1e-8;
const fail=s=>{throw Error("ENGINE22_SHEET_IMPORT_"+s);};
export const SOURCE_SHEET_PREVIEW_SCHEMA="engine22.ownerSheetImportPreview.v1";
export function previewOwnerSheetAnchorsV1(source){
 if(source?.schema!=="engine22.ownerSheetAnchorSource.v1"||!Array.isArray(source.tabs)||!source.workbookId)fail("SOURCE");
 const records=[], seen=new Set();
 for(const tab of source.tabs){
  if(!Number.isInteger(tab.sheetId)||!Array.isArray(tab.rows)||!tab.title)fail("TAB");
  for(const entry of tab.rows){
   if(!Array.isArray(entry)||entry.length!==7)fail("ROW");
   const [row,rawDegree,label,dateArizona,timeArizona,rawPrice,sourceEvidence]=entry;
   if(!Number.isInteger(row)||row<2||!DEGREES.has(rawDegree)||typeof label!=="string"||!label||typeof sourceEvidence!=="string")fail("ROW_FIELDS");
   const rowReference=`${tab.title}!A${row}:F${row}`;
   const sourceKey=`${source.workbookId}:${tab.sheetId}:${row}`;
   if(seen.has(sourceKey))fail("DUPLICATE_SOURCE_ROW");
   seen.add(sourceKey);
   const dateKnown=!unknown(dateArizona)&&validDate(dateArizona);
   const timeKnown=!unknown(timeArizona)&&validTime(timeArizona);
   const price=unknown(rawPrice)?null:Number(rawPrice);
   if(price!==null&&!tick(price))fail("PRICE_TICK");
   const warnings=[];
   if(!dateKnown||!timeKnown)warnings.push("INCOMPLETE_SOURCE_TIMESTAMP");
   if(price===null)warnings.push("MISSING_ES_PRICE");
   if(/approximate|not confirmed|provisional|unknown|not supplied|overwritten|differs|reconcile/i.test(sourceEvidence))
    warnings.push("OWNER_SOURCE_RECONCILIATION_REQUIRED");
   if(tab.title.includes("Proposed"))warnings.push("RESEARCH_NOT_APPROVED");
   if(tab.title.includes("Archive"))warnings.push("PREVIOUS_MODEL_NOT_CURRENT");
   // The raw source date/time is owner-provided Arizona local time, not an
   // exchange-verified event and not proof of a historical publication.
   records.push({
    sourceKey,sourceWorkbookId:source.workbookId,sourceSheetId:tab.sheetId,
    sourceTab:tab.title,sourceRow:row,rowReference,degree:rawDegree.toLowerCase(),
    label,ownerDateArizona:dateArizona??null,ownerTimeArizona:timeArizona??null,
    ownerEsPrice:price,sourceEvidence,sourceStatus:tab.title.includes("Archive")?"ARCHIVE":tab.title.includes("Proposed")?"RESEARCH":"HISTORICAL_REFERENCE",
    timestampEligibleForReview:dateKnown&&timeKnown,
    warnings,permanentNodeId:null,modelVersion:null,ownerApprovalReference:null,
    publishedAtUtc:null,verifiedMarketAtUtc:null,esPriceBasisId:null,
    plotAllowed:false,plotReason:"SOURCE_IMPORT_REQUIRES_OWNER_APPROVAL_AND_ENGINE11_VERIFICATION",
    noExecution:true
   });
  }
 }
 return {schema:SOURCE_SHEET_PREVIEW_SCHEMA,workbookId:source.workbookId,
  records,summary:{total:records.length,byDegree:Object.fromEntries([...DEGREES].map(d=>[d.toLowerCase(),records.filter(x=>x.degree===d.toLowerCase()).length])),
   timestampIncomplete:records.filter(x=>!x.timestampEligibleForReview).length,
   needsReconciliation:records.filter(x=>x.warnings.includes("OWNER_SOURCE_RECONCILIATION_REQUIRED")).length},
  ownerApprovalGranted:false,permanentIdAssignment:false,plotAllowed:false,readOnly:true,noExecution:true};
}
