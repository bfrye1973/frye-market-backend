// services/core/logic/engine29/groups/buildGroupStateBundle.js

import { buildHeadlineIndexGroup } from "./buildHeadlineIndexGroup.js";
import { buildBreadthGroup } from "./buildBreadthGroup.js";
import { buildLeadershipGroup } from "./buildLeadershipGroup.js";
import { buildCreditGroup } from "./buildCreditGroup.js";
import { buildRatesDurationGroup } from "./buildRatesDurationGroup.js";
import { buildEnergyInflationGroup } from "./buildEnergyInflationGroup.js";
import { buildVolatilityGroup } from "./buildVolatilityGroup.js";
import { buildFinancialConditionsGroup } from "./buildFinancialConditionsGroup.js";

export function buildEngine29GroupStateBundle(structureBundle, {
  now = Date.now(),
  financialConditions = {},
} = {}) {
  const symbols = structureBundle?.symbols || {};

  const groups = {
    headlineIndex: buildHeadlineIndexGroup(symbols),
    breadth: buildBreadthGroup(symbols),
    leadership: buildLeadershipGroup(symbols),
    credit: buildCreditGroup(symbols),
    ratesDuration: buildRatesDurationGroup(symbols),
    energyInflation: buildEnergyInflationGroup(symbols),
    volatility: buildVolatilityGroup(symbols),
    financialConditions: buildFinancialConditionsGroup(symbols, financialConditions),
  };

  const structuralStates = {};
  const tacticalStates = {};
  const degradedGroups = [];
  const structuralReasonCodes = [];
  const tacticalReasonCodes = [];

  for (const [name, group] of Object.entries(groups)) {
    structuralStates[name] = group.structural?.state ?? null;
    tacticalStates[name] = group.tactical?.state ?? null;
    if (group.structural?.dataDegraded || group.tactical?.dataDegraded) degradedGroups.push(name);
    structuralReasonCodes.push(...(group.structural?.reasonCodes || []));
    tacticalReasonCodes.push(...(group.tactical?.reasonCodes || []));
  }

  return {
    version: "engine29.groups.v1",
    timestamp: new Date(now).toISOString(),
    dataDegraded: Boolean(structureBundle?.dataDegraded) || degradedGroups.length > 0,
    groups,
    summary: {
      structuralStates,
      tacticalStates,
      degradedGroups: [...new Set(degradedGroups)],
      structuralReasonCodes: [...new Set(structuralReasonCodes)],
      tacticalReasonCodes: [...new Set(tacticalReasonCodes)],
    },
  };
}
