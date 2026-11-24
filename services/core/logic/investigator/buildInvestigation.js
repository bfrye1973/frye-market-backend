// services/core/logic/investigator/buildInvestigation.js
//
// Engine 12 Trade Investigator: one bounded, read-only investigation.
//
//   Engine 12 Replay (immutable decision evidence)
// + Engine 28A recorded first blocker (Strategy 1, when trusted)
// + Engine 8 PAPER persisted orders/executions (mutable store, labelled)
// + Engine 10 Journal lifecycle (mutable store, labelled)
//
// Response sections:
//   knownAtDecision   built ONLY from the selected Replay snapshot
//   priorEvents       same-identity events timestamped before decisionTime
//   subsequentEvents  same-identity events at/after decisionTime
//   outcome           Journal lifecycle as of journalReadAt
//
// No engine is re-run. No file is written. Missing evidence => UNKNOWN.

import {
  PIPELINE_ORDER,
  GATE_ENGINES,
  REGISTRY_VERSION,
  REGISTRY_EVIDENCE_STATUS,
  REGISTRY_EVIDENCE_NOTE,
} from "./authorityRegistry.js";
import {
  extractEngineTimeline,
  extractLaneIdentity,
  GATE_VERSION,
  STATUS_MAPPING_VERSION,
} from "./extractEngineTimeline.js";
import { identifyFirstBlocker, FALLBACK_VERSION } from "./identifyFirstBlocker.js";
import { JOIN_VERSION } from "./identityJoin.js";
import { joinExecutionEvidence } from "./joinExecutionEvidence.js";
import { joinJournalOutcome } from "./joinJournalOutcome.js";
import { lookupReplayWindow } from "./lookupReplayWindow.js";
import { LIMITS } from "./validateInvestigationQuery.js";

export const INVESTIGATION_SCHEMA = "engine12.tradeInvestigator.investigation.v1";

const STAGE_STATE_MAP = {
  PASS: "PASS", PASS_CONTEXT: "PASS", WAITING: "WAITING", BLOCKED: "BLOCKED",
  OBSERVED: "PASS",
};

const has = (v) => v !== null && v !== undefined && v !== "";
const known = (value, source) =>
  has(value) ? { value, source, status: "KNOWN" } : { value: null, source: null, status: "UNKNOWN" };

function hasExact(list, code) {
  return Array.isArray(list) && list.some((x) => String(x) === code);
}

