// Redline Strategy Account Monitor v1
//
// Read-only account/position awareness across the locked six-account plan.
// Engine 10 remains position truth; Engine 22 remains structural truth.

import {
  getStrategyAccountRegistry,
  resolveStrategyAccountRole,
} from "./strategyAccountRegistry.js";

function upper(value) {
  return String(value ?? "").trim().toUpperCase();
}

function num(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function remainingQty(trade) {
  return (
    num(trade?.qty?.remainingQty) ??
    num(trade?.remainingQty) ??
    num(trade?.entry?.qty) ??
    0
  );
}

function normalizeRoot(value) {
  const v = upper(value).replace(/^\//, "").replace(/:.*$/, "");
  if (v.startsWith("MES")) return "ES";
  if (v.startsWith("ES")) return "ES";
  return v || null;
}

function normalizeTrade(trade) {
  if (upper(trade?.status) !== "OPEN") return null;
  const qty = remainingQty(trade);
  if (!(qty > 0)) return null;

  const root = normalizeRoot(
    trade?.normalizedInstrumentRoot ?? trade?.symbol ?? trade?.brokerSymbol
  );
  if (root !== "ES") return null;

  const role = resolveStrategyAccountRole({
    brokerAccountLabel: trade?.brokerAccountLabel ?? trade?.realBroker?.brokerAccountLabel,
    legacyJournalAccount: trade?.journalAccount ?? trade?.realBroker?.journalAccount,
  });

  return {
    tradeId: trade?.tradeId ?? trade?.identity?.tradeId ?? null,
    accountRole: role?.account?.accountRole ?? null,
    accountRoleResolved: role?.resolved === true,
    accountResolutionSource: role?.resolutionSource ?? null,
    brokerAccountLabel: trade?.brokerAccountLabel ?? trade?.realBroker?.brokerAccountLabel ?? null,
    legacyJournalAccount: trade?.journalAccount ?? trade?.realBroker?.journalAccount ?? null,
    direction: upper(trade?.direction ?? trade?.identity?.direction) || "UNKNOWN",
    remainingQty: qty,
    averageEntry: num(trade?.entry?.price),
    openedAt: trade?.summary?.openTime ?? trade?.entry?.time ?? trade?.createdAt ?? null,
    futuresContractCode: trade?.futuresContractCode ?? trade?.realBroker?.futuresContractCode ?? null,
    source: trade?.source ?? null,
  };
}

function structuralViewForRole({ role, engine22WaveStrategy }) {
  if (!engine22WaveStrategy) return null;

  if (role === "INTRADAY") {
    const micro = engine22WaveStrategy?.microExecutionContext || null;
    return micro
      ? {
          degree: "micro",
          source: "microExecutionContext",
          activeWave: micro?.activeWave ?? null,
          direction: micro?.waveDirection ?? null,
          lifecycle: micro?.lifecycle ?? null,
          timingState: micro?.microTimingState ?? null,
          countStatus: micro?.countStatus ?? null,
          sourceCountId: micro?.sourceCountId ?? null,
          revision: micro?.revision ?? null,
        }
      : null;
  }

  const degreeByRole = {
    SUBMINUTE: "subminute",
    MINUTE: "minute",
    MINOR: "minor",
    INTERMEDIATE: "intermediate",
    PRIMARY: "primary",
  };

  const degree = degreeByRole[role] || null;
  if (!degree) return null;

  const state = engine22WaveStrategy?.degreeStates?.[degree] || null;
  if (!state) return null;

  return {
    degree,
    source: "degreeStates",
    activeWave: state?.activeWave ?? state?.currentWave ?? state?.wave ?? null,
    direction: state?.direction ?? state?.currentLegDirection ?? null,
    lifecycle: state?.lifecycle ?? state?.state ?? state?.status ?? null,
    timingState: null,
    countStatus: state?.countStatus ?? null,
    sourceCountId: state?.sourceCountId ?? state?.countId ?? null,
    revision: state?.revision ?? null,
  };
}

function summarizeCampaigns(campaigns) {
  if (!campaigns.length) {
    return { positionPresent: false, direction: "FLAT", contracts: 0, campaignCount: 0 };
  }

  const directions = [...new Set(campaigns.map((trade) => trade.direction).filter(Boolean))];
  const contracts = campaigns.reduce((sum, trade) => sum + Number(trade.remainingQty || 0), 0);

  return {
    positionPresent: true,
    direction: directions.length === 1 ? directions[0] : "MIXED",
    contracts,
    campaignCount: campaigns.length,
  };
}

export function buildStrategyAccountMonitoring({
  openTrades = [],
  engine22WaveStrategy = null,
} = {}) {
  const registry = getStrategyAccountRegistry();
  const normalizedTrades = (Array.isArray(openTrades) ? openTrades : [])
    .map(normalizeTrade)
    .filter(Boolean);

  const accounts = registry.accounts.map((account) => {
    const campaigns = normalizedTrades.filter(
      (trade) => trade.accountRole === account.accountRole
    );
    const position = summarizeCampaigns(campaigns);
    const structure = structuralViewForRole({
      role: account.accountRole,
      engine22WaveStrategy,
    });

    const structureDirection = upper(structure?.direction);
    const positionDirection = upper(position?.direction);
    const aligned =
      position.positionPresent === true &&
      ["LONG", "SHORT"].includes(positionDirection) &&
      ((positionDirection === "LONG" && structureDirection === "UP") ||
        (positionDirection === "SHORT" && structureDirection === "DOWN"));

    const conflict =
      position.positionPresent === true &&
      ["LONG", "SHORT"].includes(positionDirection) &&
      ["UP", "DOWN"].includes(structureDirection) &&
      !aligned;

    return {
      accountRole: account.accountRole,
      displayName: account.displayName,
      degree: account.degree,
      strategyId: account.strategyId,
      capitalTarget: account.capitalTarget,
      normalMesMin: account.normalMesMin,
      normalMesMax: account.normalMesMax,
      structuralOwner: account.structuralOwner,
      holdingProfile: account.holdingProfile,
      brokerBinding: account.brokerBinding,
      position,
      campaigns,
      structure,
      alignment: !position.positionPresent ? "FLAT" : aligned ? "ALIGNED" : conflict ? "CONFLICT" : "UNKNOWN",
      conflict,
      lowerDegreeTiming: account.lowerDegreeTiming,
      parentContext: account.parentContext,
    };
  });

  const unresolvedTrades = normalizedTrades.filter((trade) => trade.accountRoleResolved !== true);
  const totalOpenContracts = accounts.reduce((sum, account) => sum + Number(account?.position?.contracts || 0), 0);
  const longContracts = accounts.reduce((sum, account) => sum + (account?.position?.direction === "LONG" ? Number(account?.position?.contracts || 0) : 0), 0);
  const shortContracts = accounts.reduce((sum, account) => sum + (account?.position?.direction === "SHORT" ? Number(account?.position?.contracts || 0) : 0), 0);

  return {
    version: "redline.strategyAccountMonitoring.v1",
    mode: "READ_ONLY",
    instrument: "MES",
    dollarsPerPointPerContract: 5,
    registryVersion: registry.version,
    accounts,
    portfolio: {
      totalOpenContracts,
      longContracts,
      shortContracts,
      netContracts: longContracts - shortContracts,
      grossDollarsPerPoint: totalOpenContracts * 5,
      netDollarsPerPoint: (longContracts - shortContracts) * 5,
      reserveCapitalTarget: registry.capital.reserve,
    },
    unresolvedTrades,
    guardrails: {
      noPermissionCreated: true,
      noSizingAuthority: true,
      noManagementAuthority: true,
      noExecution: true,
      noJournalMutation: true,
    },
  };
}

export default buildStrategyAccountMonitoring;