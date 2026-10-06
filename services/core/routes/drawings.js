// services/core/routes/drawings.js
// Drawings API (v1) — file-backed persistence
// Contract:
//  GET    /api/v1/drawings?symbol=SPY&tf=1h
//  POST   /api/v1/drawings
//  PUT    /api/v1/drawings/:id
//  DELETE /api/v1/drawings/:id
//
// Storage:
//  services/core/data/drawings.json
//
// Notes:
//  - Client provides UUID id; backend enforces uniqueness.
//  - Backend assigns createdAtUtc/updatedAtUtc (deterministic for Replay).
//  - v1 concurrency = last-write-wins.

import express from "express";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// routes/ is sibling of data/
const DATA_DIR = path.resolve(__dirname, "../data");
const DRAWINGS_FILE = path.join(DATA_DIR, "drawings.json");

const ALLOWED_TF = new Set(["1m", "5m", "10m", "15m", "30m", "1h", "4h", "1d"]);
const ALLOWED_TYPES = new Set(["trendline", "abcd", "elliott_triangle"]);

function nowUtc() {
  return new Date().toISOString();
}

function bad(res, status, error, detail) {
  return res.status(status).json({
    ok: false,
    error,
    detail: detail ? String(detail) : undefined,
  });
}

function requireString(v) {
  return typeof v === "string" && v.trim().length > 0;
}

function sanitizeSymbol(symbol) {
  // Keep it strict; avoid writing weird filenames/keys later (even though we store flat list)
  const s = String(symbol || "").trim().toUpperCase();
  if (!/^[A-Z0-9.\-]{1,12}$/.test(s)) return null;
  return s;
}

function validateTf(tf) {
  const t = String(tf || "").trim();
  if (!ALLOWED_TF.has(t)) return null;
  return t;
}

function validateId(id) {
  const s = String(id || "").trim();
  // We accept UUIDs; keep len guard to avoid abuse.
  if (s.length < 8 || s.length > 80) return null;
  return s;
}

async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function readDrawingsFile() {
  await ensureDataDir();
  try {
    const raw = await fs.readFile(DRAWINGS_FILE, "utf-8");
    const json = JSON.parse(raw);
    const items = Array.isArray(json?.items) ? json.items : [];
    const updatedAtUtc = typeof json?.updatedAtUtc === "string" ? json.updatedAtUtc : null;
    return { ok: true, updatedAtUtc, items };
  } catch (e) {
    // If file doesn't exist, treat as empty.
    if (e && (e.code === "ENOENT" || String(e.message || "").includes("ENOENT"))) {
      return { ok: true, updatedAtUtc: null, items: [] };
    }
    // If file is corrupt, surface explicitly.
    throw e;
  }
}

async function atomicWriteJson(filepath, obj) {
  await ensureDataDir();
  const tmp = `${filepath}.tmp`;
  const data = JSON.stringify(obj, null, 2);
  await fs.writeFile(tmp, data, "utf-8");
  await fs.rename(tmp, filepath);
}

function filterItems(items, symbol, tf) {
  return items.filter((it) => it?.symbol === symbol && it?.tf === tf);
}

function normalizeIncomingItem(body) {
  // Minimal normalization; we trust the client for geometry, but validate required fields.
  // Timestamps are set server-side.
  const item = body && typeof body === "object" ? body : null;
  if (!item) return { ok: false, error: "invalid_body" };

  const id = validateId(item.id);
  const type = requireString(item.type) ? String(item.type).trim() : null;
  const symbol = sanitizeSymbol(item.symbol);
  const tf = validateTf(item.tf);

  if (!id) return { ok: false, error: "invalid_id" };
  if (!type || !ALLOWED_TYPES.has(type)) return { ok: false, error: "invalid_type" };
  if (!symbol) return { ok: false, error: "invalid_symbol" };
  if (!tf) return { ok: false, error: "invalid_tf" };

  // We keep the object mostly as-is, but enforce canonical symbol/tf/type/id
  const cleaned = { ...item, id, type, symbol, tf };

  // Ensure meta exists (timestamps assigned later)
  if (!cleaned.meta || typeof cleaned.meta !== "object") cleaned.meta = {};

  return { ok: true, item: cleaned };
}

