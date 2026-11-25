import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
const storeUrl=new URL("../logic/trading/manualPaperAccountStore.js",import.meta.url).href;
const executionUrl=new URL("../logic/trading/manualPaperOrderExecution.js",import.meta.url).href;
const fixedTicket={accountId:"PAPER-04-MINUTE",idempotencyKey:"CRASH-MANUAL-ONE",
  contract:"MESZ26",action:"BUY",intent:"OPEN_LONG",qty:1,price:7850,
  paper:true,ownerConfirmation:"CONFIRM_PAPER"};
function child(code,env){
  return spawnSync(process.execPath,["--input-type=module","-e",code],
    {encoding:"utf8",env:{...process.env,NODE_ENV:"test",...env}});
}
const initialize=`const s=await import(${JSON.stringify(storeUrl)}); console.log(JSON.stringify(await s.initializeManualPaperAccounts()));`;
const crash=`const e=await import(${JSON.stringify(executionUrl)});
  console.log(JSON.stringify(await e.executeManualPaperInstruction(${JSON.stringify(fixedTicket)})));`;
const inspect=`const e=await import(${JSON.stringify(executionUrl)});
  console.log(JSON.stringify(e.inspectManualPaperInstruction({idempotencyKey:"CRASH-MANUAL-ONE"})));`;
const repeat=`const e=await import(${JSON.stringify(executionUrl)});
  console.log(JSON.stringify(await e.executeManualPaperInstruction(${JSON.stringify(fixedTicket)})));`;
for(const [stage,expected,acked] of [
  ["BEFORE_RESERVATION","NOT_FOUND",false],
  ["AFTER_RESERVATION","RESERVED",false],
  ["AFTER_FILL_ENVELOPE","JOURNAL_PENDING",false],
  ["AFTER_ENGINE10_ACK","JOURNAL_PENDING",true],
]){
  test("interrupted manual PAPER "+stage+" fails closed across restart",()=>{
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),"engine8d-seven-crash-"));
    const env={ENGINE8_PAPER_DATA_DIR:dir,ENGINE8_MANUAL_TEST_CRASH_AT:stage};
    try{
      assert.equal(child(initialize,env).status,0);
      const stop=child(crash,env);
      assert.equal(stop.status,93,stop.stderr);
      const recovered=child(inspect,{ENGINE8_PAPER_DATA_DIR:dir});
      assert.equal(recovered.status,0,recovered.stderr);
      const state=JSON.parse(recovered.stdout.trim());
      assert.equal(state.status,expected);
      if(acked)assert.equal(state.engine10Acknowledged,true);
      assert.equal(state.mayExecuteNewFill,false);
      const duplicate=child(repeat,{ENGINE8_PAPER_DATA_DIR:dir});
      assert.equal(duplicate.status,0,duplicate.stderr);
      assert.equal(JSON.parse(duplicate.stdout.trim()).reason,
        "PAPER_INSTRUCTION_LOCKED_RECONCILIATION_REQUIRED");
      const folder=path.join(dir,"manual-paper-engine10-journal-v1.json");
      if(fs.existsSync(folder)){
        const source=JSON.parse(fs.readFileSync(folder,"utf8"));
        assert.ok(source.accounts["PAPER-04-MINUTE"].executions.length<=1);
      }
    }finally{fs.rmSync(dir,{recursive:true,force:true});}
  });
}
