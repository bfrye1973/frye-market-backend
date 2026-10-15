import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {createHash} from "node:crypto";
import {fileURLToPath} from "node:url";
import {SOURCE_XLSX_SHA256, SOURCE_CELL_JSON_SHA256, DEGREES,
 readWorkbookCellArchive,readOriginalOwnerWorkbookBytes,importAllSourceCells,auditNodeRegistry} from "../scripts/auditEngine22NodeRegistryV1.mjs";

const dir=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../data/engine22/node-registry");
test("corrected owner Excel workbook is byte-for-byte preserved in immutable source archive",()=>{
 const raw=readOriginalOwnerWorkbookBytes();
 assert.equal(raw.length,21141);
 assert.equal(raw.subarray(0,2).toString("ascii"),"PK");
 const hash = createHash("sha256").update(raw).digest("hex");
 assert.equal(hash,SOURCE_XLSX_SHA256);
});
test("source-cell zlib archive round trips verbatim and retains fixed source SHA",()=>{
 const raw=readWorkbookCellArchive();
 assert.equal(raw.sourceSha256,SOURCE_XLSX_SHA256);
 assert.equal(SOURCE_CELL_JSON_SHA256,"3242facd72f1ec1a1d14db02f5a063f8d3bc0b78018c5d434ceeb164c311d604");
 assert.equal(Object.keys(raw.sheets).length,11);
 assert.equal(raw.sheets["All Nodes"].length,41);
 assert.equal(raw.sheets["Fib Levels"].length,35);
 assert.equal(Object.values(raw.sheets).flatMap(rows=>rows.flatMap(row=>row.cells)).length,1113);
 assert.deepEqual(raw.sheets["All Nodes"][1].cells.map(c=>c.cell),["A2","B2","C2","D2","E2"]);
});
test("all seven degrees are imported with unique original source cell addresses",()=>{
 const intake=importAllSourceCells();
 assert.equal(intake.schema,"engine22.node-registry.intake.v1");
 assert.equal(intake.allNodes.length,40);
 assert.equal(intake.fibs.length,34);
 assert.deepEqual(Object.keys(intake.degreeTabs),DEGREES);
 assert.equal(new Set(intake.allNodes.map(n=>n.id)).size,40);
 for(const node of intake.allNodes){
   assert.equal(node.status,"SOURCE_EVIDENCE_PENDING_ENGINE22_RECONCILIATION");
   assert.equal(node.noStructuralPromotion,true);
   assert.ok(node.source.dateCell.startsWith("C"));
   assert.equal(node.priceBasis,"UNVERIFIED_TRADINGVIEW_ES1_ETH_B_ADJ_UNKNOWN");
   assert.equal(node.engine11CandleId,null);
 }
 for(const fib of intake.fibs){
   assert.equal(fib.approval,"SOURCE_EVIDENCE_PENDING_ENGINE22_RECONCILIATION");
   assert.equal(fib.noStructuralPromotion,true);
 }
});
test("owner Minor W1 correction and malformed Minute date retained without inventing repairs",()=>{
 const intake=importAllSourceCells();
 const minor=intake.allNodes.find(n=>n.degree==="MINOR"&&n.node==="W1 starting low");
 assert.equal(minor.price,6496);
 assert.equal(minor.rawDate,46111);
 assert.equal(minor.rawTime,2/3);
 assert.equal(minor.source.dateCell,"C24");
 const minute=intake.allNodes.find(n=>n.degree==="MINUTE"&&n.node==="W1 starting low");
 assert.equal(minute.rawDate,"7/29/206");
 assert.equal(minute.datePrecision,"UNRESOLVED_DATE_TEXT");
 assert.equal(minute.price,7419);
});
test("legacy tabs and owner workbook values coexist without overwriting one another",()=>{
 const intake=importAllSourceCells();
 assert.equal(intake.degreeTabs.MICRO[0].price,7677.25);
 assert.equal(intake.allNodes.find(n=>n.degree==="MICRO"&&n.node==="W1 starting low").price,7706.25);
 assert.equal(intake.degreeTabs.SUBMINUTE[0].price,7575);
 assert.equal(intake.allNodes.find(n=>n.degree==="SUBMINUTE"&&n.node==="W1 starting low").price,7616.25);
 const audit=auditNodeRegistry(intake);
 assert.ok(audit.crossSheetPriceConflicts.length>=10);
 assert.ok(audit.issues.some(i=>i.type==="INVALID_OR_AMBIGUOUS_DATE"));
 assert.equal(audit.pass,true);
});
test("untrusted amended archive fails closed without durable replay or side effects",()=>{
 const src=path.join(dir,"source-cells-zlib"),temp=fs.mkdtempSync(path.join("/tmp","engine22-registry-"));
 try{
  fs.mkdirSync(path.join(temp,"source-cells-zlib"),{recursive:true});
  for(let i=1;i<=3;i++){const name="chunk-0"+i+".b64";fs.copyFileSync(path.join(src,name),path.join(temp,"source-cells-zlib",name));}
  const first=path.join(temp,"source-cells-zlib","chunk-01.b64");
  const content=fs.readFileSync(first,"utf8");fs.writeFileSync(first,(content[0]==="a"?"b":"a")+content.slice(1));
  assert.throws(()=>readWorkbookCellArchive(temp),/WORKBOOK_CELL_ARCHIVE_HASH_DRIFT|invalid|incorrect/i);
 } finally {fs.rmSync(temp,{recursive:true,force:true});}
});
test("Phase 1 tests cannot make any live Engine22 or Engine11 state changes",()=>{
 const archive=readWorkbookCellArchive();const input=JSON.stringify(archive);
 importAllSourceCells(archive);
 assert.equal(JSON.stringify(archive),input);
 const script=fs.readFileSync(fileURLToPath(new URL("../scripts/auditEngine22NodeRegistryV1.mjs",import.meta.url)),"utf8");
 assert.equal(/from\s+["'].*(?:buildStrategySnapshot|engine6|engine7|engine8|engine10)["']/i.test(script),false);
});
