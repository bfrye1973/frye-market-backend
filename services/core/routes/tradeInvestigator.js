// services/core/routes/tradeInvestigator.js
//
// GET /api/v1/trade-investigator
//
// Engine 12 Trade Investigator. Authenticated, GET-only, read-only, bounded,
// redacted. Dedicated read-only credential; never the Engine 8 admin secret.
// Pattern follows the Engine 2C private read route (dedicated header,
// timing-safe compare, explicit origin allowlist, no-store).
//
// Env:
//   TRADE_INVESTIGATOR_ENABLED=true
//   TRADE_INVESTIGATOR_ACCESS_KEY=<>=32 chars>       header: X-Trade-Investigator-Access
//   TRADE_INVESTIGATOR_ALLOWED_ORIGINS=https://frye-dashboard.onrender.com (comma list)
//   TRADE_INVESTIGATOR_REPLAY_ROOT   (default /var/data/replay/es)
//   ENGINE8_PAPER_DATA_DIR           (default /var/data/replay/engine8-paper)
//   TRADE_JOURNAL_DIR                (default /var/data/replay/journal)
//
// Status codes: 400 invalid query, 401 missing credential, 403 wrong credential,
// 404 no evidence, 405 non-GET, 413 response too large, 429 rate limited,
// 503 not configured / storage unavailable.

import express from "express";
import { createHash, timingSafeEqual } from "node:crypto";
import { performance } from "node:perf_hooks";

import { buildInvestigation } from "../logic/investigator/buildInvestigation.js";
import { redactInvestigationPayload } from "../logic/investigator/redactInvestigationPayload.js";
import { validateInvestigationQuery, LIMITS } from "../logic/investigator/validateInvestigationQuery.js";

export const ACCESS_HEADER = "x-trade-investigator-access";

const digest = (v) => createHash("sha256").update(String(v)).digest();
const equal = (a, b) =>
  typeof a === "string" && typeof b === "string" && a.length > 0 && b.length > 0 &&
  timingSafeEqual(digest(a), digest(b));

export function resolveInvestigatorConfig(settings = process.env) {
  const key = settings.TRADE_INVESTIGATOR_ACCESS_KEY;
  return {
    enabled: settings.TRADE_INVESTIGATOR_ENABLED === "true" && typeof key === "string" && key.length >= 32,
    key,
    allowedOrigins: String(settings.TRADE_INVESTIGATOR_ALLOWED_ORIGINS || "https://frye-dashboard.onrender.com")
      .split(",").map((s) => s.trim()).filter(Boolean),
    replayRoot: settings.TRADE_INVESTIGATOR_REPLAY_ROOT || "/var/data/replay/es",
    engine8PaperDir: settings.ENGINE8_PAPER_DATA_DIR || "/var/data/replay/engine8-paper",
    journalDir: settings.TRADE_JOURNAL_DIR || "/var/data/replay/journal",
  };
}

function makeRateLimiter({ limit, windowMs, now }) {
  const hits = new Map();
  return (key) => {
    const t = now();
    const entry = hits.get(key);
    if (!entry || t - entry.start >= windowMs) {
      hits.set(key, { start: t, count: 1 });
      if (hits.size > 10000) hits.clear();
      return true;
    }
    entry.count += 1;
    return entry.count <= limit;
  };
}

export function makeTradeInvestigatorRouter({
  settings = process.env,
  now = () => Date.now(),
  rateLimit = { limit: 60, windowMs: 60_000 },
  log = (line) => console.log(JSON.stringify(line)),
} = {}) {
  const config = resolveInvestigatorConfig(settings);
  const allow = makeRateLimiter({ ...rateLimit, now });
  const router = express.Router();

  router.all("/trade-investigator", (req, res) => {
    const started = performance.now();

    // Do not rely on the project-wide reflective CORS policy.
    res.removeHeader("Access-Control-Allow-Credentials");
    const origin = req.get("origin");
    if (origin && config.allowedOrigins.includes(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Headers", "Accept, X-Trade-Investigator-Access");
      res.setHeader("Access-Control-Allow-Methods", "GET");
    } else {
      res.removeHeader("Access-Control-Allow-Origin");
    }
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("X-Content-Type-Options", "nosniff");

    const send = (status, body, meta = {}) => {
      const durationMs = Math.round((performance.now() - started) * 10) / 10;
      res.setHeader("Server-Timing", "investigate;dur=" + durationMs);
      log({ route: "trade-investigator", status, durationMs, ...meta });
      return res.status(status).json(body);
    };

    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      return send(405, { ok: false, error: "METHOD_NOT_ALLOWED" });
    }
    if (!config.enabled) return send(503, { ok: false, error: "TRADE_INVESTIGATOR_NOT_CONFIGURED" });

    const provided = req.get(ACCESS_HEADER);
    if (!provided) return send(401, { ok: false, error: "CREDENTIAL_REQUIRED" });
    if (!equal(provided, config.key)) return send(403, { ok: false, error: "CREDENTIAL_REJECTED" });

    if (!allow(req.ip || "unknown")) return send(429, { ok: false, error: "RATE_LIMITED" });

    const v = validateInvestigationQuery(req.query);
    if (!v.ok) return send(400, { ok: false, error: "INVALID_QUERY", errors: v.errors });
    const meta = { date: v.value.date, time: v.value.time, strategyId: v.value.strategyId };

    let result;
    try {
      result = buildInvestigation({ query: v.value, config });
    } catch {
      return send(500, { ok: false, error: "INVESTIGATION_FAILED" }, meta);
    }

    const durationMs = Math.round((performance.now() - started) * 10) / 10;
    const body = redactInvestigationPayload({ ...result.body, timing: { durationMs } });
    const cap = v.value.detail === "full" ? LIMITS.maxResponseBytesFull : LIMITS.maxResponseBytesSummary;
    const size = Buffer.byteLength(JSON.stringify(body));
    if (size > cap) {
      return send(413, { ok: false, error: "RESPONSE_TOO_LARGE", bytes: size, limit: cap, hint: v.value.detail === "full" ? "Use detail=summary." : null }, meta);
    }
    return send(result.httpStatus, body, { ...meta, bytes: size });
  });

  return router;
}

export default makeTradeInvestigatorRouter;
