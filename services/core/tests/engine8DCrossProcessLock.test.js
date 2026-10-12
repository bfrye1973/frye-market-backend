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

process.on("exit",()=>fs.rmSync(root,{recursive:true,force:true}));