// -------------------- Routes --------------------

// GET /api/v1/drawings?symbol=SPY&tf=1h
router.get("/drawings", async (req, res) => {
  try {
    const symbol = sanitizeSymbol(req.query.symbol);
    const tf = validateTf(req.query.tf);

    if (!symbol) return bad(res, 400, "bad_request", "Missing/invalid symbol");
    if (!tf) return bad(res, 400, "bad_request", "Missing/invalid tf");

    const file = await readDrawingsFile();
    const items = filterItems(file.items, symbol, tf);

    return res.json({
      ok: true,
      symbol,
      tf,
      updatedAtUtc: file.updatedAtUtc || null,
      items,
    });
  } catch (e) {
    console.error("[drawings] GET failed:", e?.stack || e);
    return bad(res, 500, "internal_error", e?.message || e);
  }
});

// POST /api/v1/drawings
router.post("/drawings", async (req, res) => {
  try {
    const parsed = normalizeIncomingItem(req.body);
    if (!parsed.ok) return bad(res, 400, "bad_request", parsed.error);

    const incoming = parsed.item;

    const file = await readDrawingsFile();
    const exists = file.items.some((it) => it?.id === incoming.id);
    if (exists) return bad(res, 409, "conflict", "Drawing id already exists");

    const ts = nowUtc();
    incoming.meta = {
      ...(incoming.meta || {}),
      createdAtUtc: ts,
      updatedAtUtc: ts,
    };

    const nextItems = [...file.items, incoming];
    const out = { ok: true, updatedAtUtc: ts, items: nextItems };

    await atomicWriteJson(DRAWINGS_FILE, out);

    return res.status(201).json({
      ok: true,
      item: incoming,
    });
  } catch (e) {
    console.error("[drawings] POST failed:", e?.stack || e);
    return bad(res, 500, "internal_error", e?.message || e);
  }
});

// PUT /api/v1/drawings/:id
router.put("/drawings/:id", async (req, res) => {
  try {
    const id = validateId(req.params.id);
    if (!id) return bad(res, 400, "bad_request", "Invalid id");

    const parsed = normalizeIncomingItem({ ...req.body, id });
    if (!parsed.ok) return bad(res, 400, "bad_request", parsed.error);

    const incoming = parsed.item;

    const file = await readDrawingsFile();
    const idx = file.items.findIndex((it) => it?.id === id);
    if (idx === -1) return bad(res, 404, "not_found", "Drawing not found");

    const existing = file.items[idx];
    const createdAtUtc =
      typeof existing?.meta?.createdAtUtc === "string" ? existing.meta.createdAtUtc : null;

    const ts = nowUtc();
    incoming.meta = {
      ...(incoming.meta || {}),
      createdAtUtc: createdAtUtc || ts, // preserve if present; else set
      updatedAtUtc: ts,
    };

    const nextItems = [...file.items];
    nextItems[idx] = incoming;

    const out = { ok: true, updatedAtUtc: ts, items: nextItems };
    await atomicWriteJson(DRAWINGS_FILE, out);

    return res.json({ ok: true, item: incoming });
  } catch (e) {
    console.error("[drawings] PUT failed:", e?.stack || e);
    return bad(res, 500, "internal_error", e?.message || e);
  }
});

// DELETE /api/v1/drawings/:id
router.delete("/drawings/:id", async (req, res) => {
  try {
    const id = validateId(req.params.id);
    if (!id) return bad(res, 400, "bad_request", "Invalid id");

    const file = await readDrawingsFile();
    const idx = file.items.findIndex((it) => it?.id === id);
    if (idx === -1) return bad(res, 404, "not_found", "Drawing not found");

    const ts = nowUtc();
    const nextItems = file.items.filter((it) => it?.id !== id);

    const out = { ok: true, updatedAtUtc: ts, items: nextItems };
    await atomicWriteJson(DRAWINGS_FILE, out);

    return res.json({ ok: true, deletedId: id });
  } catch (e) {
    console.error("[drawings] DELETE failed:", e?.stack || e);
    return bad(res, 500, "internal_error", e?.message || e);
  }
});

export default router;
