// services/core/logic/investigator/identityJoin.js
//
// Generic identity join with zero lookahead. Pure.
//
// Tiers are tried in order; the first tier for which the decision has a value
// and at least one ELIGIBLE record matches is used. Lower tiers are not mixed in.
//   exact tiers: tradeId, orderId, executionId, planId
//   candidate tier: candidateId + strategyId + |eventTime - decisionTime| <= window
// Never by price. Never by time alone.
//
// Eligibility (fail closed):
//   record.mode must equal decision.mode exactly (missing => MODE_MISSING)
//   record.strategyId must equal decision.strategyId (missing => STRATEGY_MISSING)
// Ineligible identity hits are reported as counts only (no record detail), so a
// REAL record is never surfaced through a PAPER investigation.
//
// Conflict: any other identity field present on BOTH sides that differs removes
// the record from the match and reports IDENTITY_CONFLICT.
//
// Time: events are split against decisionTime into prior / subsequent.
// Nothing after decisionTime is ever placed in a "known at decision" section;
// that section is built only from Replay by the caller.

export const JOIN_VERSION = "engine12.investigator.identityJoin.v1";

const ID_FIELDS = ["tradeId", "orderId", "executionId", "planId", "candidateId"];

function ms(v) {
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

function asSet(value) {
  if (value === null || value === undefined || value === "") return new Set();
  return new Set((Array.isArray(value) ? value : [value]).filter((x) => x !== null && x !== undefined && x !== ""));
}

function eligibility(record, decision) {
  if (!record.mode) return "MODE_MISSING";
  if (record.mode !== decision.mode) return "MODE_MISMATCH";
  if (!record.strategyId) return "STRATEGY_MISSING";
  if (record.strategyId !== decision.strategyId) return "STRATEGY_MISMATCH";
  return null;
}

function conflictsFor(record, decision, tier) {
  const out = [];
  for (const field of ID_FIELDS) {
    if (field === tier) continue;
    const mine = asSet(decision[field]);
    const theirs = record[field];
    if (mine.size === 0 || theirs === null || theirs === undefined || theirs === "") continue;
    if (!mine.has(theirs)) {
      out.push({ field, decision: [...mine], record: theirs });
    }
  }
  return out;
}

/**
 * @param {object} p
 * @param {object} p.decision { strategyId, mode, decisionTime, tradeId, orderId,
 *                              executionId, planId, candidateId } (ids may be arrays)
 * @param {object[]} p.records normalized records { kind, mode, strategyId, eventTime,
 *                              tradeId, orderId, executionId, planId, candidateId, ... }
 * @param {string[]} p.tiers e.g. ["tradeId","orderId","executionId","planId","candidate"]
 * @param {number} p.windowMs candidate-tier window
 * @param {(matches:object[], tier:string)=>boolean} p.isAmbiguous
 * @param {number} p.maxRecords
 */
export function joinByIdentity({ decision, records, tiers, windowMs, isAmbiguous, maxRecords = 50 }) {
  const decisionMs = ms(decision.decisionTime);
  const excludedCounts = {};
  const excludedSeen = new Set(); // count each record once across tiers
  const notes = [];

  if (decisionMs === null) notes.push("DECISION_TIME_UNKNOWN_CANDIDATE_TIER_DISABLED");

  for (const tier of tiers) {
    let hits;
    if (tier === "candidate") {
      if (decisionMs === null || !decision.candidateId || !decision.strategyId) continue;
      hits = records.filter((r) => {
        if (!r.candidateId || !asSet(decision.candidateId).has(r.candidateId)) return false;
        const t = ms(r.eventTime);
        return t !== null && Math.abs(t - decisionMs) <= windowMs;
      });
    } else {
      const wanted = asSet(decision[tier]);
      if (wanted.size === 0) continue;
      hits = records.filter((r) => r[tier] && wanted.has(r[tier]));
    }
    if (hits.length === 0) continue;

    const eligible = [];
    for (const r of hits) {
      const reason = eligibility(r, decision);
      if (reason) {
        if (!excludedSeen.has(r)) {
          excludedSeen.add(r);
          excludedCounts[reason] = (excludedCounts[reason] || 0) + 1;
        }
      } else {
        eligible.push(r);
      }
    }
    if (eligible.length === 0) continue;

    const clean = [];
    const conflicts = [];
    for (const r of eligible) {
      const c = conflictsFor(r, decision, tier === "candidate" ? "candidateId" : tier);
      if (c.length > 0) conflicts.push({ recordKind: r.kind, recordRef: r.ref ?? null, mismatches: c });
      else clean.push(r);
    }

    const excluded = Object.entries(excludedCounts).map(([reason, count]) => ({ reason, count }));

    if (clean.length === 0) {
      return {
        version: JOIN_VERSION, status: "IDENTITY_CONFLICT", matchTier: tier,
        matches: [], conflicts, excluded, notes, truncated: false,
      };
    }

    const truncated = clean.length > maxRecords;
    const matches = clean.slice(0, maxRecords);
    if (isAmbiguous(matches, tier)) {
      return {
        version: JOIN_VERSION, status: "AMBIGUOUS", matchTier: tier,
        matches: [], ambiguousCandidates: matches.map((m) => m.ref ?? null),
        conflicts, excluded, notes, truncated,
      };
    }
    return {
      version: JOIN_VERSION, status: "MATCHED", matchTier: tier,
      matches, conflicts, excluded, notes, truncated,
    };
  }

  return {
    version: JOIN_VERSION, status: "NO_MATCH", matchTier: null, matches: [],
    conflicts: [],
    excluded: Object.entries(excludedCounts).map(([reason, count]) => ({ reason, count })),
    notes, truncated: false,
  };
}

/** Split timestamped events against decisionTime. Never reorders evidence into the past. */
export function splitEventsByDecisionTime(events, decisionTime) {
  const d = ms(decisionTime);
  const prior = [];
  const subsequent = [];
  const undated = [];
  for (const e of events) {
    const t = ms(e.eventTime);
    if (t === null || d === null) undated.push(e);
    else if (t < d) prior.push(e);
    else subsequent.push(e);
  }
  const byTime = (a, b) => ms(a.eventTime) - ms(b.eventTime);
  prior.sort(byTime);
  subsequent.sort(byTime);
  return { prior, subsequent, undated };
}
