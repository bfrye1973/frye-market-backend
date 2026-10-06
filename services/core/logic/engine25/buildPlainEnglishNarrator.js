// services/core/logic/engine25/buildPlainEnglishNarrator.js
// Deterministic Engine25 Plain-English Narrator v1.
//
// READ-ONLY TRANSLATOR:
// - consumes canonical Engine25 / Redline evidence
// - does not recalculate Engine25 scores
// - does not create trade permission
// - does not predict price
// - does not create a new weighted market score

const DIRECTIONS = new Set(["BULLISH", "MIXED", "BEARISH", "UNAVAILABLE"]);
const STRENGTHS = new Set(["WEAK", "MODERATE", "STRONG"]);

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function upper(value) {
  return String(value || "").trim().toUpperCase();
}

function cleanState(value) {
  return String(value || "")
    .replaceAll("_", " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function evidenceItem(label, value, sourcePath) {
  return { label, value: value ?? null, sourcePath };
}

function mapParticipation(participationArtifact) {
  const breadth = participationArtifact?.participation?.breadth || null;
  const label = upper(breadth?.label);
  const p = participationArtifact?.participation || {};

  let direction = "UNAVAILABLE";
  let strength = "WEAK";

  if (label === "BREADTH_PARTICIPATION_HEALTHY") {
    direction = "BULLISH";
    strength = "MODERATE";
  } else if (
    label === "BREADTH_PARTICIPATION_MIXED" ||
    label === "BREADTH_PARTICIPATION_MIXED_WEAKENING"
  ) {
    direction = "MIXED";
    strength = "WEAK";
  } else if (label === "BREADTH_PARTICIPATION_WEAK") {
    direction = "BEARISH";
    strength = "MODERATE";
  }

  return {
    direction,
    strength,
    canonicalState: label || null,
    evidence: [
      evidenceItem(
        "advancingCount",
        p?.upDown?.intradayUp,
        "participationArtifact.participation.upDown.intradayUp"
      ),
      evidenceItem(
        "decliningCount",
        p?.upDown?.intradayDown,
        "participationArtifact.participation.upDown.intradayDown"
      ),
      evidenceItem(
        "newHighs",
        p?.newHighsNewLows?.intradayTotalNh,
        "participationArtifact.participation.newHighsNewLows.intradayTotalNh"
      ),
      evidenceItem(
        "newLows",
        p?.newHighsNewLows?.intradayTotalNl,
        "participationArtifact.participation.newHighsNewLows.intradayTotalNl"
      ),
      evidenceItem(
        "bullishSectors",
        p?.sectorParticipation?.intraday?.bullishCount,
        "participationArtifact.participation.sectorParticipation.intraday.bullishCount"
      ),
      evidenceItem(
        "neutralSectors",
        p?.sectorParticipation?.intraday?.neutralCount,
        "participationArtifact.participation.sectorParticipation.intraday.neutralCount"
      ),
      evidenceItem(
        "bearishSectors",
        p?.sectorParticipation?.intraday?.bearishCount,
        "participationArtifact.participation.sectorParticipation.intraday.bearishCount"
      ),
    ],
  };
}

function mapVolumeDistribution(participationArtifact) {
  const distribution =
    participationArtifact?.participation?.distributionPressure || null;
  const stockVolume =
    participationArtifact?.participation?.stockVolume?.intraday || null;
  const label = upper(distribution?.label);

  let direction = "UNAVAILABLE";
  let strength = "WEAK";

  if (label === "DISTRIBUTION_PRESSURE_LOW") {
    direction = "BULLISH";
    strength = "MODERATE";
  } else if (label === "DISTRIBUTION_PRESSURE_WATCH") {
    direction = "MIXED";
    strength = "WEAK";
  } else if (label === "DISTRIBUTION_PRESSURE_ELEVATED") {
    direction = "BEARISH";
    strength = "MODERATE";
  } else if (label === "DISTRIBUTION_PRESSURE_HIGH") {
    direction = "BEARISH";
    strength = "STRONG";
  }

  return {
    direction,
    strength,
    canonicalState: label || null,
    evidence: [
      evidenceItem(
        "advancingVolume",
        stockVolume?.advancingVolume,
        "participationArtifact.participation.stockVolume.intraday.advancingVolume"
      ),
      evidenceItem(
        "decliningVolume",
        stockVolume?.decliningVolume,
        "participationArtifact.participation.stockVolume.intraday.decliningVolume"
      ),
      evidenceItem(
        "directionalImbalance",
        stockVolume?.volumeImbalance,
        "participationArtifact.participation.stockVolume.intraday.volumeImbalance"
      ),
      evidenceItem(
        "breadthPressure",
        distribution?.inputs?.intradayBreadthPressure,
        "participationArtifact.participation.distributionPressure.inputs.intradayBreadthPressure"
      ),
      evidenceItem(
        "volumePressure",
        participationArtifact?.participation?.stockVolume?.combinedVolumePressure,
        "participationArtifact.participation.stockVolume.combinedVolumePressure"
      ),
      evidenceItem(
        "distributionPressure",
        distribution?.rawPressure,
        "participationArtifact.participation.distributionPressure.rawPressure"
      ),
    ],
  };
}

function classifySectorCombined(label) {
  const state = upper(label);

  if (!state || state.includes("UNAVAILABLE")) {
    return { direction: "UNAVAILABLE", strength: "WEAK" };
  }

  if (state === "SECTOR_BREADTH_EXPANDING_TACTICAL_AND_REGIME") {
    return { direction: "BULLISH", strength: "STRONG" };
  }

  if (
    state === "SECTOR_BREADTH_SUPPORTIVE" ||
    state.includes("RISK_ON")
  ) {
    return { direction: "BULLISH", strength: "MODERATE" };
  }

  if (state === "SECTOR_BREADTH_WEAK_TACTICAL_AND_REGIME") {
    return { direction: "BEARISH", strength: "STRONG" };
  }

  if (
    state === "SECTOR_BREADTH_WEAK" ||
    state.includes("RISK_OFF")
  ) {
    return { direction: "BEARISH", strength: "MODERATE" };
  }

  if (
    state === "TACTICAL_BOUNCE_REGIME_NOT_CONFIRMED" ||
    state === "TACTICAL_DAMAGE_WITH_REGIME_STILL_SUPPORTIVE" ||
    state.includes("MIXED")
  ) {
    return { direction: "MIXED", strength: "WEAK" };
  }

  return { direction: "MIXED", strength: "WEAK" };
}

function mapSectors(sectorBreadth) {
  const combined = sectorBreadth?.combinedRead || null;
  const oneHour = sectorBreadth?.tactical1h || null;
  const fourHour = sectorBreadth?.regime4h || null;
  const eod = sectorBreadth?.latest?.structuralEod || null;

  const mapped = classifySectorCombined(combined?.label);

  return {
    ...mapped,
    combinedState: upper(combined?.label) || null,
    oneHourState: upper(oneHour?.classification?.label) || null,
    fourHourState: upper(fourHour?.classification?.label) || null,
    eodState: upper(eod?.classification?.label) || null,
    evidence: [
      evidenceItem(
        "oneHourStrongSectors",
        oneHour?.groups?.strong || [],
        "sectorBreadth.tactical1h.groups.strong"
      ),
      evidenceItem(
        "oneHourWeakSectors",
        oneHour?.groups?.weak || [],
        "sectorBreadth.tactical1h.groups.weak"
      ),
      evidenceItem(
        "fourHourStrongSectors",
        fourHour?.groups?.strong || [],
        "sectorBreadth.regime4h.groups.strong"
      ),
      evidenceItem(
        "fourHourWeakSectors",
        fourHour?.groups?.weak || [],
        "sectorBreadth.regime4h.groups.weak"
      ),
    ],
  };
}

function severityStrength(severity) {
  const s = upper(severity);
  if (s === "HIGH" || s === "EXTREME") return "STRONG";
  if (s === "MODERATE") return "MODERATE";
  if (s === "LOW") return "WEAK";
  return "WEAK";
}

function mapMacro(intradayMacro, creditStressDetail) {
  const state = upper(intradayMacro?.state);
  let direction = "UNAVAILABLE";

  if (state === "MACRO_SUPPORTIVE") direction = "BULLISH";
  else if (state === "MACRO_NEUTRAL") direction = "MIXED";
  else if (state === "MACRO_HEADWIND" || state === "MACRO_SHOCK") {
    direction = "BEARISH";
  }

  return {
    direction,
    strength: severityStrength(intradayMacro?.severity),
    canonicalState: state || null,
    equityImpact: upper(intradayMacro?.equityImpact) || null,
    severity: upper(intradayMacro?.severity) || null,
    macroShock: intradayMacro?.macroShock === true,
    evidence: [
      evidenceItem(
        "financialState",
        creditStressDetail?.displayLabel,
        "creditStressDetail.displayLabel"
      ),
      evidenceItem(
        "bondsSellingOff",
        creditStressDetail?.warningFlags?.bondsSellingOff,
        "creditStressDetail.warningFlags.bondsSellingOff"
      ),
      evidenceItem(
        "creditSpreadsWidening",
        creditStressDetail?.warningFlags?.creditSpreadsWidening,
        "creditStressDetail.warningFlags.creditSpreadsWidening"
      ),
      evidenceItem(
        "liquidityDeteriorating",
        creditStressDetail?.warningFlags?.liquidityDeteriorating,
        "creditStressDetail.warningFlags.liquidityDeteriorating"
      ),
      evidenceItem(
        "ratesState",
        intradayMacro?.components?.rates?.state,
        "intradayMacro.components.rates.state"
      ),
      evidenceItem(
        "oilState",
        intradayMacro?.components?.oil?.state,
        "intradayMacro.components.oil.state"
      ),
      evidenceItem(
        "wtiSessionPct",
        intradayMacro?.components?.oil?.wti?.changesPct?.session,
        "intradayMacro.components.oil.wti.changesPct.session"
      ),
      evidenceItem(
        "brentSessionPct",
        intradayMacro?.components?.oil?.brent?.changesPct?.session,
        "intradayMacro.components.oil.brent.changesPct.session"
      ),
    ],
  };
}

function mapEsVsBroader(engine25Context, participationArtifact) {
  const es = engine25Context?.marketInternals?.esMarketMeter || null;
  const esScore = finite(es?.masterScore);
  const broaderScore = finite(
    participationArtifact?.participation?.breadth?.score
  );
  const masterState = upper(es?.masterState);

  let relation = "UNAVAILABLE";
  if (esScore !== null && broaderScore !== null) {
    relation =
      esScore > broaderScore
        ? "ES_STRONGER_THAN_BROADER"
        : esScore < broaderScore
          ? "BROADER_STRONGER_THAN_ES"
          : "ALIGNED";
  }

  let direction = "UNAVAILABLE";
  if (masterState === "BULL") direction = "BULLISH";
  else if (masterState === "BEAR") direction = "BEARISH";
  else if (masterState === "NEUTRAL") direction = "MIXED";

  return {
    relation,
    direction,
    strength: direction === "MIXED" ? "WEAK" : "MODERATE",
    esScore,
    broaderScore,
    masterState: masterState || null,
    alignmentState:
      upper(engine25Context?.marketInternals?.alignment?.overall) || null,
  };
}

function mapFreshness(participationArtifact) {
  const freshness = participationArtifact?.freshness || {};
  const state = upper(
    freshness?.intraday?.state || freshness?.state
  ) || "UNAVAILABLE";
  const reason = upper(
    freshness?.intraday?.reason || freshness?.reason
  ) || null;

  return {
    state,
    reason,
    sourceTimestamp:
      freshness?.intraday?.sourceTimestamp ||
      participationArtifact?.sources?.intraday?.sourceTimestamp ||
      null,
    systemOperatingSession:
      freshness?.systemOperatingSession || null,
    equityScannerSession:
      freshness?.equityScannerSession || null,
    usableForTrapConfirmation:
      freshness?.usableForTrapConfirmation === true,
  };
}

function detectConflicts({
  participation,
  volumeDistribution,
  sectors,
  macro,
  esVsBroader,
  freshness,
}) {
  const conflicts = [];

  if (
    participation.direction === "BEARISH" &&
    volumeDistribution.direction === "BULLISH"
  ) {
    conflicts.push({
      code: "WEAK_BREADTH_STRONG_BUYING_VOLUME",
      text:
        "Participation is weak across stocks, but buying volume is providing some support. The internals are mixed rather than uniformly bearish.",
    });
  }

  if (
    esVsBroader.direction === "BULLISH" &&
    participation.direction === "BEARISH"
  ) {
    conflicts.push({
      code: "STRONG_ES_WEAK_BROADER_MARKET",
      text:
        "ES is holding up better than the broader market, while stock participation remains weak. The index strength is not broadly confirmed underneath.",
    });
  }

  if (
    sectors.oneHourState &&
    sectors.fourHourState &&
    (sectors.oneHourState.includes("WEAK") ||
      sectors.oneHourState.includes("RISK_OFF")) &&
    (sectors.fourHourState.includes("EXPANDING") ||
      sectors.fourHourState.includes("RISK_ON"))
  ) {
    conflicts.push({
      code: "WEAK_1H_STRONG_4H",
      text:
        "Short-term sector participation has weakened, while the broader backdrop remains firmer.",
    });
  }

  if (
    sectors.oneHourState &&
    sectors.fourHourState &&
    (sectors.oneHourState.includes("EXPANDING") ||
      sectors.oneHourState.includes("RISK_ON")) &&
    (sectors.fourHourState.includes("WEAK") ||
      sectors.fourHourState.includes("RISK_OFF"))
  ) {
    conflicts.push({
      code: "STRONG_1H_WEAK_4H",
      text:
        "Sector participation improved over the last hour, but the broader 4-hour backdrop has not confirmed that improvement.",
    });
  }

  if (
    participation.direction === "BEARISH" &&
    macro.direction === "BULLISH"
  ) {
    conflicts.push({
      code: "BEARISH_PARTICIPATION_SUPPORTIVE_MACRO",
      text:
        "Stock participation remains defensive even though the macro backdrop is more supportive. The evidence families are not confirming each other.",
    });
  }

  if (
    participation.direction === "BULLISH" &&
    macro.direction === "BEARISH"
  ) {
    conflicts.push({
      code: "BULLISH_PARTICIPATION_MACRO_HEADWIND",
      text:
        "Market participation is constructive, but macro conditions remain a headwind.",
    });
  }

  if (
    freshness.state === "STALE_INTRADAY_SOURCE" &&
    esVsBroader.direction !== "UNAVAILABLE"
  ) {
    conflicts.push({
      code: "STALE_EQUITY_LIVE_ES",
      text:
        "ES is current, but the stock-internals feed should be updating and is stale.",
    });
  }

  if (
    freshness.state === "LAST_VALID_EQUITY_READ" &&
    esVsBroader.direction !== "UNAVAILABLE"
  ) {
    conflicts.push({
      code: "LAST_VALID_EQUITY_LIVE_ES",
      contextOnly: true,
      text:
        "ES is trading, while stock internals reflect the last valid cash-session reading.",
    });
  }

  return conflicts;
}

function confidenceFromFamilies(families, freshness, conflicts) {
  const directional = families.filter((family) =>
    DIRECTIONS.has(family?.direction) && family.direction !== "UNAVAILABLE"
  );

  const usableFamilyCount = directional.length;
  const bullishCount = directional.filter((f) => f.direction === "BULLISH").length;
  const bearishCount = directional.filter((f) => f.direction === "BEARISH").length;
  const mixedCount = directional.filter((f) => f.direction === "MIXED").length;
  const agreementCount = Math.max(bullishCount, bearishCount, mixedCount);
  const contradictionCount = conflicts.filter((c) => c.contextOnly !== true).length;
  const missingFamilyCount = Math.max(0, 5 - usableFamilyCount);
  const clearLean =
    Math.max(bullishCount, bearishCount) >
    Math.max(mixedCount, Math.min(bullishCount, bearishCount));

  let confidence = "LOW";

  if (usableFamilyCount < 2) {
    confidence = "INSUFFICIENT DATA";
  } else if (
    freshness.state === "STALE_INTRADAY_SOURCE"
  ) {
    confidence = "LOW";
  } else if (
    usableFamilyCount >= 4 &&
    agreementCount >= Math.ceil(usableFamilyCount / 2) &&
    contradictionCount === 0 &&
    freshness.state === "FRESH"
  ) {
    confidence = "HIGH";
  } else if (
    usableFamilyCount >= 3 &&
    clearLean &&
    contradictionCount <= 1 &&
    ["FRESH", "LAST_VALID_EQUITY_READ"].includes(freshness.state)
  ) {
    confidence = "MODERATE";
  } else {
    confidence = "LOW";
  }

  return {
    usableFamilyCount,
    agreementCount,
    bullishCount,
    bearishCount,
    mixedCount,
    missingFamilyCount,
    contradictionCount,
    confidence,
  };
}

function number(value) {
  const n = finite(value);
  return n === null ? "unavailable" : n.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function participationSentence(participation) {
  if (participation.direction === "UNAVAILABLE") return null;

  const byLabel = {
    BREADTH_PARTICIPATION_HEALTHY: "Broader stock participation is healthy",
    BREADTH_PARTICIPATION_MIXED: "Broader stock participation is mixed",
    BREADTH_PARTICIPATION_MIXED_WEAKENING:
      "Broader stock participation is mixed but weakening",
    BREADTH_PARTICIPATION_WEAK: "Broader stock participation is weak",
  };

  const advancing = participation.evidence.find((e) => e.label === "advancingCount")?.value;
  const declining = participation.evidence.find((e) => e.label === "decliningCount")?.value;
  const bearishSectors = participation.evidence.find((e) => e.label === "bearishSectors")?.value;

  return `${byLabel[participation.canonicalState] || "Broader stock participation is mixed"}, with ${number(advancing)} advancing versus ${number(declining)} declining and ${number(bearishSectors)} sectors classified bearish.`;
}

function volumeSentence(volumeDistribution) {
  if (volumeDistribution.direction === "UNAVAILABLE") return null;

  const imbalance = finite(
    volumeDistribution.evidence.find((e) => e.label === "directionalImbalance")?.value
  );

  let lean = "balanced";
  if (imbalance !== null) {
    if (imbalance > 0) lean = "toward selling";
    else if (imbalance < 0) lean = "toward buying";
  }

  const pressureLabel = {
    DISTRIBUTION_PRESSURE_LOW: "low",
    DISTRIBUTION_PRESSURE_WATCH: "on watch",
    DISTRIBUTION_PRESSURE_ELEVATED: "elevated",
    DISTRIBUTION_PRESSURE_HIGH: "high",
  }[volumeDistribution.canonicalState] || "unavailable";

  return `Directional stock volume is leaning ${lean}, while Distribution Pressure is ${pressureLabel}.`;
}

function sectorsEsSentence(sectors, esVsBroader) {
  const parts = [];

  if (sectors.combinedState) {
    const map = {
      TACTICAL_BOUNCE_REGIME_NOT_CONFIRMED:
        "Sector participation has improved tactically, but the 4-hour regime has not confirmed it",
      TACTICAL_DAMAGE_WITH_REGIME_STILL_SUPPORTIVE:
        "Short-term sector participation is damaged while the broader regime remains supportive",
      SECTOR_BREADTH_WEAK_TACTICAL_AND_REGIME:
        "Sector participation is weak on both the 1-hour and 4-hour views",
      SECTOR_BREADTH_EXPANDING_TACTICAL_AND_REGIME:
        "Sector participation is expanding on both the 1-hour and 4-hour views",
      SECTOR_CARD_BREADTH_MIXED:
        "Sector participation is mixed across the 1-hour and 4-hour views",
      SECTOR_BREADTH_MIXED:
        "Sector participation is mixed across the 1-hour and 4-hour views",
      SECTOR_BREADTH_SUPPORTIVE:
        "Sector participation is supportive across the combined 1-hour and 4-hour read",
      SECTOR_BREADTH_WEAK:
        "Sector participation is weak across the combined 1-hour and 4-hour read",
    };
    parts.push(map[sectors.combinedState] || `Sector participation is ${cleanState(sectors.combinedState)}`);
  }

  if (esVsBroader.relation === "ES_STRONGER_THAN_BROADER") {
    parts.push("ES is holding up better than the broader market");
  } else if (esVsBroader.relation === "BROADER_STRONGER_THAN_ES") {
    parts.push("the broader market is stronger than ES");
  } else if (esVsBroader.relation === "ALIGNED") {
    parts.push("ES and the broader market are aligned");
  }

  if (!parts.length) return null;
  return `${parts.join("; ")}.`;
}

function macroSentence(macro) {
  if (macro.direction === "UNAVAILABLE") return null;

  const map = {
    MACRO_SUPPORTIVE: "Macro conditions are supportive",
    MACRO_NEUTRAL: "Macro conditions are neutral",
    MACRO_HEADWIND: "Macro conditions are a headwind",
    MACRO_SHOCK:
      "Macro conditions are a strong headwind, with multiple cross-market signals confirming the pressure",
  };

  return `${map[macro.canonicalState] || "Macro conditions are mixed"}.`;
}

function freshnessSentence(freshness, confidence, conflicts) {
  let lead = "Current stock-internals confirmation is unavailable.";

  if (freshness.state === "FRESH") {
    lead = "Equity internals are current.";
  } else if (freshness.state === "LAST_VALID_EQUITY_READ") {
    lead =
      "ES is trading, while stock internals reflect the last valid cash-session reading.";
  } else if (freshness.state === "STALE_INTRADAY_SOURCE") {
    lead =
      "ES is current, but the stock-internals feed should be updating and is stale.";
  }

  const contradictionCount = conflicts.filter((c) => c.contextOnly !== true).length;
  const consistency =
    contradictionCount === 0
      ? "The available evidence is broadly consistent"
      : contradictionCount === 1
        ? "The evidence has one meaningful contradiction"
        : "The evidence contains multiple contradictions";

  return `${lead} ${consistency}, so narrator confidence is ${confidence.toLowerCase()}.`;
}

export function buildEngine25NarratorEvidence({
  participationArtifact,
  sectorBreadth,
  creditStressDetail,
  intradayMacro,
  engine25Context,
} = {}) {
  const participation = mapParticipation(participationArtifact);
  const volumeDistribution = mapVolumeDistribution(participationArtifact);
  const sectors = mapSectors(sectorBreadth);
  const macro = mapMacro(intradayMacro, creditStressDetail);
  const esVsBroader = mapEsVsBroader(engine25Context, participationArtifact);
  const freshness = mapFreshness(participationArtifact);

  const conflicts = detectConflicts({
    participation,
    volumeDistribution,
    sectors,
    macro,
    esVsBroader,
    freshness,
  });

  const confidenceMeta = confidenceFromFamilies(
    [participation, volumeDistribution, sectors, macro, esVsBroader],
    freshness,
    conflicts
  );

  return {
    participation,
    volumeDistribution,
    sectors,
    macro,
    esVsBroader,
    freshness,
    conflicts,
    usableFamilyCount: confidenceMeta.usableFamilyCount,
    agreementCount: confidenceMeta.agreementCount,
    contradictionCount: confidenceMeta.contradictionCount,
    missingFamilyCount: confidenceMeta.missingFamilyCount,
    confidence: confidenceMeta.confidence,
    diagnostics: {
      bullishFamilyCount: confidenceMeta.bullishCount,
      bearishFamilyCount: confidenceMeta.bearishCount,
      mixedFamilyCount: confidenceMeta.mixedCount,
    },
  };
}

export function buildEngine25PlainEnglishNarrator(input = {}) {
  const narratorEvidence = buildEngine25NarratorEvidence(input);

  const sentences = [
    participationSentence(narratorEvidence.participation),
    volumeSentence(narratorEvidence.volumeDistribution),
    sectorsEsSentence(narratorEvidence.sectors, narratorEvidence.esVsBroader),
    macroSentence(narratorEvidence.macro),
    freshnessSentence(
      narratorEvidence.freshness,
      narratorEvidence.confidence,
      narratorEvidence.conflicts
    ),
  ].filter(Boolean);

  return {
    engine: "engine25.plainEnglishNarrator.v1",
    modelType: "DETERMINISTIC_CANONICAL_EVIDENCE_TRANSLATOR",
    generatedAtUtc: new Date().toISOString(),
    readOnly: true,
    predictive: false,
    createsTradingSignal: false,
    narratorEvidence,
    sentences: sentences.slice(0, 5),
    text: sentences.slice(0, 5).join(" "),
  };
}

export default {
  buildEngine25NarratorEvidence,
  buildEngine25PlainEnglishNarrator,
};
