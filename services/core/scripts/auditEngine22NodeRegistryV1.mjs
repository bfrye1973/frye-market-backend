// Engine 22 Phase 1 read-only coordinate registry. Never imported by production.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../data/engine22/node-registry");
const hash = x => crypto.createHash("sha256").update(x).digest("hex");
export const SOURCE_CELL_JSON_SHA256 = "3242facd72f1ec1a1d14db02f5a063f8d3bc0b78018c5d434ceeb164c311d604";
export const SOURCE_XLSX_SHA256 = "6fb824cc5e8469bc66db004b903fbf3caf537d624ad18fcbc24a20815f9f40a8";
export const DEGREES = Object.freeze(["SUBMICRO","MICRO","SUBMINUTE","MINUTE","MINOR","INTERMEDIATE","PRIMARY"]);

export function readOriginalOwnerWorkbookBytes(root=ROOT){
  // Byte-for-byte reversible archive of the corrected owner-provided XLSX.
  // Never writes it into production or replaces the owner's original cells.
  const chunks=Array.from({length:7},(_,i)=>fs.readFileSync(
    path.join(root,"source-workbook-zlib","chunk-"+String(i+1).padStart(2,"0")+".b64"),
    "utf8").trim());
  const bytes=zlib.inflateSync(Buffer.from(chunks.join(""),"base64"));
  if(hash(bytes)!==SOURCE_XLSX_SHA256)throw new Error("OWNER_XLSX_ARCHIVE_HASH_DRIFT");
  if(bytes[0]!==0x50||bytes[1]!==0x4b)throw new Error("OWNER_XLSX_NOT_ZIP");
  return bytes;
}
export function readWorkbookCellArchive(root=ROOT) {
  const parts = [1,2,3].map(i=>fs.readFileSync(path.join(root, "source-cells-zlib", "chunk-0"+i+".b64"),"utf8").trim());
  const json=zlib.inflateSync(Buffer.from(parts.join(""),"base64"));
  if(hash(json)!==SOURCE_CELL_JSON_SHA256) throw new Error("WORKBOOK_CELL_ARCHIVE_HASH_DRIFT");
  const archive=JSON.parse(json.toString("utf8"));
  if(archive.sourceSha256!==SOURCE_XLSX_SHA256) throw new Error("WORKBOOK_SOURCE_HASH_DRIFT");
  return archive;
}

