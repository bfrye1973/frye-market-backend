import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
const dir=fs.mkdtempSync(path.join(os.tmpdir(),"manual-paper-trades-"));
process.env.ENGINE8_PAPER_DATA_DIR=dir;
process.env.NODE_ENV="test";
delete process.env.ENGINE8_KILL_SWITCH;
const accounts=await import("../logic/trading/manualPaperAccountStore.js");
const manual=await import("../logic/trading/manualPaperOrderExecution.js");
const journal=await import("../logic/journal/manualPaperAccountJournal.js");
const initialized=await accounts.initializeManualPaperAccounts();
assert.equal(initialized.ok,true);
const id=n=>initialized.accounts[n].accountId;
let seq=0;
function ticket(accountId,opts={}){
  return {accountId,idempotencyKey:"REQ-TEST-"+(++seq),contract:"MESZ26",
    action:"BUY",intent:"OPEN_LONG",qty:2,price:7850,paper:true,...opts};
}
test("one manual LONG produces one Engine 10 contract-level entry and correct fees",async()=>{
  const request=ticket(id(3));
  const entry=await manual.executeManualPaperInstruction(request);
  assert.equal(entry.ok,true);
  assert.equal(entry.fill.qty,2);
  assert.equal(entry.contractIds.length,2);
  const repeated=await manual.executeManualPaperInstruction(request);
  assert.equal(repeated.duplicate,true);
  assert.equal(repeated.executionId,entry.executionId);
  const overview=manual.getManualPaperAccountsOverview();
  const a=overview.accounts[3];
  assert.equal(a.openContracts,2);
  assert.equal(a.marginUsed,3000);
  assert.equal(a.feesPaid,2.5);
  assert.equal(a.cashBalance,9997.5);
  assert.equal(overview.accounts[2].cashBalance,10000);
});
test("partial and full LONG closes follow Engine 10 FIFO and realize $5/point",async()=>{
  const partial=await manual.executeManualPaperInstruction(ticket(id(3),{
    action:"REDUCE",intent:"CLOSE_LONG",qty:1,price:7860
  }));
  assert.equal(partial.ok,true);
  let a=manual.getManualPaperAccountsOverview().accounts[3];
  assert.equal(a.openContracts,1);
  assert.equal(a.realizedPnL,46.25); // gross 50 less 2.5 open + 1.25 closing
  const close=await manual.executeManualPaperInstruction(ticket(id(3),{
    action:"CLOSE",intent:"CLOSE_LONG",qty:1,price:7870
  }));
  assert.equal(close.ok,true);
  a=manual.getManualPaperAccountsOverview().accounts[3];
  assert.equal(a.openContracts,0);
  assert.equal(a.closedContracts,2);
  assert.equal(a.realizedPnL,145); // 50+100 gross less 2.5+1.25+1.25 fees
});
test("SHORT entry and buy-close P&L remain isolated to PRIMARY",async()=>{
  const entry=await manual.executeManualPaperInstruction(ticket(id(6),{
    action:"SELL",intent:"OPEN_SHORT",qty:1,price:7870
  }));
  assert.equal(entry.ok,true);
  const close=await manual.executeManualPaperInstruction(ticket(id(6),{
    action:"BUY",intent:"CLOSE_SHORT",qty:1,price:7860
  }));
  assert.equal(close.ok,true);
  const p=manual.getManualPaperAccountsOverview().accounts[6];
  assert.equal(p.openContracts,0);
  assert.equal(p.realizedPnL,47.5);
  assert.equal(manual.getManualPaperAccountsOverview().accounts[3].realizedPnL,145);
});
test("ES rejected on margin and fractional/invalid tick rejected",async()=>{
  const wrong=await manual.executeManualPaperInstruction(ticket(id(4),{contract:"ESZ26",qty:1}));
  assert.equal(wrong.reason,"INSUFFICIENT_SIMULATED_BUYING_POWER");
  assert.equal((await manual.executeManualPaperInstruction(ticket(id(4),{qty:1.2}))).reason,"INVALID_CONTRACT_QUANTITY");
  assert.equal((await manual.executeManualPaperInstruction(ticket(id(4),{price:7850.1}))).reason,"INVALID_FUTURES_TICK_PRICE");
  assert.equal(manual.getManualPaperAccountsOverview().accounts[4].openContracts,0);
});
test("lost Engine 10 reply and Journal-only retry do not create duplicate fill",async()=>{
  const original=ticket(id(0),{qty:1});
  manual.setManualPaperJournalHookForTests(async(fill,apply)=>{
    apply(fill); throw Error("ACK_LOST");
  });
  const first=await manual.executeManualPaperInstruction(original);
  assert.equal(first.journalStatus,"JOURNAL_PENDING");
  assert.equal(manual.getManualPaperAccountsOverview().accounts[0].tradingBlocked,true);
  assert.equal((await manual.executeManualPaperInstruction(original)).duplicate,true);
  manual.setManualPaperJournalHookForTests(null);
  const recovered=await manual.retryManualPaperJournalOnly({idempotencyKey:original.idempotencyKey});
  assert.equal(recovered.ok,true);
  assert.equal(recovered.executionId,first.executionId);
  const row=journal.readEngine10ManualPaperJournal().accounts[id(0)];
  assert.equal(row.executions.length,1);
  assert.equal(row.contracts.length,1);
  assert.equal(manual.getManualPaperAccountsOverview().accounts[0].tradingBlocked,false);
});
test("journal unavailable blocks account and retries identical instruction envelope",async()=>{
  const original=ticket(id(1),{qty:1});
  manual.setManualPaperJournalHookForTests(async()=>{throw Error("JOURNAL_DOWN")});
  const pending=await manual.executeManualPaperInstruction(original);
  assert.equal(pending.journalStatus,"JOURNAL_PENDING");
  const blocked=await manual.executeManualPaperInstruction(ticket(id(1),{qty:1}));
  assert.equal(blocked.reason,"ACCOUNT_JOURNAL_RECONCILIATION_REQUIRED");
  manual.setManualPaperJournalHookForTests(null);
  const done=await manual.retryManualPaperJournalOnly({idempotencyKey:original.idempotencyKey});
  assert.equal(done.ok,true);
  assert.equal(done.executionId,pending.executionId);
});
test("Engine 10 journal and Engine 8 instructions survive independent process",()=>{
  const uri=new URL("../logic/trading/manualPaperOrderExecution.js",import.meta.url).href;
  const child=spawnSync(process.execPath,["--input-type=module","-e",
    `const m=await import(${JSON.stringify(uri)});console.log(JSON.stringify(m.getManualPaperAccountsOverview()))`],
    {encoding:"utf8",env:{...process.env}});
  assert.equal(child.status,0,child.stderr);
  const out=JSON.parse(child.stdout.trim());
  assert.equal(out.accounts.length,7);
  assert.equal(out.accounts[3].closedContracts,2);
});
test("kill switch and REAL flag cannot create simulated fills",async()=>{
  process.env.ENGINE8_KILL_SWITCH="1";
  try{
    assert.equal((await manual.executeManualPaperInstruction(ticket(id(5)))).reason,"KILL_SWITCH");
  }finally{delete process.env.ENGINE8_KILL_SWITCH}
  assert.equal((await manual.executeManualPaperInstruction(ticket(id(5),{real:true}))).reason,"PAPER_ONLY_ENFORCED");
  assert.equal(manual.getManualPaperAccountsOverview().accounts[5].openContracts,0);
});
process.on("exit",()=>fs.rmSync(dir,{recursive:true,force:true}));
