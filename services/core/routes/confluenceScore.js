// src/services/core/routes/confluenceScore.js
import express from "express";
import { computeConfluenceScore } from "../logic/confluenceScorer.js";

export const confluenceScoreRouter = express.Router();

function baseUrlFromReq(req) {
  const proto = req.headers["x-forwarded-proto"] || req.protocol || "https";
  return `${proto}://${req.get("host")}`;
}

async function jget(url) {
  const r = await fetch(url, { headers: { accept: "application/json" } });
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new Error(`GET ${url} -> ${r.status} ${text.slice(0, 200)}`);
  }
  return r.json();
}

/**
 * ✅ Deterministic CORS for this route (HARD SET)
 */
function applyCors(req, res) {
  const origin = req.headers.origin;

  const isAllowed =
    origin === "https://frye-dashboard.onrender.com" ||
    origin === "http://localhost:3000";

  const allowOrigin = isAllowed
    ? origin
    : "https://frye-dashboard.onrender.com";

  res.setHeader("Access-Control-Allow-Origin", allowOrigin);
  res.setHeader("Vary", "Origin");

  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS,POST");
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization, X-Requested-With, X-Idempotency-Key"
  );
}

// Explicit OPTIONS handler
confluenceScoreRouter.options("/confluence-score", (req, res) => {
  applyCors(req, res);
  return res.sendStatus(204);
});

// ----------------------------
// Step 3B helpers (LOCKED)
// ----------------------------
function containsPrice(z, price) {
  if (!z || !Number.isFinite(price)) return false;
  const lo = Number(z.lo);
  const hi = Number(z.hi);
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return false;
  return lo <= price && price <= hi;
}

function pickActiveExecutionZone(engine1Context, price) {
  // Priority LOCKED: negotiated -> shelf -> institutional
  const activeNegotiated = engine1Context?.active?.negotiated ?? null;
  const activeShelf = engine1Context?.active?.shelf ?? null;
  const activeInstitutional = engine1Context?.active?.institutional ?? null;

  const candidate = activeNegotiated || activeShelf || activeInstitutional || null;

  // STRICT containment (no guessing)
  if (candidate && containsPrice(candidate, price)) return candidate;

  return null; // NO_ACTIVE_ZONE
}

function strategyIdFromReqOrContext(req, engine1Context, tf) {
  // Prefer explicit strategyId
  const fromReq = req.query.strategyId != null ? String(req.query.strategyId) : "";
  if (fromReq) return fromReq;

  const fromCtx =
    engine1Context?.meta?.strategyId ||
    engine1Context?.strategyId ||
    engine1Context?.meta?.strategy ||
    engine1Context?.strategy ||
    "";

  if (fromCtx) return String(fromCtx);

  // Fallback (LOCKED-ish) if no strategyId present:
  // Use tf to choose a stable default strategy family.
  const t = String(tf || "").toLowerCase();
  if (t === "5m" || t === "10m" || t === "15m") return "intraday_scalp@10m";
  if (t === "30m" || t === "1h") return "minor_swing@1h";
  if (t === "4h" || t === "4hbridge" || t === "4h_bridge") return "intermediate_long@4h";
  return "minor_swing@1h";
}

function modeFromStrategyId(strategyId) {
  const s = String(strategyId || "").toLowerCase();
  if (s.includes("intraday_scalp")) return "scalp";
  if (s.includes("minor_swing")) return "swing";
  if (s.includes("intermediate_long")) return "long";
  return "swing";
}

function volumeStateFromEngine4(engine4, activeZone) {
  // LOCKED labels & priority
  if (!activeZone) return "NO_ACTIVE_ZONE";
  if (!engine4 || !engine4.flags) return "NO_SIGNAL";

  const f = engine4.flags;

  if (f.liquidityTrap) return "TRAP_SUSPECTED";
  if (engine4.volumeConfirmed && f.initiativeMoveConfirmed) return "INITIATIVE";
  if (f.absorptionDetected) return "ABSORPTION";
  if (f.distributionDetected) return "DISTRIBUTION";
  if (f.volumeDivergence) return "DIVERGENCE";
  return "NEGOTIATING";
}

