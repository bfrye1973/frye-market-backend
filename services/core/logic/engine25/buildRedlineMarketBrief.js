// services/core/logic/engine25/buildRedlineMarketBrief.js
// Redline Current Market Brief + Intraday Brief v1.
//
// READ ONLY:
// - consumes canonical Redline / Engine25 / Engine26 / Engine29 evidence
// - explains how evidence fits together
// - does not create a new trading signal, permission, score, or prediction

function finite(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function upper(v) {
  return String(v || "").trim().toUpperCase();
}

function clean(v) {
  return String(v || "").replaceAll("_", " ").replace(/\s+/g, " ").trim();
}

function fmt(v, digits = 0) {
  const n = finite(v);
  if (n === null) return null;
  return n.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function pctFromFraction(v, digits = 1) {
  const n = finite(v);
  return n === null ? null : `${(n * 100).toFixed(digits)}%`;
}

function sentence(parts = []) {
  const text = parts.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  if (!text) return null;
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

function readEvidence(participationArtifact) {
  const p = participationArtifact?.participation || {};
  return {
    breadth: p?.breadth || null,
    up: finite(p?.upDown?.intradayUp),
    down: finite(p?.upDown?.intradayDown),
    nh: finite(p?.newHighsNewLows?.intradayTotalNh),
    nl: finite(p?.newHighsNewLows?.intradayTotalNl),
    netNhNl: finite(p?.newHighsNewLows?.intradayNetHighsLows),
    sector: p?.sectorParticipation?.intraday || null,
    volume: p?.stockVolume?.intraday || null,
    distribution: p?.distributionPressure || null,
    freshness:
      participationArtifact?.freshness?.intraday ||
      participationArtifact?.freshness ||
      null,
  };
}

function breadthSection(e) {
  const label = upper(e?.breadth?.label);
  if (!label) return null;

  const direction =
    label === "BREADTH_PARTICIPATION_HEALTHY"
      ? "healthy"
      : label === "BREADTH_PARTICIPATION_WEAK"
        ? "weak"
        : label === "BREADTH_PARTICIPATION_MIXED_WEAKENING"
          ? "mixed but weakening"
          : "mixed";

  const counts =
    e.up !== null && e.down !== null
      ? `${fmt(e.up)} stocks are advancing versus ${fmt(e.down)} declining`
      : null;

  const leadership =
    e.nh !== null && e.nl !== null
      ? `New highs are ${fmt(e.nh)} versus ${fmt(e.nl)} new lows`
      : null;

  const sectors =
    e?.sector &&
    [
      e.sector.bullishCount,
      e.sector.neutralCount,
      e.sector.bearishCount,
    ].every((v) => finite(v) !== null)
      ? `Sector participation is ${e.sector.bullishCount} bullish, ${e.sector.neutralCount} neutral, and ${e.sector.bearishCount} bearish`
      : null;

  return {
    key: "breadth",
    title: "Breadth / participation",
    canonicalState: label,
    text: sentence([
      `Broader stock participation is ${direction}.`,
      counts ? `${counts}.` : null,
      leadership ? `${leadership}.` : null,
      sectors ? `${sectors}.` : null,
    ]),
  };
}

function volumeSection(e) {
  const v = e?.volume || null;
  const d = e?.distribution || null;
  const dLabel = upper(d?.label);
  const imbalance = finite(v?.volumeImbalance);

  if (!dLabel && imbalance === null) return null;

  let lean = "balanced";
  if (imbalance !== null && imbalance > 0) lean = "toward sellers";
  else if (imbalance !== null && imbalance < 0) lean = "toward buyers";

  const distributionLabel = {
    DISTRIBUTION_PRESSURE_LOW: "low",
    DISTRIBUTION_PRESSURE_WATCH: "on watch",
    DISTRIBUTION_PRESSURE_ELEVATED: "elevated",
    DISTRIBUTION_PRESSURE_HIGH: "high",
  }[dLabel] || clean(dLabel).toLowerCase();

  const breadthWeak = upper(e?.breadth?.label) === "BREADTH_PARTICIPATION_WEAK";
  const breadthHealthy =
    upper(e?.breadth?.label) === "BREADTH_PARTICIPATION_HEALTHY";

  let confirmation = null;
  if (breadthWeak && imbalance !== null && imbalance > 0) {
    confirmation =
      "Volume is confirming the weak breadth. This is not just more stocks declining than advancing; actual directional volume is also leaning toward sellers.";
  } else if (breadthHealthy && imbalance !== null && imbalance < 0) {
    confirmation =
      "Volume is confirming the stronger breadth. This is not just more stocks advancing than declining; actual directional volume is also leaning toward buyers.";
  } else if (imbalance !== null) {
    confirmation =
      "Breadth and directional volume are not fully aligned, so the internals are mixed rather than giving one clean confirmation.";
  }

  const adv = finite(v?.advancingVolume);
  const dec = finite(v?.decliningVolume);

  return {
    key: "volumeDistribution",
    title: "Volume / distribution",
    canonicalState: dLabel || null,
    text: sentence([
      confirmation,
      adv !== null && dec !== null
        ? `Advancing volume is about ${fmt(adv)} versus ${fmt(dec)} declining volume.`
        : null,
      imbalance !== null
        ? `The directional-volume imbalance is ${pctFromFraction(Math.abs(imbalance))} ${lean}.`
        : null,
      dLabel ? `Distribution Pressure is ${distributionLabel}.` : null,
    ]),
  };
}

function sectorStateText(tf, layer) {
  const label = upper(layer?.classification?.label);
  const groups = layer?.groups || {};
  if (!label && layer?.available !== true) return null;

  const counts =
    Array.isArray(groups.strong) &&
    Array.isArray(groups.neutral) &&
    Array.isArray(groups.weak)
      ? `${groups.strong.length} strong, ${groups.neutral.length} neutral, ${groups.weak.length} weak`
      : null;

  const readable =
    label.includes("EXPANDING") || label.includes("RISK_ON")
      ? "constructive"
      : label.includes("WEAK") || label.includes("RISK_OFF")
        ? "weak"
        : "mixed";

  return {
    timeframe: tf,
    state: label || null,
    text: counts
      ? `The ${tf} sector read is ${readable}: ${counts}.`
      : `The ${tf} sector read is ${readable}.`,
  };
}

function sectorSection(sectorBreadth) {
  const one = sectorStateText("1-hour", sectorBreadth?.tactical1h);
  const four = sectorStateText("4-hour", sectorBreadth?.regime4h);
  const eod = sectorStateText("EOD", sectorBreadth?.latest?.structuralEod);
  const combined = upper(sectorBreadth?.combinedRead?.label);

  if (!one && !four && !eod && !combined) return null;

  const conflictText = {
    TACTICAL_BOUNCE_REGIME_NOT_CONFIRMED:
      "Short-term sector participation has improved, but the 4-hour regime has not confirmed that improvement yet.",
    TACTICAL_DAMAGE_WITH_REGIME_STILL_SUPPORTIVE:
      "Short-term sector participation has weakened while the broader 4-hour regime remains firmer.",
    SECTOR_BREADTH_WEAK_TACTICAL_AND_REGIME:
      "The 1-hour and 4-hour sector layers are both weak, so the short-term damage is confirmed by the broader regime.",
    SECTOR_BREADTH_EXPANDING_TACTICAL_AND_REGIME:
      "The 1-hour and 4-hour sector layers are both constructive, so sector participation is broadly aligned.",
    SECTOR_CARD_BREADTH_MIXED:
      "The combined 1-hour and 4-hour sector picture is mixed rather than broadly directional.",
  }[combined] || null;

  return {
    key: "sectorTimeframes",
    title: "1H / 4H / EOD sectors",
    canonicalState: combined || null,
    evidence: { oneHour: one, fourHour: four, eod },
    text: sentence([
      one?.text,
      four?.text,
      eod?.text,
      conflictText,
    ]),
  };
}

function esVsBroaderSection(narratorEvidence) {
  const rel = narratorEvidence?.esVsBroader?.relation;
  const es = finite(narratorEvidence?.esVsBroader?.esScore);
  const broader = finite(narratorEvidence?.esVsBroader?.broaderScore);

  if (!rel || rel === "UNAVAILABLE") return null;

  const wording = {
    ES_STRONGER_THAN_BROADER:
      "ES is holding up better than the broader market, so headline-index strength is not being fully confirmed underneath.",
    BROADER_STRONGER_THAN_ES:
      "The broader market is stronger than ES, so underlying participation is healthier than the headline index.",
    ALIGNED:
      "ES and the broader market are aligned rather than showing a meaningful sign difference.",
  }[rel];

  return {
    key: "esVsBroader",
    title: "ES versus the market underneath",
    canonicalState: rel,
    text: sentence([
      wording,
      es !== null && broader !== null
        ? `ES strength is ${es.toFixed(1)} versus ${broader.toFixed(1)} for the broader-market read.`
        : null,
    ]),
  };
}

function macroSection({ intradayMacro, creditStressDetail, macroPressure }) {
  const macroState = upper(intradayMacro?.state);
  const pressureLabel = upper(macroPressure?.label);
  const rates = intradayMacro?.components?.rates || {};
  const oil = intradayMacro?.components?.oil || {};
  const wti = oil?.wti || {};
  const brent = oil?.brent || {};
  const slow = rates?.slowContext || {};
  const uup = macroPressure?.inputs?.UUP || null;

  const ten = finite(slow?.tenYearYield ?? macroPressure?.diagnostics?.DGS10);
  const thirty = finite(slow?.thirtyYearYield);
  const uupValue = finite(uup?.close ?? uup?.value);
  const wtiPrice = finite(wti?.price);
  const brentPrice = finite(brent?.price);

  const macroWord = {
    MACRO_SUPPORTIVE: "supportive",
    MACRO_NEUTRAL: "neutral",
    MACRO_HEADWIND: "a headwind",
    MACRO_SHOCK: "a strong cross-market headwind",
  }[macroState] || "mixed";

  const freshness = upper(intradayMacro?.freshness?.status);
  const staleNote =
    freshness && freshness !== "FRESH"
      ? "Some macro inputs are not fresh enough to claim a current direction, so stale levels are treated as context only."
      : null;

  const oilText =
    wtiPrice !== null || brentPrice !== null
      ? `Oil remains important: WTI is ${wtiPrice !== null ? wtiPrice.toFixed(2) : "unavailable"} and Brent is ${brentPrice !== null ? brentPrice.toFixed(2) : "unavailable"}.`
      : null;

  const rateText =
    ten !== null || thirty !== null
      ? `The latest available Treasury yields are ${ten !== null ? ten.toFixed(2) + "% on the 10-year" : "10-year unavailable"} and ${thirty !== null ? thirty.toFixed(2) + "% on the 30-year" : "30-year unavailable"}.`
      : null;

  const dollarText =
    uupValue !== null
      ? `The U.S. dollar proxy UUP is ${uupValue.toFixed(2)}.`
      : null;

  return {
    key: "financialMacro",
    title: "Financial stress / rates / dollar / oil",
    canonicalState: macroState || pressureLabel || null,
    text: sentence([
      `Macro conditions are ${macroWord}.`,
      pressureLabel ? `Engine25 Macro Pressure is ${clean(pressureLabel).toLowerCase()}.` : null,
      creditStressDetail?.interpretation || null,
      rateText,
      dollarText,
      oilText,
      staleNote,
    ]),
  };
}

function eventTime(event) {
  return (
    event?.latestDevelopmentAt ||
    event?.observedAt ||
    event?.publishedAt ||
    event?.createdAt ||
    null
  );
}

function activeEvents(newsEvents, intradayMacro) {
  const raw = [
    ...(Array.isArray(intradayMacro?.newsEvents?.activeMaterialEvents)
      ? intradayMacro.newsEvents.activeMaterialEvents
      : []),
    ...(Array.isArray(newsEvents?.events) ? newsEvents.events : []),
    ...(Array.isArray(newsEvents?.activeEvents) ? newsEvents.activeEvents : []),
  ];

  const seen = new Set();
  return raw
    .filter((e) => e && e.material !== false)
    .filter((e) => {
      const id = [
        e?.eventType,
        e?.primaryEntity,
        e?.headlineSummary,
        eventTime(e),
      ].join("|");
      if (seen.has(id)) return false;
      seen.add(id);
      return true;
    })
    .sort(
      (a, b) =>
        (Date.parse(eventTime(b) || "") || 0) -
        (Date.parse(eventTime(a) || "") || 0)
    );
}

function geopoliticalSection(newsEvents, intradayMacro) {
  const events = activeEvents(newsEvents, intradayMacro)
    .filter((e) =>
      [
        "GEOPOLITICAL_ESCALATION",
        "GEOPOLITICAL_OIL_SUPPLY_RISK",
        "ENERGY_SUPPLY_EVENT",
        "TREASURY_RATES_RISK",
        "FED_POLICY_EVENT",
        "FINANCIAL_STRESS_EVENT",
        "TRADE_POLICY_RISK",
      ].includes(upper(e?.eventType))
    )
    .slice(0, 4);

  if (!events.length) {
    return {
      key: "overnightEvents",
      title: "Overnight / geopolitical events",
      canonicalState: "NO_ACTIVE_MATERIAL_EVENT",
      text:
        "No active material geopolitical, energy-supply, Treasury, Fed-policy, financial-stress, or trade-policy event is currently available in the canonical Engine25 event stack.",
    };
  }

  const lines = events.map((e) => {
    const headline =
      e?.headlineSummary ||
      e?.headline ||
      e?.title ||
      clean(e?.eventType);
    const entity = e?.primaryEntity ? ` (${e.primaryEntity})` : "";
    const severity = upper(e?.severity);
    const reaction = e?.reactionState ? ` Market reaction: ${clean(e.reactionState)}.` : "";
    return `${headline}${entity}${severity ? ` — ${severity} severity.` : "."}${reaction}`;
  });

  return {
    key: "overnightEvents",
    title: "Overnight / geopolitical events",
    canonicalState: "ACTIVE_MATERIAL_EVENTS",
    events: events.map((e) => ({
      eventType: e?.eventType || null,
      primaryEntity: e?.primaryEntity || null,
      severity: e?.severity || null,
      headlineSummary: e?.headlineSummary || e?.headline || e?.title || null,
      observedAt: e?.observedAt || null,
      latestDevelopmentAt: e?.latestDevelopmentAt || null,
      reactionState: e?.reactionState || null,
    })),
    text: lines.join(" "),
  };
}

function zoneBounds(zone) {
  const lo = finite(zone?.lo ?? zone?.low ?? zone?.zoneLow);
  const hi = finite(zone?.hi ?? zone?.high ?? zone?.zoneHigh);
  if (lo === null || hi === null) return null;
  return { lo: Math.min(lo, hi), hi: Math.max(lo, hi) };
}

function distanceToBounds(price, b) {
  if (price === null || !b) return null;
  if (price < b.lo) return b.lo - price;
  if (price > b.hi) return price - b.hi;
  return 0;
}

function engine26Candidate(strategySnapshot) {
  return (
    strategySnapshot?.strategies?.["intraday_scalp@10m"]?.engine26LocationCandidate ||
    strategySnapshot?.engine26LocationCandidate ||
    null
  );
}

function locationSection(strategySnapshot) {
  const c = engine26Candidate(strategySnapshot);
  if (!c) {
    return {
      key: "esLocation",
      title: "ES location / negotiated value",
      canonicalState: "UNAVAILABLE",
      text: "Engine26 negotiated-zone location is currently unavailable.",
    };
  }

  const price = finite(c?.currentPrice);
  const inventory = Array.isArray(c?.approvedNegotiatedZoneInventory)
    ? c.approvedNegotiatedZoneInventory
    : [];
  const candidates = inventory
    .map((zone) => ({ zone, bounds: zoneBounds(zone) }))
    .filter((x) => x.bounds)
    .map((x) => ({
      ...x,
      distance: distanceToBounds(price, x.bounds),
    }))
    .sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity));

  const nearest = candidates[0] || null;
  const above = candidates
    .filter((x) => price !== null && x.bounds.lo > price)
    .sort((a, b) => a.bounds.lo - b.bounds.lo)[0] || null;
  const below = candidates
    .filter((x) => price !== null && x.bounds.hi < price)
    .sort((a, b) => b.bounds.hi - a.bounds.hi)[0] || null;

  const relation =
    nearest && price !== null
      ? price < nearest.bounds.lo
        ? "below"
        : price > nearest.bounds.hi
          ? "above"
          : "inside"
      : null;

  const zoneText =
    nearest && price !== null
      ? relation === "inside"
        ? `ES is ${price.toFixed(2)} and is inside the nearest negotiated zone at ${nearest.bounds.lo.toFixed(2)}–${nearest.bounds.hi.toFixed(2)}.`
        : `ES is ${price.toFixed(2)}, ${nearest.distance.toFixed(2)} points ${relation} the nearest negotiated zone at ${nearest.bounds.lo.toFixed(2)}–${nearest.bounds.hi.toFixed(2)}.`
      : price !== null
        ? `ES is ${price.toFixed(2)}, but a negotiated-zone inventory is not currently available.`
        : "Current ES price is unavailable in Engine26.";

  const nextText = sentence([
    above
      ? `The nearest negotiated zone above is ${above.bounds.lo.toFixed(2)}–${above.bounds.hi.toFixed(2)}.`
      : null,
    below
      ? `The nearest negotiated zone below is ${below.bounds.lo.toFixed(2)}–${below.bounds.hi.toFixed(2)}.`
      : null,
    c?.directionState
      ? `Engine26 location state is ${clean(c.directionState).toLowerCase()}.`
      : null,
  ]);

  return {
    key: "esLocation",
    title: "ES location / negotiated value",
    canonicalState: c?.directionState || c?.contactState || null,
    currentPrice: price,
    nearestZone: nearest?.bounds || null,
    nearestAbove: above?.bounds || null,
    nearestBelow: below?.bounds || null,
    relation,
    text: sentence([zoneText, nextText]),
  };
}

function engine29Section(engine29) {
  if (!engine29) return null;

  const character =
    engine29?.moveCharacter?.moveCharacter ||
    engine29?.moveCharacter ||
    null;
  const direction =
    engine29?.moveCharacter?.direction ||
    engine29?.moveDirection ||
    null;
  const confidence =
    engine29?.moveCharacter?.confidence ||
    engine29?.moveConfidence ||
    null;
  const pressure =
    engine29?.moveCharacter?.underlyingPressure?.state ||
    engine29?.display?.underTheHood?.pressure?.state ||
    engine29?.underlyingPressure ||
    null;

  const pieces = [
    character ? `Engine29 classifies the current move as ${clean(character).toLowerCase()}.` : null,
    direction ? `The move direction is ${clean(direction).toLowerCase()}.` : null,
    confidence ? `Engine29 confidence is ${clean(confidence).toLowerCase()}.` : null,
    pressure ? `Underlying cross-market pressure is ${clean(pressure).toLowerCase()}.` : null,
    engine29?.dataDegraded === true
      ? "Engine29 data quality is degraded, so the move-character read should be treated cautiously."
      : null,
  ];

  return {
    key: "engine29",
    title: "Engine29 live market character",
    canonicalState: character || engine29?.overallState || null,
    text: sentence(pieces),
  };
}

function esMeterSection(engine25Context) {
  const m = engine25Context?.marketInternals?.esMarketMeter || {};
  const tfs = m?.timeframes || {};

  const parts = ["10m", "30m", "1h"].map((tf) => {
    const key =
      tf === "10m" ? "tenMinute" : tf === "30m" ? "thirtyMinute" : "oneHour";
    const layer = tfs?.[key] || null;
    const score = finite(layer?.score);
    const state = layer?.state || null;
    return score !== null || state
      ? `${tf}: ${score !== null ? score.toFixed(1) : "score unavailable"}${state ? ` (${clean(state)})` : ""}`
      : null;
  }).filter(Boolean);

  if (!parts.length) return null;

  return {
    key: "esMeter",
    title: "ES intraday price action",
    canonicalState: m?.masterState || null,
    text: `ES Market Meter — ${parts.join(", ")}.`,
  };
}

function bottomLine({
  narratorEvidence,
  macro,
  location,
  engine29,
  freshness,
}) {
  const dirs = [
    narratorEvidence?.participation?.direction,
    narratorEvidence?.volumeDistribution?.direction,
    narratorEvidence?.sectors?.direction,
    narratorEvidence?.macro?.direction,
  ].filter(Boolean);

  const bearish = dirs.filter((x) => x === "BEARISH").length;
  const bullish = dirs.filter((x) => x === "BULLISH").length;

  let tone = "mixed";
  if (bearish > bullish && bearish >= 2) tone = "defensive underneath";
  else if (bullish > bearish && bullish >= 2) tone = "constructive underneath";

  const freshnessState = upper(freshness?.state);
  const currentness =
    freshnessState === "LAST_VALID_EQUITY_READ"
      ? "Equity internals are the last valid cash-session context, not current confirmation."
      : freshnessState === "STALE_INTRADAY_SOURCE"
        ? "Equity internals are stale and should not be treated as current confirmation."
        : freshnessState === "FRESH"
          ? "Equity internals are current."
          : null;

  return sentence([
    `Overall, Redline currently reads the market as ${tone}.`,
    engine29?.canonicalState
      ? `Engine29 is reading the active move as ${clean(engine29.canonicalState).toLowerCase()}.`
      : null,
    macro?.canonicalState
      ? `The macro backdrop is ${clean(macro.canonicalState).toLowerCase()}.`
      : null,
    location?.relation && location?.nearestZone
      ? `ES is ${location.relation} its nearest negotiated zone.`
      : null,
    currentness,
  ]);
}

export function buildRedlineCurrentMarketBrief({
  participationArtifact,
  sectorBreadth,
  narratorEvidence,
  creditStressDetail,
  intradayMacro,
  macroPressure,
  newsEvents,
  engine25Context,
  strategySnapshot,
  engine29,
} = {}) {
  const evidence = readEvidence(participationArtifact);
  const breadth = breadthSection(evidence);
  const volume = volumeSection(evidence);
  const sectors = sectorSection(sectorBreadth);
  const esVsBroader = esVsBroaderSection(narratorEvidence);
  const macro = macroSection({
    intradayMacro,
    creditStressDetail,
    macroPressure,
  });
  const events = geopoliticalSection(newsEvents, intradayMacro);
  const location = locationSection(strategySnapshot);
  const e29 = engine29Section(engine29);

  const sections = [
    breadth,
    volume,
    sectors,
    esVsBroader,
    macro,
    events,
    location,
  ].filter(Boolean);

  const conclusion = bottomLine({
    narratorEvidence,
    macro,
    location,
    engine29: e29,
    freshness: evidence.freshness,
  });

  return {
    engine: "redline.currentMarketBrief.v1",
    mode: "CURRENT_MARKET",
    readOnly: true,
    predictive: false,
    createsTradingSignal: false,
    generatedAtUtc: new Date().toISOString(),
    sections,
    conclusion,
    paragraphs: [
      ...sections.map((s) => s.text).filter(Boolean),
      conclusion,
    ].filter(Boolean),
  };
}

export function buildRedlineIntradayBrief({
  participationArtifact,
  sectorBreadth,
  narratorEvidence,
  creditStressDetail,
  intradayMacro,
  macroPressure,
  newsEvents,
  engine25Context,
  strategySnapshot,
  engine29,
} = {}) {
  const evidence = readEvidence(participationArtifact);
  const meter = esMeterSection(engine25Context);
  const breadth = breadthSection(evidence);
  const volume = volumeSection(evidence);
  const sectors = sectorSection(sectorBreadth);
  const e29 = engine29Section(engine29);
  const esVsBroader = esVsBroaderSection(narratorEvidence);
  const macro = macroSection({
    intradayMacro,
    creditStressDetail,
    macroPressure,
  });
  const events = geopoliticalSection(newsEvents, intradayMacro);
  const location = locationSection(strategySnapshot);

  const sections = [
    meter,
    e29,
    breadth,
    volume,
    sectors,
    esVsBroader,
    macro,
    events,
    location,
  ].filter(Boolean);

  const conclusion = bottomLine({
    narratorEvidence,
    macro,
    location,
    engine29: e29,
    freshness: evidence.freshness,
  });

  return {
    engine: "redline.intradayBrief.v1",
    mode: "INTRADAY",
    readOnly: true,
    predictive: false,
    createsTradingSignal: false,
    generatedAtUtc: new Date().toISOString(),
    sections,
    conclusion,
    paragraphs: [
      ...sections.map((s) => s.text).filter(Boolean),
      conclusion,
    ].filter(Boolean),
  };
}

export default {
  buildRedlineCurrentMarketBrief,
  buildRedlineIntradayBrief,
};
