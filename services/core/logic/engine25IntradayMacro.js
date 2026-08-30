// services/core/logic/engine25IntradayMacro.js
// Engine 25 Intraday Macro v0.2 — Finlight canonical event handoff
// Pure classification/normalization logic. No provider calls, no trade permission.

export const INTRADAY_MACRO_ENGINE = "engine25.intradayMacro.v0.2";

export const MACRO_STATES = Object.freeze([
  "MACRO_SUPPORTIVE",
  "MACRO_NEUTRAL",
  "MACRO_HEADWIND",
  "MACRO_SHOCK",
]);

export const EQUITY_IMPACTS = Object.freeze([
  "EQUITY_SUPPORTIVE",
  "EQUITY_NEGATIVE",
  "MIXED",
  "NEUTRAL",
]);

export const SEVERITIES = Object.freeze(["LOW", "MODERATE", "HIGH", "EXTREME"]);

export const EVENT_STATES = Object.freeze([
  "EVENT_DETECTED",
  "EVENT_CONFIRMED",
  "REACTION_HOLDING",
  "REACTION_FADING",
  "REACTION_FAILED",
  "EVENT_EXPIRED",
]);

// Research thresholds only. These do not modify legacy Engine 25 scoring.
export const RESEARCH_THRESHOLDS = Object.freeze({
  tlt: {
    warning10mPct: -0.35,
    warning30mPct: -0.5,
    strong60mPct: -0.75,
    supportive30mPct: 0.35,
  },
  oil: {
    // Short-window velocity thresholds.
    warning30mPct: 1.0,
    strong30mPct: 1.5,
    shock30mPct: 2.0,
    shock60mPct: 3.0,
    supportive30mPct: -1.0,

    // Full-session magnitude thresholds.
    // These prevent a material all-day oil move from being labeled NEUTRAL
    // simply because the last 30 minutes are quiet.
    warningSessionPct: 1.0,
    strongSessionPct: 1.5,
    shockSessionPct: 3.0,
    supportiveSessionPct: -1.0,
  },
  treasuryProxy: {
    // Futures prices move opposite yields. Values are percentage changes in futures price.
    warning10mPct: -0.08,
    warning30mPct: -0.15,
    strong30mPct: -0.25,
    supportive30mPct: 0.15,
  },
});

