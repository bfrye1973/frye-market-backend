import {execFileSync} from "node:child_process";
import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,rmSync,readFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {buildCurrentWavelength} from "../logic/engine22/wave/buildCurrentWavelength.js";
import {buildAuthorizedWorkingStructureV1} from "../logic/engine22/wave/buildAuthorizedWorkingStructureV1.js";
import {buildWaveHistoryObservation,appendWaveHistoryObservation} from "../logic/engine22/history/waveHistoryJournalV1.js";
import {exportWaveHistoryWorkbook,buildWaveHistoryWorkbook} from "../logic/engine22/history/exportWaveHistoryWorkbookV1.js";
function fixture(){
 const currentWavelength=buildCurrentWavelength({symbol:"ES",currentPrice:7558.25});
 const degreeStates={minor:{activeWave:"W5",direction:"UP"},intermediate:{activeWave:"W3",direction:"UP"},primary:{activeWave:"W5",direction:"UP"}};
 return {symbol:"ES",currentWavelength,degreeStates,authorizedWorkingStructure:buildAuthorizedWorkingStructureV1({currentWavelength,degreeStates})};
}
test("creates real XLSX package with current, history, changes, Fib and seven degree tabs",()=>{
 const directory=mkdtempSync(join(tmpdir(),"engine22-xlsx-"));
 try{
  const source=fixture();
  const a=buildWaveHistoryObservation({strategy:source,observedAt:"2026-10-31T20:05:00Z"});
  appendWaveHistoryObservation({directory,observation:a});
  const first=exportWaveHistoryWorkbook({directory});
  assert.equal(first.revisions,1);
  const xlsx=readFileSync(first.path);
  assert.equal(xlsx.readUInt32LE(0),0x04034b50);
  assert.ok(xlsx.includes(Buffer.from("xl/workbook.xml")));
  const revised=structuredClone(source);
  revised.currentWavelength.degrees.micro.ownerMicroCDownOct31.priorBEnding.price=7819.5;
  const b=buildWaveHistoryObservation({strategy:revised,observedAt:"2026-10-31T20:06:00Z"});
  appendWaveHistoryObservation({directory,observation:b});
  const second=exportWaveHistoryWorkbook({directory});
  assert.equal(second.revisions,2);
  assert.ok(second.bytes>first.bytes);
  assert.ok(readFileSync(second.path).includes(Buffer.from("xl/worksheets/sheet12.xml")));
  const verified=execFileSync("python3",["-c",`import sys,zipfile,xml.etree.ElementTree as E\np=sys.argv[1]\nwith zipfile.ZipFile(p) as z:\n assert z.testzip() is None\n names=z.namelist()\n assert len([n for n in names if n.startswith("xl/worksheets/sheet")])==12\n for n in names:\n  if n.endswith(".xml") or n.endswith(".rels"): E.fromstring(z.read(n))\n print("VALID_XLSX_12_SHEETS")`,second.path],{encoding:"utf8"});
  assert.match(verified,/VALID_XLSX_12_SHEETS/);
 }finally{rmSync(directory,{recursive:true,force:true});}
});
test("rejects nonverified input instead of creating false history",()=>{
 assert.throws(()=>buildWaveHistoryWorkbook({events:null}),/VERIFIED_EVENTS_REQUIRED/);
});
