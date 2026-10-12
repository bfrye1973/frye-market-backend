import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "engine8d-journal-retry-"));
process.env.NODE_ENV = "test";
process.env.ENGINE8_PAPER_DATA_DIR = dir;
process.env.ENGINE8_PAPER_ONLY = "0";
delete process.env.ENGINE8_KILL_SWITCH;
const paperUrl = new URL("../logic/trading/engine8Paper.js", import.meta.url).href;
const paper = await import(paperUrl);
const { executeTradeTicket, retryPaperJournalDelivery, setPaperJournalHooksForTests } = paper;

let counter = 0;
function ticket(key) {
  return { idempotencyKey:key, symbol:"ES", strategyId:"manual-test-strategy",
    assetType:"FUTURES", direction:"LONG", intent:"ENTRY", action:"NEW_ENTRY",
    paper:true, side:"BUY", qty:1, contracts:1, entry:{ price:6000 } };
}
function ledger() {
  return JSON.parse(fs.readFileSync(path.join(dir, "paper-idempotency-ledger.json"), "utf8"));
}
function orders() {
  return JSON.parse(fs.readFileSync(path.join(dir, "paper-orders.json"), "utf8"));
}
function executions() {
  return JSON.parse(fs.readFileSync(path.join(dir, "paper-executions.json"), "utf8"));
}

test("Journal failure, repeated manual instruction, and Journal-only retry reuse original fill", async () => {
  let delivered;
  setPaperJournalHooksForTests({ create: async delivery => { counter++; delivered = delivery; throw new Error("simulated journal downtime"); } });
  const first = await executeTradeTicket(ticket("FAIL-THEN-RETRY"));
  assert.equal(first.status, "filled");
  assert.equal(first.journalStatus, "JOURNAL_PENDING");
  assert.equal(ledger()["FAIL-THEN-RETRY"].journalStatus, "JOURNAL_PENDING");
  const initialOrderId = first.orderId;
  const duplicate = await executeTradeTicket(ticket("FAIL-THEN-RETRY"));
  assert.equal(duplicate.duplicate, true);
  assert.equal(orders().length, 1);
  assert.equal(executions().length, 1);
  assert.equal(counter, 1);
  setPaperJournalHooksForTests({ create: async delivery => {
    counter++;
    assert.equal(delivery.order.orderId, initialOrderId);
    assert.equal(delivery.result.orderId, initialOrderId);
    return { ok:true, tradeId:"TRD-ORIGINAL", status:"OPEN" };
  } });
  const recovered = await retryPaperJournalDelivery({ idempotencyKey:"FAIL-THEN-RETRY" });
  assert.equal(recovered.journalStatus,"JOURNAL_COMPLETE");
  assert.equal(recovered.orderId, initialOrderId);
  assert.equal(recovered.tradeId,"TRD-ORIGINAL");
  assert.equal(orders().length,1);
  assert.equal(executions().length,1);
  assert.equal(counter,2);
  assert.equal(ledger()["FAIL-THEN-RETRY"].journalStatus,"JOURNAL_COMPLETE");
  const again = await retryPaperJournalDelivery({idempotencyKey:"FAIL-THEN-RETRY"});
  assert.equal(again.duplicate,true);
  assert.equal(counter,2);
});

test("lost Engine 10 acknowledgment on original event recovers without another fill", async () => {
  let journalEvents=0;
  let committed=false;
  setPaperJournalHooksForTests({ create: async () => {
    journalEvents++;
    committed=true;
    throw Error("response lost after durable Engine 10 commit");
  } });
  const first = await executeTradeTicket(ticket("LOST-ACK"));
  assert.equal(committed,true);
  assert.equal(first.journalStatus,"JOURNAL_PENDING");
  const originalOrder = first.orderId;
  setPaperJournalHooksForTests({ create: async delivery => {
    journalEvents++;
    assert.equal(delivery.result.orderId,originalOrder);
    return {ok:true,tradeId:"TRD-ALREADY-RECORDED",duplicate:true,status:"OPEN"};
  }});
  const recovered=await retryPaperJournalDelivery({idempotencyKey:"LOST-ACK"});
  assert.equal(recovered.journalStatus,"JOURNAL_COMPLETE");
  assert.equal(journalEvents,2);
  assert.equal(orders().filter(x=>x.orderId===originalOrder).length,1);
  assert.equal(executions().filter(x=>x.orderId===originalOrder).length,1);
});

test("pending identity survives separate-process restart for Journal-only replay", async () => {
  setPaperJournalHooksForTests({create:async()=>{throw Error("Engine10 unavailable")}});
  const first=await executeTradeTicket(ticket("RESTART-PENDING"));
  assert.equal(first.journalStatus,"JOURNAL_PENDING");
  const child=spawnSync(process.execPath,["--input-type=module","-e",
    `process.env.NODE_ENV="test"; const paper=await import(${JSON.stringify(paperUrl)});
       paper.setPaperJournalHooksForTests({create:async delivery=>({ok:true,tradeId:"TRD-RESTART",status:"OPEN"})});
       console.log(JSON.stringify(await paper.retryPaperJournalDelivery({idempotencyKey:"RESTART-PENDING"})));`],
    {encoding:"utf8",env:{...process.env}});
  assert.equal(child.status,0,child.stderr);
  const response=JSON.parse(child.stdout.trim());
  assert.equal(response.journalStatus,"JOURNAL_COMPLETE");
  assert.equal(response.orderId,first.orderId);
  assert.equal(ledger()["RESTART-PENDING"].tradeId,"TRD-RESTART");
});

test("invalid quantity and price fail closed with no new simulated fills", async () => {
  const count=executions().length;
  assert.equal((await executeTradeTicket({...ticket("ZERO"),qty:0,contracts:0})).reason,"SIZE_ZERO_OR_MISSING_QTY");
  assert.equal((await executeTradeTicket({...ticket("BAD-PRICE"),entry:{price:0}})).reason,"MISSING_FUTURES_ENTRY_PRICE");
  assert.equal(executions().length,count);
});

test("REAL ticket rejection and kill switch prevent fills regardless of PAPER env", async () => {
  const count=executions().length;
  assert.equal((await executeTradeTicket({...ticket("REAL-FLAG"),paper:false})).reason,"PAPER_ONLY_ENFORCED");
  assert.equal((await executeTradeTicket({...ticket("REAL-TRUE"),real:true})).reason,"PAPER_ONLY_ENFORCED");
  process.env.ENGINE8_KILL_SWITCH="1";
  try {
    assert.equal((await executeTradeTicket(ticket("KILLED"))).reason,"KILL_SWITCH");
  } finally { delete process.env.ENGINE8_KILL_SWITCH; }
  assert.equal(executions().length,count);
});

process.on("exit",()=>fs.rmSync(dir,{recursive:true,force:true}));
