import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// routes/ -> services/core/routes
// data/ is one level up from routes/
const STATE_FILE = path.resolve(__dirname, "../data/strategy-state.json");

function nowIso() {
  return new Date().toISOString();
}

function safeParseJson(txt, fallback) {
  try {
    return JSON.parse(txt);
  } catch {
    return fallback;
  }
}

/**
 * Engine 7 Strategy State (v1.0)
 *
 * Purpose:
 * - Persist user strategy toggles (enabled/disabled)
 * - Persist size cap band (display-only in Phase 1)
 * - Persist paperOnly (global) for execution enforcement
 *
 * Keying:
 * - strategies are keyed by `${strategyId}@${tf}`
 * - strategyId values (locked):
 *    - intraday_scalp (10m)
 *    - minor_swing (1h)
 *    - intermediate_long (4h)
 */
function seedState() {
  return {
    version: 1,
    updatedAt: nowIso(),
    global: { paperOnly: true },
    symbols: {}
  };
}

function defaultStrategiesForSymbol() {
  return {
    "intraday_scalp@10m": {
      strategyId: "intraday_scalp",
      tf: "10m",
      enabled: true,
      sizeCapBand: "M"
    },
    "minor_swing@1h": {
      strategyId: "minor_swing",
      tf: "1h",
      enabled: true,
      sizeCapBand: "M"
    },
    "intermediate_long@4h": {
      strategyId: "intermediate_long",
      tf: "4h",
      enabled: true,
      sizeCapBand: "S"
    }
  };
}

function normalizeGlobal(global) {
  const g = global && typeof global === "object" ? global : {};
  return {
    paperOnly: typeof g.paperOnly === "boolean" ? g.paperOnly : true
  };
}

function normalizeStrategyRow(row, fallbackStrategyId, fallbackTf) {
  const r = row && typeof row === "object" ? row : {};
  const strategyId = typeof r.strategyId === "string" ? r.strategyId : fallbackStrategyId;
  const tf = typeof r.tf === "string" ? r.tf : fallbackTf;

  let sizeCapBand = r.sizeCapBand;
  if (!["XS", "S", "M", "L"].includes(sizeCapBand)) sizeCapBand = "M";

  return {
    strategyId,
    tf,
    enabled: typeof r.enabled === "boolean" ? r.enabled : true,
    sizeCapBand
  };
}

function normalizeSymbolBlock(block) {
  const b = block && typeof block === "object" ? block : {};
  const strategiesIn = b.strategies && typeof b.strategies === "object" ? b.strategies : {};

  // Always include defaults so the UI always has the 3 cards.
  const defaults = defaultStrategiesForSymbol();
  const strategiesOut = { ...defaults };

  for (const [k, v] of Object.entries(strategiesIn)) {
    const [sidGuess, tfGuess] = String(k).split("@");
    strategiesOut[k] = normalizeStrategyRow(v, sidGuess || "unknown", tfGuess || "unknown");
  }

  return {
    updatedAt: typeof b.updatedAt === "string" ? b.updatedAt : nowIso(),
    strategies: strategiesOut
  };
}

function normalizeState(raw) {
  const r = raw && typeof raw === "object" ? raw : seedState();

  const symbolsIn = r.symbols && typeof r.symbols === "object" ? r.symbols : {};
  const symbolsOut = {};

  for (const [sym, block] of Object.entries(symbolsIn)) {
    symbolsOut[String(sym).toUpperCase()] = normalizeSymbolBlock(block);
  }

  return {
    version: typeof r.version === "number" ? r.version : 1,
    updatedAt: typeof r.updatedAt === "string" ? r.updatedAt : nowIso(),
    global: normalizeGlobal(r.global),
    symbols: symbolsOut
  };
}

function ensureFile() {
  if (!fs.existsSync(STATE_FILE)) {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(seedState(), null, 2), "utf8");
  }
}

function readState() {
  ensureFile();
  const txt = fs.readFileSync(STATE_FILE, "utf8");
  return normalizeState(safeParseJson(txt, seedState()));
}

function writeState(state) {
  const normalized = normalizeState(state);
  normalized.updatedAt = nowIso();

  // atomic write
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  const tmp = `${STATE_FILE}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(normalized, null, 2), "utf8");
  fs.renameSync(tmp, STATE_FILE);

  return normalized;
}

/**
 * GET /api/v1/strategy-state?symbol=SPY
 * Returns:
 *  - global settings (paperOnly)
 *  - per-symbol strategies keyed by `${strategyId}@${tf}`
 */
router.get("/strategy-state", (req, res) => {
  const symbol = String(req.query.symbol || "SPY").toUpperCase();
  const state = readState();

  if (!state.symbols[symbol]) {
    state.symbols[symbol] = {
      updatedAt: nowIso(),
      strategies: defaultStrategiesForSymbol()
    };
    writeState(state);
  }

  return res.json({
    ok: true,
    version: state.version,
    updatedAt: state.updatedAt,
    symbol,
    global: state.global,
    symbolState: state.symbols[symbol]
  });
});

/**
 * POST /api/v1/strategy-state
 *
 * Patch semantics:
 * - update global.paperOnly (optional)
 * - patch strategies by key `${strategyId}@${tf}` (optional)
 *
 * Body examples:
 * {
 *   "symbol": "SPY",
 *   "global": { "paperOnly": true }
 * }
 *
 * {
 *   "symbol": "SPY",
 *   "strategies": {
 *     "intraday_scalp@10m": { "enabled": true, "sizeCapBand": "M" },
 *     "minor_swing@1h": { "enabled": false },
 *     "intermediate_long@4h": { "sizeCapBand": "S" }
 *   }
 * }
 */
router.post("/strategy-state", express.json({ limit: "64kb" }), (req, res) => {
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const symbol = String(body.symbol || "SPY").toUpperCase();

  const state = readState();
  if (!state.symbols[symbol]) {
    state.symbols[symbol] = {
      updatedAt: nowIso(),
      strategies: defaultStrategiesForSymbol()
    };
  }

  // Patch global
  if (body.global && typeof body.global === "object") {
    if (typeof body.global.paperOnly === "boolean") {
      state.global.paperOnly = body.global.paperOnly;
    }
  }

  // Patch strategies
  if (body.strategies && typeof body.strategies === "object") {
    const strategies = state.symbols[symbol].strategies || {};

    for (const [key, patch] of Object.entries(body.strategies)) {
      const p = patch && typeof patch === "object" ? patch : null;
      if (!p) continue;

      if (!strategies[key]) {
        const [sidGuess, tfGuess] = String(key).split("@");
        strategies[key] = normalizeStrategyRow(
          { strategyId: sidGuess || "unknown", tf: tfGuess || "unknown" },
          sidGuess || "unknown",
          tfGuess || "unknown"
        );
      }

      if (typeof p.enabled === "boolean") strategies[key].enabled = p.enabled;

      if (typeof p.sizeCapBand === "string" && ["XS", "S", "M", "L"].includes(p.sizeCapBand)) {
        strategies[key].sizeCapBand = p.sizeCapBand;
      }

      // Optional: allow explicit id/tf patching if provided
      if (typeof p.strategyId === "string") strategies[key].strategyId = p.strategyId;
      if (typeof p.tf === "string") strategies[key].tf = p.tf;
    }

    state.symbols[symbol].strategies = strategies;
    state.symbols[symbol].updatedAt = nowIso();
  }

  const saved = writeState(state);

  return res.json({
    ok: true,
    version: saved.version,
    updatedAt: saved.updatedAt,
    symbol,
    global: saved.global,
    symbolState: saved.symbols[symbol]
  });
});

export default router;
