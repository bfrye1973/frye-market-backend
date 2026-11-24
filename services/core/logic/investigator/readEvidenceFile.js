// services/core/logic/investigator/readEvidenceFile.js
//
// Read-only evidence file reader. Opens with "r" only, never creates, never
// writes, refuses symlinks and non-regular files, hashes the exact bytes it
// parses. A corrupt file is ERROR, never "empty".

import fs from "node:fs";
import crypto from "node:crypto";

export const DEFAULT_MAX_EVIDENCE_BYTES = 64 * 1024 * 1024;

export function readEvidenceBytes(file, { maxBytes = DEFAULT_MAX_EVIDENCE_BYTES } = {}) {
  const readAt = new Date().toISOString();
  let st;
  try {
    st = fs.lstatSync(file);
  } catch (error) {
    if (error?.code === "ENOENT") return { status: "UNAVAILABLE", reason: "FILE_NOT_FOUND", readAt };
    return { status: "ERROR", reason: "FILE_STAT_FAILED", readAt };
  }
  if (st.isSymbolicLink()) return { status: "ERROR", reason: "SYMLINK_REFUSED", readAt };
  if (!st.isFile()) return { status: "ERROR", reason: "NOT_A_REGULAR_FILE", readAt };
  if (st.size > maxBytes) return { status: "ERROR", reason: "FILE_TOO_LARGE", bytes: st.size, readAt };

  let bytes;
  const fd = fs.openSync(file, "r");
  try {
    bytes = fs.readFileSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  return {
    status: "OK",
    bytes,
    sha256: crypto.createHash("sha256").update(bytes).digest("hex"),
    byteLength: bytes.length,
    mtimeMs: st.mtimeMs,
    readAt,
  };
}

export function readEvidenceJson(file, options) {
  const raw = readEvidenceBytes(file, options);
  if (raw.status !== "OK") return raw;
  try {
    const value = JSON.parse(raw.bytes.toString("utf8"));
    const { bytes: _omit, ...meta } = raw;
    return { ...meta, value };
  } catch {
    const { bytes: _omit, ...meta } = raw;
    return { ...meta, status: "ERROR", reason: "JSON_PARSE_FAILED" };
  }
}

export function storeMeta(read, { label, mutable }) {
  return {
    store: label,
    status: read.status,
    reason: read.reason ?? null,
    sha256: read.sha256 ?? null,
    byteLength: read.byteLength ?? null,
    mtime: read.mtimeMs ? new Date(read.mtimeMs).toISOString() : null,
    readAt: read.readAt,
    mutable,
    note: mutable
      ? "Current store state at readAt. Not an immutable point-in-time record."
      : null,
  };
}
