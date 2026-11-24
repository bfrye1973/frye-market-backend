// services/core/logic/investigator/extractEngineTimeline.js
//
// Pure extraction of one strategy lane from one immutable Replay snapshot.
// No I/O. No engine is re-run. Every value comes from the stored record;
// absent values stay null and are reported as UNKNOWN by the caller.
//
// Two separate concepts per engine:
//   gate   PASSED | NOT_PASSED | UNKNOWN
//          from the engine's own explicit fields (booleans, direction, ids).
//          Investigator gate contract: GATE_VERSION. Mirrors the Engine 28A v1
//          pass criteria field-for-field, but never reads reason text.
//          A required field that is absent => UNKNOWN, never NOT_PASSED.
//   ownStatus PASS | WAITING | BLOCKED | UNKNOWN
//          WAITING/BLOCKED only from an exact value of the engine's own
//          status/state field or an explicit flag (hardBlocked, waitingFor).
//          Reason codes and blocker text are never parsed.

import {
  PIPELINE_ORDER,
  resolveEngineRecords,
} from "./authorityRegistry.js";

export const GATE_VERSION = "engine12.investigator.gate.v1";
export const STATUS_MAPPING_VERSION = "engine12.investigator.statusMap.v1";

const WAITING_VALUES = new Set(["WAITING", "WAIT", "WATCH", "PENDING"]);
const BLOCKED_VALUES = new Set([
  "BLOCKED", "BLOCK", "DENIED", "DENY", "STAND_DOWN", "NO_TRADE", "REJECTED",
]);
const ENGINE4_BLOCKED_STATES = new Set([
  "ADVERSE_PARTICIPATION_BLOCKED", "IDENTITY_MISMATCH", "CANDIDATE_INVALIDATED",
]);

const upper = (v) => (typeof v === "string" ? v.trim().toUpperCase() : null);
const arr = (v) => (Array.isArray(v) ? v : []);
const has = (v) => v !== undefined && v !== null;
const num = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const dir = (v) => {
  const d = upper(v);
  return d === "LONG" || d === "SHORT" ? d : null;
};
const first = (...values) => values.find((v) => has(v)) ?? null;

function timeFields(record) {
  for (const field of ["evaluatedAt", "generatedAt", "snapshotTime", "evaluationTime"]) {
    if (typeof record?.[field] === "string" && record[field]) {
      return { evaluatedAt: record[field], evaluatedAtField: field };
    }
  }
  return { evaluatedAt: null, evaluatedAtField: null };
}

function rawStatusOf(engine, r) {
  switch (engine) {
    case "engine4": return first(r?.participationState, r?.status);
    case "engine6": return first(r?.decision, r?.status);
    case "engine9": return first(r?.planStatus, r?.status);
    default: return first(r?.status, r?.state, r?.decision);
  }
}

// ---- gates (explicit fields only) ----------------------------------------

function all(conditions) {
  // conditions: [{ need: [values that must be present], ok: boolean }]
  // A condition whose inputs are all present and which fails proves NOT_PASSED
  // even if some other condition cannot be evaluated.
  const evaluable = conditions.filter((c) => !c.need.some((v) => v === undefined || v === null));
  if (evaluable.some((c) => !c.ok)) return "NOT_PASSED";
  if (evaluable.length < conditions.length) return "UNKNOWN";
  return "PASSED";
}

function dirMatch(ownRaw, upstream) {
  // Own direction absent, or upstream direction unknown => cannot evaluate.
  // Own direction present but NEUTRAL/other => evaluable mismatch.
  return {
    need: [has(ownRaw) ? ownRaw : undefined, upstream === null || upstream === undefined ? undefined : upstream],
    ok: dir(ownRaw) !== null && dir(ownRaw) === upstream,
  };
}

