import fs from "node:fs";
import path from "node:path";

export const MEMORY_SCHEMA = "engine26.negotiatedZoneMemory.v1";
export const DEFAULT_MEMORY_PATH =
  process.env.ENGINE26_NEGOTIATED_ZONE_MEMORY_PATH ||
  "/opt/render/project/src/services/core/data/engine26/negotiated-zone-memory.json"

function emptyStore() {
  return {
    schema: MEMORY_SCHEMA,
    updatedAt: null,
    records: {},
  };
}

export function readNegotiatedZoneMemory({ filePath = DEFAULT_MEMORY_PATH } = {}) {
  if (!fs.existsSync(filePath)) {
    return { ok: true, store: emptyStore(), warnings: [], malformed: false };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (
      parsed?.schema !== MEMORY_SCHEMA ||
      !parsed?.records ||
      typeof parsed.records !== "object"
    ) {
      throw new Error("ENGINE26_NEGOTIATED_ZONE_MEMORY_SCHEMA_INVALID");
    }
    return { ok: true, store: parsed, warnings: [], malformed: false };
  } catch (error) {
    return {
      ok: false,
      store: emptyStore(),
      warnings: [String(error?.message || error)],
      malformed: true,
      malformedPath: filePath,
    };
  }
}

function corruptBackupPath(filePath) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const ext = path.extname(filePath);
  const base = filePath.slice(0, ext ? -ext.length : undefined);
  return `${base}.${stamp}.corrupt.json`;
}

export function writeNegotiatedZoneMemory({
  filePath = DEFAULT_MEMORY_PATH,
  store,
  malformedSource = false,
} = {}) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });

  if (malformedSource && fs.existsSync(filePath)) {
    fs.renameSync(filePath, corruptBackupPath(filePath));
  }

  const nextStore = {
    schema: MEMORY_SCHEMA,
    updatedAt: new Date().toISOString(),
    records: { ...(store?.records || {}) },
  };

  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  let fd = null;

  try {
    fd = fs.openSync(tempPath, "w");
    fs.writeFileSync(fd, JSON.stringify(nextStore, null, 2), "utf8");
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    fs.renameSync(tempPath, filePath);
    return { ok: true, store: nextStore, warnings: [] };
  } catch (error) {
    if (fd !== null) {
      try { fs.closeSync(fd); } catch {}
    }
    try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch {}
    return {
      ok: false,
      store: nextStore,
      warnings: [String(error?.message || error)],
    };
  }
}
