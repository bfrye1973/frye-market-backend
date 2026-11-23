// Engine 29 — one read-only, schema-versioned downstream context for live and Replay.
// The canonical 30m parent is copied, never recomputed from companion lanes.
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { diagnoseEngine29RatesDuration } from "./ratesDurationDiagnostic.js";

export const ENGINE29_DOWNSTREAM_SCHEMA = "engine29.downstreamContext.v1";

export function buildEngine29DownstreamContext(output) {
  const character = output?.marketCharacter || {};
  const move = character.move || {};
  const trap = output?.trapDetection || {};
  const quality = output?.dataQuality || {};
  const parent = move.parent || null;
  const live = move.liveCondition || null;
  const squeeze = character.squeezeCampaign || null;
  const sourceTimestamp = output?.squeezeV2Observation?.sourceTimestamp ??
    output?.squeezeV2Observation?.timestamp ?? null;
  const observationId = output?.squeezeV2Observation?.observationId ?? null;
  const timestamp = output?.timestamp ?? null;
  const squeezeObs = output?.squeezeV2Observation || null;
  const ageMs = sourceTimestamp && Number.isFinite(Date.parse(sourceTimestamp)) &&
    Number.isFinite(Date.parse(timestamp))
    ? Math.max(0, Date.parse(timestamp) - Date.parse(sourceTimestamp))
    : null;

  return {
    schema: ENGINE29_DOWNSTREAM_SCHEMA,
    timestamp,
    authority: "OBSERVATION_ONLY_NO_PERMISSION_OR_EXECUTION",
    dataDegraded: output?.dataDegraded === true,
    degradedGroups: quality.degradedGroups || [],
    observationId,
    sourceTimestamp,
    observationAgeMs: ageMs,
    lanes: {
      parentMove: { dataDegraded: parent == null || parent?.stale === true ||
        quality.esThirtyMinuteFreshness?.stale === true, state: parent?.state ?? null,
        direction: parent?.direction ?? null, parent,
        freshness: quality.esThirtyMinuteFreshness ?? parent?.freshness ?? null },
      oneHour: { state: output?.tacticalState ?? null,
        freshness: quality.esOneHourFreshness ?? null,
        dataDegraded: output?.tacticalState == null || quality.esOneHourFreshness?.stale === true },
      thirtyMinute: { state: output?.fastTacticalState ?? null,
        freshness: quality.esThirtyMinuteFreshness ?? null,
        dataDegraded: output?.fastTacticalState == null || quality.esThirtyMinuteFreshness?.stale === true },
      liveTenMinute: { ...live, dataDegraded: !live || quality.esLiveMonitorFreshness?.stale === true,
        freshness: quality.esLiveMonitorFreshness ?? null },
      broadConfirmation: move.character?.broadConfirmation ?? null,
      squeeze: { campaign: squeeze, observationId, sourceTimestamp, observationAgeMs: ageMs,
        freshness: { ageMs, sourceTimestamp, reasonCodes: squeezeObs?.reasonCodes || [] },
        dataDegraded: !squeeze || squeezeObs?.available !== true || squeezeObs?.dataDegraded === true },
      liquidity: { ...character.liquidity,
        freshness: quality.esLiveMonitorFreshness ?? null,
        dataDegraded: !character.liquidity || quality.esLiveMonitorFreshness?.stale === true,
        eligibleForEngine4: false, reason: "P0_REPAIR_AND_REGRESSION_PENDING" },
      trap: { ...character.trap, campaign: output?.trapCampaign ?? null,
        freshness: quality.esLiveMonitorFreshness ?? null,
        dataDegraded: !character.trap || quality.esLiveMonitorFreshness?.stale === true, eligibleForEngine4: false,
        reason: "P0_REPAIR_AND_REGRESSION_PENDING" },
      engine25Participation: { ...output?.structuralParticipation,
        freshness: output?.structuralParticipation?.freshness ?? null,
        dataDegraded: output?.structuralParticipation?.available !== true },
      ratesDuration: { structural: output?.groups?.ratesDuration?.structural ?? null,
        oneHour: output?.groups?.ratesDuration?.tactical ?? null,
        thirtyMinute: output?.groups?.ratesDuration?.fastTactical ?? null,
        dataDegraded: (quality.degradedGroups || []).includes("ratesDuration"),
        diagnostics: diagnoseEngine29RatesDuration(output) },
    },
    engine26ZoneId: trap?.auctionEvent?.engine26ZoneId ??
      trap?.auctionEvent?.liquidityLevel?.zoneId ?? null,
    reasonCodes: [...new Set([...(output?.reasonCodes || []), ...(trap?.reasonCodes || [])])],
  };
}

// Point-in-time receipts are append-only and stored under the existing Replay mount.
// A failed write is fatal so production cannot claim a recorded observation that was lost.
export function recordEngine29DownstreamContext(context, { replayBaseDir =
  process.env.REPLAY_DATA_DIR || "/var/data", now = new Date() } = {}) {
  const base = path.join(replayBaseDir, "replay", "engine29", now.toISOString().slice(0,10));
  fs.mkdirSync(base, { recursive: true });
  const file = path.join(base, `${now.toISOString().replace(/[:.]/g, "-")}-${randomUUID()}.json`);
  fs.writeFileSync(file, JSON.stringify(context) + "\n", { flag: "wx" });
  return file;
}
