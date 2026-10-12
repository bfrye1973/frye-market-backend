import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const home = fs.mkdtempSync(path.join(os.tmpdir(), "engine8-paper-durable-"));
const old = path.join(home, "legacy");
const durable = path.join(home, "disk");
fs.mkdirSync(old, { recursive: true });
fs.mkdirSync(durable, { recursive: true });
process.env.NODE_ENV = "test";
process.env.ENGINE8_PAPER_TEST_LEGACY_DIR = old;
process.env.ENGINE8_PAPER_DATA_DIR = durable;
const store = await import("../logic/trading/engine8PaperDurableStore.js");

test("historical PAPER files are never read, copied, moved, or deleted", () => {
  const history = { "OLD-ORDER": { orderId: "PAPER-HISTORICAL", status: "filled" } };
  const oldFile = path.join(old, "paper-idempotency-ledger.json");
  const oldBytes = JSON.stringify(history);
  fs.writeFileSync(oldFile, oldBytes);
  assert.deepEqual(store.readPaperStore("paper-idempotency-ledger.json", {}), {});
  assert.equal(fs.existsSync(path.join(durable, "paper-idempotency-ledger.json")), false);
  assert.equal(fs.readFileSync(oldFile, "utf8"), oldBytes);
  assert.deepEqual(fs.readdirSync(durable), []);
});

test("new PAPER writes remain strictly isolated from historical files", () => {
  const oldOrders = path.join(old, "paper-orders.json");
  fs.writeFileSync(oldOrders, JSON.stringify([{ orderId: "HISTORY" }]));
  store.writePaperStore("paper-orders.json", [{ orderId: "NEW-PAPER" }]);
  assert.deepEqual(store.readPaperStore("paper-orders.json", []), [{ orderId: "NEW-PAPER" }]);
  assert.deepEqual(JSON.parse(fs.readFileSync(oldOrders, "utf8")), [{ orderId: "HISTORY" }]);
  assert.equal(fs.readdirSync(durable).some(name => name.startsWith(".migrated-")), false);
});

test("durable atomic writes remain readable in a fresh process", () => {
  const moduleUrl = new URL("../logic/trading/engine8PaperDurableStore.js", import.meta.url).href;
  const child = spawnSync(process.execPath, ["--input-type=module", "-e",
    `import {readPaperStore} from ${JSON.stringify(moduleUrl)};console.log(JSON.stringify(readPaperStore("paper-orders.json",[])))`],
    { encoding: "utf8", env: { ...process.env } });
  assert.equal(child.status, 0, child.stderr);
  assert.deepEqual(JSON.parse(child.stdout.trim()), [{ orderId: "NEW-PAPER" }]);
});

test("corrupt durable records fail closed, without empty fallback", () => {
  fs.writeFileSync(path.join(durable, "paper-executions.json"), "{corrupt");
  assert.throws(() => store.readPaperStore("paper-executions.json", []), SyntaxError);
});

test("corrupt legacy files are never imported into the clean PAPER store", () => {
  fs.writeFileSync(path.join(old, "paper-executions.json"), "{corrupt");
  assert.equal(fs.readFileSync(path.join(old, "paper-executions.json"), "utf8"), "{corrupt");
  assert.equal(fs.readFileSync(path.join(durable, "paper-executions.json"), "utf8"), "{corrupt");
});

test("durable execution identity and acceptance lock remain independent of history", () => {
  for (const name of ["engine8-paper-execution-state.json", "engine8-paper-acceptance-state.json"]) {
    fs.writeFileSync(path.join(old, name), JSON.stringify({ "HISTORY": true }));
    assert.deepEqual(store.readPaperStore(name, {}), {});
    store.writePaperStore(name, { "NEW": true });
    assert.deepEqual(store.readPaperStore(name, {}), { "NEW": true });
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(old, name), "utf8")), { "HISTORY": true });
  }
});

test("unknown PAPER file paths are rejected", () => {
  assert.throws(() => store.paperStorePath("../trade-journal.json"), /UNKNOWN_ENGINE8_PAPER_FILE/);
});

process.on("exit", () => fs.rmSync(home, { recursive: true, force: true }));