function buildPipeline({ timeline, blocker }) {
  const { canonical, shadow } = timeline;
  const recordedStages = {};
  if (blocker.source === "ENGINE28A_RECORDED") {
    for (const s of blocker.engine28a.recorded.stages) {
      if (s.engine) recordedStages[s.engine] = s.state;
    }
  }
  const blockerEngine = blocker.firstBlocker.engine;
  const blockerIdx = blockerEngine && blockerEngine !== "UNKNOWN" ? PIPELINE_ORDER.indexOf(blockerEngine) : -1;
  const e8 = canonical.engine8;
  const e8Ordered = e8?.present && (e8.decision?.orderCreated === true || has(e8.decision?.orderId) || has(e8.decision?.tradeId));

  return PIPELINE_ORDER.map((engine, idx) => {
    const c = canonical[engine];
    let status;
    let statusSource;

    if (engine === blockerEngine) {
      status = blocker.firstBlocker.status;
      statusSource = blocker.source === "ENGINE28A_RECORDED" ? "ENGINE28A_RECORDED_FIRST_BLOCKER" : "CANONICAL_FALLBACK";
    } else if (recordedStages[engine] && (blockerIdx === -1 || idx < blockerIdx)) {
      status = STAGE_STATE_MAP[recordedStages[engine]] || "UNKNOWN";
      statusSource = "ENGINE28A_RECORDED_STAGE";
    } else if (c.present) {
      status = engine === "engine10"
        ? (has(c.decision?.tradeId) ? "PASS" : "UNKNOWN")
        : c.ownStatus;
      statusSource = "ENGINE_OWN_FIELDS";
    } else {
      const upstreamStopped =
        (blockerIdx !== -1 && idx > blockerIdx) ||
        GATE_ENGINES.slice(0, Math.min(idx, GATE_ENGINES.length)).some((u) => canonical[u]?.gate === "NOT_PASSED") ||
        (engine === "engine10" && e8?.present && !e8Ordered && e8.gate === "NOT_PASSED");
      status = upstreamStopped ? "NOT_REACHED" : "UNKNOWN";
      statusSource = upstreamStopped ? "RECORD_ABSENT_UPSTREAM_STOPPED" : "RECORD_ABSENT";
    }

    // Never PASS from progression alone: if this engine's own status is
    // unknown but a downstream canonical gate passed (or an order exists),
    // report INFERRED_PROGRESS.
    if (status === "UNKNOWN" && engine !== "engine10") {
      const downstreamPassed =
        GATE_ENGINES.slice(idx + 1).some((d) => canonical[d]?.gate === "PASSED") || e8Ordered;
      if (downstreamPassed) {
        status = "INFERRED_PROGRESS";
        statusSource = "DOWNSTREAM_PROGRESS_OBSERVED";
      }
    }

    return {
      engine,
      authority: "CANONICAL",
      status,
      statusSource,
      downstreamOfFirstBlocker: blockerIdx !== -1 && idx > blockerIdx,
      gate: c.gate,
      rawStatus: c.rawStatus,
      decision: c.decision,
      reasonCodes: c.reasonCodes,
      blockers: c.blockers,
      evaluatedAt: c.evaluatedAt,
      evaluatedAtField: c.evaluatedAtField,
      source: c.source,
      sourcePath: c.sourcePath,
      version: c.version ?? null,
      versionVerified: c.versionVerified ?? false,
      mappingVersion: STATUS_MAPPING_VERSION,
      ...(c.record ? { record: c.record } : {}),
      shadow: (shadow[engine] || []).map((s) => ({
        engine: s.engine,
        authority: "SHADOW",
        version: s.version,
        sourcePath: s.sourcePath,
        decision: s.decision,
        rawStatus: s.rawStatus,
        reasonCodes: s.reasonCodes,
        evaluatedAt: s.evaluatedAt,
        note: "Comparison only. Never used for status or first blocker.",
        ...(s.record ? { record: s.record } : {}),
      })),
    };
  });
}

function tradeGeometry(canonical) {
  const e9 = canonical.engine9?.decision || {};
  const e26b = canonical.engine26B?.decision || {};
  const e7 = canonical.engine7?.decision || {};
  const e6 = canonical.engine6?.decision || {};
  const e8 = canonical.engine8?.decision || {};
  const pick = (pairs) => {
    for (const [value, source] of pairs) if (has(value)) return known(value, source);
    return known(null, null);
  };
  const targets = e9.targets?.length ? e9.targets : e26b.targets?.length ? e26b.targets : [];
  const targetSource = e9.targets?.length ? "engine9" : e26b.targets?.length ? "engine26B" : null;
  return {
    entry: pick([[e9.entry, "engine9"], [e26b.entry, "engine26B"]]),
    stop: pick([[e9.stop, "engine9"], [e26b.stop, "engine26B"]]),
    target1: known(targets[0] ?? null, targetSource),
    target2: known(targets[1] ?? null, targetSource),
    target3: known(targets[2] ?? null, targetSource),
    contracts: pick([[e7.contracts, "engine7"], [e8.contracts, "engine8"]]),
    dollarRisk: pick([[e7.dollarRisk, "engine7"]]),
    riskBudgetDollars: pick([[e7.riskBudgetDollars, "engine7"]]),
    sizeMultiplier: pick([[e6.sizeMultiplier, "engine6"], [e7.sizeMultiplier, "engine7"]]),
    note: "Stored values only. Nothing is recalculated.",
  };
}

function queryIdentityFlags(query, identity) {
  const flags = [];
  for (const field of ["candidateId", "planId", "tradeId"]) {
    const q = query[field];
    if (!q) continue;
    const s = identity[field]?.value ?? null;
    if (s === null) flags.push({ flag: "QUERY_IDENTITY_NOT_IN_SNAPSHOT", detail: { field, query: q } });
    else if (s !== q) flags.push({ flag: "QUERY_IDENTITY_MISMATCH", detail: { field, query: q, snapshot: s } });
  }
  return flags;
}

/**
 * @param {object} p
 * @param {object} p.query validated query (validateInvestigationQuery().value)
 * @param {object} p.config { replayRoot, engine8PaperDir, journalDir }
 */
