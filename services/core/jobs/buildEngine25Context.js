// services/core/jobs/buildEngine25Context.js

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CORE_DIR = path.join(__dirname, "..");
const DATA_DIR = path.join(CORE_DIR, "data");

const OUTPUT_FILE = path.join(DATA_DIR, "engine25-context.json");

const SOURCE_FILES = {
  marketHealth: "engine25-market-health.json",
  compositeOverlay: "engine25-composite-overlay-6mo.json",
  zoneAwareRead: "engine25-es-zone-aware-read.json",
  sectorBreadth: "engine25-sector-card-breadth-snapshots.json",
  zoneClassification: "engine25-zone-classification.json",
};

function nowIso() {
  return new Date().toISOString();
}

function ensureDataDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

function isObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function safeString(value) {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  return String(value);
}

function includesToken(value, token) {
  return safeString(value).toUpperCase().includes(token);
}

function firstDefined(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== "") {
      return value;
    }
  }
  return null;
}

function toNumberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function readJsonSource(key, fileName, warnings) {
  const filePath = path.join(DATA_DIR, fileName);

  if (!fs.existsSync(filePath)) {
    warnings.push(`Missing Engine 25 source file: ${fileName}`);
    return {
      ok: false,
      key,
      fileName,
      filePath,
      data: null,
      modifiedAt: null,
      sizeBytes: 0,
      error: "MISSING_FILE",
    };
  }

  try {
    const stat = fs.statSync(filePath);

    if (!stat.size || stat.size <= 0) {
      warnings.push(`Empty Engine 25 source file: ${fileName}`);
      return {
        ok: false,
        key,
        fileName,
        filePath,
        data: null,
        modifiedAt: stat.mtime.to
