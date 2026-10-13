const DEFAULT_TICK_SIZE = 0.25;

function toNum(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function upper(value) {
  return String(value || "").trim().toUpperCase();
}

function roundToTick(value, tickSize = DEFAULT_TICK_SIZE) {
  const n = toNum(value);
  const tick = toNum(tickSize) ?? DEFAULT_TICK_SIZE;
  if (n == null || tick <= 0) return null;
  return Number((Math.round(n / tick) * tick).toFixed(2));
}

function normalizeZone(zone) {
  if (!zone || typeof zone !== "object") return null;

  const low = toNum(zone.low ?? zone.lo);
  const high = toNum(zone.high ?? zone.hi);
  if (low == null || high == null) return null;

  const lo = Math.min(low, high);
  const hi = Math.max(low, high);
  const midline =
    toNum(zone.midline ?? zone.mid) ??
    Number(((lo + hi) / 2).toFixed(2));

  return {
    ...zone,
    id: zone.id ?? zone.zoneId ?? null,
    zoneId: zone.zoneId ?? zone.id ?? null,
    low: lo,
    high: hi,
    midline,
    lo,
    hi,
    mid: midline,
  };
}

function sameZone(a, b) {
  const za = normalizeZone(a);
  const zb = normalizeZone(b);
  if (!za || !zb) return false;

  if (za.zoneId && zb.zoneId && za.zoneId === zb.zoneId) return true;
  if (za.id && zb.id && za.id === zb.id) return true;

  return za.low === zb.low && za.high === zb.high;
}

export function selectEngine26BTargetZone({
  direction,
  entryZone,
  approvedNegotiatedZones = [],
} = {}) {
  const dir = upper(direction);
  const entry = normalizeZone(entryZone);
  const zones = Array.isArray(approvedNegotiatedZones)
    ? approvedNegotiatedZones.map(normalizeZone).filter(Boolean)
    : [];

  if (!entry || !["LONG", "SHORT"].includes(dir)) return null;

  const candidates = zones.filter((zone) => !sameZone(zone, entry));

  if (dir === "LONG") {
    return (
      candidates
        .filter((zone) => zone.low > entry.high)
        .sort((a, b) => {
          if (a.low !== b.low) return a.low - b.low;
          if (a.high !== b.high) return a.high - b.high;
          return String(a.zoneId || a.id || "").localeCompare(
            String(b.zoneId || b.id || "")
          );
        })[0] || null
    );
  }

  return (
    candidates
      .filter((zone) => zone.high < entry.low)
      .sort((a, b) => {
        if (a.high !== b.high) return b.high - a.high;
        if (a.low !== b.low) return b.low - a.low;
        return String(a.zoneId || a.id || "").localeCompare(
          String(b.zoneId || b.id || "")
        );
      })[0] || null
  );
}

export function buildEngine26BTargetStopGeometry({
  direction,
  entryZone,
  approvedNegotiatedZones = [],
  tickSize = DEFAULT_TICK_SIZE,
} = {}) {
  const dir = upper(direction);
  const entry = normalizeZone(entryZone);

  if (!["LONG", "SHORT"].includes(dir)) {
    return {
      ready: false,
      status: "DIRECTION_UNAVAILABLE",
      direction: dir || "NEUTRAL",
      entryZone: entry,
      targetZone: null,
      locationInvalidationBoundary: null,
      locationStopReference: null,
      reasonCodes: ["ENGINE26B_TARGET_STOP_DIRECTION_UNAVAILABLE"],
    };
  }

  if (!entry) {
    return {
      ready: false,
      status: "ENTRY_ZONE_UNAVAILABLE",
      direction: dir,
      entryZone: null,
      targetZone: null,
      locationInvalidationBoundary: null,
      locationStopReference: null,
      reasonCodes: ["ENGINE26B_TARGET_STOP_ENTRY_ZONE_UNAVAILABLE"],
    };
  }

  const locationInvalidationBoundary =
    dir === "LONG"
      ? roundToTick(entry.low - tickSize, tickSize)
      : roundToTick(entry.high + tickSize, tickSize);

  const targetZone = selectEngine26BTargetZone({
    direction: dir,
    entryZone: entry,
    approvedNegotiatedZones,
  });

  const target1Price = targetZone
    ? dir === "LONG"
      ? roundToTick(targetZone.low, tickSize)
      : roundToTick(targetZone.high, tickSize)
    : null;

  const target2Price = targetZone
    ? roundToTick(targetZone.midline, tickSize)
    : null;

  const ready =
    locationInvalidationBoundary != null &&
    targetZone != null &&
    target1Price != null &&
    target2Price != null;

  return {
    ready,
    status: ready ? "TARGET_STOP_GEOMETRY_READY" : "TARGET_ZONE_UNAVAILABLE",
    direction: dir,
    entryZone: entry,
    targetZone,
    locationInvalidationBoundary,
    locationStopReference: locationInvalidationBoundary,
    target1Price,
    target2Price,
    target3Price: target2Price,
    tickSize,
    targetSelectionRule:
      dir === "LONG"
        ? "NEAREST_APPROVED_NEGOTIATED_ZONE_COMPLETELY_ABOVE_ENTRY"
        : "NEAREST_APPROVED_NEGOTIATED_ZONE_COMPLETELY_BELOW_ENTRY",
    stopRule:
      dir === "LONG"
        ? "ENTRY_ZONE_LOW_MINUS_ONE_TICK"
        : "ENTRY_ZONE_HIGH_PLUS_ONE_TICK",
    reasonCodes: [
      "ENGINE26B_TARGET_STOP_GEOMETRY_EVALUATED",
      dir === "LONG"
        ? "ENGINE26B_LONG_GEOMETRY_FROM_LOCKED_DIRECTION"
        : "ENGINE26B_SHORT_GEOMETRY_FROM_LOCKED_DIRECTION",
      targetZone
        ? "ENGINE26B_DIRECTIONAL_TARGET_ZONE_SELECTED"
        : "ENGINE26B_DIRECTIONAL_TARGET_ZONE_UNAVAILABLE",
      locationInvalidationBoundary != null
        ? "ENGINE26B_DIRECTIONAL_STOP_CALCULATED"
        : "ENGINE26B_DIRECTIONAL_STOP_UNAVAILABLE",
    ].filter(Boolean),
  };
}

export default buildEngine26BTargetStopGeometry;
