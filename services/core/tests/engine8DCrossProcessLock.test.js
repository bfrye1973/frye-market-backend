import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "e8d-lock-"));
process.env.ENGINE8_PAPER_DATA_DIR = root;
process.env.NODE_ENV = "test";
const moduleUrl = new URL("../logic/trading/engine8PaperDurableStore.js", import.meta.url).href;
const { withPaperInstructionLock, readPaperStore, writePaperStore } = await import(moduleUrl);

function runChild(script) {
  return spawnSync(process.execPath, ["--input-type=module", "-e", script],
    { encoding: "utf8", env: { ...process.env } });
}

test("independent process denied while another process owns instruction", async () => {
  let entered;
  const pending = new Promise(resolve => { entered = resolve; });
  let release;
  const held = new Promise(resolve => { release = resolve; });
  const task = withPaperInstructionLock("ONE-KEY", async () => {
    entered();
    await held;
    return { ok: true };
  });
  await pending;
  const child = runChild(`import {withPaperInstructionLock} from ${JSON.stringify(moduleUrl)};
    console.log(JSON.stringify(await withPaperInstructionLock("ONE-KEY",async()=>({ok:true,fill:true}))));`);
  assert.equal(child.status, 0, child.stderr);
  assert.equal(JSON.parse(child.stdout.trim()).reason, "PAPER_INSTRUCTION_LOCKED_RECONCILIATION_REQUIRED");
  release();
  assert.deepEqual(await task, { ok: true });
});

test("different process can read committed PAPER identity after restart", () => {
  writePaperStore("paper-idempotency-ledger.json", { "ONE-KEY": { orderId: "ORIGINAL-1", status: "filled" } });
  const child = runChild(`import {readPaperStore} from ${JSON.stringify(moduleUrl)};
    console.log(JSON.stringify(readPaperStore("paper-idempotency-ledger.json",{})));`);
  assert.equal(child.status, 0, child.stderr);
  assert.equal(JSON.parse(child.stdout.trim())["ONE-KEY"].orderId, "ORIGINAL-1");
});

test("stranded lock after crash fails closed on restart", () => {
  const child = runChild(`import {withPaperInstructionLock} from ${JSON.stringify(moduleUrl)};
    await withPaperInstructionLock("CRASH-ID",async()=>{process.exit(12)});`);
  assert.equal(child.status, 12);
  const attempt = runChild(`import {withPaperInstructionLock} from ${JSON.stringify(moduleUrl)};
    console.log(JSON.stringify(await withPaperInstructionLock("CRASH-ID",async()=>({ok:true,fill:true}))));`);
  assert.equal(attempt.status, 0, attempt.stderr);
  assert.equal(JSON.parse(attempt.stdout.trim()).reason, "PAPER_INSTRUCTION_LOCKED_RECONCILIATION_REQUIRED");
});


test("two independent PAPER executor processes cannot commit duplicate simulated fill", async () => {
  const paperUrl = new URL("../logic/trading/engine8Paper.js", import.meta.url).href;
  const template = `{ idempotencyKey:"PARALLEL-ONE", symbol:"ES",
    strategyId:"manual-concurrency-test", paper:true, assetType:"FUTURES",
    intent:"ENTRY", direction:"LONG", action:"NEW_ENTRY", side:"BUY",
    qty:1, contracts:1, entry:{price:6000} }`;
  const firstCode = `const p=await import(${JSON.stringify(paperUrl)});
    p.setPaperJournalHooksForTests({create:async()=>{console.log("JOURNAL_ENTERED"); await new Promise(r=>setTimeout(r,750)); return {ok:true,tradeId:"TRD-A",status:"OPEN"};}});
    console.log("FIRST_RESULT="+JSON.stringify(await p.executeTradeTicket(${template})));`;
  const secondCode = `const p=await import(${JSON.stringify(paperUrl)});
    p.setPaperJournalHooksForTests({create:async()=>({ok:true,tradeId:"TRD-B",status:"OPEN"})});
    console.log(JSON.stringify(await p.executeTradeTicket(${template})));`;
  const first = spawn(process.execPath,["--input-type=module","-e",firstCode],
    {env:{...process.env,ENGINE8_PAPER_ONLY:"0"},stdio:["ignore","pipe","pipe"]});
  let stdout = "";
  let stderr = "";
  first.stdout.on("data",data=>{stdout+=data.toString();});
  first.stderr.on("data",data=>{stderr+=data.toString();});
  await new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>reject(Error("first executor did not reach Journal")),3000);
    first.stdout.on("data",()=>{if(stdout.includes("JOURNAL_ENTERED")){clearTimeout(timeout);resolve();}});
    first.on("error",reject);
  });
  const second=runChild(secondCode);
  assert.equal(second.status,0,second.stderr);
  assert.equal(JSON.parse(second.stdout.trim()).reason,"PAPER_INSTRUCTION_LOCKED_RECONCILIATION_REQUIRED");
  const ended=await new Promise(resolve=>first.on("close",resolve));
  assert.equal(ended,0,stderr);
  assert.match(stdout,/FIRST_RESULT/);
  const orders=readPaperStore("paper-orders.json",[]);
  const fills=readPaperStore("paper-executions.json",[]);
  assert.equal(orders.filter(order=>order.idempotencyKey==="PARALLEL-ONE").length,1);
  assert.equal(fills.filter(fill=>fill.idempotencyKey==="PARALLEL-ONE").length,1);
});

test("shared global lock protects distinct instruction keys from stale ledger overwrites", async () => {
  let proceed;
  const hold = new Promise(resolve=>{proceed=resolve;});
  let entered;
  const started=new Promise(resolve=>{entered=resolve;});
  const first=withPaperInstructionLock("__ENGINE8_PAPER_GLOBAL_WRITE__",async()=>{
    entered();
    await hold;
    return {ok:true};
  });
  await started;
  const child=runChild(`import {withPaperInstructionLock} from ${JSON.stringify(moduleUrl)};
    console.log(JSON.stringify(await withPaperInstructionLock("__ENGINE8_PAPER_GLOBAL_WRITE__",async()=>({ok:true,secondInstruction:true}))));`);
  assert.equal(child.status,0,child.stderr);
  assert.equal(JSON.parse(child.stdout.trim()).reason,"PAPER_INSTRUCTION_LOCKED_RECONCILIATION_REQUIRED");
  proceed();
  await first;
});

process.on("exit",()=>fs.rmSync(root,{recursive:true,force:true}));
