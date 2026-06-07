// services/core/jobs/snapshotEngine25SectorCardBreadth.js
//
// Engine 25G — Sector Card Proxy Breadth Snapshot Collector v0.1
//
// Purpose:
// - Capture forward-only sector-card breadth snapshots for Engine 25.
// - Use 1H/hourly sector cards as tactical live participation.
// - Use 4H sector cards as regime confirmation.
// - Do NOT fake historical sector-card breadth.
// - Do NOT mutate Market Meter files.
//
// Reads, in priority order:
//   1H tactical:
//     data/outlook_source.json
//     data/outlook_hourly.json
//     /live/hourly fallback
//
//   4H regime:
//     data/outlook_source_4h.json
//     data/outlook_4h.json
//     /live/4h fallback
//
// Writes:
//   data/engine25-sector-card-breadth-snapshots.json

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CORE_DIR = path.resolve(__dirname, "..");
const SRC_ROOT = path.resolve(CORE_DIR, "..", "..");
const ROOT_DATA_DIR = path.join(SRC_ROOT, "data");
const CORE_DATA_DIR = path.join(CORE_DIR, "data");

const OUTPUT_FILE = path.join(CORE_DATA_DIR, "engine25-sector-card-breadth-snapshots.json");

const BACKEND_BASE =
  process.env.BACKEND_BASE || "https://frye-market-backend-1.onrender.com";

const LIVE_HOURLY_URL = `${BACKEND_BASE}/live/hourly`;
const LIVE_4H_URL = `${BACKEND_BASE}/live/4h`;

const ENGINE_NAME = "engine25.sectorCardProxyBreadthSnapshots.v0.1";

const OFFENSIVE = new Set([
  "information technology",
  "consumer discretionary",
  "communication services",
  "industrials",
]);

const DEFENSIVE = new Set([
  "consumer staples",
  "utilities",
  "health care",
  "real estate",
]);

function nowUtcIso() {
  return new Date().toISOString();
}

function utcDateFromIso(iso) {
  const d = iso ? new Date(iso) : new Date();
  if (Number.isNaN(d.getTime())) return new Date().toISOString().slice(0, 10);
  return d.toISOString().slice(0, 10);
}

function ensureDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function safeNumber(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function round2(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Number(n.toFixed(2));
}

function pct(a, b) {
  const x = safeNumber(a, 0);
  const y = safeNumber(b, 0);
  if (y <= 0) return 50;
  return round2((x / y) * 100);
}

function normalizeSectorName(name) {
  return String(name || "").trim().toLowerCase();
}

function readJsonOptional(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (err) {
    return {
      ok: false,
      error: `Failed reading ${filePath}: ${err.message}`,
    };
  }
}

async function fetchJsonOptional(url, label) {
  try {
    const res = await fetch(url);
    const text = await res.text();

    let json;
    try {
      json = JSON.parse(text);
    } catch {
      return {
        ok: false,
        unavailable: true,
        label,
        url,
        error: `Invalid JSON: ${text.slice(0, 250)}`,
      };
    }

    if (!res.ok) {
      return {
        ok: false,
        unavailable: true,
        label,
        url,
        error: `HTTP ${res.status}: ${text.slice(0, 250)}`,
      };
    }

    return json;
  } catch (err) {
    return {
      ok: false,
      unavailable: true,
      label,
      url,
      error: err.message,
    };
  }
}

function extractGeneratedAt(payload) {
  return (
    payload?.updated_at_utc ||
    payload?.generated_at_utc ||
    payload?.meta?.ts_utc ||
    payload?.meta?.last_run_utc ||
    payload?.date ||
    null
  );
}

function extractSectorCards(payload) {
  if (Array.isArray(payload?.sectorCards)) return payload.sectorCards;
  if (Array.isArray(payload?.sectors)) return payload.sectors;
  return [];
}

function normalizeCard(card) {
  const sector = card?.sector || card?.name || null;

  return {
    sector,
    sectorKey: normalizeSectorName(sector),
    breadth_pct: safeNumber(card?.breadth_pct, 50),
    momentum_pct: safeNumber(card?.momentum_pct, 50),
    nh: safeNumber(card?.nh, 0),
    nl: safeNumber(card?.nl, 0),
    up: safeNumber(card?.up, 0),
    down: safeNumber(card?.down, 0),
    netHighLow: safeNumber(card?.nh, 0) - safeNumber(card?.nl, 0),
  };
}

function summarizeCards(cards) {
  const clean = (Array.isArray(cards) ? cards : []).map(normalizeCard).filter((c) => c.sector);

  const sectorCount = clean.length;

  const totalNh = clean.reduce((sum, c) => sum + safeNumber(c.nh, 0), 0);
  const totalNl = clean.reduce((sum, c) => sum + safeNumber(c.nl, 0), 0);
  const totalUp = clean.reduce((sum, c) => sum + safeNumber(c.up, 0), 0);
  const totalDown = clean.reduce((sum, c) => sum + safeNumber(c.down, 0), 0);

  const avgBreadthPct =
    sectorCount > 0
      ? round2(clean.reduce((sum, c) => sum + safeNumber(c.breadth_pct, 50), 0) / sectorCount)
      : null;

  const avgMomentumPct =
    sectorCount > 0
      ? round2(clean.reduce((sum, c) => sum + safeNumber(c.momentum_pct, 50), 0) / sectorCount)
      : null;

  const aggregateBreadthPct = pct(totalNh, totalNh + totalNl);
  const aggregateMomentumPct = pct(totalUp, totalUp + totalDown);

  const offensiveCards = clean.filter((c) => OFFENSIVE.has(c.sectorKey));
  const defensiveCards = clean.filter((c) => DEFENSIVE.has(c.sectorKey));

  const offensiveBreadthPct =
    offensiveCards.length > 0
      ? round2(
          offensiveCards.reduce((sum, c) => sum + safeNumber(c.breadth_pct, 50), 0) /
            offensiveCards.length
        )
      : null;

  const defensiveBreadthPct =
    defensiveCards.length > 0
      ? round2(
          defensiveCards.reduce((sum, c) => sum + safeNumber(c.breadth_pct, 50), 0) /
            defensiveCards.length
        )
      : null;

  let riskOnHits = 0;
  let riskOnDenom = 0;

  for (const c of offensiveCards) {
    riskOnDenom += 1;
    if (safeNumber(c.breadth_pct, 50) >= 55) riskOnHits += 1;
  }

  for (const c of defensiveCards) {
    riskOnDenom += 1;
    if (safeNumber(c.breadth_pct, 50) <= 45) riskOnHits += 1;
  }

  const riskOnBreadthPct = riskOnDenom > 0 ? round2((riskOnHits / riskOnDenom) * 100) : null;

  const sectorsRising = clean.filter(
    (c) => safeNumber(c.breadth_pct, 50) >= 55 && safeNumber(c.momentum_pct, 50) >= 55
  ).length;

  const sectorsWeak = clean.filter(
    (c) => safeNumber(c.breadth_pct, 50) <= 45 && safeNumber(c.momentum_pct, 50) <= 45
  ).length;

  let riskOnState = "NEUTRAL";
  if (riskOnBreadthPct !== null) {
    if (riskOnBreadthPct >= 62) riskOnState = "RISK_ON_PARTICIPATION";
    else if (riskOnBreadthPct <= 38) riskOnState = "RISK_OFF_PARTICIPATION";
    else riskOnState = "MIXED_PARTICIPATION";
  }

  return {
    sectorCount,
    avgBreadthPct,
    avgMomentumPct,
    aggregateBreadthPct,
    aggregateMomentumPct,
    totalNh,
    totalNl,
    totalUp,
    totalDown,
    netHighLow: totalNh - totalNl,
    offensiveBreadthPct,
    defensiveBreadthPct,
    riskOnBreadthPct,
    riskOnState,
    sectorsRising,
    sectorsWeak,
  };
}

function classifyTimeframe(summary, timeframe) {
  if (!summary || summary.sectorCount <= 0) {
    return {
      available: false,
      label: `${timeframe.toUpperCase()}_SECTOR_BREADTH_UNAVAILABLE`,
      score: null,
      permissionImpact: "NO_IMPACT_DATA_UNAVAILABLE",
      reasonCodes: ["NO_SECTOR_CARDS_AVAILABLE"],
    };
  }

  const reasons = [];
  const breadth = safeNumber(summary.aggregateBreadthPct, 50);
  const momentum = safeNumber(summary.aggregateMomentumPct, 50);
  const riskOn = safeNumber(summary.riskOnBreadthPct, 50);

  const score = round2(0.45 * breadth + 0.35 * momentum + 0.2 * riskOn);

  let label = `${timeframe.toUpperCase()}_SECTOR_BREADTH_MIXED`;
  let permissionImpact = "NEUTRAL";

  if (score >= 65 && breadth >= 55 && momentum >= 55) {
    label = `${timeframe.toUpperCase()}_SECTOR_BREADTH_EXPANDING`;
    permissionImpact = "LONG_PERMISSION_SUPPORTIVE";
    reasons.push("BREADTH_AND_MOMENTUM_EXPANDING");
  } else if (score <= 40 || (breadth <= 45 && momentum <= 45)) {
    label = `${timeframe.toUpperCase()}_SECTOR_BREADTH_WEAK`;
    permissionImpact = "LONG_PERMISSION_REDUCED";
    reasons.push("BREADTH_AND_MOMENTUM_WEAK");
  } else if (riskOn >= 62) {
    label = `${timeframe.toUpperCase()}_RISK_ON_PARTICIPATION_IMPROVING`;
    permissionImpact = "LONG_PERMISSION_SUPPORTIVE_IF_ZONE_RECLAIMS";
    reasons.push("RISK_ON_SECTORS_PARTICIPATING");
  } else if (riskOn <= 38) {
    label = `${timeframe.toUpperCase()}_RISK_OFF_PARTICIPATION`;
    permissionImpact = "A_PLUS_ONLY_OR_NO_NORMAL_LONGS";
    reasons.push("RISK_ON_PARTICIPATION_WEAK_OR_DEFENSIVE_LEADERSHIP");
  } else {
    reasons.push("SECTOR_BREADTH_MIXED");
  }

  return {
    available: true,
    label,
    score,
    permissionImpact,
    reasonCodes: reasons,
  };
}

async function loadSource({ timeframe, candidates, liveUrl }) {
  for (const filePath of candidates) {
    const payload = readJsonOptional(filePath);
    const cards = extractSectorCards(payload);

    if (payload && Array.isArray(cards) && cards.length > 0) {
      return {
        available: true,
        sourceKind: "localFile",
        sourcePath: path.relative(SRC_ROOT, filePath),
        generatedAtUtc: extractGeneratedAt(payload),
        payload,
        cards,
      };
    }
  }

  const livePayload = await fetchJsonOptional(liveUrl, `${timeframe} live sector breadth`);
  const liveCards = extractSectorCards(livePayload);

  if (Array.isArray(liveCards) && liveCards.length > 0) {
    return {
      available: true,
      sourceKind: "liveRoute",
      sourcePath: liveUrl.replace(BACKEND_BASE, ""),
      generatedAtUtc: extractGeneratedAt(livePayload),
      payload: livePayload,
      cards: liveCards,
    };
  }

  return {
    available: false,
    sourceKind: "unavailable",
    sourcePath: null,
    generatedAtUtc: null,
    payload: null,
    cards: [],
    error: livePayload?.error || "No local or live sectorCards source available.",
  };
}

function buildTimeframeSnapshot(timeframe, source) {
  const cards = source.cards.map(normalizeCard);
  const summary = summarizeCards(cards);
  const classification = classifyTimeframe(summary, timeframe);

  return {
    available: source.available,
    timeframe,
    sourceType: "sectorCardProxyBreadth",
    sourceKind: source.sourceKind,
    sourcePath: source.sourcePath,
    generatedAtUtc: source.generatedAtUtc,
    cardCount: cards.length,
    cards,
    summary,
    classification,
  };
}

function buildCombinedRead(tactical1h, regime4h) {
  const reasons = [];

  const tAvailable = tactical1h?.available === true;
  const rAvailable = regime4h?.available === true;

  if (!tAvailable && !rAvailable) {
    return {
      available: false,
      score: null,
      label: "SECTOR_CARD_BREADTH_UNAVAILABLE",
      permissionImpact: "NO_IMPACT_DATA_UNAVAILABLE",
      reasonCodes: ["NO_1H_OR_4H_SECTOR_BREADTH_AVAILABLE"],
    };
  }

  const tScore = safeNumber(tactical1h?.classification?.score, null);
  const rScore = safeNumber(regime4h?.classification?.score, null);

  let score = null;

  if (tScore !== null && rScore !== null) {
    score = round2(0.65 * tScore + 0.35 * rScore);
    reasons.push("COMBINED_65_PERCENT_1H_35_PERCENT_4H");
  } else if (tScore !== null) {
    score = tScore;
    reasons.push("TACTICAL_1H_ONLY_AVAILABLE");
  } else if (rScore !== null) {
    score = rScore;
    reasons.push("REGIME_4H_ONLY_AVAILABLE");
  }

  const tacticalWeak =
    String(tactical1h?.classification?.label || "").includes("WEAK") ||
    String(tactical1h?.classification?.label || "").includes("RISK_OFF");

  const tacticalStrong =
    String(tactical1h?.classification?.label || "").includes("EXPANDING") ||
    String(tactical1h?.classification?.label || "").includes("RISK_ON");

  const regimeWeak =
    String(regime4h?.classification?.label || "").includes("WEAK") ||
    String(regime4h?.classification?.label || "").includes("RISK_OFF");

  const regimeStrong =
    String(regime4h?.classification?.label || "").includes("EXPANDING") ||
    String(regime4h?.classification?.label || "").includes("RISK_ON");

  let label = "SECTOR_CARD_BREADTH_MIXED";
  let permissionImpact = "NEUTRAL";

  if (tacticalWeak && regimeWeak) {
    label = "SECTOR_BREADTH_WEAK_TACTICAL_AND_REGIME";
    permissionImpact = "NO_BLIND_LONGS_OR_A_PLUS_ONLY";
    reasons.push("TACTICAL_1H_AND_REGIME_4H_WEAK");
  } else if (tacticalStrong && regimeStrong) {
    label = "SECTOR_BREADTH_EXPANDING_TACTICAL_AND_REGIME";
    permissionImpact = "LONG_PERMISSION_SUPPORTIVE_ON_RECLAIM";
    reasons.push("TACTICAL_1H_AND_REGIME_4H_EXPANDING");
  } else if (tacticalStrong && regimeWeak) {
    label = "TACTICAL_BOUNCE_REGIME_NOT_CONFIRMED";
    permissionImpact = "SCALP_OR_A_PLUS_ONLY";
    reasons.push("1H_IMPROVING_BUT_4H_NOT_CONFIRMED");
  } else if (tacticalWeak && regimeStrong) {
    label = "TACTICAL_DAMAGE_WITH_REGIME_STILL_SUPPORTIVE";
    permissionImpact = "WAIT_FOR_1H_REPAIR";
    reasons.push("1H_WEAK_BUT_4H_NOT_BROKEN");
  } else if (score !== null && score >= 65) {
    label = "SECTOR_BREADTH_SUPPORTIVE";
    permissionImpact = "LONG_PERMISSION_SUPPORTIVE_IF_ZONE_RECLAIMS";
    reasons.push("COMBINED_SCORE_SUPPORTIVE");
  } else if (score !== null && score <= 40) {
    label = "SECTOR_BREADTH_WEAK";
    permissionImpact = "LONG_PERMISSION_REDUCED";
    reasons.push("COMBINED_SCORE_WEAK");
  } else {
    reasons.push("COMBINED_SECTOR_BREADTH_MIXED");
  }

  return {
    available: true,
    score,
    label,
    permissionImpact,
    reasonCodes: reasons,
  };
}

function upsertSnapshot(existing, snapshot) {
  const snapshots = Array.isArray(existing?.snapshots) ? existing.snapshots : [];
  const key = snapshot.snapshotKey;

  const filtered = snapshots.filter((s) => s?.snapshotKey !== key);
  filtered.push(snapshot);

  filtered.sort((a, b) => String(a.snapshotKey || "").localeCompare(String(b.snapshotKey || "")));

  const maxSnapshots = safeNumber(process.env.ENGINE25_SECTOR_SNAPSHOT_LIMIT, 250);
  const trimmed = filtered.slice(-maxSnapshots);

  return trimmed;
}

async function main() {
  const startedAt = nowUtcIso();

  const outputBase = {
    ok: false,
    engine: ENGINE_NAME,
    schema: "engine25.sectorCardProxyBreadthSnapshots@1",
    startedAt,
    finishedAt: null,
    generatedAtUtc: null,
    sourceType: "sectorCardProxyBreadth",
    historicalSectorCardBreadthAvailable: false,
    disabledReason: "NO_HISTORICAL_SECTOR_CARD_SNAPSHOTS",
    design: {
      tactical1h: "primary live participation feed",
      regime4h: "higher-timeframe confirmation layer",
      historicalReplay: "disabled until real historical sector-card snapshots exist",
    },
    latestSnapshotDate: null,
    latestSnapshotKey: null,
    latest: null,
    snapshots: [],
    errors: [],
  };

  try {
    const existing = readJsonOptional(OUTPUT_FILE) || {};

    const tacticalSource = await loadSource({
      timeframe: "1h",
      candidates: [
        path.join(ROOT_DATA_DIR, "outlook_source.json"),
        path.join(ROOT_DATA_DIR, "outlook_hourly.json"),
        path.join(CORE_DATA_DIR, "outlook_source.json"),
        path.join(CORE_DATA_DIR, "outlook_hourly.json"),
      ],
      liveUrl: LIVE_HOURLY_URL,
    });

    const regimeSource = await loadSource({
      timeframe: "4h",
      candidates: [
        path.join(ROOT_DATA_DIR, "outlook_source_4h.json"),
        path.join(ROOT_DATA_DIR, "outlook_4h.json"),
        path.join(CORE_DATA_DIR, "outlook_source_4h.json"),
        path.join(CORE_DATA_DIR, "outlook_4h.json"),
      ],
      liveUrl: LIVE_4H_URL,
    });

    const tactical1h = buildTimeframeSnapshot("1h", tacticalSource);
    const regime4h = buildTimeframeSnapshot("4h", regimeSource);
    const combinedRead = buildCombinedRead(tactical1h, regime4h);

    const generatedAtUtc =
      tactical1h.generatedAtUtc ||
      regime4h.generatedAtUtc ||
      nowUtcIso();

    const snapshotDate = utcDateFromIso(generatedAtUtc);
    const snapshotKey = `${snapshotDate}|${new Date(generatedAtUtc).toISOString()}`;

    const snapshot = {
      snapshotKey,
      date: snapshotDate,
      generatedAtUtc,
      collectedAtUtc: nowUtcIso(),
      sourceType: "sectorCardProxyBreadth",
      historicalSectorCardBreadthAvailable: false,
      disabledReason: "NO_HISTORICAL_SECTOR_CARD_SNAPSHOTS",
      tactical1h,
      regime4h,
      combinedRead,
    };

    const snapshots = upsertSnapshot(existing, snapshot);

    const output = {
      ...outputBase,
      ok: true,
      finishedAt: nowUtcIso(),
      generatedAtUtc: nowUtcIso(),
      latestSnapshotDate: snapshotDate,
      latestSnapshotKey: snapshotKey,
      latest: snapshot,
      snapshots,
    };

    ensureDir(OUTPUT_FILE);
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));

    console.log("========================================");
    console.log("Engine 25 Sector Card Proxy Breadth Snapshot Complete");
    console.log("OK:", output.ok);
    console.log("Latest:", output.latestSnapshotKey);
    console.log("1H:", tactical1h.classification?.label, tactical1h.classification?.score);
    console.log("4H:", regime4h.classification?.label, regime4h.classification?.score);
    console.log("Combined:", combinedRead.label, combinedRead.score);
    console.log("Wrote:", OUTPUT_FILE);
    console.log("========================================");

    console.log(
      JSON.stringify(
        {
          ok: output.ok,
          engine: output.engine,
          latestSnapshotDate: output.latestSnapshotDate,
          tactical1h: {
            available: tactical1h.available,
            sourceKind: tactical1h.sourceKind,
            sourcePath: tactical1h.sourcePath,
            cardCount: tactical1h.cardCount,
            summary: tactical1h.summary,
            classification: tactical1h.classification,
          },
          regime4h: {
            available: regime4h.available,
            sourceKind: regime4h.sourceKind,
            sourcePath: regime4h.sourcePath,
            cardCount: regime4h.cardCount,
            summary: regime4h.summary,
            classification: regime4h.classification,
          },
          combinedRead,
          outputFile: OUTPUT_FILE,
        },
        null,
        2
      )
    );
  } catch (err) {
    const output = {
      ...outputBase,
      ok: false,
      finishedAt: nowUtcIso(),
      generatedAtUtc: nowUtcIso(),
      errors: [
        {
          message: err.message,
          stack: err.stack,
        },
      ],
    };

    ensureDir(OUTPUT_FILE);
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));

    console.error("Engine 25 Sector Card Proxy Breadth Snapshot Failed:");
    console.error(err);
    process.exit(1);
  }
}

main();
