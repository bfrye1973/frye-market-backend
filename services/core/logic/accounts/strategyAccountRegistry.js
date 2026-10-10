// Canonical Strategy Account Registry v1
//
// One dedicated Schwab account role per Elliott/strategy lane.
// This registry is descriptive only and carries no trading authority.

export const STRATEGY_ACCOUNT_REGISTRY_VERSION =
  "redline.strategyAccountRegistry.v1";

const LOCKED_TOTAL_CAPITAL = 46000;
const LOCKED_RESERVE_CAPITAL = 8000;

const ACCOUNT_ROLES = Object.freeze([
  Object.freeze({
    accountRole: "INTRADAY",
    displayName: "Intraday",
    degree: "micro",
    strategyId: "intraday_scalp@10m",
    capitalTarget: 16000,
    normalMesMin: 1,
    normalMesMax: 5,
    holdingProfile: "INTRADAY",
    structuralOwner: "MICRO",
    lowerDegreeTiming: [],
    parentContext: ["SUBMINUTE", "MINUTE"],
    brokerBinding: Object.freeze({
      status: "BOUND_EXISTING",
      brokerAccountLabel: "SCHWAB_6380",
      legacyJournalAccount: "INTRADAY",
    }),
  }),
  Object.freeze({
    accountRole: "SUBMINUTE",
    displayName: "Subminute",
    degree: "subminute",
    strategyId: "subminute_scalp@10m",
    capitalTarget: 10000,
    normalMesMin: 1,
    normalMesMax: 4,
    holdingProfile: "FAST_SWING",
    structuralOwner: "SUBMINUTE",
    lowerDegreeTiming: ["MICRO"],
    parentContext: ["MINUTE", "MINOR", "INTERMEDIATE", "PRIMARY"],
    brokerBinding: Object.freeze({
      status: "BOUND_EXISTING",
      brokerAccountLabel: "SCHWAB_0747",
      legacyJournalAccount: "SWING",
    }),
  }),
  Object.freeze({
    accountRole: "MINUTE",
    displayName: "Minute",
    degree: "minute",
    strategyId: "intraday_scalp@10m",
    capitalTarget: 3000,
    normalMesMin: 1,
    normalMesMax: 1,
    holdingProfile: "SWING",
    structuralOwner: "MINUTE",
    lowerDegreeTiming: ["SUBMINUTE", "MICRO"],
    parentContext: ["MINOR", "INTERMEDIATE", "PRIMARY"],
    brokerBinding: Object.freeze({
      status: "AWAITING_NEW_SCHWAB_ACCOUNT",
      brokerAccountLabel: null,
      legacyJournalAccount: null,
    }),
  }),
  Object.freeze({
    accountRole: "MINOR",
    displayName: "Minor",
    degree: "minor",
    strategyId: "minor_swing@1h",
    capitalTarget: 3000,
    normalMesMin: 1,
    normalMesMax: 1,
    holdingProfile: "SWING",
    structuralOwner: "MINOR",
    lowerDegreeTiming: ["MINUTE", "SUBMINUTE", "MICRO"],
    parentContext: ["INTERMEDIATE", "PRIMARY"],
    brokerBinding: Object.freeze({
      status: "AWAITING_NEW_SCHWAB_ACCOUNT",
      brokerAccountLabel: null,
      legacyJournalAccount: null,
    }),
  }),
  Object.freeze({
    accountRole: "INTERMEDIATE",
    displayName: "Intermediate",
    degree: "intermediate",
    strategyId: "intermediate_long@4h",
    capitalTarget: 3000,
    normalMesMin: 1,
    normalMesMax: 1,
    holdingProfile: "POSITION_SWING",
    structuralOwner: "INTERMEDIATE",
    lowerDegreeTiming: ["MINOR", "MINUTE", "SUBMINUTE", "MICRO"],
    parentContext: ["PRIMARY"],
    brokerBinding: Object.freeze({
      status: "AWAITING_NEW_SCHWAB_ACCOUNT",
      brokerAccountLabel: null,
      legacyJournalAccount: null,
    }),
  }),
  Object.freeze({
    accountRole: "PRIMARY",
    displayName: "Primary",
    degree: "primary",
    strategyId: "primary_position@1d",
    capitalTarget: 3000,
    normalMesMin: 1,
    normalMesMax: 1,
    holdingProfile: "POSITION_SWING",
    structuralOwner: "PRIMARY",
    lowerDegreeTiming: ["INTERMEDIATE", "MINOR", "MINUTE", "SUBMINUTE", "MICRO"],
    parentContext: [],
    brokerBinding: Object.freeze({
      status: "AWAITING_NEW_SCHWAB_ACCOUNT",
      brokerAccountLabel: null,
      legacyJournalAccount: null,
    }),
  }),
]);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function getStrategyAccountRegistry() {
  const accounts = ACCOUNT_ROLES.map(clone);
  const allocatedCapital = accounts.reduce(
    (sum, account) => sum + Number(account.capitalTarget || 0),
    0
  );

  return {
    version: STRATEGY_ACCOUNT_REGISTRY_VERSION,
    status: "LOCKED_ARCHITECTURE",
    instrument: "MES",
    dollarsPerPointPerContract: 5,
    capital: {
      total: LOCKED_TOTAL_CAPITAL,
      strategyAccounts: allocatedCapital,
      reserve: LOCKED_RESERVE_CAPITAL,
      balanced: allocatedCapital + LOCKED_RESERVE_CAPITAL === LOCKED_TOTAL_CAPITAL,
    },
    accounts,
    reserve: {
      accountRole: "RESERVE",
      displayName: "Portfolio Reserve",
      capitalTarget: LOCKED_RESERVE_CAPITAL,
      tradable: false,
      strategyId: null,
      structuralOwner: null,
    },
    ownership: {
      engine22: "STRUCTURAL_TRUTH",
      engine7: "SIZING_AUTHORITY",
      engine8: "EXECUTION_AND_BROKER_FILL_OBSERVATION",
      engine10: "JOURNAL_AND_POSITION_TRUTH",
      engine13: "NOTIFICATION_ONLY",
      engine28a: "REPLAY_AND_TRAINING_MEASUREMENT_ONLY",
    },
    guardrails: {
      noCashMovement: true,
      noBrokerAccountCreation: true,
      noFuturesApprovalMutation: true,
      noSizingAuthority: true,
      noOrderCreation: true,
      noJournalMutation: true,
    },
  };
}

export function resolveStrategyAccountRole({
  brokerAccountLabel = null,
  legacyJournalAccount = null,
} = {}) {
  const broker = String(brokerAccountLabel || "").trim().toUpperCase();
  const journal = String(legacyJournalAccount || "").trim().toUpperCase();
  const registry = getStrategyAccountRegistry();

  const exactBroker = registry.accounts.find((account) =>
    broker && String(account?.brokerBinding?.brokerAccountLabel || "").trim().toUpperCase() === broker
  );

  if (exactBroker) {
    return { resolved: true, resolutionSource: "BROKER_ACCOUNT_LABEL", account: exactBroker };
  }

  const legacy = registry.accounts.find((account) =>
    journal && String(account?.brokerBinding?.legacyJournalAccount || "").trim().toUpperCase() === journal
  );

  if (legacy) {
    return { resolved: true, resolutionSource: "LEGACY_JOURNAL_ACCOUNT", account: legacy };
  }

  return { resolved: false, resolutionSource: "UNBOUND_ACCOUNT", account: null };
}

export default {
  STRATEGY_ACCOUNT_REGISTRY_VERSION,
  getStrategyAccountRegistry,
  resolveStrategyAccountRole,
};