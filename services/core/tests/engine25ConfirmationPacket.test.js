import test from "node:test";
import assert from "node:assert/strict";
import {
  buildEngine25ConfirmationPacket,
  classifyTradePermission,
  completedBarStatus,
} from "../logic/engine25/buildConfirmationPacket.js";

function baseInputs() {
  const asOfUtc = "2026-10-31T18:00:00.000Z";
  return {
    asOfUtc,
    marketMeter: {
      updated_at_utc: "2026-10-31T17:59:30.000Z",
      master: {
        score: 36.3,
        state: "bear",
        tone: "danger",
        weights: { "10m": 0.10, "30m": 0.15, "1h": 0.25, "4h": 0.30, "1d": 0.20 },
      },
      lights: {
        "4h": {
          score: 33.7,
          state: "bear",
          reason: "ES_TREND_RISK",
          formula: "ES_4H_BASIC_PENDING_TUNE",
          updated_at_utc: "2026-10-31T17:59:20.000Z",
          lastBar: { time: Date.parse("2026-10-31T12:00:00.000Z") / 1000, close: 7600 },
        },
      },
    },
    reconstructedEod: {
      score: 51.5,
      state: "MIXED",
      breadthScore: 57.8,
      momentumScore: 45.1,
      completedSessionDate: "2026-10-30",
      updated_at_utc: "2026-10-31T17:57:01.000Z",
      productionAuthority: false,
    },
    participationArtifact: {
      fastParticipation: {
        timeframe: "10m",
        state: "STRONG",
        sourceTimestamp: "2026-10-31T17:55:00.000Z",
      },
      blendedParticipation: {
        state: "MIXED",
        reasonCodes: ["MIXED_PARTICIPATION_EVIDENCE"],
        conflictFlags: [],
      },
      sourceDiagnostics: {
        "10m": { freshnessState: "FRESH", sourceTimestamp: "2026-10-31T17:55:00.000Z" },
      },
      freshness: {
        state: "LAST_VALID_EQUITY_READ",
      },
      participation: {
        stockVolume: {
          intraday: {
            advancingVolume: 46,
            decliningVolume: 54,
          },
        },
        distributionPressure: {
          schema: "engine25.distributionPressure.v2",
          structural4h: { pressure: 54, label: "ELEVATED" },
        },
      },
    },
  };
}

test("65/20/15 score exactly matches frontend shadow formula", () => {
  const packet = buildEngine25ConfirmationPacket(baseInputs());
  const expected = 36.3 * 0.65 + 33.7 * 0.20 + 51.5 * 0.15;
  assert.equal(packet.tradePermissionShadow.score, Number(expected.toFixed(2)));
  assert.equal(packet.tradePermissionShadow.state, "BEARISH_SHORTS_FAVORED");
  assert.equal(packet.tradePermissionShadow.sizing, "DEFENSIVE");
  assert.equal(packet.authority.changesTradingPermission, false);
  assert.equal(packet.sources.reconstructedEod.shadowOnly, true);
  assert.equal(packet.calibration.historicallyCalibrated, false);
});

test("missing required input fails closed and never renormalizes", () => {
  const input = baseInputs();
  input.reconstructedEod = null;
  const packet = buildEngine25ConfirmationPacket(input);
  assert.equal(packet.tradePermissionShadow.score, null);
  assert.equal(packet.tradePermissionShadow.state, "INSUFFICIENT_DATA");
  assert.equal(packet.tradePermissionShadow.insufficientData, true);
  assert(packet.warnings.some((w) => w.code === "RECONSTRUCTED_EOD_UNAVAILABLE"));
});