function gateFor(engine, r, ctx) {
  if (!r) return "UNKNOWN";
  switch (engine) {
    case "engine26A":
      return has(r.candidateId) ? "PASSED" : "UNKNOWN";
    case "engine3": {
      const d = dir(r.direction);
      return all([
        { need: [r.allowed], ok: r.allowed === true },
        { need: [r.engine3Strategy1QualifiedForEngine6], ok: r.engine3Strategy1QualifiedForEngine6 === true },
        { need: [r.direction], ok: d !== null },
      ]);
    }
    case "engine4":
      return all([
        { need: [r.participationConfirmed], ok: r.participationConfirmed === true },
        { need: [r.allowed], ok: r.allowed === true },
        { need: [], ok: r.hardBlocked !== true },
        dirMatch(r.direction, ctx.e3Direction),
      ]);
    case "engine6": {
      return all([
        { need: [r.allowed], ok: r.allowed === true },
        { need: [r.paperAllowed], ok: r.paperAllowed === true },
        { need: [r.locked], ok: r.locked === true },
        dirMatch(r.direction, ctx.e3Direction),
        dirMatch(r.direction, ctx.e4Direction),
      ]);
    }
    case "engine26B": {
      const d = dir(r.direction);
      const entry = num(r.proposedEntryPrice);
      const stop = num(r.proposedStopPrice);
      const targets = targetPrices(r);
      const stopOk = entry !== null && stop !== null &&
        (d === "LONG" ? stop < entry : d === "SHORT" ? stop > entry : false);
      const targetOk = entry !== null && targets.some((t) =>
        d === "LONG" ? t > entry : d === "SHORT" ? t < entry : false);
      const idOk =
        (!ctx.e6CandidateId || !r.candidateId || ctx.e6CandidateId === r.candidateId) &&
        (!ctx.e6ZoneId || !r.zoneId || ctx.e6ZoneId === r.zoneId);
      return all([
        { need: [r.geometryReady], ok: r.geometryReady === true },
        dirMatch(r.direction, ctx.e6Direction),
        { need: [r.proposedEntryPrice, r.proposedStopPrice], ok: stopOk },
        { need: [r.proposedEntryPrice], ok: targetOk },
        { need: [], ok: idOk },
      ]);
    }
    case "engine7": {
      const contracts = first(num(r.finalContracts), num(r.paperTestingContracts));
      return all([
        { need: [r.allowed], ok: r.allowed === true },
        { need: [r.executableSizing], ok: r.executableSizing === true },
        { need: [contracts === null ? undefined : contracts], ok: Number.isInteger(contracts) && contracts > 0 },
        dirMatch(r.direction, ctx.e6Direction),
      ]);
    }
    case "engine9":
      return all([
        { need: [r.managementReady], ok: r.managementReady === true },
        { need: [r.official], ok: r.official === true },
        { need: [], ok: Boolean(r.planId) },
        dirMatch(r.direction, ctx.e6Direction),
      ]);
    case "engine8": {
      const ordered = r.orderCreated === true || Boolean(r.orderId) || Boolean(r.tradeId);
      if (ordered) return "PASSED";
      if (!has(r.status) && !has(r.executable)) return "UNKNOWN";
      return upper(r.status) === "READY_TO_CREATE_PAPER_ORDER" && r.executable === true
        ? "PASSED" : "NOT_PASSED";
    }
    case "engine10":
      return "NOT_A_GATE";
    default:
      return "UNKNOWN";
  }
}

function ownStatus(engine, r, gate) {
  if (gate === "PASSED") return "PASS";
  if (!r || gate !== "NOT_PASSED") return "UNKNOWN";
  if (engine === "engine4") {
    if (r.hardBlocked === true) return "BLOCKED";
    if (ENGINE4_BLOCKED_STATES.has(upper(r.participationState))) return "BLOCKED";
  }
  if (engine === "engine9" && arr(r.waitingFor).length > 0) return "WAITING";
  const raw = upper(rawStatusOf(engine, r));
  if (raw && WAITING_VALUES.has(raw)) return "WAITING";
  if (raw && BLOCKED_VALUES.has(raw)) return "BLOCKED";
  return "UNKNOWN";
}

function targetPrices(r) {
  const list = arr(r?.proposedTargets).length > 0
    ? arr(r.proposedTargets)
    : arr(r?.officialTargets).length > 0
      ? arr(r.officialTargets)
      : arr(r?.targets).length > 0
        ? arr(r.targets)
        : [r?.target1Price, r?.target2Price, r?.target3Price];
  return list.map((t) => num(t?.price ?? t)).filter((p) => p !== null);
}

// ---- per-engine decision summary (stored values only) ---------------------

