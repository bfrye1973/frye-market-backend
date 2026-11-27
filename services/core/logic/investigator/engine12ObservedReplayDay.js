// Engine 12 #412: observed approval/blocker chronology for one Arizona day,
// read from original immutable Replay snapshots (consumer regression 1,
// comment 7223782428). Read-only. Never manufactures receipt rows.
//
// A first blocker is used only when Engine 28A's recorded diagnosis passes the
// existing trust checks for that snapshot; otherwise the observation stays
// UNKNOWN. Missing snapshots and between-snapshot activity remain unproven.

import path from "node:path";
import { listArchivedTimes } from "./lookupReplayWindow.js";
import { readEvidenceJson } from "./readEvidenceFile.js";
import { evaluateEngine28ATrust } from "./identifyFirstBlocker.js";
import { summarizeObservedApprovalWindow } from "../trading/engine8ObservedApprovalWindow.js";

export const MAX_REPLAY_SNAPSHOTS_PER_DAY = 500;
const MAX_SNAPSHOT_BYTES = 4 * 1024 * 1024;

function bool(v) { return typeof v === "boolean" ? v : null; }

// Normalize one Replay snapshot into the observed-window shape.
export function normalizeReplaySnapshot({ snapshot, strategyId, dateYmd }) {
  const lane = snapshot?.strategies?.[strategyId];
  const observedAt = typeof snapshot?.generatedAtUtc === "string" ? snapshot.generatedAtUtc : (typeof snapshot?.snapshotTime === "string" ? snapshot.snapshotTime : null);
  if (!lane || typeof lane !== "object" || !observedAt) return { observedAt, strategyId, invalid: true };
  const order = lane.engine8PaperOrder || {};
  const trust = evaluateEngine28ATrust({ strategy: lane, strategyId, replayGeneratedAtUtc: snapshot?.generatedAtUtc ?? null, dateYmd });
  // The authority registry is proven only for evidence-backed dates. On other dates the
  // recorded blocker is used for chronology when every OTHER trust check passes, and the
  // row says so; any other failed check leaves the blocker UNKNOWN.
  const failed = (trust.checks || []).filter((c) => c.ok === false).map((c) => c.check);
  const registryOnly = trust.present && failed.length === 1 && failed[0] === "REGISTRY_VERIFIED_FOR_DATE";
  const rec = trust.trusted || registryOnly ? trust.recorded : null;
  const blockerAuthority = trust.trusted ? "ENGINE28A_TRUSTED" : registryOnly ? "ENGINE28A_RECORDED_REGISTRY_UNVERIFIED_FOR_DATE" : "NONE";
  return {
    observedAt,
    strategyId,
    engine6Allowed: bool(lane?.permission?.paper?.allowed),
    engine8Executable: bool(order.executable),
    // The snapshot's Engine 8 adapter state: an order is recorded only by orderCreated/orderId.
    orderCreated: order.orderCreated === true || Boolean(order.orderId) ? true : false,
    firstBlocker: rec?.firstFailingEngine ?? null,
    rootCause: rec?.rootCause ?? null,
    engine8Blockers: Array.isArray(order.blockers) ? order.blockers.filter((x) => typeof x === "string").slice(0, 20) : [],
    engine28aTrusted: trust.trusted === true,
    blockerAuthority,
  };
}

export function summarizeObservedReplayDay({ root, date, strategyId = "intraday_scalp@10m", read = readEvidenceJson } = {}) {
  const start = new Date(Date.parse(date + "T00:00:00-07:00")).toISOString();
  const end = new Date(Date.parse(date + "T00:00:00-07:00") + 86400000).toISOString();
  const empty = (reason) => ({ ...summarizeObservedApprovalWindow({ snapshots: [], start, end }), date, source: "ENGINE12_REPLAY", reason, snapshotsListed: 0, snapshotsRead: 0 });
  if (!root) return empty("REPLAY_ROOT_NOT_CONFIGURED");
  let times;
  try { times = listArchivedTimes(root, date); } catch { return empty("REPLAY_LIST_FAILED"); }
  if (times === null) return empty("REPLAY_DATE_NOT_FOUND");
  if (times.policyRefused) return empty("PATH_POLICY_REFUSED");
  const issues = [];
  if (times.length > MAX_REPLAY_SNAPSHOTS_PER_DAY) issues.push("REPLAY_SNAPSHOT_CAP_REACHED");
  const snapshots = [];
  const extra = new Map();
  for (const hhmm of times.slice(0, MAX_REPLAY_SNAPSHOTS_PER_DAY)) {
    const r = read(path.join(root, date, hhmm + ".json"), { maxBytes: MAX_SNAPSHOT_BYTES });
    if (r?.status !== "OK") { issues.push("REPLAY_SNAPSHOT_UNREADABLE"); continue; }
    const n = normalizeReplaySnapshot({ snapshot: r.value, strategyId, dateYmd: date });
    if (n.invalid) { issues.push("REPLAY_SNAPSHOT_LANE_MISSING"); continue; }
    snapshots.push(n);
    extra.set(n.observedAt, { engine8Blockers: n.engine8Blockers, engine28aTrusted: n.engine28aTrusted, blockerAuthority: n.blockerAuthority });
  }
  const summary = summarizeObservedApprovalWindow({ snapshots, start, end });
  const rows = summary.rows.map((row) => ({ ...row, ...(extra.get(row.observedAt) || {}) }));
  return {
    ...summary,
    rows,
    issues: [...new Set([...summary.issues, ...issues])],
    date,
    source: "ENGINE12_REPLAY",
    snapshotsListed: times.length,
    snapshotsRead: snapshots.length,
    blockerAuthority: rows.some((r) => r.blockerAuthority === "ENGINE28A_RECORDED_REGISTRY_UNVERIFIED_FOR_DATE") ? "INCLUDES_REGISTRY_UNVERIFIED_DATES" : rows.length ? "ENGINE28A_TRUSTED_OR_NONE" : "NONE",
    note: "Original Replay observations only. Gaps between snapshots and missing snapshots are not evidence of no activity; fill verdict is decided by durable evidence, never by this summary.",
  };
}
