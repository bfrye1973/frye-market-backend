// services/core/logic/investigator/identifyFirstBlocker.js
//
// First-blocker resolution. Pure. Canonical evidence only.
//
// Priority:
//   1. Engine 28A recorded diagnosis, used exactly as stored, when trusted.
//   2. Canonical fallback over stored canonical gates in the REAL pipeline order.
//   3. UNKNOWN.
//
// Engine 28A is trusted only when ALL checks pass:
//   - record present, known contract version
//   - lane is covered by 28A (Strategy 1 only) and record.strategyId matches
//   - same cycle: record.snapshotTime equals the lane reference snapshot time
//   - not generated after the Replay file was written
//   - firstFailingEngine is null or a canonical gate engine
// A trusted 28A that disagrees with stored canonical gates yields
// BLOCKER_CONFLICT and firstBlocker UNKNOWN (both sides shown, neither picked).
//
// Shadow records are never an input to this module.

import {
  ENGINE28A_CONTRACTS,
  ENGINE28A_LANES,
  ENGINE28A_PATH,
  GATE_ENGINES,
  isDateCanonicallyVerified,
} from "./authorityRegistry.js";

export const FALLBACK_VERSION = "engine12.investigator.blockerFallback.v1";

const NO_BLOCKER_STATUSES = new Set(["PASS", "ORDER_READY", "COMPLETE"]);

function laneReferenceSnapshotTime(strategy) {
  // Same precedence Engine 28A v1 uses to stamp its own snapshotTime.
  return (
    strategy?.engine26LocationCandidate?.snapshotTime ||
    strategy?.confluence?.context?.reaction?.paperScalpReaction?.snapshotTime ||
    strategy?.permission?.paper?.snapshotTime ||
    strategy?.snapshotTime ||
    null
  );
}

function ms(value) {
  const t = Date.parse(value);
  return Number.isFinite(t) ? t : null;
}

function check(name, ok, detail = null) {
  return { check: name, ok: ok === true ? true : ok === null ? null : false, detail };
}

export function evaluateEngine28ATrust({ strategy, strategyId, replayGeneratedAtUtc, dateYmd }) {
  const record = strategy?.[ENGINE28A_PATH];
  const present = !!record && typeof record === "object";
  const reference = laneReferenceSnapshotTime(strategy);
  const checks = [];

  checks.push(check("LANE_COVERED_BY_ENGINE28A", ENGINE28A_LANES.includes(strategyId), strategyId));
  // "Names a canonical engine" is only decidable when the registry covers the date.
  checks.push(check("REGISTRY_VERIFIED_FOR_DATE", isDateCanonicallyVerified(dateYmd), dateYmd ?? null));
  checks.push(check("RECORD_PRESENT", present));
  if (present) {
    checks.push(check("KNOWN_CONTRACT", ENGINE28A_CONTRACTS.includes(record.contractVersion), record.contractVersion ?? null));
    checks.push(check("STRATEGY_MATCH", record.strategyId === strategyId, record.strategyId ?? null));
    checks.push(check(
      "SAME_CYCLE_SNAPSHOT_TIME",
      typeof record.snapshotTime === "string" && reference !== null && record.snapshotTime === reference,
      { recorded: record.snapshotTime ?? null, laneReference: reference },
    ));
    const gen = ms(record.generatedAt);
    const arch = ms(replayGeneratedAtUtc);
    checks.push(check(
      "GENERATED_NOT_AFTER_REPLAY_WRITE",
      gen === null || arch === null ? null : gen <= arch,
      { generatedAt: record.generatedAt ?? null, replayGeneratedAtUtc: replayGeneratedAtUtc ?? null },
    ));
    const ffe = record.firstFailingEngine;
    checks.push(check(
      "FIRST_FAILING_ENGINE_IS_CANONICAL_GATE",
      ffe === null || ffe === undefined || GATE_ENGINES.includes(ffe),
      ffe ?? null,
    ));
  }
  // `null` (unverifiable) does not fail trust; `false` does.
  const trusted = present && checks.every((c) => c.ok !== false);
  return {
    present,
    trusted,
    checks,
    laneReferenceSnapshotTime: reference,
    recorded: present
      ? {
          contractVersion: record.contractVersion ?? null,
          pipelineStatus: record.pipelineStatus ?? null,
          firstFailingEngine: record.firstFailingEngine ?? null,
          failureType: record.failureType ?? null,
          rootCause: record.rootCause ?? null,
          snapshotTime: record.snapshotTime ?? null,
          generatedAt: record.generatedAt ?? null,
          stages: Array.isArray(record.stages)
            ? record.stages.map((s) => ({ engine: s?.engine ?? null, state: s?.state ?? null }))
            : [],
          warnings: Array.isArray(record.warnings) ? record.warnings : [],
        }
      : null,
  };
}