const fromRows=(sheet) => sheet.slice(1).map(row => {
 const obj={};
 for(const cell of row.cells) {
   const column=cell.cell.replace(/[0-9]/g,"");
   obj[column]=cell.value;
 }
 return {sheet:row.sourceSheet??null,row:row.row,columns:obj,cells:row.cells};
});
function datePrecision(raw, cell) {
 if(raw==null||raw==="")return "MISSING";
 if(typeof raw==="string")return /^\\d{4}-\\d{2}-\\d{2}$/.test(raw)?"DATE_ONLY":"UNRESOLVED_DATE_TEXT";
 if(typeof raw==="number" && raw>=10000 && raw<100000 && Number.isInteger(raw))return "EXCEL_SERIAL_DATE";
 return "UNRESOLVED_DATE_TYPE";
}
function timePrecision(raw) {
 if(raw==null||raw==="")return "MISSING";
 if(typeof raw==="number"&&Number.isFinite(raw)&&raw>=0&&raw<=1)return "EXCEL_TIME_FRACTION";
 if(typeof raw==="string"&&/^\\d{2}:\\d{2}$/.test(raw))return "MINUTE_STRING_UNVERIFIED_TIMEZONE";
 return "UNRESOLVED_TIME";
}
function canonValue(c) {
 if(c==null||c==="")return null;
 return Number(c);
}
export function importAllSourceCells(archive=readWorkbookCellArchive()){
 const required=["All Nodes","Start Here","Submicro","Micro","Subminute","Minute","Minor","Intermediate","Primary","Fib Levels","Source Notes"];
 for(const sheet of required)if(!archive.sheets[sheet])throw new Error("MISSING_WORKSHEET_"+sheet);
 const worksheets=Object.fromEntries(required.map(sheet=>[sheet,fromRows(archive.sheets[sheet])]));
 const allNodes=worksheets["All Nodes"].map(r=>({
   id:"OWNER-ALL-"+String(r.row).padStart(3,"0"),
   source:{workbookSha256:archive.sourceSha256,sheet:"All Nodes",row:r.row,priceCell:"E"+r.row,dateCell:"C"+r.row,timeCell:"D"+r.row,waveCell:"B"+r.row},
   degree:r.columns.A,node:String(r.columns.B??"").trim(),
   rawDate:r.columns.C??null,rawTime:r.columns.D??null,rawPrice:r.columns.E??null,
   price:canonValue(r.columns.E),
   datePrecision:datePrecision(r.columns.C),timePrecision:timePrecision(r.columns.D),
   timezone:"UNKNOWN",priceBasis:"UNVERIFIED_TRADINGVIEW_ES1_ETH_B_ADJ_UNKNOWN",
   sourceContract:"UNVERIFIED",sourceCountId:null,engine11CandleId:null,
   status:"SOURCE_EVIDENCE_PENDING_ENGINE22_RECONCILIATION",
   noStructuralPromotion:true,
 }));
 const fibs=worksheets["Fib Levels"].map(r=>({
   id:"OWNER-FIB-"+String(r.row).padStart(3,"0"),
   source:{workbookSha256:archive.sourceSha256,sheet:"Fib Levels",row:r.row,priceCell:"D"+r.row},
   degree:r.columns.A,model:r.columns.B,ratioRaw:r.columns.C,rawPrice:r.columns.D,price:canonValue(r.columns.D),
   reportedState:r.columns.E,officialFieldRaw:r.columns.F,
   caveat:r.columns.G??null,sourceFile:r.columns.H??null,
   approval:"SOURCE_EVIDENCE_PENDING_ENGINE22_RECONCILIATION",
   noStructuralPromotion:true,
 }));
 const degreeTabs=Object.fromEntries(DEGREES.map(degree=>{
   const sheetName=degree[0]+degree.slice(1).toLowerCase();
   return [degree,worksheets[sheetName].map(r=>({sourceSheet:sheetName,sourceRow:r.row,sourceCells:r.cells,
      degree:r.columns.A,node:r.columns.B,date:r.columns.C??null,time:r.columns.D??null,
      price:r.columns.E??null,sourceStatus:r.columns.F??null,
      countId:r.columns.K??null,sourceBasis:r.columns.L??null}))];
 }));
 return {schema:"engine22.node-registry.intake.v1",sourceSha256:archive.sourceSha256,
  sourceCellArchiveSha256:SOURCE_CELL_JSON_SHA256,sourceWorkbookOriginalName:archive.sourceFile,
  importApproval:"PHASE1_SOURCE_EVIDENCE_ONLY",rawWorksheets:worksheets,allNodes,fibs,degreeTabs};
}
export function auditNodeRegistry(intake=importAllSourceCells()){
 const issues=[], conf=[], missing=[];
 const seen=new Set();
 for(const n of intake.allNodes){
   if(!DEGREES.includes(n.degree)) issues.push({type:"UNKNOWN_DEGREE",id:n.id});
   if(seen.has(n.id))issues.push({type:"DUPLICATE_NODE_ID",id:n.id});
   seen.add(n.id);
   if(n.datePrecision.startsWith("UNRESOLVED"))issues.push({type:"INVALID_OR_AMBIGUOUS_DATE",id:n.id,raw:n.rawDate});
   if(n.timePrecision==="UNRESOLVED_TIME")issues.push({type:"INVALID_TIME",id:n.id,raw:n.rawTime});
   if(n.rawPrice!=null && (!Number.isFinite(n.price)||Math.round(n.price*4)!==n.price*4))
     issues.push({type:"NON_ES_TICK_PRICE",id:n.id,price:n.rawPrice});
   if(n.price!=null && (n.rawDate==null || n.rawTime==null))
     missing.push({id:n.id,degree:n.degree,node:n.node,reason:"PRICE_WITH_MISSING_DATE_OR_TIME"});
   const dtab=intake.degreeTabs[n.degree].filter(t=>String(t.node??"").trim().toUpperCase()===n.node.toUpperCase());
   for(const old of dtab){
     const priceDiff=old.price!=null&&n.price!=null && Number(old.price)!==n.price;
     // Some sheet labels are vague; retain all rows but compare exact label only.
     if(priceDiff) conf.push({id:n.id,degree:n.degree,node:n.node,ownerAllNodes:n.price,degreeTab:old.price,
       sourceCells:[n.source.priceCell,old.sourceSheet+"!E"+old.sourceRow],type:"WORKBOOK_CROSS_SHEET_PRICE_CONFLICT"});
   }
 }
 const minor=intake.allNodes.find(n=>n.degree==="MINOR"&&n.node==="W1 starting low");
 if(minor?.price!==6496||minor?.rawDate!==46111)
   issues.push({type:"OWNER_CORRECTION_NOT_APPLIED",id:minor?.id??"MISSING",expected:"2026-03-30 at 6496.00"});
 const minute=intake.allNodes.find(n=>n.degree==="MINUTE"&&n.node==="W1 starting low");
 if(minute?.datePrecision==="UNRESOLVED_DATE_TEXT")
   issues.push({type:"MINUTE_W1_DATE_MALFORMED_DO_NOT_INFER",id:minute.id,raw:minute.rawDate});
 const counts=Object.fromEntries(DEGREES.map(d=>[d,intake.allNodes.filter(n=>n.degree===d).length]));
 return {pass:issues.filter(x=>!["INVALID_OR_AMBIGUOUS_DATE","MINUTE_W1_DATE_MALFORMED_DO_NOT_INFER"].includes(x.type)).length===0,
  issues,crossSheetPriceConflicts:conf,missingDateOrTime:missing,
  nodeCount:intake.allNodes.length,fibCount:intake.fibs.length,
  sheetCount:Object.keys(intake.rawWorksheets).length,degreeCounts:counts};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const intake=importAllSourceCells();const audit=auditNodeRegistry(intake);
 console.log(JSON.stringify({audit,sourceSha256:intake.sourceSha256},null,2));
 if(!audit.pass)process.exitCode=1;
}
