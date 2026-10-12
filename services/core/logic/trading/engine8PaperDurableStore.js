// Engine 8 PAPER-only durable storage. REAL Journal and Schwab stores are out of scope.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const legacyDir = process.env.NODE_ENV === "test" && process.env.ENGINE8_PAPER_TEST_LEGACY_DIR
  ? path.resolve(process.env.ENGINE8_PAPER_TEST_LEGACY_DIR)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../data");
export const PAPER_DATA_DIR = path.resolve(process.env.ENGINE8_PAPER_DATA_DIR || (process.env.RENDER ? "/var/data/replay/engine8-paper" : legacyDir));
const FILES = new Set(["paper-orders.json", "paper-executions.json", "paper-idempotency-ledger.json", "engine8-paper-acceptance-state.json", "engine8-paper-execution-state.json"]);

function parseFile(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}
function syncDirectory(directory) {
  const fd = fs.openSync(directory, "r");
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
export function atomicPaperWrite(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = file + "." + process.pid + "." + crypto.randomBytes(8).toString("hex") + ".tmp";
  try {
    const fd = fs.openSync(temp, "wx", 0o600);
    try {
      fs.writeFileSync(fd, JSON.stringify(value, null, 2), "utf8");
      fs.fsyncSync(fd);
    } finally { fs.closeSync(fd); }
    fs.renameSync(temp, file);
    syncDirectory(path.dirname(file));
  } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
}
// New PAPER ledger is intentionally independent of all historical PAPER files.
// No migration, old-file discovery, reading, copying, deleting, or merging.
// Legacy records are left exactly as they were; this function only resolves the
// dedicated PAPER store location for new, manager-authorized activity.
export function paperStorePath(name) {
  if (!FILES.has(name)) throw new Error("UNKNOWN_ENGINE8_PAPER_FILE");
  return path.join(PAPER_DATA_DIR, name);
}
export function readPaperStore(name, empty) {
  const file = paperStorePath(name);
  if (!fs.existsSync(file)) return structuredClone(empty);
  return parseFile(file); // unreadable/corrupt file fails closed
}
export function writePaperStore(name, value) {
  const file = paperStorePath(name);
  atomicPaperWrite(file, value);
}

/**
 * Exclusive cross-process instruction lock on the persistent filesystem.
 * A crash leaves the lock in place; NEVER auto-expire it, because the fill
 * may have been committed before the interrupted process exited.
 * Operator reconciliation is required before removing a stranded lock.
 */
export async function withPaperInstructionLock(idempotencyKey, operation) {
  const key = String(idempotencyKey || "").trim();
  if (!key) throw new Error("MISSING_IDEMPOTENCY_KEY");
  const lockParent = path.join(PAPER_DATA_DIR, ".instruction-locks");
  fs.mkdirSync(lockParent, { recursive: true });
  const hashed = crypto.createHash("sha256").update(key).digest("hex");
  const lock = path.join(lockParent, hashed + ".lock");
  try {
    fs.mkdirSync(lock);
  } catch (error) {
    if (error?.code === "EEXIST") {
      return { ok: false, rejected: true, duplicate: true,
        reason: "PAPER_INSTRUCTION_LOCKED_RECONCILIATION_REQUIRED", idempotencyKey: key };
    }
    throw error;
  }
  try {
    fs.writeFileSync(path.join(lock, "identity.json"),
      JSON.stringify({ idempotencyKey: key, processId: process.pid, startedAt: new Date().toISOString() }));
    return await operation();
  } finally {
    // This runs on handled exceptions; a hard crash leaves the lock intact.
    fs.rmSync(lock, { recursive: true, force: true });
  }
}
