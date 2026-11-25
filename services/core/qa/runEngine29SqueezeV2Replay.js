// services/core/qa/runEngine29SqueezeV2Replay.js
//
// Phase 4 read-only replay harness.
// - Reads immutable Engine25 10m archive snapshots.
// - Fetches ES 10m bars from the production public futures OHLC route.
// - Applies Phase 2 pure scoring only.
// - Does NOT wire or mutate production Engine29 state.

import fs from "node:fs";
import path from "node:path";

import {
  scoreBroadeningVelocity10,
  scoreBroadeningVelocity20,
  scoreESAbnormalityHorizon,
  scoreESAbnormalityQuality,
  scoreSqueezePressure,
  scoreSqueezeV2Internals,
} from "../logic/engine29/tacticalCharacter/squeezeV2Scoring.js";

const BACKEND_BASE =
  process.env.ENGINE29_REPLAY_BACKEND ||
  "https://frye-market-backend-1.onrender.com";

const ARCHIVE_ROOT =
  process.env.ENGINE25_10M_ARCHIVE_ROOT ||
  "/tmp/engine25-10m-archive/data/engine25-10m-history";

const ARCHIVE_30M_ROOT =
  process.env.ENGINE25_30M_ARCHIVE_ROOT ||
  "/tmp/engine25-30m-archive/data/engine25-30m-history";

const REPLAY_DATE =
  process.env.ENGINE29_REPLAY_DATE ||
  new Date().toISOString().slice(0, 10);