function num(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function round(v, digits = 4) {
  const n = num(v);
  if (n === null) return null;
  const p = 10 ** digits;
  return Math.round(n * p) / p;
}

export function pctChange(current, prior, digits = 4) {
  const c = num(current);
  const p = num(prior);
  if (c === null || p === null || p === 0) return null;
  return round(((c - p) / p) * 100, digits);
}

function barClose(bar) {
  return num(bar?.close ?? bar?.c);
}

function barTime(bar) {
  return num(bar?.time ?? bar?.t);
}

export function normalizeBars(bars = []) {
  const seen = new Map();
  for (const bar of Array.isArray(bars) ? bars : []) {
    const time = barTime(bar);
    const close = barClose(bar);
    if (time === null || close === null) continue;
    seen.set(time, {
      time,
      open: num(bar?.open ?? bar?.o),
      high: num(bar?.high ?? bar?.h),
      low: num(bar?.low ?? bar?.l),
      close,
      volume: num(bar?.volume ?? bar?.v) ?? 0,
    });
  }
  return [...seen.values()].sort((a, b) => a.time - b.time);
}

function closeAtOrBefore(bars, targetSec) {
  let found = null;
  for (const bar of bars) {
    if (bar.time <= targetSec) found = bar.close;
    else break;
  }
  return found;
}

export function buildRollingChanges(barsInput = [], nowSec = null, sessionStartSec = null) {
  const bars = normalizeBars(barsInput);
  if (!bars.length) {
    return {
      price: null,
      asOfUnix: null,
      asOfUtc: null,
      changesPct: { "5m": null, "10m": null, "30m": null, "60m": null, session: null },
    };
  }

  const latest = bars[bars.length - 1];
  const refSec = num(nowSec) ?? latest.time;
  const current = latest.close;

  const changesPct = {};
  for (const [label, seconds] of Object.entries({
    "5m": 5 * 60,
    "10m": 10 * 60,
    "30m": 30 * 60,
    "60m": 60 * 60,
  })) {
    changesPct[label] = pctChange(current, closeAtOrBefore(bars, refSec - seconds));
  }

  // Session change must use an explicitly supplied canonical session start.
  // Never fall back to bars[0], because the fetched bar window can span
  // multiple days and would create a false "session" percentage.
  const sessionStart = num(sessionStartSec);
  let sessionOpen = null;

  if (sessionStart !== null) {
    const sessionBar = bars.find((bar) => bar.time >= sessionStart);
    if (sessionBar) {
      sessionOpen = sessionBar.open ?? sessionBar.close;
    }
  }

  changesPct.session = sessionOpen === null ? null : pctChange(current, sessionOpen);

  return {
    price: current,
    asOfUnix: latest.time,
    asOfUtc: new Date(latest.time * 1000).toISOString(),
    changesPct,
  };
}

function anyAtOrBelow(values, threshold) {
  return values.some((v) => num(v) !== null && Number(v) <= threshold);
}

function anyAtOrAbove(values, threshold) {
  return values.some((v) => num(v) !== null && Number(v) >= threshold);
}

export function classifyRates({ tenYearProxy, thirtyYearProxy } = {}) {
  const zn = tenYearProxy?.changesPct || {};
  const zbInput = thirtyYearProxy?.changesPct || {};
  const hasData = [tenYearProxy?.price, thirtyYearProxy?.price, ...Object.values(zn), ...Object.values(zbInput)]
    .some((v) => num(v) !== null);
  if (!hasData) {
    return { state: "UNAVAILABLE", severity: null, velocityState: "UNAVAILABLE", reasonCodes: ["RATES_PROXY_DATA_UNAVAILABLE"] };
  }

  const zb = zbInput;
  const t = RESEARCH_THRESHOLDS.treasuryProxy;

  const znWarn = anyAtOrBelow([zn["10m"]], t.warning10mPct) || anyAtOrBelow([zn["30m"]], t.warning30mPct);
  const zbWarn = anyAtOrBelow([zb["10m"]], t.warning10mPct) || anyAtOrBelow([zb["30m"]], t.warning30mPct);
  const znStrong = anyAtOrBelow([zn["30m"]], t.strong30mPct);
  const zbStrong = anyAtOrBelow([zb["30m"]], t.strong30mPct);
  const bothSupportive =
    anyAtOrAbove([zn["30m"]], t.supportive30mPct) &&
    anyAtOrAbove([zb["30m"]], t.supportive30mPct);

  const reasonCodes = [];
  if (znWarn) reasonCodes.push("ZN_TREASURY_PRICE_PRESSURE");
  if (zbWarn) reasonCodes.push("ZB_TREASURY_PRICE_PRESSURE");
  if (znStrong) reasonCodes.push("ZN_STRONG_TREASURY_SELLING");
  if (zbStrong) reasonCodes.push("ZB_STRONG_TREASURY_SELLING");
  if (bothSupportive) reasonCodes.push("ZN_ZB_TREASURY_STRENGTH");

  if (znStrong && zbStrong) {
    return { state: "NEGATIVE", severity: "HIGH", velocityState: "TREASURY_SELLING_STRONG", reasonCodes };
  }
  if (znWarn && zbWarn) {
    return { state: "NEGATIVE", severity: "MODERATE", velocityState: "TREASURY_SELLING_CONFIRMED", reasonCodes };
  }
  if (znWarn || zbWarn) {
    return { state: "NEGATIVE", severity: "LOW", velocityState: "TREASURY_PRESSURE_DEVELOPING", reasonCodes };
  }
  if (bothSupportive) {
    return { state: "SUPPORTIVE", severity: "LOW", velocityState: "TREASURY_STRENGTH", reasonCodes };
  }
  return { state: "NEUTRAL", severity: "LOW", velocityState: "STABLE", reasonCodes };
}

export function classifyTlt(tlt = {}) {
  const c = tlt?.changesPct || {};
  const hasData = [tlt?.price, ...Object.values(c)].some((v) => num(v) !== null);
  if (!hasData) {
    return { state: "UNAVAILABLE", severity: null, velocityState: "UNAVAILABLE", reasonCodes: ["TLT_DATA_UNAVAILABLE"] };
  }
  const t = RESEARCH_THRESHOLDS.tlt;
  const reasonCodes = [];

  const strong = anyAtOrBelow([c["60m"]], t.strong60mPct);
  const warning =
    anyAtOrBelow([c["10m"]], t.warning10mPct) ||
    anyAtOrBelow([c["30m"]], t.warning30mPct);
  const supportive = anyAtOrAbove([c["30m"]], t.supportive30mPct);

  if (strong) {
    reasonCodes.push("TLT_STRONG_DURATION_SELLING");
    return { state: "NEGATIVE", severity: "HIGH", velocityState: "SELLING_STRONG", reasonCodes };
  }
  if (warning) {
    reasonCodes.push("TLT_DURATION_PRESSURE");
    return { state: "NEGATIVE", severity: "MODERATE", velocityState: "SELLING_ACCELERATING", reasonCodes };
  }
  if (supportive) {
    reasonCodes.push("TLT_DURATION_STRENGTH");
    return { state: "SUPPORTIVE", severity: "LOW", velocityState: "STRENGTHENING", reasonCodes };
  }
  return { state: "NEUTRAL", severity: "LOW", velocityState: "STABLE", reasonCodes };
}

function classifyOilLeg(changes = {}) {
  const t = RESEARCH_THRESHOLDS.oil;

  const thirtyMinute = changes["30m"];
  const sixtyMinute = changes["60m"];
  const session = changes.session;

  // SHOCK can come from extreme short-window velocity or an extreme
  // full-session move. Session magnitude is intentionally separate from
  // 30m/60m velocity so a late-day plateau does not erase a major oil move.
  if (
    anyAtOrAbove([thirtyMinute], t.shock30mPct) ||
    anyAtOrAbove([sixtyMinute], t.shock60mPct) ||
    anyAtOrAbove([session], t.shockSessionPct)
  ) {
    return "SHOCK";
  }

  if (
    anyAtOrAbove([thirtyMinute], t.strong30mPct) ||
    anyAtOrAbove([session], t.strongSessionPct)
  ) {
    return "STRONG_WARNING";
  }

  if (
    anyAtOrAbove([thirtyMinute], t.warning30mPct) ||
    anyAtOrAbove([session], t.warningSessionPct)
  ) {
    return "WARNING";
  }

  if (
    anyAtOrBelow([thirtyMinute], t.supportive30mPct) ||
    anyAtOrBelow([session], t.supportiveSessionPct)
  ) {
    return "SUPPORTIVE";
  }

  return "NEUTRAL";
}

export function classifyOil({ wti, brent } = {}) {
  const hasWti = [wti?.price, ...Object.values(wti?.changesPct || {})].some((v) => num(v) !== null);
  const hasBrent = [brent?.price, ...Object.values(brent?.changesPct || {})].some((v) => num(v) !== null);
  if (!hasWti && !hasBrent) {
    return { state: "UNAVAILABLE", severity: null, shockState: "UNAVAILABLE", marketConfirmed: false, reasonCodes: ["OIL_DATA_UNAVAILABLE"] };
  }
  const wtiState = hasWti ? classifyOilLeg(wti?.changesPct || {}) : "UNAVAILABLE";
  const brentState = hasBrent ? classifyOilLeg(brent?.changesPct || {}) : "UNAVAILABLE";
  const reasonCodes = [];

  if (wtiState !== "NEUTRAL") reasonCodes.push(`WTI_${wtiState}`);
  if (brentState !== "NEUTRAL") reasonCodes.push(`BRENT_${brentState}`);

  const bothShock = wtiState === "SHOCK" && brentState === "SHOCK";
  const oneShock = wtiState === "SHOCK" || brentState === "SHOCK";
  const bothWarning = ["WARNING", "STRONG_WARNING", "SHOCK"].includes(wtiState) &&
    ["WARNING", "STRONG_WARNING", "SHOCK"].includes(brentState);
  const bothSupportive = wtiState === "SUPPORTIVE" && brentState === "SUPPORTIVE";

  if (bothShock) {
    reasonCodes.push("WTI_BRENT_OIL_SHOCK_CONFIRMED");
    return { state: "NEGATIVE", severity: "EXTREME", shockState: "CONFIRMED", marketConfirmed: true, reasonCodes };
  }
  if (oneShock && bothWarning) {
    reasonCodes.push("OIL_SHOCK_CROSS_MARKET_CONFIRMED");
    return { state: "NEGATIVE", severity: "HIGH", shockState: "CONFIRMED", marketConfirmed: true, reasonCodes };
  }
  if (bothWarning) {
    reasonCodes.push("WTI_BRENT_OIL_WARNING_CONFIRMED");
    return { state: "NEGATIVE", severity: "MODERATE", shockState: "WARNING", marketConfirmed: true, reasonCodes };
  }
  if (["WARNING", "STRONG_WARNING", "SHOCK"].includes(wtiState) || ["WARNING", "STRONG_WARNING", "SHOCK"].includes(brentState)) {
    return { state: "NEGATIVE", severity: "LOW", shockState: "DEVELOPING", marketConfirmed: false, reasonCodes };
  }
  if (bothSupportive) {
    return { state: "SUPPORTIVE", severity: "LOW", shockState: "NONE", marketConfirmed: true, reasonCodes };
  }
  return { state: "NEUTRAL", severity: "LOW", shockState: "NONE", marketConfirmed: false, reasonCodes };
}

export function normalizeTemporaryEvents(raw, nowMs = Date.now()) {
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.events) ? raw.events : [];
  const normalized = [];

  for (const event of list) {
    if (!event || typeof event !== "object") continue;
    const observedMs = Date.parse(event.observedAt || "");
    const expiresMs = Date.parse(event.expiresAt || "");
    const hasExpiry = Number.isFinite(expiresMs);
    const expired = !hasExpiry || nowMs >= expiresMs;

    normalized.push({
      ...event,
      observedAt: Number.isFinite(observedMs) ? new Date(observedMs).toISOString() : null,
      expiresAt: hasExpiry ? new Date(expiresMs).toISOString() : null,
      status: expired ? "EVENT_EXPIRED" : EVENT_STATES.includes(event.status) ? event.status : "EVENT_DETECTED",
      expired,
      usable: event.material === true && !expired && hasExpiry,
    });
  }

  return normalized;
}