test("historical cutoff rejects any required source published after as-of time", () => {
  const input = baseInputs();
  input.asOfUtc = "2026-10-29T15:00:00.000Z"; // 8:00 AM Arizona
  input.marketMeter.updated_at_utc = "2026-10-29T15:00:30.000Z";
  input.marketMeter.lights["4h"].updated_at_utc = "2026-10-29T14:59:00.000Z";
  input.marketMeter.lights["4h"].lastBar.time = Date.parse("2026-10-29T10:00:00.000Z") / 1000;
  input.reconstructedEod.updated_at_utc = "2026-10-28T20:00:00.000Z";
  input.reconstructedEod.completedSessionDate = "2026-10-28";

  const packet = buildEngine25ConfirmationPacket({
    ...input,
    mode: "HISTORICAL_REPLAY",
    provenance: {
      esMaster: { kind: "RETROSPECTIVE_RECONSTRUCTION", reconstructed: true, originallyPublished: false, archiveReference: "fixture/es" },
      fourHour: { kind: "ARCHIVED_PUBLISHED", originallyPublished: true, reconstructed: false, archiveReference: "fixture/4h" },
      reconstructedEod: { kind: "RETROSPECTIVE_RECONSTRUCTION", reconstructed: true, originallyPublished: false, archiveReference: "fixture/eod" },
    },
  });

  assert.equal(packet.tradePermissionShadow.score, null);
  assert.equal(packet.tradePermissionShadow.state, "INSUFFICIENT_DATA");
  assert(packet.warnings.some((w) => w.code === "ES_MASTER_AFTER_ASOF_CUTOFF"));
  assert.equal(packet.sources.esMaster.provenance.kind, "RETROSPECTIVE_RECONSTRUCTION");
});

test("historical provenance remains explicit when inputs are valid", () => {
  const input = baseInputs();
  input.asOfUtc = "2026-10-29T15:00:00.000Z";
  input.marketMeter.updated_at_utc = "2026-10-29T14:59:30.000Z";
  input.marketMeter.lights["4h"].updated_at_utc = "2026-10-29T14:59:00.000Z";
  input.marketMeter.lights["4h"].lastBar.time = Date.parse("2026-10-29T10:00:00.000Z") / 1000;
  input.reconstructedEod.updated_at_utc = "2026-10-28T20:00:00.000Z";
  input.reconstructedEod.completedSessionDate = "2026-10-28";

  const packet = buildEngine25ConfirmationPacket({
    ...input,
    mode: "HISTORICAL_REPLAY",
    provenance: {
      esMaster: { kind: "RETROSPECTIVE_RECONSTRUCTION", reconstructed: true, originallyPublished: false, archiveReference: "fixture/es" },
      fourHour: { kind: "ARCHIVED_PUBLISHED", originallyPublished: true, reconstructed: false, archiveReference: "fixture/4h" },
      reconstructedEod: { kind: "RETROSPECTIVE_RECONSTRUCTION", reconstructed: true, originallyPublished: false, archiveReference: "fixture/eod" },
    },
  });

  assert.notEqual(packet.tradePermissionShadow.score, null);
  assert.equal(packet.sources.esMaster.provenance.reconstructed, true);
  assert.equal(packet.sources.fourHour.provenance.originallyPublished, true);
  assert.equal(packet.sources.reconstructedEod.provenance.kind, "RETROSPECTIVE_RECONSTRUCTION");
});

test("4H completed-bar status is explicit", () => {
  const light = { lastBar: { time: Date.parse("2026-10-29T12:00:00Z") / 1000 } };
  const before = completedBarStatus(light, "4h", "2026-10-29T15:00:00Z");
  const after = completedBarStatus(light, "4h", "2026-10-29T16:00:00Z");
  assert.equal(before.completed, false);
  assert.equal(after.completed, true);
});

test("threshold classifications preserve current frontend bands", () => {
  assert.equal(classifyTradePermission(65).state, "LONG_BIAS");
  assert.equal(classifyTradePermission(55).state, "LONG_ALLOWED_REDUCED_SIZE");
  assert.equal(classifyTradePermission(50).state, "NEUTRAL_WAIT");
  assert.equal(classifyTradePermission(45).state, "AVOID_NEW_LONGS_SHORT_WATCH");
  assert.equal(classifyTradePermission(35).state, "BEARISH_SHORTS_FAVORED");
  assert.equal(classifyTradePermission(34.99).state, "STRONG_DEFENSIVE_BEARISH");
});