function toMs(value) {
  const n = Number(value);
  if (Number.isFinite(n)) return n < 1e12 ? n * 1000 : n;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function pct(from, to) {
  const a = Number(from);
  const b = Number(to);
  if (!Number.isFinite(a) || !Number.isFinite(b) || a === 0) return null;
  return ((b - a) / Math.abs(a)) * 100;
}

async function getJson(url) {
  const response = await fetch(url, {
    cache: "no-store",
    headers: { accept: "application/json", "cache-control": "no-store" },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${url}: ${text.slice(0,300)}`);
  }
  return JSON.parse(text);
}

function normalizeEsBars(payload) {
  const rows = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.bars)
      ? payload.bars
      : [];

  return rows
    .map((bar) => {
      const time = toMs(bar?.time ?? bar?.t);
      const close = Number(bar?.close ?? bar?.c);
      if (!Number.isFinite(time) || !Number.isFinite(close)) return null;
      return {
        time,
        close,
        open: Number(bar?.open ?? bar?.o),
        high: Number(bar?.high ?? bar?.h),
        low: Number(bar?.low ?? bar?.l),
      };
    })
    .filter(Boolean)
    .sort((a,b) => a.time - b.time);
}

function loadSnapshotsFrom(root, filename) {
  const dateDir = path.join(root, REPLAY_DATE);
  if (!fs.existsSync(dateDir)) {
    throw new Error(`No Engine25 10m archive date: ${dateDir}`);
  }

  return fs.readdirSync(dateDir)
    .sort()
    .map((folder) => {
      const file = path.join(dateDir, folder, filename);
      if (!fs.existsSync(file)) return null;
      return JSON.parse(fs.readFileSync(file, "utf8"));
    })
    .filter(Boolean)
    .sort((a,b) => toMs(a.sourceTimestamp) - toMs(b.sourceTimestamp));
}

function barsAtOrBefore(allBars, timestampMs) {
  return allBars.filter((bar) => bar.time <= timestampMs);
}

function sameWindowReturns(bars, barsBack, baselineWindows = 40) {
  const out = [];
  const endExclusive = bars.length - 1;
  const start = Math.max(barsBack, endExclusive - baselineWindows);
  for (let end = start; end < endExclusive; end += 1) {
    const anchor = bars[end - barsBack];
    const latest = bars[end];
    const move = pct(anchor?.close, latest?.close);
    if (Number.isFinite(move)) out.push(move);
  }
  return out;
}

function currentReturn(bars, barsBack) {
  if (bars.length < barsBack + 1) return null;
  return pct(bars.at(-(barsBack + 1))?.close, bars.at(-1)?.close);
}

function directionFromReturns(r10, r20) {
  const composite = [r10, r20].filter(Number.isFinite)
    .reduce((sum,v,_,arr) => sum + v / arr.length, 0);
  if (composite > 0) return "UP";
  if (composite < 0) return "DOWN";
  return null;
}

function round(value, digits = 2) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : null;
}

async function main() {
  let production = null;
  try {
    production = await getJson(
      new URL("/api/v1/engine29/cross-market-stress", BACKEND_BASE).toString()
    );
  } catch (error) {
    production = { shadowComparisonUnavailable: true, error: error?.message || String(error) };
  }

  const snapshots = loadSnapshotsFrom(ARCHIVE_ROOT, "engine25_10m_snapshot.json");
  const snapshots30 = fs.existsSync(path.join(ARCHIVE_30M_ROOT, REPLAY_DATE))
    ? loadSnapshotsFrom(ARCHIVE_30M_ROOT, "engine25_30m_snapshot.json")
    : [];

  const url = new URL("/api/v1/futures/ohlc", BACKEND_BASE);
  url.searchParams.set("symbol", "ES");
  url.searchParams.set("tf", "10m");
  url.searchParams.set("limit", "5000");

  const esPayload = await getJson(url.toString());
  const esBars = normalizeEsBars(esPayload);

  if (esBars.length < 50) {
    throw new Error(`Insufficient ES 10m bars: ${esBars.length}`);
  }

  let priorParticipation = [];
  const rows = [];

  for (const snapshot of snapshots) {
    const ts = toMs(snapshot.sourceTimestamp);
    const bars = barsAtOrBefore(esBars, ts);
    if (bars.length < 5) continue;

    const r10 = currentReturn(bars, 1);
    const r20 = currentReturn(bars, 2);
    const direction = directionFromReturns(r10, r20);
    if (!direction) continue;

    const a10 = scoreESAbnormalityHorizon({
      currentReturnPct: r10,
      historicalSameWindowReturnsPct: sameWindowReturns(bars, 1),
    });
    const a20 = scoreESAbnormalityHorizon({
      currentReturnPct: r20,
      historicalSameWindowReturnsPct: sameWindowReturns(bars, 2),
    });
    const esQuality = scoreESAbnormalityQuality({
      quality10: a10.quality,
      quality20: a20.quality,
    });

    const internals = scoreSqueezeV2Internals(snapshot, direction);
    const participation = internals.participationConfirmation.score;

    const bv10 = scoreBroadeningVelocity10({
      currentParticipation: participation,
      previousParticipation: priorParticipation.at(-1),
    });
    const bv20 = scoreBroadeningVelocity20({
      currentParticipation: participation,
      participationTwoObservationsAgo: priorParticipation.at(-2),
    });

    const pressure = scoreSqueezePressure({
      esAbnormalityQuality: esQuality.score,
      internalDivergence: internals.internalDivergence.score,
    });

    const matched30 = snapshots30
      .filter((item) => toMs(item.sourceTimestamp) <= ts)
      .at(-1) || null;
    const internals30 = matched30
      ? scoreSqueezeV2Internals(matched30, direction)
      : null;

    rows.push({
      sourceTimestamp: snapshot.sourceTimestamp,
      direction,
      es10mReturnPct: round(r10, 4),
      es20mReturnPct: round(r20, 4),
      es10RobustZ: round(a10.robustZ, 2),
      es20RobustZ: round(a20.robustZ, 2),
      esAbnormalityQuality: round(esQuality.score, 1),
      breadthPct: round(
        direction === "UP"
          ? snapshot.advancingBreadthPct
          : snapshot.decliningBreadthPct,
        1,
      ),
      sectors: `${snapshot.strongSectorCount}/${snapshot.neutralSectorCount}/${snapshot.weakSectorCount}`,
      netNHNL: snapshot.netNewHighsLows,
      directionalVolumeShare: round(
        direction === "UP"
          ? snapshot.advancingVolumeShare
          : snapshot.decliningVolumeShare,
        1,
      ),
      internalDivergence: round(internals.internalDivergence.score, 1),
      participationConfirmation: round(participation, 1),
      broadeningVelocity10: round(bv10.value, 1),
      broadeningVelocity20: round(bv20.value, 1),
      squeezePressure: round(pressure.score, 1),
      thirtyMinute: matched30 ? {
        sourceTimestamp: matched30.sourceTimestamp,
        internalDivergence: round(internals30?.internalDivergence?.score, 1),
        participationConfirmation: round(internals30?.participationConfirmation?.score, 1),
      } : null,
    });

    priorParticipation.push(participation);
    if (priorParticipation.length > 3) priorParticipation.shift();
  }

  console.log("SQUEEZE_V2_REPLAY " + JSON.stringify({
    date: REPLAY_DATE,
    snapshotCount: snapshots.length,
    thirtyMinuteSnapshotCount: snapshots30.length,
    evaluatedCount: rows.length,
    rows,
  }));

  const highPressure = rows.filter((row) => row.squeezePressure >= 40);
  const broadMoveLike = rows.filter((row) =>
    row.esAbnormalityQuality >= 50 &&
    row.participationConfirmation >= 70 &&
    row.squeezePressure < 30
  );

  const productionData = production?.data || production || {};
  const canonicalCharacterSqueeze =
    productionData?.marketCharacter?.move?.character?.squeeze ||
    productionData?.display?.marketCharacter?.move?.character?.squeeze ||
    null;
  const compatibilitySqueeze =
    productionData?.moveCharacter?.squeeze ||
    null;
  const oldSqueeze =
    canonicalCharacterSqueeze ||
    compatibilitySqueeze ||
    null;
  const oldLiveCondition =
    productionData?.marketCharacter?.move?.liveCondition ||
    productionData?.liveMonitor ||
    null;

  console.log("SQUEEZE_V2_PRODUCTION_SHAPE " + JSON.stringify({
    topLevelKeys: Object.keys(productionData || {}),
    error: productionData?.error ?? null,
    moveCharacterKeys: Object.keys(productionData?.moveCharacter || {}),
    marketCharacterMoveKeys: Object.keys(productionData?.marketCharacter?.move || {}),
  }));

  console.log("SQUEEZE_V2_SHADOW_COMPARE " + JSON.stringify({
    productionTimestamp: productionData?.timestamp ?? null,
    oldDetector: {
      active: oldSqueeze?.active === true || oldSqueeze?.squeezeLike === true,
      direction: oldSqueeze?.direction ?? null,
      state: oldSqueeze?.state ?? oldSqueeze?.character ?? (oldSqueeze?.active === false ? "NONE" : null),
      impulsePct: oldSqueeze?.impulsePct ?? null,
      impulseMultiple: oldSqueeze?.impulseMultiple ?? null,
      broadConfirmationMissing: oldSqueeze?.broadConfirmationMissing ?? null,
      liveConditionState: oldLiveCondition?.state ?? null,
      liveConditionDirection: oldLiveCondition?.direction ?? null,
    },
    newShadowLatest: rows.at(-1) || null,
    authority: "READ_ONLY_SHADOW_COMPARE",
  }));

  console.log("SQUEEZE_V2_REPLAY_SUMMARY " + JSON.stringify({
    highPressureCount: highPressure.length,
    highPressureTimes: highPressure.map((x) => x.sourceTimestamp),
    broadMoveLikeCount: broadMoveLike.length,
    broadMoveLikeTimes: broadMoveLike.map((x) => x.sourceTimestamp),
  }));
}

main().catch((error) => {
  console.error("SQUEEZE_V2_REPLAY_FAIL", error?.stack || error?.message || String(error));
  process.exit(1);
});