export function evaluateEventLifecycle({ event, oil, rates, tlt } = {}) {
  if (!event || event.expired || event.status === "EVENT_EXPIRED") return "EVENT_EXPIRED";

  const marketConfirmed = oil?.marketConfirmed === true ||
    (rates?.state === "NEGATIVE" && tlt?.state === "NEGATIVE");

  if (event.status === "EVENT_DETECTED" && !marketConfirmed) return "EVENT_DETECTED";
  if (!marketConfirmed && event.status === "EVENT_CONFIRMED") return "EVENT_CONFIRMED";

  if (marketConfirmed) return "REACTION_HOLDING";

  return event.status || "EVENT_DETECTED";
}

function severityRank(value) {
  return { LOW: 0, MODERATE: 1, HIGH: 2, EXTREME: 3 }[value] ?? 0;
}

function maxSeverity(...values) {
  const best = values.reduce((a, b) => severityRank(b) > severityRank(a) ? b : a, "LOW");
  return best;
}

export function buildIntradayMacro({
  generatedAtUtc = new Date().toISOString(),
  slowContext = {},
  tenYearProxy = {},
  thirtyYearProxy = {},
  tlt = {},
  wti = {},
  brent = {},
  temporaryEvents = [],
  freshness = {},
  warnings = [],
  persistenceAvailable = false,
} = {}) {
  const ratesRead = classifyRates({ tenYearProxy, thirtyYearProxy });
  const tltRead = classifyTlt(tlt);
  const oilRead = classifyOil({ wti, brent });

  const events = normalizeTemporaryEvents(temporaryEvents, Date.parse(generatedAtUtc) || Date.now());
  const activeEvents = events.filter((e) => e.usable);

  // Canonical Finlight/Engine 25 event families.
  // News identifies the event; market data confirms transmission.
  const geopoliticalEvents = activeEvents.filter((e) =>
    [
      "GEOPOLITICAL_OIL_SUPPLY_RISK",
      "GEOPOLITICAL_ESCALATION",
      "ENERGY_SUPPLY_EVENT",
    ].includes(e.eventType)
  );

  const treasuryEvents = activeEvents.filter((e) =>
    [
      "TREASURY_RATES_RISK",
      "FED_POLICY_EVENT",
      "FINANCIAL_STRESS_EVENT",
    ].includes(e.eventType)
  );

  const geopoliticsActive = geopoliticalEvents.length > 0;
  const geopoliticsMarketConfirmed = geopoliticsActive && oilRead.marketConfirmed === true;
  const treasuryActive = treasuryEvents.length > 0;
  const treasuryMarketConfirmed = treasuryActive && (ratesRead.state === "NEGATIVE" || tltRead.state === "NEGATIVE");

  const enrichedGeopoliticalEvents = geopoliticalEvents.map((event) => ({
    ...event,
    reactionState: evaluateEventLifecycle({ event, oil: oilRead, rates: ratesRead, tlt: tltRead }),
  }));
  const enrichedTreasuryEvents = treasuryEvents.map((event) => ({
    ...event,
    reactionState: evaluateEventLifecycle({ event, oil: oilRead, rates: ratesRead, tlt: tltRead }),
  }));

  const ratesConfirmed = ratesRead.state === "NEGATIVE" && tltRead.state === "NEGATIVE";
  const tltConfirmed = tltRead.state === "NEGATIVE";
  const oilConfirmed = oilRead.marketConfirmed === true;
  const crossMarketConfluence = ratesConfirmed && oilConfirmed;
  const marketEvidenceCount = [ratesRead.state, tltRead.state, oilRead.state]
    .filter((x) => x && x !== "UNAVAILABLE").length;

  // Critical manager rule: a manual event alone never creates MACRO_SHOCK.
  const macroShock =
    (geopoliticsMarketConfirmed && oilRead.shockState === "CONFIRMED") ||
    (crossMarketConfluence && oilRead.severity === "EXTREME");

  let state = marketEvidenceCount > 0 ? "MACRO_NEUTRAL" : null;
  let equityImpact = marketEvidenceCount > 0 ? "NEUTRAL" : null;
  let severity = marketEvidenceCount > 0 ? "LOW" : null;
  const reasonCodes = [];

  if (marketEvidenceCount === 0) {
    reasonCodes.push("INSUFFICIENT_INTRADAY_MARKET_DATA");
  } else if (macroShock) {
    state = "MACRO_SHOCK";
    equityImpact = "EQUITY_NEGATIVE";
    severity = maxSeverity("HIGH", ratesRead.severity, tltRead.severity, oilRead.severity);
    reasonCodes.push("CROSS_MARKET_MACRO_SHOCK_CONFIRMED");
  } else {
    const negativeCount = [ratesRead.state, tltRead.state, oilRead.state].filter((x) => x === "NEGATIVE").length;
    const supportiveCount = [ratesRead.state, tltRead.state, oilRead.state].filter((x) => x === "SUPPORTIVE").length;

    if (negativeCount >= 2 || geopoliticsMarketConfirmed || treasuryMarketConfirmed) {
      state = "MACRO_HEADWIND";
      equityImpact = "EQUITY_NEGATIVE";
      severity = maxSeverity("MODERATE", ratesRead.severity, tltRead.severity, oilRead.severity);
      reasonCodes.push("MULTI_COMPONENT_MACRO_HEADWIND");
    } else if (supportiveCount >= 2 && negativeCount === 0 && !geopoliticsActive && !treasuryActive) {
      state = "MACRO_SUPPORTIVE";
      equityImpact = "EQUITY_SUPPORTIVE";
      severity = "LOW";
      reasonCodes.push("MULTI_COMPONENT_MACRO_SUPPORTIVE");
    } else if (negativeCount === 1 || geopoliticsActive || treasuryActive) {
      state = "MACRO_HEADWIND";
      equityImpact = negativeCount === 1 ? "EQUITY_NEGATIVE" : "MIXED";
      severity = maxSeverity("LOW", ratesRead.severity, tltRead.severity, oilRead.severity);
      reasonCodes.push("SINGLE_COMPONENT_OR_EVENT_HEADWIND");
    }
  }

  const outputWarnings = [...warnings];
  if (!persistenceAvailable) outputWarnings.push("EVENT_PERSISTENCE_DEGRADED");
  if (events.some((e) => !e.expiresAt)) outputWarnings.push("TEMPORARY_EVENT_MISSING_EXPIRY_IGNORED");

  return {
    ok: marketEvidenceCount > 0,
    engine: INTRADAY_MACRO_ENGINE,
    generatedAtUtc,
    state,
    equityImpact,
    severity,
    macroShock,
    freshness: {
      status: freshness.status || "FRESH",
      marketDataAsOfUtc: freshness.marketDataAsOfUtc || null,
      eventDataAsOfUtc: freshness.eventDataAsOfUtc || null,
      warnings: Array.isArray(freshness.warnings) ? freshness.warnings : [],
    },
    components: {
      rates: {
        state: ratesRead.state,
        severity: ratesRead.severity,
        slowContext: {
          tenYearYield: num(slowContext.tenYearYield),
          tenYearObservationDate: slowContext.tenYearObservationDate || null,
          thirtyYearYield: num(slowContext.thirtyYearYield),
          thirtyYearObservationDate: slowContext.thirtyYearObservationDate || null,
          sourceType: "FRED_SLOW_CONTEXT",
        },
        tenYearProxy: { ...tenYearProxy, sourceType: "FUTURES_PROXY" },
        thirtyYearProxy: { ...thirtyYearProxy, sourceType: "FUTURES_PROXY" },
        velocityState: ratesRead.velocityState,
        reasonCodes: ratesRead.reasonCodes,
      },
      tlt: {
        ...tlt,
        state: tltRead.state,
        severity: tltRead.severity,
        symbol: "TLT",
        sourceType: "ETF_PROXY",
        velocityState: tltRead.velocityState,
        reasonCodes: tltRead.reasonCodes,
      },
      oil: {
        state: oilRead.state,
        severity: oilRead.severity,
        wti: { ...wti, sourceType: wti.sourceType || "DIRECT_FUTURES" },
        brent: { ...brent, sourceType: brent.sourceType || "DIRECT_FUTURES" },
        shockState: oilRead.shockState,
        reasonCodes: oilRead.reasonCodes,
      },
      treasuryLiquidity: {
        state: treasuryMarketConfirmed ? "NEGATIVE" : treasuryActive ? "WATCH" : "NEUTRAL",
        severity: treasuryMarketConfirmed ? "MODERATE" : treasuryActive ? "LOW" : "LOW",
        activeEvents: enrichedTreasuryEvents,
        reactionState: enrichedTreasuryEvents[0]?.reactionState || null,
        reasonCodes: treasuryMarketConfirmed ? ["TREASURY_EVENT_MARKET_CONFIRMED"] : treasuryActive ? ["TREASURY_EVENT_ACTIVE"] : [],
      },
      geopolitics: {
        state: geopoliticsMarketConfirmed
          ? "ELEVATED"
          : geopoliticsActive
            ? "ACTIVE_ESCALATION"
            : "NORMAL",
        severity: geopoliticsActive
          ? maxSeverity(
              ...enrichedGeopoliticalEvents.map((event) => event?.severity || "LOW"),
              geopoliticsMarketConfirmed ? oilRead.severity : "LOW"
            )
          : "LOW",
        materialOilSupplyRisk:
          enrichedGeopoliticalEvents.some((event) => event?.oilSupplyRisk === true),
        activeEvents: enrichedGeopoliticalEvents,
        marketConfirmed: geopoliticsMarketConfirmed,
        reasonCodes: geopoliticsMarketConfirmed
          ? ["GEOPOLITICAL_EVENT_OIL_MARKET_CONFIRMED"]
          : geopoliticsActive
            ? ["GEOPOLITICAL_EVENT_ACTIVE_AWAITING_MARKET_CONFIRMATION"]
            : [],
      },
    },
    marketConfirmation: {
      ratesConfirmed,
      tltConfirmed,
      oilConfirmed,
      crossMarketConfluence,
    },

    // Root-level diagnostic mirrors for Engine 25 consumers.
    // Canonical detailed objects remain under components.*.
    geopolitics: {
      state: geopoliticsMarketConfirmed
        ? "ELEVATED"
        : geopoliticsActive
          ? "ACTIVE_ESCALATION"
          : "NORMAL",
      severity: geopoliticsActive
        ? maxSeverity(
            ...enrichedGeopoliticalEvents.map((event) => event?.severity || "LOW"),
            geopoliticsMarketConfirmed ? oilRead.severity : "LOW"
          )
        : "LOW",
      eventCount: enrichedGeopoliticalEvents.length,
      primaryEntity: enrichedGeopoliticalEvents[0]?.primaryEntity || null,
      marketConfirmed: geopoliticsMarketConfirmed,
      materialOilSupplyRisk:
        enrichedGeopoliticalEvents.some((event) => event?.oilSupplyRisk === true),
    },

    confirmationFamilies: {
      oilGeopolitical: geopoliticalEvents.length,
      treasuryLiquidity: treasuryEvents.length,
    },

    reasonCodes: [
      ...new Set([
        ...reasonCodes,
        ...(geopoliticsActive
          ? ["GEOPOLITICAL_EVENT_ACTIVE"]
          : []),
        ...(geopoliticsMarketConfirmed
          ? ["GEOPOLITICAL_EVENT_OIL_MARKET_CONFIRMED"]
          : []),
        ...(treasuryActive
          ? ["TREASURY_OR_POLICY_EVENT_ACTIVE"]
          : []),
      ]),
    ],
    warnings: [...new Set(outputWarnings)],
  };
}

export default {
  INTRADAY_MACRO_ENGINE,
  RESEARCH_THRESHOLDS,
  pctChange,
  normalizeBars,
  buildRollingChanges,
  classifyRates,
  classifyTlt,
  classifyOil,
  normalizeTemporaryEvents,
  evaluateEventLifecycle,
  buildIntradayMacro,
};
