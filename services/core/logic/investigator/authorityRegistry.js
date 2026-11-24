// services/core/logic/investigator/authorityRegistry.js
//
// Engine 12 Trade Investigator: historical authority registry.
//
// Authority (CANONICAL / SHADOW) is decided HERE, by engine + source path +
// historical date. It is never taken from labels inside a Replay payload.
// A payload version label is only a consistency check: if it contradicts the
// registry, authority becomes UNKNOWN and the record is excluded from blocker
// logic.
//
// Date ranges are inclusive Arizona calendar dates (YYYY-MM-DD).
// `from` is the earliest date this mapping is VERIFIED for, not the date the
// engine was first deployed. Earlier dates resolve to UNKNOWN authority until
// the Engine 12 Manager extends the range with evidence.
// A future promotion (e.g. Engine 4 v2 -> canonical) must ADD a new dated row;
// it must never edit an existing row's meaning.

export const REGISTRY_VERSION = "engine12.investigator.authorityRegistry.v1";

// PROVISIONAL. Earliest Replay date retained at build time (~14 Arizona days
// before 2026-11-24). This is a retention-derived assumption, NOT proof of when
// each canonical/shadow mapping took effect (Engine 12 Manager review, PR #392).
// Every investigation carries AUTHORITY_REGISTRY_PROVISIONAL until per-engine
// effective dates are proven from dated original Replay payloads and
// deployment/commit history. Dates before this boundary resolve to UNKNOWN.
const VERIFIED_FROM = "2026-11-10";
export const REGISTRY_EVIDENCE_STATUS = "PROVISIONAL_RETENTION_DERIVED";
export const REGISTRY_EVIDENCE_NOTE =
  "Authority date ranges are provisional (retention-derived), not proven per-engine effective dates.";
const OPEN_END = "9999-12-31";

// Real canonical chain, matching Engine 28A v1:
// 26A -> 3 -> 4 -> 6 -> 26B -> 7 -> 9 -> 8 -> 10
export const PIPELINE_ORDER = Object.freeze([
  "engine26A",
  "engine3",
  "engine4",
  "engine6",
  "engine26B",
  "engine7",
  "engine9",
  "engine8",
  "engine10",
]);

// Engines that act as gates. Engine 10 is an observed lifecycle record.
export const GATE_ENGINES = Object.freeze(PIPELINE_ORDER.slice(0, -1));

// Engine 28A coverage. Other lanes never have a recorded first blocker.
export const ENGINE28A_LANES = Object.freeze(["intraday_scalp@10m"]);
export const ENGINE28A_CONTRACTS = Object.freeze(["engine28a.pipelineDoctor.v1"]);
export const ENGINE28A_PATH = "engine28APipelineDoctor";

export const STRATEGY_LANES = Object.freeze([
  "subminute_scalp@10m",
  "intraday_scalp@10m",
  "minor_swing@1h",
  "intermediate_long@4h",
  "primary_position@1d",
]);

// Each row: engine, authority, version label, lane path(s) inside the strategy
// object, optional payload label check, date range.
// `paths` lists alternatives in priority order; the first present wins.
// `keyPattern` (shadow only) matches dynamic keys under `parentPath`.
const ROWS = Object.freeze([
  {
    engine: "engine26A", authority: "CANONICAL", version: "engine26A",
    paths: ["engine26LocationCandidate"],
    from: VERIFIED_FROM, to: OPEN_END,
  },
  {
    engine: "engine3", authority: "CANONICAL", version: "engine3.v5",
    paths: ["confluence.context.reaction.paperScalpReaction"],
    labelFields: ["engine", "version"],
    labelAccept: /^engine3\.v5(\.|$)/,
    from: VERIFIED_FROM, to: OPEN_END,
  },
  {
    engine: "engine3", authority: "SHADOW", version: "engine3.v6",
    parentPath: "confluence.context.reaction",
    keyPattern: /^engine3V6/i,
    from: VERIFIED_FROM, to: OPEN_END,
  },
  {
    engine: "engine4", authority: "CANONICAL", version: "engine4.v1",
    paths: ["confluence.context.volume.engine4AuthorizedReactionParticipation"],
    labelFields: ["engine"],
    labelAccept: /^engine4\.authorizedReactionParticipation\.v1$/,
    from: VERIFIED_FROM, to: OPEN_END,
  },
  {
    engine: "engine4", authority: "SHADOW", version: "engine4.v2",
    paths: ["confluence.context.volume.engine4V2Shadow"],
    labelFields: ["version"],
    labelAccept: /^engine4\.v2\./,
    from: VERIFIED_FROM, to: OPEN_END,
  },
  {
    engine: "engine6", authority: "CANONICAL", version: "engine6.paper",
    paths: ["permission.paper"],
    from: VERIFIED_FROM, to: OPEN_END,
  },
  {
    engine: "engine26B", authority: "CANONICAL", version: "engine26B",
    paths: ["engine26ProposedGeometry"],
    from: VERIFIED_FROM, to: OPEN_END,
  },
  {
    engine: "engine7", authority: "CANONICAL", version: "engine7",
    paths: ["engine7PositionSizing"],
    from: VERIFIED_FROM, to: OPEN_END,
  },
  {
    engine: "engine9", authority: "CANONICAL", version: "engine9",
    paths: ["engine9OfficialManagementPlan"],
    from: VERIFIED_FROM, to: OPEN_END,
  },
  {
    engine: "engine8", authority: "CANONICAL", version: "engine8.paper",
    paths: ["engine8PaperOrder"],
    from: VERIFIED_FROM, to: OPEN_END,
  },
  {
    engine: "engine10", authority: "CANONICAL", version: "engine10",
    paths: ["engine10Journal", "engine10JournalAttachment", "engine10Lifecycle"],
    from: VERIFIED_FROM, to: OPEN_END,
  },
]);