function summary(engine, r) {
  if (!r) return null;
  const base = {
    direction: first(r.direction),
    candidateId: first(r.candidateId),
    zoneId: first(r.zoneId),
    snapshotTime: first(r.snapshotTime),
  };
  switch (engine) {
    case "engine26A":
      return { ...base, status: first(r.status), currentPrice: num(r.currentPrice) };
    case "engine3":
      return {
        ...base, state: first(r.state), quality: first(r.quality),
        allowed: first(r.allowed), qualified: first(r.engine3Strategy1QualifiedForEngine6),
      };
    case "engine4":
      return {
        ...base, participationState: first(r.participationState),
        participationQuality: first(r.participationQuality),
        confirmed: first(r.participationConfirmed), allowed: first(r.allowed),
        hardBlocked: first(r.hardBlocked),
      };
    case "engine6":
      return {
        ...base, decision: first(r.decision), allowed: first(r.allowed),
        paperAllowed: first(r.paperAllowed), locked: first(r.locked),
        sizeMultiplier: num(first(r.sizeMultiplier, r.permissionSizeMultiplier)),
      };
    case "engine26B":
      return {
        ...base, status: first(r.status), geometryReady: first(r.geometryReady),
        entry: num(r.proposedEntryPrice), stop: num(r.proposedStopPrice),
        targets: targetPrices(r),
      };
    case "engine7":
      return {
        ...base, status: first(r.status), allowed: first(r.allowed),
        executableSizing: first(r.executableSizing),
        contracts: first(num(r.finalContracts), num(r.paperTestingContracts)),
        dollarRisk: num(first(r.estimatedTotalRiskDollars, r.frozenOpeningRiskDollars)),
        riskBudgetDollars: num(first(r.permissionAdjustedRiskBudget, r.riskBudgetDollars)),
        sizeMultiplier: num(r.sizeMultiplier),
        planId: first(r.planId),
      };
    case "engine9":
      return {
        ...base, planId: first(r.planId), planStatus: first(r.planStatus),
        managementReady: first(r.managementReady), official: first(r.official),
        entry: num(first(r.officialEntryPrice, r.entryPrice)),
        stop: num(first(r.officialStopPrice, r.stopPrice)),
        targets: targetPrices(r),
        waitingFor: arr(r.waitingFor),
      };
    case "engine8":
      return {
        ...base, status: first(r.status), executable: first(r.executable),
        planId: first(r.planId), orderCreated: first(r.orderCreated),
        orderId: first(r.orderId), tradeId: first(r.tradeId),
        executionId: first(r.executionId),
        contracts: first(num(r.finalContracts), num(r.contracts)),
      };
    case "engine10": {
      const j = r.journal || r.lifecycle || r;
      return {
        status: first(r.status, j?.status), tradeId: first(r.tradeId, j?.tradeId),
        remainingQty: num(first(r.remainingQty, j?.remainingQty)),
      };
    }
    default:
      return base;
  }
}

function shadowSummary(engine, r) {
  if (engine === "engine4") {
    return {
      participationState: first(r.participationState),
      confirmationState: first(r.confirmationState),
      direction: first(r.direction),
      relVol: num(r?.evidence?.relVol),
    };
  }
  if (engine === "engine3") {
    return {
      direction: first(r?.canonical?.canonical?.direction, r.direction),
      quality: first(r?.canonical?.canonical?.quality, r.quality),
      state: first(r.state),
    };
  }
  return {};
}

function entry({ engine, resolved, gate, includeRecord }) {
  const r = resolved.record;
  const t = timeFields(r);
  return {
    engine,
    authority: resolved.authority,
    authorityReason: resolved.authorityReason,
    version: resolved.version,
    payloadLabel: resolved.payloadLabel,
    versionVerified: resolved.versionVerified,
    source: "ENGINE12_REPLAY",
    sourcePath: resolved.sourcePath,
    present: true,
    gate,
    gateVersion: GATE_VERSION,
    ownStatus: resolved.authority === "SHADOW" ? null : ownStatus(engine, r, gate),
    rawStatus: rawStatusOf(engine, r),
    mappingVersion: STATUS_MAPPING_VERSION,
    reasonCodes: arr(r.reasonCodes),
    blockers: arr(r.blockers),
    evaluatedAt: t.evaluatedAt,
    evaluatedAtField: t.evaluatedAtField,
    snapshotTime: first(r.snapshotTime),
    decision: resolved.authority === "SHADOW" ? shadowSummary(engine, r) : summary(engine, r),
    ...(includeRecord ? { record: r } : {}),
  };
}