// ----------------------------
// Route
// ----------------------------
confluenceScoreRouter.get("/confluence-score", async (req, res) => {
  applyCors(req, res);

  try {
    const symbol = String(req.query.symbol || "SPY").toUpperCase();
    const tf = String(req.query.tf || "1h");
    const degree = String(req.query.degree || "minor");
    const wave = String(req.query.wave || "W1");

    const base = baseUrlFromReq(req);

    // ----------------------------
    // Engine 1 context FIRST (authoritative for price + active zones)
    // ----------------------------
    const ctxUrl =
      `${base}/api/v1/engine5-context` +
      `?symbol=${encodeURIComponent(symbol)}` +
      `&tf=${encodeURIComponent(tf)}`;

    const engine1Context = await jget(ctxUrl);

    // Authoritative price comes from Engine 1 context
    const price = Number(engine1Context?.meta?.current_price ?? NaN);
    const priceOk = Number.isFinite(price);

    // Strategy/mode (Engine 5 owns this)
    const strategyId = strategyIdFromReqOrContext(req, engine1Context, tf);
    const mode = modeFromStrategyId(strategyId);

    // ----------------------------
    // Engine 2 fib (signals only; NOT price source)
    // ----------------------------
    const fibUrl =
      `${base}/api/v1/fib-levels` +
      `?symbol=${encodeURIComponent(symbol)}` +
      `&tf=${encodeURIComponent(tf)}` +
      `&degree=${encodeURIComponent(degree)}` +
      `&wave=${encodeURIComponent(wave)}`;

    const fib = await jget(fibUrl);

    // ----------------------------
    // Active execution zone (NO guessing, containment required)
    // Priority: negotiated -> shelf -> institutional
    // ----------------------------
    const activeZone = priceOk ? pickActiveExecutionZone(engine1Context, price) : null;

    const zoneId = activeZone?.id ?? null;
    const zoneLo = activeZone?.lo ?? null;
    const zoneHi = activeZone?.hi ?? null;

    // ----------------------------
    // Engine 3 (reaction) — keep aligned with mode, pass zoneId if present
    // ----------------------------
    const e3Url =
      `${base}/api/v1/reaction-score` +
      `?symbol=${encodeURIComponent(symbol)}` +
      `&tf=${encodeURIComponent(tf)}` +
      `&mode=${encodeURIComponent(mode)}` +
      (zoneId ? `&zoneId=${encodeURIComponent(zoneId)}` : "");

    const reaction = await jget(e3Url);

    // ----------------------------
    // Engine 4 (volume) — call ONLY if activeZone exists; pass mode; degrade gracefully
    // ----------------------------
    let volume = null;
    let volumeState = "NO_ACTIVE_ZONE";

    if (activeZone && zoneLo != null && zoneHi != null) {
      const e4Base =
        process.env.ENGINE4_BASE_URL?.trim() || "http://localhost:10000";

      const e4Url =
        `${e4Base}/api/v1/volume-behavior` +
        `?symbol=${encodeURIComponent(symbol)}` +
        `&tf=${encodeURIComponent(tf)}` +
        `&zoneLo=${encodeURIComponent(zoneLo)}` +
        `&zoneHi=${encodeURIComponent(zoneHi)}` +
        `&mode=${encodeURIComponent(mode)}`;

      try {
        volume = await jget(e4Url);
      } catch (e) {
        volume = {
          ok: true,
          volumeScore: 0,
          volumeConfirmed: false,
          reasonCodes: ["ENGINE4_UNAVAILABLE"],
          flags: {},
          diagnostics: {
            note: "Engine 4 unreachable — degraded volume scoring",
            engine4Base: e4Base,
            error: String(e?.message || e),
          },
        };
      }

      volumeState = volumeStateFromEngine4(volume, activeZone);
    } else {
      // No active zone => hard gate upstream (Engine 1 rule)
      volume = {
        ok: true,
        volumeScore: 0,
        volumeConfirmed: false,
        reasonCodes: ["NO_ACTIVE_ZONE"],
        flags: {},
        diagnostics: { note: "NO_ACTIVE_ZONE" },
      };
      volumeState = "NO_ACTIVE_ZONE";
    }

    // ----------------------------
    // Confluence aggregation
    // ----------------------------
    const out = computeConfluenceScore({
      symbol,
      tf,
      degree,
      wave,
      price: priceOk ? price : null,
      engine1Context,
      fib,
      reaction,
      volume,
    });

    // ----------------------------
    // Step 3B: Attach translated truth for UI + downstream engines
    // (Non-breaking: add fields if missing, never remove)
    // ----------------------------
    out.strategyId = out.strategyId ?? strategyId;
    out.mode = out.mode ?? mode;

    out.volumeState = volumeState;

    out.context = out.context || {};
    out.context.activeZone =
      out.context.activeZone ||
      (activeZone
        ? {
            id: activeZone.id ?? null,
            zoneType: activeZone.zoneType ?? activeZone.type ?? null,
            lo: activeZone.lo ?? null,
            hi: activeZone.hi ?? null,
            mid: activeZone.mid ?? null,
            strength: activeZone.strength ?? null,
          }
        : null);

    out.context.volume = out.context.volume || {};
    out.context.volume.volumeScore = volume?.volumeScore ?? 0;
    out.context.volume.volumeConfirmed = volume?.volumeConfirmed ?? false;
    out.context.volume.flags = volume?.flags ?? {};
    out.context.volume.mode = mode;
    out.context.volume.state = volumeState;

    return res.json(out);
  } catch (err) {
    applyCors(req, res);
    return res.status(500).json({
      ok: false,
      error: String(err?.message || err),
    });
  }
});
