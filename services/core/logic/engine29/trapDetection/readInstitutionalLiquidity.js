// services/core/logic/engine29/trapDetection/readInstitutionalLiquidity.js
// Read-only adapter for the canonical ES manual institutional inventory.
// Engine 29 consumes location truth only. It does not create or mutate Engine 26
// candidates, permissions, geometry, or execution state.

import { readEngine26ManualImbalanceZones } from "../../engine26/readManualImbalanceZones.js";

function finite(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function readEngine29InstitutionalLiquidity() {
  const inventory = readEngine26ManualImbalanceZones();

  const zones = (Array.isArray(inventory?.zones) ? inventory.zones : [])
    .filter((zone) =>
      zone?.active !== false &&
      zone?.invalidated !== true &&
      zone?.expired !== true
    )
    .map((zone) => ({
      id: zone.id ?? null,
      source: zone.source ?? null,
      sourceLine: zone.sourceLine ?? null,
      type: "INSTITUTIONAL_ZONE",
      side: zone.side ?? "GREEN",
      lo: finite(zone.lo),
      hi: finite(zone.hi),
      mid: finite(zone.mid),
      originalLo: finite(zone.originalLo),
      originalHi: finite(zone.originalHi),
      originalMid: finite(zone.originalMid),
      rollAdjustmentPoints: finite(zone.rollAdjustmentPoints) ?? 0,
      displayFuturesContractCode: zone.displayFuturesContractCode ?? null,
      sourceFuturesContractCode: zone.sourceFuturesContractCode ?? null,
      priceBasis: zone.priceBasis ?? null,
      readOnly: true,
    }))
    .filter((zone) =>
      Number.isFinite(zone.lo) &&
      Number.isFinite(zone.hi) &&
      zone.hi >= zone.lo
    );

  return {
    version: "engine29.institutionalLiquidity.v1",
    available: inventory?.ok === true && zones.length > 0,
    authority: "READ_ONLY_LOCATION_CONTEXT",
    upstreamEngine: "ENGINE26_MANUAL_IMBALANCE_INVENTORY",
    rolloverApplied: inventory?.rolloverApplied === true,
    zoneCount: zones.length,
    zones,
    reasonCodes: Array.isArray(inventory?.reasonCodes)
      ? inventory.reasonCodes
      : [],
    warnings: Array.isArray(inventory?.warnings)
      ? inventory.warnings
      : [],
    noPermissionCreated: true,
    noExecution: true,
  };
}

export default readEngine29InstitutionalLiquidity;
