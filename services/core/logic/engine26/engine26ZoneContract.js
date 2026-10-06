// services/core/logic/engine26/engine26ZoneContract.js
//
// Canonical Engine 26 zone normalization + serialization.
// Keeps Engine 26 identity stable while carrying rollover price-basis metadata.

const DEFAULT_TICK_SIZE = 0.25;

function toFiniteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function positiveNumber(value) {
  const n = toFiniteNumber(value);
  return n !== null && n > 0 ? n : null;
}

function roundToTick(value, tickSize = DEFAULT_TICK_SIZE) {
  const n = toFiniteNumber(value);
  if (n === null) return null;
  return Number((Math.round(n / tickSize) * tickSize).toFixed(2));
}

function buildPriceBasis(zone) {
  if (!zone || typeof zone !== "object") return null;

  const existing =
    zone.priceBasis && typeof zone.priceBasis === "object"
      ? zone.priceBasis
      : null;

  const originalContract =
    existing?.originalContract ??
    zone.sourceFuturesContractCode ??
    null;

  const displayContract =
    existing?.displayContract ??
    zone.displayFuturesContractCode ??
    null;

  const rollAdjustmentPoints = toFiniteNumber(
    existing?.rollAdjustmentPoints ??
    zone.rollAdjustmentPoints
  );

  if (
    !existing &&
    originalContract == null &&
    displayContract == null &&
    rollAdjustmentPoints == null &&
    zone.protectedOriginal !== true &&
    zone.readOnly !== true
  ) {
    return null;
  }

  return {
    ...(existing || {}),
    originalContract,
    displayContract,
    polygonOriginalTicker:
      existing?.polygonOriginalTicker ??
      zone.polygonSourceTicker ??
      null,
    polygonDisplayTicker:
      existing?.polygonDisplayTicker ??
      zone.polygonDisplayTicker ??
      null,
    rollAdjusted:
      existing?.rollAdjusted === true ||
      (rollAdjustmentPoints !== null && rollAdjustmentPoints !== 0),
    rollAdjustmentPoints,
    tickSize:
      toFiniteNumber(existing?.tickSize) ??
      DEFAULT_TICK_SIZE,
    adjustmentMethod:
      existing?.adjustmentMethod ??
      zone.adjustmentMethod ??
      null,
    adjustmentTimestamp:
      existing?.adjustmentTimestamp ??
      zone.adjustmentTimestamp ??
      null,
    priceSource:
      zone.priceSource ??
      zone.source ??
      null,
    protectedOriginal:
      zone.protectedOriginal === true,
    readOnly:
      zone.readOnly === true,
  };
}

function buildRolloverMetadata(zone) {
  const raw = zone?.raw || {};

  return {
    priceSource:
      zone?.priceSource ??
      raw?.source ??
      zone?.source ??
      null,

    originalLo:
      toFiniteNumber(zone?.originalLo ?? raw?.originalLo),

    originalHi:
      toFiniteNumber(zone?.originalHi ?? raw?.originalHi),

    originalMid:
      toFiniteNumber(zone?.originalMid ?? raw?.originalMid),

    adjustedLo:
      toFiniteNumber(zone?.adjustedLo ?? raw?.adjustedLo),

    adjustedHi:
      toFiniteNumber(zone?.adjustedHi ?? raw?.adjustedHi),

    adjustedMid:
      toFiniteNumber(zone?.adjustedMid ?? raw?.adjustedMid),

    protectedOriginal:
      zone?.protectedOriginal === true ||
      raw?.protectedOriginal === true,

    readOnly:
      zone?.readOnly === true ||
      raw?.readOnly === true,

    sourceFuturesContractCode:
      zone?.sourceFuturesContractCode ??
      raw?.sourceFuturesContractCode ??
      null,

    displayFuturesContractCode:
      zone?.displayFuturesContractCode ??
      raw?.displayFuturesContractCode ??
      null,

    polygonSourceTicker:
      zone?.polygonSourceTicker ??
      raw?.polygonSourceTicker ??
      null,

    polygonDisplayTicker:
      zone?.polygonDisplayTicker ??
      raw?.polygonDisplayTicker ??
      null,

    rollAdjustmentPoints:
      toFiniteNumber(
        zone?.rollAdjustmentPoints ??
        raw?.rollAdjustmentPoints
      ),

    adjustmentMethod:
      zone?.adjustmentMethod ??
      raw?.adjustmentMethod ??
      null,

    adjustmentTimestamp:
      zone?.adjustmentTimestamp ??
      raw?.adjustmentTimestamp ??
      null,

    priceBasis:
      buildPriceBasis({
        ...raw,
        ...(zone || {}),
      }),
  };
}