function historicalInputs() {
  const input = baseInputs();
  input.mode = "HISTORICAL_REPLAY";
  input.asOfUtc = "2026-10-29T15:00:00.000Z";
  input.marketMeter.updated_at_utc = "2026-10-29T14:50:00.000Z";
  input.marketMeter.lights["4h"].updated_at_utc = "2026-10-29T12:00:00.000Z";
  input.marketMeter.lights["4h"].lastBar.time = Date.parse("2026-10-29T08:00:00Z") / 1000;
  input.reconstructedEod.updated_at_utc = "2026-10-28T20:00:00.000Z";
  input.reconstructedEod.completedSessionDate = "2026-10-28";
  input.provenance = {
    esMaster: { kind: "RETROSPECTIVE_RECONSTRUCTION", reconstructed: true, originallyPublished: false, archiveReference: "fixture/es" },
    fourHour: { kind: "RETROSPECTIVE_RECONSTRUCTION", reconstructed: true, originallyPublished: false, archiveReference: "fixture/4h" },
    reconstructedEod: { kind: "RETROSPECTIVE_RECONSTRUCTION", reconstructed: true, originallyPublished: false, archiveReference: "fixture/eod" },
  };
  return input;
}

test("historical valid reconstruction stays explicitly non-published", () => {
  const p = buildEngine25ConfirmationPacket(historicalInputs());
  assert.notEqual(p.tradePermissionShadow.score, null);
  assert.equal(p.tradePermissionShadow.historicalDecisionAvailability, "RETROSPECTIVE_ESTIMATE_ONLY");
  assert(p.warnings.some((w) => w.code === "RETROSPECTIVE_INPUTS_NOT_ORIGINALLY_PUBLISHED"));
});

test("incomplete 4H bars fail closed even with three numeric scores", () => {
  const input = historicalInputs();
  input.marketMeter.lights["4h"].lastBar.time = Date.parse("2026-10-29T12:00:00Z") / 1000;
  const p = buildEngine25ConfirmationPacket(input);
  assert.equal(p.tradePermissionShadow.score, null);
  assert.equal(p.tradePermissionShadow.state, "INSUFFICIENT_DATA");
  assert(p.warnings.some((w) => w.code === "ES_4H_LAST_BAR_INCOMPLETE"));
});

test("missing and invalid 4H bar timestamp fail closed", () => {
  const input = historicalInputs();
  delete input.marketMeter.lights["4h"].lastBar;
  const p = buildEngine25ConfirmationPacket(input);
  assert.equal(p.tradePermissionShadow.score, null);
  assert(p.warnings.some((w) => w.code === "ES_4H_BAR_COMPLETION_UNVERIFIABLE"));
});

test("missing required historical publication timestamp fails closed", () => {
  const input = historicalInputs();
  delete input.marketMeter.lights["4h"].updated_at_utc;
  const p = buildEngine25ConfirmationPacket(input);
  assert.equal(p.tradePermissionShadow.score, null);
  assert(p.warnings.some((w) => w.code === "ES_4H_SOURCE_TIMESTAMP_UNVERIFIABLE"));
});

test("missing and inconsistent historical provenance fail closed", () => {
  const input = historicalInputs();
  input.provenance.fourHour = { kind: "ARCHIVED_PUBLISHED", originallyPublished: true };
  const p = buildEngine25ConfirmationPacket(input);
  assert.equal(p.tradePermissionShadow.score, null);
  assert(p.warnings.some((w) => w.code === "ES_4H_PROVENANCE_UNVERIFIABLE"));
});

test("EOD from current partial session is never used in 8AM replay", () => {
  const input = historicalInputs();
  input.reconstructedEod.completedSessionDate = "2026-10-29";
  const p = buildEngine25ConfirmationPacket(input);
  assert.equal(p.tradePermissionShadow.score, null);
  assert(p.warnings.some((w) => w.code === "RECONSTRUCTED_EOD_SESSION_NOT_COMPLETED_BY_ASOF"));
});

test("invalid historical asOf fails closed", () => {
  const input = historicalInputs();
  input.asOfUtc = "not-a-real-time";
  const p = buildEngine25ConfirmationPacket(input);
  assert.equal(p.tradePermissionShadow.score, null);
  assert(p.warnings.some((w) => w.code === "HISTORICAL_ASOF_INVALID"));
});