export function getPath(object, dotted) {
  let cursor = object;
  for (const key of String(dotted).split(".")) {
    if (cursor === null || typeof cursor !== "object") return undefined;
    cursor = cursor[key];
  }
  return cursor;
}

function inRange(dateYmd, row) {
  return typeof dateYmd === "string" && dateYmd >= row.from && dateYmd <= row.to;
}

function labelCheck(record, row) {
  if (!row.labelFields || !row.labelAccept) {
    return { checked: false, ok: true, label: null };
  }
  const labels = row.labelFields
    .map((field) => record?.[field])
    .filter((value) => typeof value === "string" && value.length > 0);
  if (labels.length === 0) return { checked: false, ok: true, label: null };
  const ok = labels.some((label) => row.labelAccept.test(label));
  return { checked: true, ok, label: labels.join("|") };
}

/**
 * Resolve every registered record for one engine inside one strategy lane.
 * Returns [{ engine, authority, version, sourcePath, record, versionVerified,
 *            registryRow, authorityReason }]
 * Records found at a path but outside the verified date range, or whose payload
 * label contradicts the registry, are returned with authority "UNKNOWN".
 */
export function resolveEngineRecords({ engine, strategy, dateYmd }) {
  const out = [];
  for (const row of ROWS.filter((r) => r.engine === engine)) {
    const hits = [];
    if (row.keyPattern) {
      const parent = getPath(strategy, row.parentPath);
      if (parent && typeof parent === "object") {
        for (const key of Object.keys(parent).sort()) {
          if (row.keyPattern.test(key) && parent[key] && typeof parent[key] === "object") {
            hits.push({ sourcePath: row.parentPath + "." + key, record: parent[key] });
          }
        }
      }
    } else {
      for (const p of row.paths) {
        const record = getPath(strategy, p);
        if (record && typeof record === "object") {
          hits.push({ sourcePath: p, record });
          break;
        }
      }
    }
    for (const hit of hits) {
      const label = labelCheck(hit.record, row);
      let authority = row.authority;
      let authorityReason = "REGISTRY";
      if (!inRange(dateYmd, row)) {
        authority = "UNKNOWN";
        authorityReason = "DATE_OUTSIDE_VERIFIED_REGISTRY_RANGE";
      } else if (label.checked && !label.ok) {
        authority = "UNKNOWN";
        authorityReason = "PAYLOAD_LABEL_CONTRADICTS_REGISTRY";
      }
      out.push({
        engine,
        authority,
        authorityReason,
        version: row.version,
        payloadLabel: label.label,
        versionVerified: label.checked && label.ok,
        sourcePath: hit.sourcePath,
        record: hit.record,
      });
    }
  }
  return out;
}

/** True only when every canonical gate engine has a verified row covering the date. */
export function isDateCanonicallyVerified(dateYmd) {
  return GATE_ENGINES.every((engine) =>
    ROWS.some((r) => r.engine === engine && r.authority === "CANONICAL" && inRange(dateYmd, r)));
}

export function registrySummary() {
  return {
    registryVersion: REGISTRY_VERSION,
    evidenceStatus: REGISTRY_EVIDENCE_STATUS,
    pipelineOrder: PIPELINE_ORDER,
    engine28aLanes: ENGINE28A_LANES,
    rows: ROWS.map(({ engine, authority, version, from, to }) => ({
      engine, authority, version, from, to,
    })),
  };
}
