// Engine 8 PAPER-only durable storage. REAL Journal and Schwab stores are out of scope.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const legacyDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../data");
export const PAPER_DATA_DIR = path.resolve(process.env.ENGINE8_PAPER_DATA_DIR || (process.env.RENDER ? "/var/data/replay/engine8-paper" : legacyDir));
const FILES = new Set(["paper-orders.json", "paper-executions.json", "paper-idempotency-ledger.json"]);

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
export function paperStorePath(name) {
  if (!FILES.has(name)) throw new Error("UNKNOWN_ENGINE8_PAPER_FILE");
  const target = path.join(PAPER_DATA_DIR, name);
  const old = path.join(legacyDir, name);
  // Never silently prefer an empty store when an older record exists.
  if (!fs.existsSync(target) && fs.existsSync(old)) {
    const history = parseFile(old); // corruption is a hard failure, not an empty ledger
    atomicPaperWrite(target, history);
  }
  return target;
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
