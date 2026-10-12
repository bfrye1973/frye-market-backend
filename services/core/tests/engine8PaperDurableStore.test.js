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

test("migrates historical PAPER ledger without overwriting it", () => {
  const history = { "OLD-ORDER": { orderId: "PAPER-HISTORICAL", status: "filled" } };
  fs.writeFileSync(path.join(old, "paper-idempotency-ledger.json"), JSON.stringify(history));
  assert.deepEqual(store.readPaperStore("paper-idempotency-ledger.json", {}), history);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(durable, "paper-idempotency-ledger.json"), "utf8")), history);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(old, "paper-idempotency-ledger.json"), "utf8")), history);
});

test("durable atomic writes are readable after a separate process restart", () => {
  store.writePaperStore("paper-orders.json", [{ orderId: "PAPER-KEEP", status: "filled" }]);
  const moduleUrl = new URL("../logic/trading/engine8PaperDurableStore.js", import.meta.url).href;
  const child = spawnSync(process.execPath, ["--input-type=module", "-e",
    `import {readPaperStore} from ${JSON.stringify(moduleUrl)};console.log(JSON.stringify(readPaperStore("paper-orders.json",[])))`],
    { encoding: "utf8", env: { ...process.env } });
  assert.equal(child.status, 0, child.stderr);
  assert.deepEqual(JSON.parse(child.stdout.trim()), [{ orderId: "PAPER-KEEP", status: "filled" }]);
});

test("corrupt durable records fail closed rather than becoming empty orders", () => {
  fs.writeFileSync(path.join(durable, "paper-executions.json"), "{corrupt");
  assert.throws(() => store.readPaperStore("paper-executions.json", []), SyntaxError);
});

test("corrupt historical records are not silently migrated as empty data", () => {
  const name = "paper-executions.json";
  fs.unlinkSync(path.join(durable, name));
  fs.writeFileSync(path.join(old, name), "{corrupt");
  assert.throws(() => store.readPaperStore(name, []), SyntaxError);
  assert.equal(fs.existsSync(path.join(durable, name)), false);
});

test("unknown PAPER storage path is rejected", () => {
  assert.throws(() => store.paperStorePath("../trade-journal.json"), /UNKNOWN_ENGINE8_PAPER_FILE/);
});

process.on("exit", () => fs.rmSync(home, { recursive: true, force: true }));
