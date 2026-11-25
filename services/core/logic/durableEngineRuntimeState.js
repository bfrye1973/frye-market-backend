import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CORE_DIR = path.resolve(__dirname, "..");
const DATA_DIR = path.join(CORE_DIR, "data");

export const ENGINE_RUNTIME_PERSIST_DIR =
  process.env.ENGINE_RUNTIME_PERSIST_DIR ||
  "/var/data/replay/engine-runtime-state";

export const ENGINE_RUNTIME_CANONICAL_FILES = Object.freeze([
  "engine25-market-health.json",
  "engine25-participation.json",
  "engine25-context.json",
  "engine25-es-overlay.json",
  "engine25-sector-card-breadth-snapshots.json",
  "engine25-zone-classification.json",
  "engine25-es-zone-aware-read.json",
  "engine25-es-technical-context.json",
  "engine29-cross-market-stress.json",
]);

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function parseJsonFile(filePath) {
  const text = fs.readFileSync(filePath, "utf8");
  const data = JSON.parse(text);
  if (!data || typeof data !== "object") {
    throw new Error(`Invalid canonical JSON object: ${filePath}`);
  }
  return { text, data };
}

function atomicWrite(filePath, text) {
  ensureDir(path.dirname(filePath));
  const temp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(temp, text, "utf8");
  fs.renameSync(temp, filePath);
}

export function persistEngineRuntimeFiles({
  fileNames = ENGINE_RUNTIME_CANONICAL_FILES,
  dataDir = DATA_DIR,
  persistDir = ENGINE_RUNTIME_PERSIST_DIR,
} = {}) {
  ensureDir(persistDir);

  const saved = [];
  const skipped = [];

  for (const fileName of fileNames) {
    const source = path.join(dataDir, fileName);
    const target = path.join(persistDir, fileName);

    if (!fs.existsSync(source)) {
      skipped.push({ file: fileName, reason: "SOURCE_MISSING" });
      continue;
    }

    try {
      const { text } = parseJsonFile(source);
      atomicWrite(target, text.endsWith("\n") ? text : `${text}\n`);
      saved.push(fileName);
    } catch (error) {
      skipped.push({
        file: fileName,
        reason: `INVALID_SOURCE:${error?.message || String(error)}`,
      });
    }
  }

  return {
    ok: saved.length > 0,
    persistDir,
    saved,
    skipped,
  };
}

export function restoreEngineRuntimeFiles({
  fileNames = ENGINE_RUNTIME_CANONICAL_FILES,
  dataDir = DATA_DIR,
  persistDir = ENGINE_RUNTIME_PERSIST_DIR,
  overwrite = false,
} = {}) {
  ensureDir(dataDir);

  const restored = [];
  const preserved = [];
  const skipped = [];

  for (const fileName of fileNames) {
    const source = path.join(persistDir, fileName);
    const target = path.join(dataDir, fileName);

    if (!fs.existsSync(source)) {
      skipped.push({ file: fileName, reason: "PERSISTED_COPY_MISSING" });
      continue;
    }

    if (!overwrite && fs.existsSync(target)) {
      try {
        parseJsonFile(target);
        preserved.push(fileName);
        continue;
      } catch {
        // Invalid runtime copy is replaced by the durable known-good copy.
      }
    }

    try {
      const { text } = parseJsonFile(source);
      atomicWrite(target, text.endsWith("\n") ? text : `${text}\n`);
      restored.push(fileName);
    } catch (error) {
      skipped.push({
        file: fileName,
        reason: `INVALID_PERSISTED_COPY:${error?.message || String(error)}`,
      });
    }
  }

  return {
    ok: restored.length > 0 || preserved.length > 0,
    persistDir,
    restored,
    preserved,
    skipped,
  };
}

export default {
  ENGINE_RUNTIME_PERSIST_DIR,
  ENGINE_RUNTIME_CANONICAL_FILES,
  persistEngineRuntimeFiles,
  restoreEngineRuntimeFiles,
};
