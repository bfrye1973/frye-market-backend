// services/core/logic/replay/snapshotBuilder.js
import fs from "fs";
import path from "path";
import { nowUtcIso } from "./timeAz.js";

async function safeFetchJson(url) {
  try {
    const res = await fetch(url, { headers: { "accept": "application/json" } });
    if (!res.ok) return { ok: false, reason: `HTTP_${res.status}`, url };
    const json = await res.json();
    return json;
  } catch (e) {
    return { ok: false, reason: "FETCH_FAILED", message: String(e), url };
  }
}

function safeReadJson(filePath) {
  try {
    if (!fs.existsSync(filePath)) return { ok: false, reason: "FILE_NOT_FOUND", filePath };
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (e) {
    return { ok: false, reason: "READ_FAILED", message: String(e), filePath };
  }
}

/**
 * Best-effort mapping from outlook_intraday.json to required market fields.
 * If your outlook file uses different paths, we still store raw.
 */
function extractMarket(outlook) {
  // Default shape
  const market = {
    score10m: null,
    score1h: null,
    score4h: null,
    scoreEOD: null,
    scoreMaster: null,
    state10m: null,
    state1h: null,
    state4h: null,
    stateEOD: null,
    regime: null,
    raw: outlook,
    ok: true,
  };

  // Common patterns we've used before: outlook.metrics.* or outlook.market.*
  const m = outlook?.market ?? null;
  const metrics = outlook?.metrics ?? null;

  // Try multiple known candidates (no hard dependency)
  market.score10m = m?.score10m ?? metrics?.score10m ?? metrics?.marketScore10m ?? null;
  market.score1h  = m?.score1h  ?? metrics?.score1h  ?? metrics?.marketScore1h  ?? null;
  market.score4h  = m?.score4h  ?? metrics?.score4h  ?? metrics?.marketScore4h  ?? null;
  market.scoreEOD = m?.scoreEOD ?? metrics?.scoreEOD ?? metrics?.marketScoreEOD ?? null;
  market.scoreMaster = m?.scoreMaster ?? metrics?.scoreMaster ?? metrics?.masterScore ?? null;

  market.state10m = m?.state10m ?? metrics?.state10m ?? metrics?.marketState10m ?? null;
  market.state1h  = m?.state1h  ?? metrics?.state1h  ?? metrics?.marketState1h  ?? null;
  market.state4h  = m?.state4h  ?? metrics?.state4h  ?? metrics?.marketState4h  ?? null;
  market.stateEOD = m?.stateEOD ?? metrics?.stateEOD ?? metrics?.marketStateEOD ?? null;

  market.regime = m?.regime ?? metrics?.regime ?? outlook?.regime ?? null;

  // If everything is null, flag but still store raw
  const hasAny =
    market.score10m != null ||
    market.score1h != null ||
    market.score4h != null ||
    market.scoreEOD != null ||
    market.scoreMaster != null ||
    market.state10m != null ||
    market.regime != null;

  if (!hasAny) {
    market.ok = false;
    market.reason = "OUTLOOK_MAPPING_UNKNOWN";
  }

  return market;
}

export async function buildReplaySnapshot({
  dataDir,
  symbol = "SPY",
  smzHierarchyUrl,
  fibUrl,
  decisionUrl,      // optional
  permissionUrl,    // optional
}) {
  // 1) Market Meter from file (truth as produced by jobs)
  const outlookPath = path.join(dataDir, "outlook_intraday.json");
  const outlook = safeReadJson(outlookPath);

  const market = outlook?.ok === false
    ? { ok: false, reason: outlook.reason, raw: outlook }
    : extractMarket(outlook);

  // 2) SMZ Hierarchy (exact API output)
  const smzHierarchy = smzHierarchyUrl
    ? await safeFetchJson(smzHierarchyUrl + (smzHierarchyUrl.includes("?") ? `&symbol=${symbol}` : `?symbol=${symbol}`))
    : { ok: false, reason: "NO_SMZ_HIERARCHY_URL" };

  // 3) Fib (authoritative endpoint)
  const fib = fibUrl
    ? await safeFetchJson(fibUrl)
    : { ok: false, reason: "NO_FIB_URL" };

  // 4) Decision (best effort)
  let decision = {
    ok: false,
    reason: "NO_DECISION_SOURCE",
    setupScore: null,
    setupLabel: null,
    permission: null,
    direction: null,
    sizeMultiplier: null,
    reasonCodes: [],
  };

  // If you later add decision endpoints, we fold them in:
  if (decisionUrl) {
    const d = await safeFetchJson(decisionUrl);
    if (d?.ok !== false) decision = { ...decision, ...d, ok: true };
  }
  if (permissionUrl) {
    const p = await safeFetchJson(permissionUrl);
    if (p?.ok !== false) decision = { ...decision, ...p, ok: true };
  }

  // Structure wrapper required by passover
  const structure = {
    smzHierarchy,
    currentPrice: smzHierarchy?.meta?.current_price ?? smzHierarchy?.meta?.price ?? null,
  };

  return {
    ok: true,
    tsUtc: nowUtcIso(),
    symbol,
    market,
    structure,
    fib,
    decision,
  };
}
