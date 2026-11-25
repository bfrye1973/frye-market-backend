import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const moduleUrl = new URL("../logic/trading/engine8Paper.js", import.meta.url).href;
const stages = [
  ["BEFORE_RESERVATION", "NO_RESERVATION_FOUND", 0, 0],
  ["AFTER_RESERVATION", "RESERVED_WITHOUT_RECORDED_FILL", 0, 0],
  ["AFTER_ORDER_RECORD", "PARTIAL_OR_UNACKNOWLEDGED_FILL_RECORDING", 1, 0],
  ["AFTER_EXECUTION_RECORD", "PARTIAL_OR_UNACKNOWLEDGED_FILL_RECORDING", 1, 1],
  ["AFTER_FILL_LEDGER", "JOURNAL_ONLY_RETRY_ELIGIBLE", 1, 1],
  ["AFTER_JOURNAL_ACK", "JOURNAL_ONLY_RETRY_ELIGIBLE", 1, 1],
];
const tradeScript = `const p = await import(${JSON.stringify(moduleUrl)});
p.setPaperJournalHooksForTests({create:async()=>({ok:true,tradeId:"TRD-MOCK",status:"OPEN"})});
console.log(JSON.stringify(await p.executeTradeTicket({
  idempotencyKey:"CRASH-ONE",symbol:"ES",strategyId:"manual-crash-test",
  assetType:"FUTURES",direction:"LONG",intent:"ENTRY",action:"NEW_ENTRY",
  paper:true,side:"BUY",qty:1,contracts:1,entry:{price:6000}
})));
`;
const inspectScript = `const p = await import(${JSON.stringify(moduleUrl)});
console.log(JSON.stringify(p.inspectPaperInstructionRecovery({idempotencyKey:"CRASH-ONE"})));`;

for (const [stage, expected, orders, fills] of stages) {
  test("interruption " + stage + " fails closed and classifies original fill on restart", () => {
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),"engine8d-interrupt-"));
    const env={...process.env,NODE_ENV:"test",ENGINE8_PAPER_DATA_DIR:dir,
      ENGINE8_PAPER_TEST_CRASH_AT:stage, ENGINE8_PAPER_ONLY:"0"};
    delete env.ENGINE8_KILL_SWITCH;
    try {
      const crash=spawnSync(process.execPath,["--input-type=module","-e",tradeScript],{env,encoding:"utf8"});
      assert.equal(crash.status,92,crash.stderr);
      delete env.ENGINE8_PAPER_TEST_CRASH_AT;
      const inspect=spawnSync(process.execPath,["--input-type=module","-e",inspectScript],{env,encoding:"utf8"});
      assert.equal(inspect.status,0,inspect.stderr);
      const result=JSON.parse(inspect.stdout.trim());
      assert.equal(result.state,expected);
      assert.equal(result.orderRecords,orders);
      assert.equal(result.fillRecords,fills);
      assert.equal(result.mayCreateNewFill,false);
      const repeated=spawnSync(process.execPath,["--input-type=module","-e",tradeScript],{env,encoding:"utf8"});
      assert.equal(repeated.status,0,repeated.stderr);
      assert.equal(JSON.parse(repeated.stdout.trim()).reason,"PAPER_INSTRUCTION_LOCKED_RECONCILIATION_REQUIRED");
    } finally {fs.rmSync(dir,{recursive:true,force:true});}
  });
}