function conflictsWithCanonical(recorded, canonical) {
  const conflicts = [];
  const ffe = recorded.firstFailingEngine;
  if (ffe) {
    const idx = GATE_ENGINES.indexOf(ffe);
    if (canonical[ffe]?.gate === "PASSED") {
      conflicts.push({ engine: ffe, engine28a: "FIRST_FAILING", canonicalGate: "PASSED" });
    }
    for (const upstream of GATE_ENGINES.slice(0, idx)) {
      if (canonical[upstream]?.gate === "NOT_PASSED") {
        conflicts.push({ engine: upstream, engine28a: "UPSTREAM_OF_FIRST_FAILING", canonicalGate: "NOT_PASSED" });
      }
    }
  } else if (NO_BLOCKER_STATUSES.has(recorded.pipelineStatus)) {
    for (const engine of GATE_ENGINES) {
      if (canonical[engine]?.gate === "NOT_PASSED") {
        conflicts.push({ engine, engine28a: "NO_BLOCKER", canonicalGate: "NOT_PASSED" });
      }
    }
  }
  return conflicts;
}

export function canonicalFallbackBlocker({ canonical, referenceSnapshotTime }) {
  const flags = [];
  for (const engine of GATE_ENGINES) {
    const e = canonical[engine];
    if (
      e?.present && e.snapshotTime && referenceSnapshotTime &&
      e.snapshotTime !== referenceSnapshotTime
    ) {
      return {
        engine: "UNKNOWN", status: "UNKNOWN", rootCause: null,
        refusal: "STALE_CYCLE_EVIDENCE",
        refusalDetail: { engine, engineSnapshotTime: e.snapshotTime, laneReference: referenceSnapshotTime },
        flags,
      };
    }
    if (!e?.present || e.gate === "UNKNOWN") {
      return {
        engine: "UNKNOWN", status: "UNKNOWN", rootCause: null,
        refusal: "UPSTREAM_EVIDENCE_INCOMPLETE",
        refusalDetail: { engine, present: !!e?.present, gate: e?.gate ?? null },
        flags,
      };
    }
    if (e.gate === "NOT_PASSED") {
      return {
        engine,
        status: e.ownStatus || "UNKNOWN",
        failureType: null,
        rootCause: "INVESTIGATOR_FALLBACK_CANONICAL_GATE_NOT_PASSED",
        reasonCodes: e.reasonCodes || [],
        blockers: e.blockers || [],
        refusal: null,
        flags,
      };
    }
  }
  return { engine: null, status: "PASS", rootCause: null, refusal: null, flags };
}

/**
 * @returns {{
 *   firstBlocker: { engine: string|null, status: string, failureType: string|null,
 *                   rootCause: string|null, reasonCodes: string[], blockers: string[] },
 *   source: "ENGINE28A_RECORDED"|"CANONICAL_FALLBACK"|"NONE",
 *   engine28a: object, fallback: object|null, flags: object[]
 * }}
 */
export function identifyFirstBlocker({ strategy, strategyId, canonical, replayGeneratedAtUtc, dateYmd }) {
  const trust = evaluateEngine28ATrust({ strategy, strategyId, replayGeneratedAtUtc, dateYmd });
  const flags = [];

  if (trust.trusted) {
    const rec = trust.recorded;
    const conflicts = conflictsWithCanonical(rec, canonical);
    if (conflicts.length > 0) {
      flags.push({ flag: "BLOCKER_CONFLICT", detail: { engine28a: rec, conflicts } });
      return {
        firstBlocker: { engine: "UNKNOWN", status: "UNKNOWN", failureType: null, rootCause: null, reasonCodes: [], blockers: [] },
        source: "NONE",
        engine28a: trust,
        fallback: null,
        flags,
      };
    }
    const statusMap = { WAITING: "WAITING", BLOCKED: "BLOCKED", ERROR: "UNKNOWN" };
    const engine = rec.firstFailingEngine || null;
    return {
      firstBlocker: {
        engine,
        status: engine ? statusMap[rec.pipelineStatus] || "UNKNOWN" : "PASS",
        recordedPipelineStatus: rec.pipelineStatus,
        failureType: rec.failureType,
        rootCause: rec.rootCause,
        reasonCodes: engine ? canonical[engine]?.reasonCodes || [] : [],
        blockers: engine ? canonical[engine]?.blockers || [] : [],
      },
      source: "ENGINE28A_RECORDED",
      engine28a: trust,
      fallback: null,
      flags,
    };
  }

  const fb = canonicalFallbackBlocker({ canonical, referenceSnapshotTime: trust.laneReferenceSnapshotTime });
  if (fb.refusal) flags.push({ flag: "FALLBACK_REFUSED", detail: { reason: fb.refusal, ...fb.refusalDetail } });
  return {
    firstBlocker: {
      engine: fb.engine,
      status: fb.status,
      failureType: fb.failureType ?? null,
      rootCause: fb.rootCause,
      reasonCodes: fb.reasonCodes || [],
      blockers: fb.blockers || [],
    },
    source: fb.refusal ? "NONE" : "CANONICAL_FALLBACK",
    engine28a: trust,
    fallback: { version: FALLBACK_VERSION, refusal: fb.refusal },
    flags,
  };
}
