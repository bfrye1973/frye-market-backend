// Read-only Engine 22 seven-degree migration proposal.
// These handwritten marks are USER_PROPOSED, not confirmed or locked production state.
// This module MUST NOT be imported by snapshot, canonical stores, execution or Replay.
export const PROPOSED_MICRO_ANCHORS = Object.freeze({
  degree: "MICRO",
  status: "USER_PROPOSED_MANAGER_REVIEW",
  parentDegree: "SUBMINUTE",
  source: "USER_HANDWRITTEN_2026_10_11",
  marks: Object.freeze({
    w1Low: Object.freeze({ price: 7675.00, date: "2026-10-01", time: "08:00" }),
    w1High: Object.freeze({ price: 7808.75, date: "2026-10-02", time: "07:30" }),
    w2Low: Object.freeze({ price: 7759.50, date: "2026-10-05", time: "03:30" }),
    w3High: Object.freeze({ price: 7896.75, date: "2026-10-06", time: "08:30" }),
    w4Low: Object.freeze({ price: 7788.00, date: "2026-10-08", time: "15:30" }),
  }),
  activeWaveCandidate: "W5",
  // Date/time zone and historical OHLC bar identity are not yet verified.
  confirmationStatus: "PENDING_OHLC_RECONCILIATION",
});

export const PROPOSED_SUBMICRO_MIGRATION = Object.freeze({
  degree: "SUBMICRO",
  displayName: "INTRADAY SUBMICRO",
  source: "CURRENT_PRODUCTION_MICRO_OPERATING_SEQUENCE",
  status: "MIGRATION_PENDING_REPLAY_RECONCILIATION",
  parentDegree: "MICRO",
  accountRole: "INTRADAY_SUBMICRO",
  countIdRule: "CREATE_DISTINCT_SUBMICRO_COUNT_ID; NEVER_REUSE_MICRO_COUNT_ID",
  historicalRule: "PRESERVE_ORIGINAL_MICRO_RECORDS_AND_PROVENANCE",
  authorization: "NO_TRADING_OR_ACCOUNT_ROUTING_CHANGES",
});

export function auditProposedStructuralDegrees({ micro = PROPOSED_MICRO_ANCHORS,
  submicro = PROPOSED_SUBMICRO_MIGRATION } = {}) {
  const m=micro.marks;
  const prices=[m.w1Low.price,m.w1High.price,m.w2Low.price,m.w3High.price,m.w4Low.price];
  const onEsTicks=prices.every(p=>Number.isFinite(p)&&Math.round(p*4)===p*4);
  const impulseOrder=m.w1Low.price<m.w1High.price &&
    m.w2Low.price>m.w1Low.price &&
    m.w3High.price>m.w1High.price &&
    m.w4Low.price>m.w1High.price &&
    m.w4Low.price<m.w3High.price;
  return Object.freeze({
    ok:onEsTicks&&impulseOrder&&micro.degree==="MICRO"&&
      submicro.degree==="SUBMICRO"&&
      micro.parentDegree==="SUBMINUTE"&&submicro.parentDegree==="MICRO",
    priceTicksValid:onEsTicks, proposedImpulseAnchorOrderValid:impulseOrder,
    historicalBarsVerified:false,
    lockedAnchorsPublished:false,
    sourceCountIdsIndependent:false,
    replayEquivalenceVerified:false,
    reasonCodes:["HANDWRITTEN_ANCHORS_PENDING_HISTORICAL_BAR_VALIDATION",
      "SUBMICRO_COUNT_ID_PENDING_CONTROLLED_MIGRATION",
      "NO_STRUCTURAL_PRICES_MIGRATED_IN_PRODUCTION"],
  });
}