export function buildEngine26LogicalZoneKey(zone) {
  if (!zone || typeof zone !== "object") return null;

  const upstreamId = String(
    zone.upstreamId ??
    zone.id ??
    zone.zoneId ??
    zone.raw?.upstreamId ??
    zone.raw?.id ??
    ""
  ).trim();

  if (!upstreamId) return null;

  const source = String(zone.source ?? "UNKNOWN")
    .trim()
    .toUpperCase();

  const type = String(
    zone.type ??
    zone.zoneType ??
    zone.raw?.type ??
    zone.raw?.zoneType ??
    "ZONE"
  )
    .trim()
    .toUpperCase();

  const timeframe = String(
    zone.timeframe ??
    zone.tf ??
    zone.raw?.timeframe ??
    zone.raw?.tf ??
    "UNKNOWN"
  )
    .trim()
    .toUpperCase();

  return [
    source,
    type,
    timeframe,
    upstreamId.toUpperCase(),
  ].join("|");
}

export function normalizeEngine26Zone({
  zone,
  source,
  sourcePath,
  defaultType = "ZONE",
  defaultTimeframe = null,
  priority = 50,
  tickSize = DEFAULT_TICK_SIZE,
}) {
  if (!zone || typeof zone !== "object") return null;

  const directPrice = positiveNumber(
    zone.price ??
    zone.level ??
    zone.mid ??
    zone.value
  );

  const rawLo = positiveNumber(
    zone.lo ??
    zone.low ??
    zone.lower ??
    zone.from ??
    directPrice
  );

  const rawHi = positiveNumber(
    zone.hi ??
    zone.high ??
    zone.upper ??
    zone.to ??
    directPrice
  );

  if (rawLo === null || rawHi === null) return null;

  const lo = roundToTick(Math.min(rawLo, rawHi), tickSize);
  const hi = roundToTick(Math.max(rawLo, rawHi), tickSize);
  const mid = roundToTick((lo + hi) / 2, tickSize);

  return {
    upstreamId:
      zone.id ??
      zone.zoneId ??
      null,

    logicalZoneKey:
      buildEngine26LogicalZoneKey({
        ...zone,
        source,
        type: String(
          zone.zoneType ??
          zone.type ??
          zone.label ??
          defaultType
        ).toUpperCase(),
        timeframe:
          zone.timeframe ??
          zone.tf ??
          defaultTimeframe,
        upstreamId:
          zone.id ??
          zone.zoneId ??
          null,
      }),

    source,
    sourcePath,

    type: String(
      zone.zoneType ??
      zone.type ??
      zone.label ??
      defaultType
    ).toUpperCase(),

    timeframe:
      zone.timeframe ??
      zone.tf ??
      defaultTimeframe,

    side:
      zone.side ??
      zone.direction ??
      zone.bias ??
      null,

    lo,
    hi,
    mid,

    priority,

    strength: toFiniteNumber(
      zone.strength ??
      zone.score ??
      zone.confidence
    ),

    freshness:
      zone.freshness ??
      zone.status ??
      null,

    ...buildRolloverMetadata(zone),

    raw: zone,
  };
}

export function buildEngine26TradeZoneView(
  zone,
  { zoneId = null } = {}
) {
  if (!zone || typeof zone !== "object") return null;

  return {
    id:
      zoneId ??
      zone.id ??
      null,

    zoneId:
      zoneId ??
      zone.zoneId ??
      zone.id ??
      null,

    upstreamId:
      zone.upstreamId ?? null,

    logicalZoneKey:
      zone.logicalZoneKey ??
      buildEngine26LogicalZoneKey(zone),

    source:
      zone.source ?? null,

    sourcePath:
      zone.sourcePath ?? null,

    type:
      zone.type ?? null,

    timeframe:
      zone.timeframe ?? null,

    low:
      zone.lo ?? zone.low ?? null,

    high:
      zone.hi ?? zone.high ?? null,

    midline:
      zone.mid ?? zone.midline ?? null,

    ...buildRolloverMetadata(zone),
  };
}

export function buildEngine26LocationView(zone) {
  if (!zone || typeof zone !== "object") return null;

  return {
    source:
      zone.source ?? null,

    sourcePath:
      zone.sourcePath ?? null,

    upstreamId:
      zone.upstreamId ?? null,

    logicalZoneKey:
      zone.logicalZoneKey ??
      buildEngine26LogicalZoneKey(zone),

    type:
      zone.type ?? null,

    timeframe:
      zone.timeframe ?? null,

    lo:
      zone.lo ?? null,

    hi:
      zone.hi ?? null,

    mid:
      zone.mid ?? null,

    relation:
      zone.relation ?? null,

    distancePoints:
      zone.distancePoints ?? null,

    selectionScore:
      zone.selectionScore ?? null,

    priority:
      zone.priority ?? null,

    strength:
      zone.strength ?? null,

    freshness:
      zone.freshness ?? null,

    ...buildRolloverMetadata(zone),
  };
}

export default {
  normalizeEngine26Zone,
  buildEngine26TradeZoneView,
  buildEngine26LocationView,
  buildEngine26LogicalZoneKey,
};