export function buildInvestigation({ query, config }) {
  const lookup = lookupReplayWindow({
    root: config.replayRoot, date: query.date, time: query.time, windowMinutes: query.windowMinutes,
  });
  if (!lookup.ok) {
    const { ok: _ok, httpStatus, ...rest } = lookup;
    return { httpStatus, body: { ok: false, ...rest } };
  }

  const { replay, selection, provenance } = lookup;
  const strategy = replay?.strategies?.[query.strategyId];
  if (!strategy || typeof strategy !== "object") {
    return {
      httpStatus: 404,
      body: { ok: false, error: "STRATEGY_NOT_IN_SNAPSHOT", selection, replay: provenance },
    };
  }

  const includeRecords = query.detail === "full";
  const timeline = extractEngineTimeline({ strategy, dateYmd: query.date, includeRecords });
  const identity = extractLaneIdentity({ strategy, canonical: timeline.canonical, strategyId: query.strategyId });
  const blocker = identifyFirstBlocker({
    strategy, strategyId: query.strategyId, canonical: timeline.canonical,
    replayGeneratedAtUtc: replay?.generatedAtUtc ?? null,
    dateYmd: query.date,
  });
  const pipeline = buildPipeline({ timeline, blocker });

  const windowMs = query.windowMinutes * 60 * 1000;
  const decision = {
    strategyId: query.strategyId,
    mode: identity.mode,
    decisionTime: identity.decisionTime,
    tradeId: identity.tradeId.value,
    orderId: identity.orderId.value,
    executionId: identity.executionId.value,
    planId: identity.planId.value,
    candidateId: identity.candidateId.value,
  };

  const execution = identity.mode
    ? joinExecutionEvidence({ decision, storeDir: config.engine8PaperDir, windowMs, maxRecords: LIMITS.maxRecords })
    : { source: "ENGINE8_PAPER_STORE", status: "NOT_APPLICABLE", reason: "NO_CANONICAL_ENGINE8_RECORD_IN_SNAPSHOT" };

  // Chain: orderIds/executionIds proven by a clean Engine 8 match strengthen
  // the Journal join. Ambiguous/conflicting Engine 8 results are not chained.
  const journalDecision = { ...decision };
  if (execution.status === "MATCHED") {
    journalDecision.orderId = [...new Set([decision.orderId, ...execution.orders.map((o) => o.orderId)].filter(Boolean))];
    journalDecision.executionId = [...new Set([decision.executionId, ...execution.orders.map((o) => o.executionId)].filter(Boolean))];
  }
  const journal = identity.mode
    ? joinJournalOutcome({ decision: journalDecision, journalDir: config.journalDir, windowMs, maxRecords: LIMITS.maxRecords })
    : { source: "ENGINE10_JOURNAL", status: "NOT_APPLICABLE", reason: "NO_CANONICAL_ENGINE8_RECORD_IN_SNAPSHOT" };

  const flags = [...blocker.flags, ...queryIdentityFlags(query, identity)];
  if (REGISTRY_EVIDENCE_STATUS !== "VERIFIED") {
    flags.push({ flag: "AUTHORITY_REGISTRY_PROVISIONAL", detail: { evidenceStatus: REGISTRY_EVIDENCE_STATUS, note: REGISTRY_EVIDENCE_NOTE } });
  }
  if (timeline.unknownAuthority.length) {
    flags.push({
      flag: "RECORDS_WITH_UNKNOWN_AUTHORITY_EXCLUDED",
      detail: timeline.unknownAuthority.map((u) => ({ engine: u.engine, sourcePath: u.sourcePath, reason: u.authorityReason })),
    });
  }
  const e8d = timeline.canonical.engine8?.decision || {};
  if (
    hasExact(timeline.canonical.engine8?.blockers, "DUPLICATE_ORDER_BLOCKED") ||
    hasExact(timeline.canonical.engine8?.reasonCodes, "DUPLICATE_ORDER_BLOCKED") ||
    String(e8d.status || "").toUpperCase() === "DUPLICATE_ORDER_BLOCKED"
  ) {
    const priorOrders = (execution.priorEvents || []).length;
    flags.push({
      flag: "DUPLICATE_BLOCK_RECORDED",
      detail: {
        note: "Engine 8 recorded DUPLICATE_ORDER_BLOCKED. This alone does not prove a prior order existed.",
        priorSameIdentityOrdersFound: execution.status === "MATCHED" ? priorOrders : "UNKNOWN",
      },
    });
  }
  for (const [label, j] of [["ENGINE8", execution], ["ENGINE10", journal]]) {
    if (j.status === "AMBIGUOUS") flags.push({ flag: "AMBIGUOUS", detail: { source: label, candidates: j.ambiguousCandidates } });
    if (j.conflicts?.length) flags.push({ flag: "IDENTITY_CONFLICT", detail: { source: label, conflicts: j.conflicts } });
    if (j.status === "ERROR") flags.push({ flag: "ERROR", detail: { source: label, reason: j.reason } });
  }

  const byTime = (a, b) => Date.parse(a.eventTime) - Date.parse(b.eventTime);
  const priorEvents = [...(execution.priorEvents || []), ...(journal.priorEvents || [])].sort(byTime);
  const subsequentEvents = [...(execution.subsequentEvents || []), ...(journal.subsequentEvents || [])].sort(byTime);
  const undatedEvents = [...(execution.undatedEvents || []), ...(journal.undatedEvents || [])];

  const filledOrder = (execution.orders || []).find((o) => o.action === "NEW_ENTRY" && String(o.status).toLowerCase() === "filled");

  const body = {
    ok: true,
    schema: INVESTIGATION_SCHEMA,
    query,
    selection,
    replay: provenance,
    knownAtDecision: {
      note: "Built only from the selected Replay snapshot. Nothing after decisionTime is included.",
      snapshotTime: replay?.snapshotTime ?? null,
      decisionTime: identity.decisionTime,
      decisionTimeSource: identity.decisionTimeSource,
      price: known(
        timeline.canonical.engine26A?.decision?.currentPrice ?? replay?.currentPrice ?? null,
        has(timeline.canonical.engine26A?.decision?.currentPrice) ? "engine26A.currentPrice" : has(replay?.currentPrice) ? "replay.currentPrice" : null,
      ),
      direction: known(identity.direction.value, identity.direction.source),
      identity,
      firstBlocker: {
        ...blocker.firstBlocker,
        source: blocker.source,
      },
      engine28a: blocker.engine28a,
      blockerFallback: blocker.fallback,
      pipeline,
      tradeGeometry: tradeGeometry(timeline.canonical),
      executionAtDecision: {
        source: "engine8 (Replay)",
        status: known(e8d.status ?? null, "engine8"),
        orderCreated: known(e8d.orderCreated ?? null, "engine8"),
        orderId: known(e8d.orderId ?? null, "engine8"),
        tradeId: known(e8d.tradeId ?? null, "engine8"),
        blockers: timeline.canonical.engine8?.blockers || [],
        note: "Replay is archived before later PAPER execution activity in the same cycle. This proves the evaluation result only, not that no earlier or later order exists.",
      },
    },
    priorEvents,
    subsequentEvents,
    undatedEvents,
    execution: {
      ...execution,
      entryFill: filledOrder
        ? { status: "FILLED_PER_ENGINE8_PAPER_STORE", orderId: filledOrder.orderId, avgPrice: filledOrder.avgPrice, filledQty: filledOrder.filledQty, eventTime: filledOrder.eventTime }
        : { status: execution.status === "MATCHED" ? "NO_FILLED_ENTRY_ORDER_MATCHED" : "UNKNOWN" },
    },
    outcome: {
      source: "ENGINE10_JOURNAL",
      status: journal.status,
      journalReadAt: journal.journalReadAt ?? null,
      trade: journal.trade ?? null,
      note: "Journal is mutable current state as of journalReadAt, not a point-in-time record.",
    },
    journal: {
      status: journal.status,
      reason: journal.reason ?? null,
      matchTier: journal.matchTier ?? null,
      identity: journal.identity ?? null,
      conflicts: journal.conflicts ?? [],
      excluded: journal.excluded ?? [],
      notes: journal.notes ?? [],
      store: journal.store ?? null,
    },
    flags,
    provenance: {
      registryVersion: REGISTRY_VERSION,
      registryEvidenceStatus: REGISTRY_EVIDENCE_STATUS,
      gateVersion: GATE_VERSION,
      statusMappingVersion: STATUS_MAPPING_VERSION,
      blockerFallbackVersion: FALLBACK_VERSION,
      joinVersion: JOIN_VERSION,
      enginesRerun: false,
      writesPerformed: false,
    },
  };
  return { httpStatus: 200, body };
}
