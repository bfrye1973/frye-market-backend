// Read-only forensic verification of existing Engine29 receipt bytes against ES Replay.
// No Engine29 recomputation, mutation, execution, permission, or raw-payload response.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export const ENGINE29_RECEIPT_ROOT = "/var/data/replay/engine29";
export const ES_REPLAY_ROOT = "/var/data/replay/es";
const SCHEMA = "engine29.downstreamContext.v1";
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{4}$/;
const RECEIPT = /^(\d{4}-\d{2}-\d{2})T\d{2}-\d{2}-\d{2}-\d{3}Z-[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.json$/i;
const MAX_RECEIPT_BYTES = 4 * 1024 * 1024;
// ES Replay snapshots include strategy context beyond Engine29. Production
// sample 2026-11-23 12:09 AZ was 6,404,916 bytes; cap Replay at 16 MiB.
const MAX_REPLAY_BYTES = 16 * 1024 * 1024;
const sha256 = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");
// Stable key ordering makes identity independent of object insertion order.
// No market logic is computed; arrays retain original order.
function canonicalJson(value) {
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  if (value !== null && typeof value === "object") {
    return "{" + Object.keys(value).sort().map(key =>
      JSON.stringify(key) + ":" + canonicalJson(value[key])).join(",") + "}";
  }
  return JSON.stringify(value);
}
const canonical = (obj) => Buffer.from(canonicalJson(obj), "utf8");
const fail = (reason, status = 422, exists = false) => ({ status, body: { ok:false, exists, verified:false, exactMatch:false, reason } });

export function authenticateEngine29Verifier(headerToken, configuredToken) {
  const expected = String(configuredToken ?? "").trim();
  if (!expected) return { ok:false, status:503, reason:"VERIFY_AUTH_NOT_CONFIGURED" };
  const received = typeof headerToken === "string" ? headerToken : "";
  const a = Buffer.from(received, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (!a.length || a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok:false, status:401, reason:"UNAUTHORIZED" };
  }
  return { ok:true };
}

function validDate(date) {
  if (typeof date !== "string" || !DATE.test(date)) return false;
  const ts = Date.parse(date + "T00:00:00Z");
  return Number.isFinite(ts) && new Date(ts).toISOString().slice(0,10) === date;
}
function validTime(time) {
  return typeof time === "string" && TIME.test(time) &&
    Number(time.slice(0,2)) <= 23 && Number(time.slice(2)) <= 59;
}
function below(child, root) {
  return child.startsWith(root + path.sep);
}
function ensureDirectory(directory, root) {
  const info = fs.lstatSync(directory);
  if (info.isSymbolicLink() || !info.isDirectory()) throw new Error("UNSAFE_DIRECTORY");
  const real = fs.realpathSync(directory);
  if (directory !== root && !below(real, fs.realpathSync(root))) throw new Error("UNSAFE_DIRECTORY");
}
function readRegularFile(file, root, maxBytes) {
  const parent = path.dirname(file);
  ensureDirectory(root, root);
  ensureDirectory(parent, root);
  const info = fs.lstatSync(file);
  if (info.isSymbolicLink() || !info.isFile()) throw new Error("NON_REGULAR_FILE");
  if (info.size > maxBytes) throw new Error("FILE_TOO_LARGE");
  const real = fs.realpathSync(file);
  if (!below(real, fs.realpathSync(root))) throw new Error("UNSAFE_FILE_PATH");
  // NOFOLLOW and fstat ensure a link swap cannot silently redirect a read.
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const actual = fs.fstatSync(fd);
    if (!actual.isFile() || actual.size > maxBytes ||
      actual.dev !== info.dev || actual.ino !== info.ino) {
      throw new Error("NON_REGULAR_FILE");
    }
    return fs.readFileSync(fd);
  } finally { fs.closeSync(fd); }
}
function mapFsError(error, receiptExists = false) {
  const code = error?.code || error?.message;
  if (code === "ENOENT") return fail(
    receiptExists ? "REPLAY_NOT_FOUND" : "NOT_FOUND", 404, receiptExists
  );
  if (code === "ELOOP" || code === "UNSAFE_DIRECTORY" ||
    code === "NON_REGULAR_FILE" || code === "UNSAFE_FILE_PATH") return fail("UNSAFE_FILE",400,receiptExists);
  if (code === "FILE_TOO_LARGE") return fail("FILE_TOO_LARGE",413,receiptExists);
  return fail("FILE_READ_FAILED",500,receiptExists);
}

// Injected roots exist only for offline tests; HTTP route uses fixed production roots.
export function verifyEngine29Receipt({
  date, filename, replayDate, replayTime,
  receiptRoot = ENGINE29_RECEIPT_ROOT, esRoot = ES_REPLAY_ROOT,
} = {}) {
  if (!validDate(date) || !validDate(replayDate) || !validTime(replayTime) ||
    typeof filename !== "string" || !RECEIPT.test(filename) ||
    !filename.startsWith(date + "T") || path.basename(filename) !== filename) {
    return fail("INVALID_IDENTIFIER",400);
  }
  const receiptFile = path.join(receiptRoot, date, filename);
  const esFile = path.join(esRoot, replayDate, replayTime + ".json");
  let receiptBytes, replayBytes;
  try { receiptBytes = readRegularFile(receiptFile, receiptRoot, MAX_RECEIPT_BYTES); }
  catch (error) { return mapFsError(error); }
  try { replayBytes = readRegularFile(esFile, esRoot, MAX_REPLAY_BYTES); }
  catch (error) { return mapFsError(error,true); }

  let receipt, replay;
  try {
    receipt = JSON.parse(receiptBytes.toString("utf8"));
    replay = JSON.parse(replayBytes.toString("utf8"));
  } catch { return fail("INVALID_JSON",422,true); }
  if (receipt?.schema !== SCHEMA || !receipt?.timestamp ||
    typeof receipt !== "object" || Array.isArray(receipt)) {
    return fail("INVALID_RECEIPT_SCHEMA",422,true);
  }
  const archived = replay?.engine29DownstreamContext;
  if (archived?.schema !== SCHEMA || typeof archived !== "object" || Array.isArray(archived)) {
    return fail("INVALID_REPLAY_CONTEXT",422,true);
  }
  const receiptMs = Date.parse(receipt.timestamp);
  const archivedMs = Date.parse(archived.timestamp);
  const snapshotMs = Date.parse(replay.snapshotTime);
  if (![receiptMs, archivedMs, snapshotMs].every(Number.isFinite)) {
    return fail("INVALID_TIMESTAMP",422,true);
  }
  if (receiptMs > snapshotMs || archivedMs > snapshotMs) {
    return fail("LOOKAHEAD_DETECTED",409,true);
  }

  const receiptContextHash = sha256(canonical(receipt));
  const replayContextHash = sha256(canonical(archived));
  const exactMatch = receiptContextHash === replayContextHash &&
    receipt.timestamp === archived.timestamp;
  return {
    status: exactMatch ? 200 : 409,
    body: {
      ok:exactMatch, exists:true, verified:exactMatch,
      schema:SCHEMA,
      receiptTimestamp:receipt.timestamp,
      byteCount:receiptBytes.length,
      receiptFileSha256:sha256(receiptBytes),
      receiptContextSha256:receiptContextHash,
      replayContextSha256:replayContextHash,
      replaySnapshot:{ date:replayDate, time:replayTime, timestamp:replay.snapshotTime },
      exactMatch,
      reason:exactMatch ? "VERIFIED" : "CONTEXT_MISMATCH",
    }
  };
}