/**
 * Extract canonical + shadow entries for every engine in pipeline order.
 * @returns {{ canonical: Record<string, object>, shadow: Record<string, object[]>,
 *             unknownAuthority: object[] }}
 *   canonical[engine] has present:false when no canonical record exists.
 */
export function extractEngineTimeline({ strategy, dateYmd, includeRecords = false }) {
  const canonical = {};
  const shadow = {};
  const unknownAuthority = [];
  const ctx = {};

  for (const engine of PIPELINE_ORDER) {
    const resolved = resolveEngineRecords({ engine, strategy, dateYmd });
    const canon = resolved.find((x) => x.authority === "CANONICAL") || null;

    if (canon) {
      const gate = gateFor(engine, canon.record, ctx);
      canonical[engine] = entry({ engine, resolved: canon, gate, includeRecord: includeRecords });
    } else {
      canonical[engine] = {
        engine, authority: "CANONICAL", present: false, gate: engine === "engine10" ? "NOT_A_GATE" : "UNKNOWN",
        ownStatus: "UNKNOWN", rawStatus: null, reasonCodes: [], blockers: [],
        evaluatedAt: null, evaluatedAtField: null, snapshotTime: null, decision: null,
        source: "ENGINE12_REPLAY", sourcePath: null,
      };
    }

    for (const s of resolved.filter((x) => x.authority === "SHADOW")) {
      (shadow[engine] ||= []).push(entry({ engine, resolved: s, gate: "SHADOW_NOT_GATED", includeRecord: includeRecords }));
    }
    for (const u of resolved.filter((x) => x.authority === "UNKNOWN")) {
      unknownAuthority.push(entry({ engine, resolved: u, gate: "EXCLUDED_UNKNOWN_AUTHORITY", includeRecord: includeRecords }));
    }

    // Upstream context for downstream gates comes ONLY from canonical records.
    const r = canon?.record;
    if (engine === "engine3") ctx.e3Direction = dir(r?.direction);
    if (engine === "engine4") ctx.e4Direction = dir(r?.direction);
    if (engine === "engine6") {
      ctx.e6Direction = dir(r?.direction);
      ctx.e6CandidateId = r?.candidateId || null;
      ctx.e6ZoneId = r?.zoneId || null;
    }
  }
  return { canonical, shadow, unknownAuthority };
}

/** Lane identity, canonical records only, with the source of each value. */
export function extractLaneIdentity({ strategy, canonical, strategyId }) {
  const pick = (pairs) => {
    for (const [engine, key] of pairs) {
      const v = canonical?.[engine]?.decision?.[key];
      if (has(v) && v !== "") return { value: v, source: engine };
    }
    return { value: null, source: null };
  };
  const reference = first(
    canonical?.engine26A?.snapshotTime,
    canonical?.engine3?.snapshotTime,
    canonical?.engine6?.snapshotTime,
    strategy?.snapshotTime,
  );
  return {
    strategyId,
    candidateId: pick([["engine26A", "candidateId"], ["engine6", "candidateId"], ["engine26B", "candidateId"], ["engine8", "candidateId"]]),
    zoneId: pick([["engine26A", "zoneId"], ["engine6", "zoneId"], ["engine26B", "zoneId"]]),
    planId: pick([["engine9", "planId"], ["engine7", "planId"], ["engine8", "planId"]]),
    orderId: pick([["engine8", "orderId"]]),
    executionId: pick([["engine8", "executionId"]]),
    tradeId: pick([["engine8", "tradeId"], ["engine10", "tradeId"]]),
    direction: pick([["engine6", "direction"], ["engine3", "direction"]]),
    referenceSnapshotTime: reference,
    // Engine 8 is the decision whose consequences (orders/fills) are joined.
    decisionTime: first(canonical?.engine8?.evaluatedAt, reference),
    decisionTimeSource: canonical?.engine8?.evaluatedAt
      ? "engine8." + canonical.engine8.evaluatedAtField
      : reference ? "LANE_REFERENCE_SNAPSHOT_TIME" : null,
    // Replay's Strategy 1 execution record is the PAPER order record.
    mode: canonical?.engine8?.present ? "PAPER" : null,
  };
}
