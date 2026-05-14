// services/core/logic/engine3EsReactionQuality.js

function normRange(range) {
  const a = Number(range?.[0]);
  const b = Number(range?.[1]);
  return {
    hi: Math.max(a, b),
    lo: Math.min(a, b),
    mid: (a + b) / 2,
  };
}

function distance(price, level) {
  return Math.abs(Number(price) - Number(level));
}

function clamp(n, lo = 0, hi = 100) {
  return Math.max(lo, Math.min(hi, Math.round(n)));
}

function zonePosition(price, zone) {
  const width = zone.hi - zone.lo || 1;
  const upperBand = zone.hi - width * 0.25;
  const lowerBand = zone.lo + width * 0.25;

  if (price > zone.hi) return "ABOVE_ZONE";
  if (price < zone.lo) return "BELOW_ZONE";
  if (price >= upperBand) return "UPPER_ZONE";
  if (price <= lowerBand) return "LOWER_ZONE";
  return "MIDDLE_ZONE";
}

export function computeEngine3EsReactionQuality({
  price,
  candles = [],
  manualStructures = [],
  shelves = [],
} = {}) {
  const p = Number(price);
  const last = candles[candles.length - 1] || {};
  const close = Number(last.close ?? p);

  const manualZones = manualStructures
    .filter((z) => z?.symbol === "ES" && Array.isArray(z.priceRange))
    .map((z) => {
      const r = normRange(z.priceRange);
      return {
        source: z.isNegotiated ? "ES_MANUAL_NEGOTIATED" : "ES_MANUAL_INSTITUTIONAL",
        type: z.isNegotiated ? "negotiated" : "institutional",
        lo: r.lo,
        hi: r.hi,
        mid: r.mid,
        strength: z.isNegotiated ? 100 : 85,
        notes: z.notes || "",
        structureKey: z.structureKey,
      };
    });

  const shelfZones = shelves.map((z) => ({
    source: "ENGINE_1B_ES_SMZ_SHELVES",
    type: z.type,
    lo: Number(z.lo),
    hi: Number(z.hi),
    mid: Number(z.mid),
    strength: Number(z.strength ?? 70),
    confidence: Number(z.confidence ?? 0),
    reason: z?.diagnostic?.reason || "",
  }));

  const allZones = [...manualZones, ...shelfZones].filter(
    (z) => Number.isFinite(z.lo) && Number.isFinite(z.hi)
  );

  if (!allZones.length || !Number.isFinite(close)) {
    return {
      symbol: "ES",
      zoneSource: "NONE",
      zoneType: "none",
      zone: null,
      reaction: {
        position: "NO_ACTIVE_ZONE",
        state: "NO_ACTIVE_ZONE",
        quality: "NONE",
        qualityScore: 0,
        bias: "NEUTRAL",
        reason: "No ES zone context available.",
      },
      evidence: ["NO_ES_ZONES_AVAILABLE"],
    };
  }

  const selected = allZones
    .map((z) => {
      const inside = close >= z.lo && close <= z.hi;
      const near = Math.min(distance(close, z.lo), distance(close, z.hi), distance(close, z.mid));
      const priority =
        z.source === "ES_MANUAL_NEGOTIATED" ? 300 :
        z.source === "ES_MANUAL_INSTITUTIONAL" ? 200 :
        100;

      return {
        ...z,
        inside,
        near,
        rank: (inside ? 10000 : 0) + priority + Number(z.strength ?? 0) - near,
      };
    })
    .sort((a, b) => b.rank - a.rank)[0];

  const pos = zonePosition(close, selected);
  const evidence = [
    `ZONE_SOURCE_${selected.source}`,
    `ZONE_TYPE_${String(selected.type).toUpperCase()}`,
    `POSITION_${pos}`,
  ];

  let state = "NEUTRAL_CHOP";
  let bias = "NEUTRAL";
  let reason = "ES is chopping near the selected zone.";
  let score = 50;

  if (selected.type === "distribution") {
    if (pos === "ABOVE_ZONE") {
      state = "BREAKING_ABOVE_DISTRIBUTION";
      bias = "BULLISH_ACCEPTANCE";
      reason = "ES is trading above the distribution shelf, showing bullish acceptance above supply.";
      score = 76;
      evidence.push("CLOSE_ABOVE_DISTRIBUTION");
    } else if (pos === "UPPER_ZONE") {
      state = "REJECTING_UPPER_ZONE";
      bias = "BEARISH_REACTION";
      reason = "ES is reacting near the upper part of a distribution shelf.";
      score = 72;
      evidence.push("UPPER_DISTRIBUTION_REACTION");
    } else if (pos === "MIDDLE_ZONE") {
      state = "ACCEPTING_INSIDE_ZONE";
      bias = "NEUTRAL";
      reason = "ES is accepting value inside the distribution shelf.";
      score = 55;
    } else if (pos === "BELOW_ZONE") {
      state = "REJECTED_FROM_DISTRIBUTION";
      bias = "BEARISH_REACTION";
      reason = "ES is below the distribution shelf after rejecting supply.";
      score = 78;
      evidence.push("BELOW_DISTRIBUTION_AFTER_REJECTION");
    }
  } else if (selected.type === "accumulation") {
    if (pos === "BELOW_ZONE") {
      state = "BREAKING_BELOW_ACCUMULATION";
      bias = "BEARISH_ACCEPTANCE";
      reason = "ES is trading below the accumulation shelf, showing bearish acceptance below demand.";
      score = 76;
      evidence.push("CLOSE_BELOW_ACCUMULATION");
    } else if (pos === "LOWER_ZONE") {
      state = "DEFENDING_LOWER_ZONE";
      bias = "BULLISH_REACTION";
      reason = "ES is reacting near the lower part of an accumulation shelf.";
      score = 72;
      evidence.push("LOWER_ACCUMULATION_REACTION");
    } else if (pos === "ABOVE_ZONE") {
      state = "HELD_ACCUMULATION";
      bias = "BULLISH_REACTION";
      reason = "ES is holding above the accumulation shelf.";
      score = 74;
      evidence.push("ABOVE_ACCUMULATION");
    } else {
      state = "ACCEPTING_INSIDE_ZONE";
      bias = "NEUTRAL_TO_BULLISH";
      reason = "ES is accepting value inside the accumulation shelf.";
      score = 60;
    }
  } else if (selected.type === "negotiated") {
    if (pos === "ABOVE_ZONE") {
      state = "BREAKING_ABOVE_NEGOTIATED_VALUE";
      bias = "BULLISH_ACCEPTANCE";
      reason = "ES is trading above manually defined negotiated value.";
      score = 78;
      evidence.push("ABOVE_MANUAL_NEGOTIATED");
    } else if (pos === "BELOW_ZONE") {
      state = "BREAKING_BELOW_NEGOTIATED_VALUE";
      bias = "BEARISH_ACCEPTANCE";
      reason = "ES is trading below manually defined negotiated value.";
      score = 78;
      evidence.push("BELOW_MANUAL_NEGOTIATED");
    } else {
      state = "ACCEPTING_VALUE";
      bias = "NEUTRAL_TO_BULLISH";
      reason = "ES is holding inside manually defined negotiated value.";
      score = 72;
      evidence.push("INSIDE_MANUAL_NEGOTIATED");
    }
  } else if (selected.type === "institutional") {
    if (pos === "ABOVE_ZONE") {
      state = "ABOVE_INSTITUTIONAL_ZONE";
      bias = "BULLISH_ACCEPTANCE";
      reason = "ES is trading above the manual institutional zone.";
      score = 70;
    } else if (pos === "BELOW_ZONE") {
      state = "BELOW_INSTITUTIONAL_ZONE";
      bias = "BEARISH_ACCEPTANCE";
      reason = "ES is trading below the manual institutional zone.";
      score = 70;
    } else {
      state = "INSIDE_INSTITUTIONAL_ZONE";
      bias = "NEUTRAL";
      reason = "ES is inside a broad manual institutional zone.";
      score = 62;
    }
  }

  const quality =
    score >= 75 ? "GOOD" :
    score >= 60 ? "FAIR" :
    score >= 40 ? "CAUTION" :
    "WEAK";

  return {
    symbol: "ES",
    zoneSource: selected.source,
    zoneType: selected.type,
    zone: {
      lo: selected.lo,
      hi: selected.hi,
      mid: selected.mid,
      strength: selected.strength ?? null,
      confidence: selected.confidence ?? null,
      reason: selected.reason ?? null,
      notes: selected.notes ?? null,
      structureKey: selected.structureKey ?? null,
    },
    reaction: {
      position: pos,
      state,
      quality,
      qualityScore: clamp(score),
      bias,
      reason,
    },
    price: close,
    evidence,
  };
}
