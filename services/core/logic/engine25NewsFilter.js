// services/core/logic/engine25NewsFilter.js
// Engine 25 Finlight News v0.5 — continuation threads / evidence-preserving dedupe
// Pure relevance, classification, expiry, and dedupe logic.
// No provider calls. No trade direction. No market confirmation thresholds.
//
// Provider contract:
// - Finlight is discovery only.
// - Original publisher/source remains visible on each normalized event.
// - NEWS IDENTIFIES THE EVENT. MARKETS CONFIRM THE EVENT.
// - One underlying news event = one canonical Engine 25 event.

import { createHash } from "crypto";

export const ENGINE25_NEWS_ENGINE = "engine25.finlightNews.v0.5";
export const ENGINE25_NEWS_SOURCE = "FINLIGHT_REUTERS_FEED";
export const ENGINE25_NEWS_SOURCE_TIER = "PROFESSIONAL_NEWS";
export const ENGINE25_NEWS_PROVIDER = "FINLIGHT";

export const APPROVED_EVENT_TYPES = Object.freeze([
  "GEOPOLITICAL_OIL_SUPPLY_RISK",
  "GEOPOLITICAL_ESCALATION",
  "TREASURY_RATES_RISK",
  "FED_POLICY_EVENT",
  "MACRO_DATA_RELEASE",
  "TRADE_POLICY_RISK",
  "FINANCIAL_STRESS_EVENT",
  "ENERGY_SUPPLY_EVENT",
]);

const EXPIRY_HOURS = Object.freeze({
  GEOPOLITICAL_OIL_SUPPLY_RISK: 6,
  GEOPOLITICAL_ESCALATION: 6,
  ENERGY_SUPPLY_EVENT: 6,
  TREASURY_RATES_RISK: 4,
  FED_POLICY_EVENT: 4,
  MACRO_DATA_RELEASE: 3,
  TRADE_POLICY_RISK: 6,
  FINANCIAL_STRESS_EVENT: 6,
});

const PRIORITY = Object.freeze({
  GEOPOLITICAL_OIL_SUPPLY_RISK: 80,
  FINANCIAL_STRESS_EVENT: 75,
  TREASURY_RATES_RISK: 70,
  ENERGY_SUPPLY_EVENT: 65,
  FED_POLICY_EVENT: 55,
  TRADE_POLICY_RISK: 50,
  MACRO_DATA_RELEASE: 45,
  GEOPOLITICAL_ESCALATION: 40,
});

const MATERIAL_TERMS = [
  "attack", "attacks", "airstrike", "airstrikes", "air strike", "air strikes", "strike", "strikes", "struck", "striking",
  "missile", "missiles", "drone", "drones", "war", "invasion", "military",
  "blockade", "blocked", "closure", "closed", "disruption", "disrupted",
  "halt", "halted", "suspend", "suspended", "sanction", "sanctions",
  "emergency", "default", "failed", "failure", "collapse", "collapsed",
  "bank run", "liquidity crisis", "funding stress", "credit stress",
  "downgrade", "downgraded", "bailout", "rescue", "rate hike", "rate cut",
  "raises rates", "cuts rates", "fomc", "tariff", "tariffs", "embargo",
  "export ban", "import ban", "ceasefire", "retaliation", "retaliates",
  "nonfarm payroll", "payrolls", "consumer price index", "cpi", "ppi",
  "gdp", "jobless claims", "retail sales", "pce", "inflation",
];

function normalizeText(value) {
  return String(value || "")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function articleText(article) {
  const title = normalizeText(article?.title);
  const summary = normalizeText(article?.summary);
  const categories = Array.isArray(article?.categories)
    ? article.categories.join(" ")
    : "";
  const countries = Array.isArray(article?.countries)
    ? article.countries.join(" ")
    : "";
  const source = normalizeText(article?.source);

  return normalizeText(
    `${title} ${summary} ${categories} ${countries} ${source}`
  ).toLowerCase();
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasTerm(text, term) {
  const normalizedText = String(text || "").toLowerCase();
  const normalizedTerm = normalizeText(term).toLowerCase();
  if (!normalizedTerm) return false;

  const phrasePattern = escapeRegExp(normalizedTerm).replace(/\s+/g, "\\s+");
  const pattern = new RegExp(
    `(^|[^a-z0-9])${phrasePattern}(?=$|[^a-z0-9])`,
    "i"
  );

  return pattern.test(normalizedText);
}

function hasAny(text, terms) {
  return terms.some((term) => hasTerm(text, term));
}

function hasAll(text, groups) {
  return groups.every((group) => hasAny(text, group));
}

function isHormuzConcreteDisruption(text) {
  const hormuzContext = hasAny(text, ["strait of hormuz", "hormuz"]);
  const disruptionTerms = [
    "mine", "mines",
    "navy", "naval",
    "destroyed", "destruction",
    "detonated", "detonation",
    "blockade",
    "closure", "closed",
    "attack", "attacks", "attacked",
    "strike", "strikes", "struck", "striking",
    "airstrike", "airstrikes", "air strike", "air strikes",
    "ship", "ships",
    "shipping disruption",
    "tanker", "tankers",
  ];

  return hormuzContext && hasAny(text, disruptionTerms);
}

function parseIso(value) {
  const ms = Date.parse(value || "");
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function addHours(iso, hours) {
  const ms = Date.parse(iso || "");
  if (!Number.isFinite(ms)) return null;
  return new Date(ms + hours * 60 * 60 * 1000).toISOString();
}

const SEVERITY_RANK = Object.freeze({
  LOW: 1,
  MODERATE: 2,
  HIGH: 3,
  EXTREME: 4,
});

function maxSeverity(a, b) {
  const aa = String(a || "LOW").toUpperCase();
  const bb = String(b || "LOW").toUpperCase();
  return (SEVERITY_RANK[bb] || 0) > (SEVERITY_RANK[aa] || 0) ? bb : aa;
}

function eventFamily(eventType) {
  if (["GEOPOLITICAL_OIL_SUPPLY_RISK", "ENERGY_SUPPLY_EVENT"].includes(eventType)) {
    return "ENERGY_GEOPOLITICS";
  }
  if (eventType === "GEOPOLITICAL_ESCALATION") return "GEOPOLITICS";
  if (["TREASURY_RATES_RISK", "FED_POLICY_EVENT", "FINANCIAL_STRESS_EVENT"].includes(eventType)) {
    return "RATES_FINANCIAL";
  }
  if (eventType === "TRADE_POLICY_RISK") return "TRADE";
  if (eventType === "MACRO_DATA_RELEASE") return "US_MACRO";
  return eventType || "UNKNOWN";
}

function strategicThreadAnchor(eventType, primaryEntityValue, text) {
  if (hasAny(text, ["strait of hormuz", "hormuz", "persian gulf", "gulf of oman"])) {
    return "HORMUZ_GULF";
  }
  if (hasAny(text, ["red sea", "suez canal", "suez"])) {
    return "RED_SEA_SUEZ";
  }
  if (hasAny(text, ["iran", "iranian"])) return "IRAN";
  if (hasAny(text, ["israel", "israeli"])) return "ISRAEL";
  if (hasAny(text, ["russia", "russian", "ukraine", "ukrainian"])) return "RUSSIA_UKRAINE";
  if (hasAny(text, ["china", "chinese", "taiwan", "taiwanese"])) return "CHINA_TAIWAN";
  if (hasAny(text, ["north korea", "north korean", "pyongyang"])) return "NORTH_KOREA";
  if (primaryEntityValue) {
    return String(primaryEntityValue).toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  }
  return String(eventType || "UNKNOWN").toUpperCase();
}

function eventThreadKeyFor(eventType, primaryEntityValue, text) {
  const family = eventFamily(eventType);
  const anchor = strategicThreadAnchor(eventType, primaryEntityValue, text);
  return `${family}:${anchor}`;
}

function developmentIdentity(event) {
  return (
    String(event?.sourceUrl || "").trim() ||
    String(event?.providerArticleId || "").trim() ||
    String(event?.eventId || "").trim() ||
    `${event?.observedAt || ""}|${event?.headlineSummary || ""}`
  );
}

function developmentFromEvent(event) {
  return {
    eventId: event?.eventId || null,
    providerArticleId: event?.providerArticleId || null,
    sourceUrl: event?.sourceUrl || null,
    source: event?.source || null,
    observedAt: event?.observedAt || null,
    providerFirstSeenAt: event?.providerFirstSeenAt || null,
    eventType: event?.eventType || null,
    headlineSummary: event?.headlineSummary || null,
    material: event?.material === true,
    severity: event?.severity || null,
    primaryTheme: event?.primaryTheme || null,
    primaryEntity: event?.primaryEntity || null,
    oilSupplyRisk: event?.oilSupplyRisk === true,
    treasuryLiquidityRisk: event?.treasuryLiquidityRisk === true,
  };
}

function mergeDevelopmentEvidence(canonical, incoming) {
  const existingDevelopments = Array.isArray(canonical?.developments)
    ? canonical.developments
    : [];

  const candidates = [
    ...existingDevelopments,
    developmentFromEvent(incoming),
    ...(Array.isArray(incoming?.developments) ? incoming.developments : []),
  ].filter(Boolean);

  const seen = new Set();
  const developments = [];

  for (const development of candidates) {
    const id = developmentIdentity(development);
    if (!id || seen.has(id)) continue;
    seen.add(id);

    if (id === developmentIdentity(canonical)) continue;
    developments.push(development);
  }

  developments.sort(
    (a, b) => Date.parse(a?.observedAt || "") - Date.parse(b?.observedAt || "")
  );

  const canonicalExpiryMs = Date.parse(canonical?.expiresAt || "");
  const incomingExpiryMs = Date.parse(incoming?.expiresAt || "");
  const expiresAt =
    Number.isFinite(incomingExpiryMs) &&
    (!Number.isFinite(canonicalExpiryMs) || incomingExpiryMs > canonicalExpiryMs)
      ? incoming.expiresAt
      : canonical.expiresAt;

  return {
    ...canonical,
    expiresAt,
    material: canonical?.material === true || incoming?.material === true,
    severity: maxSeverity(canonical?.severity, incoming?.severity),
    oilSupplyRisk: canonical?.oilSupplyRisk === true || incoming?.oilSupplyRisk === true,
    treasuryLiquidityRisk:
      canonical?.treasuryLiquidityRisk === true ||
      incoming?.treasuryLiquidityRisk === true,
    latestDevelopmentAt: [canonical?.latestDevelopmentAt, incoming?.observedAt]
      .filter(Boolean)
      .sort((a, b) => Date.parse(b) - Date.parse(a))[0] || canonical?.observedAt || null,
    developments,
  };
}

function primaryEntity(text) {
  const entities = [
    ["Strait of Hormuz", ["strait of hormuz", "hormuz"]],
    ["Red Sea", ["red sea"]],
    ["Suez Canal", ["suez canal", "suez"]],
    ["OPEC+", ["opec+", "opec plus"]],
    ["OPEC", ["opec"]],
    ["Federal Reserve", [
      "federal reserve", "fomc", "fed chair", "jerome powell", "powell",
      "boston fed", "cleveland fed", "minneapolis fed", "kansas city fed",
      "dallas fed", "new york fed", "chicago fed", "st. louis fed",
      "san francisco fed", "atlanta fed", "richmond fed", "philadelphia fed",
      "collins"
    ]],
    ["U.S. Treasury", ["u.s. treasury", "us treasury", "treasury department", "treasury market"]],
    ["Iran", ["iran", "iranian"]],
    ["Israel", ["israel", "israeli"]],
    ["Russia", ["russia", "russian"]],
    ["Ukraine", ["ukraine", "ukrainian"]],
    ["China", ["china", "chinese", "beijing"]],
    ["Taiwan", ["taiwan", "taiwanese"]],
    ["North Korea", ["north korea", "north korean", "pyongyang"]],
    ["Saudi Arabia", ["saudi arabia", "saudi"]],
    ["United States", ["united states", "u.s.", "usa"]],
  ];

  for (const [name, terms] of entities) {
    if (hasAny(text, terms)) return name;
  }
  return null;
}


function isMajorStrategicEscalation(text) {
  const usIran =
    hasAny(text, ["iran", "iranian"]) &&
    hasAny(text, ["united states", "u.s.", "usa", "american", "us forces", "u.s. forces"]);

  const israelIran =
    hasAny(text, ["iran", "iranian"]) &&
    hasAny(text, ["israel", "israeli"]);

  const chinaTaiwan =
    hasAny(text, ["china", "chinese", "beijing"]) &&
    hasAny(text, ["taiwan", "taiwanese"]);

  const russiaNatoOrUs =
    hasAny(text, ["russia", "russian"]) &&
    hasAny(text, [
      "nato",
      "united states", "u.s.", "usa",
      "us forces", "u.s. forces", "american"
    ]);

  const northKoreaStrategic =
    hasAny(text, ["north korea", "north korean", "pyongyang"]) &&
    hasAny(text, [
      "united states", "u.s.", "usa",
      "south korea", "japan",
      "us forces", "u.s. forces"
    ]);

  const strategicPair =
    usIran ||
    israelIran ||
    chinaTaiwan ||
    russiaNatoOrUs ||
    northKoreaStrategic;

  if (!strategicPair) {
    return false;
  }

  return hasAny(text, [
    "attack", "attacks", "attacked",
    "strike", "strikes", "struck", "striking",
    "airstrike", "airstrikes", "air strike", "air strikes",
    "missile", "missiles",
    "drone strike", "drone strikes",
    "military strike", "military strikes",
    "military action",
    "retaliation", "retaliates", "retaliated",
    "vow response", "vows response", "vowed response",
    "vow retaliation", "vows retaliation", "vowed retaliation",
    "response to attack",
    "invasion",
    "blockade",
    "naval clash", "military clash",
    "hostilities intensify", "conflict escalates"
  ]);
}

function classifyCandidates(text) {
  const candidates = [];

  const oilTerms = [
    "oil", "crude", "brent", "wti", "petroleum",
    "tanker", "tankers", "refinery", "refineries"
  ];

  const supplyTerms = [
    "supply", "shipping", "shipment", "shipments",
    "pipeline", "pipelines", "terminal", "terminals",
    "production", "exports", "export",
    "hormuz", "red sea", "suez",
    "blockade", "closure", "disruption", "disrupted",
    "halt", "halted", "attack", "attacks", "attacked",
    "strike", "strikes", "struck", "striking",
    "airstrike", "airstrikes", "air strike", "air strikes",
    "sanction", "sanctions"
  ];

  const geopoliticalTerms = [
    "war", "military", "attack", "attacks", "attacked",
    "strike", "strikes", "struck", "striking",
    "airstrike", "airstrikes", "air strike", "air strikes",
    "missile", "missiles",
    "drone", "drones",
    "invasion", "retaliation", "retaliates",
    "ceasefire", "troops", "conflict", "hostilities",
    "blockade", "naval", "navy",
    "hormuz", "red sea", "suez"
  ];

  // A generic crime/legal/historical story containing words like
  // "war", "attack", "military", or "drone" is NOT enough.
  // Engine 25 geopolitical discovery requires a strategic theater/entity
  // plus a live escalation/action, or explicit market-transmission risk.
  const strategicGeoContextTerms = [
    "iran", "iranian",
    "israel", "israeli",
    "russia", "russian",
    "ukraine", "ukrainian",
    "china", "chinese", "beijing",
    "taiwan", "taiwanese",
    "north korea", "north korean", "pyongyang",
    "saudi arabia", "saudi",
    "yemen", "houthi", "houthis",
    "nato",
    "united states", "u.s.", "us",
    "strait of hormuz", "hormuz",
    "red sea", "suez canal", "suez",
    "persian gulf", "gulf of oman"
  ];

  const liveEscalationActionTerms = [
    "airstrike", "airstrikes", "air strike", "air strikes",
    "missile", "missiles",
    "drone strike", "drone strikes",
    "military strike", "military strikes",
    "attack", "attacks", "attacked",
    "strike", "strikes", "struck", "striking",
    "invasion",
    "retaliation", "retaliates", "retaliated",
    "vow response", "vows response", "vowed response",
    "vow retaliation", "vows retaliation", "vowed retaliation",
    "response to attack",
    "troops deploy", "troops deployed",
    "deploys troops", "deployed troops",
    "blockade",
    "closure",
    "ship seized", "ships seized",
    "tanker seized", "tankers seized",
    "naval clash", "military clash",
    "ceasefire collapses", "ceasefire breaks down",
    "hostilities intensify", "conflict escalates"
  ];

  const geopoliticalTransmissionTerms = [
    "oil", "crude", "brent", "wti", "fuel", "gas",
    "shipping", "tanker", "tankers",
    "strait of hormuz", "hormuz", "red sea", "suez",
    "supply", "exports", "export",
    "sanctions", "sanction",
    "markets", "market", "stocks", "equities",
    "futures", "bonds", "treasury", "treasuries",
    "inflation", "prices", "trade"
  ];

  const treasuryContextTerms = [
    "treasury", "treasuries",
    "treasury market", "treasury markets",
    "treasury yield", "treasury yields",
    "bond market", "bond markets",
    "bond yield", "bond yields",
    "10-year yield", "30-year yield",
    "10-year treasury", "30-year treasury"
  ];

  const treasuryRiskActionTerms = [
    "yield spike", "yield spikes", "yields surge", "yields surged",
    "yield jump", "yield jumps", "yields jump", "yields jumped",
    "selloff", "sell-off", "selling",
    "auction", "auctions", "auction tail", "weak auction",
    "duration selloff", "bond selloff",
    "record high", "highest since", "liquidity", "disorder",
    "buyback", "buybacks"
  ];

  const fedEntityTerms = [
    "federal reserve", "fomc", "fed chair",
    "jerome powell", "powell",
    "boston fed", "cleveland fed", "minneapolis fed",
    "kansas city fed", "dallas fed", "new york fed",
    "chicago fed", "st. louis fed", "san francisco fed",
    "atlanta fed", "richmond fed", "philadelphia fed",
    "collins"
  ];

  const fedPolicyTerms = [
    "rate decision", "rate hike", "rate hikes",
    "rate cut", "rate cuts", "rates unchanged", "dot plot",
    "interest rates",
    "raise interest rates", "raises interest rates", "raising interest rates",
    "lower interest rates", "cut interest rates",
    "rates higher", "rates lower",
    "discount rate", "primary credit rate",
    "monetary policy", "policy rate", "policy rates",
    "hawkish", "dovish", "tightening", "easing"
  ];

  // Prevent market-preview stories such as "focus on Jackson Hole"
  // from becoming a FED_POLICY_EVENT merely because Fed/rates are mentioned.
  const fedSubstantiveActionTerms = [
    "said", "says", "told", "remarks", "remarked",
    "signals", "signaled", "backs", "backed",
    "calls for", "called for",
    "votes", "voted",
    "decision", "statement", "minutes", "testimony",
    "raises", "raised", "cuts", "cut",
    "holds", "held", "keeps", "kept", "leaves", "left",
    "projects", "projected", "forecast", "forecasts",
    "speech", "press conference"
  ];

  const fedOfficialActionTerms = [
    "fomc statement", "fomc decision", "fomc minutes",
    "fed statement", "fed decision", "fed minutes",
    "fed chair speech", "powell speech",
    "fed testimony", "powell testimony"
  ];

  const macroTerms = [
    "consumer price index", "cpi",
    "producer price index", "ppi",
    "nonfarm payroll", "payrolls",
    "jobless claims", "retail sales",
    "gross domestic product", "gdp",
    "pce", "personal consumption expenditures",
    "employment report", "unemployment rate",
    "ism manufacturing", "ism services"
  ];

  // Strategy 1 Engine 25 macro-data lane is U.S.-macro only.
  // Finlight articleText includes the provider's countries metadata,
  // so this can qualify either from headline/body or source metadata.
  const usMacroContextTerms = [
    "united states", "u.s.", "us",
    "american", "america"
  ];

  const tradeTerms = [
    "tariff", "tariffs",
    "trade war", "trade policy",
    "export ban", "import ban",
    "export controls",
    "trade restriction", "trade restrictions",
    "customs duty", "duties", "embargo"
  ];

  const stressTerms = [
    "bank run", "bank failure", "bank failures",
    "banking crisis", "liquidity crisis",
    "funding stress", "credit stress", "credit crisis",
    "systemic risk", "default", "defaults",
    "counterparty", "deposit flight",
    "bailout", "bank rescue",
    "financial stability",
    "commercial paper", "repo stress"
  ];

  const energyTerms = [
    "natural gas", "lng", "energy supply",
    "power grid", "electric grid",
    "refinery", "refineries",
    "pipeline", "pipelines",
    "production outage", "production cut", "output cut"
  ];

  const tradePolicyMatch = hasAny(text, tradeTerms);
  const hormuzConcreteDisruption = isHormuzConcreteDisruption(text);

  const treasuryContextMatch = hasAny(text, treasuryContextTerms);
  const treasuryRiskActionMatch = hasAny(text, treasuryRiskActionTerms);

  const fedEntityMatch = hasAny(text, fedEntityTerms);
  const fedPolicyMatch = hasAny(text, fedPolicyTerms);
  const fedSubstantiveActionMatch = hasAny(text, fedSubstantiveActionTerms);
  const fedOfficialActionMatch = hasAny(text, fedOfficialActionTerms);

  const strategicGeoContextMatch = hasAny(text, strategicGeoContextTerms);
  const liveEscalationActionMatch = hasAny(text, liveEscalationActionTerms);
  const majorStrategicEscalationMatch = isMajorStrategicEscalation(text);
  const geopoliticalTransmissionMatch = hasAny(
    text,
    geopoliticalTransmissionTerms
  );

  if (
    (hasAll(text, [oilTerms, supplyTerms]) && strategicGeoContextMatch) ||
    hormuzConcreteDisruption
  ) {
    candidates.push("GEOPOLITICAL_OIL_SUPPLY_RISK");
  }

  if (hasAny(text, stressTerms)) {
    candidates.push("FINANCIAL_STRESS_EVENT");
  }

  if (treasuryContextMatch && treasuryRiskActionMatch) {
    candidates.push("TREASURY_RATES_RISK");
  }

  if (
    hasAny(text, energyTerms) &&
    hasAny(text, [
      "supply", "outage", "cut", "halt",
      "disruption", "shortage", "attack", "attacks", "attacked",
      "strike", "strikes", "struck", "striking",
      "airstrike", "airstrikes", "sanction"
    ])
  ) {
    candidates.push("ENERGY_SUPPLY_EVENT");
  }

  if (
    fedOfficialActionMatch ||
    (fedEntityMatch && fedPolicyMatch && fedSubstantiveActionMatch)
  ) {
    candidates.push("FED_POLICY_EVENT");
  }

  if (tradePolicyMatch) {
    candidates.push("TRADE_POLICY_RISK");
  }

  // Require BOTH strategic geopolitical context and a live escalation.
  // Pure crime/legal/historical stories are rejected.
  // A trade-policy story is not promoted to geopolitical escalation unless
  // there is an independent live military/security escalation.
  if (
    (
      (strategicGeoContextMatch && liveEscalationActionMatch) ||
      majorStrategicEscalationMatch
    ) &&
    (!tradePolicyMatch || geopoliticalTransmissionMatch)
  ) {
    candidates.push("GEOPOLITICAL_ESCALATION");
  }

  // U.S.-only macro lane. Foreign GDP/CPI/labor releases stay out.
  if (
    hasAny(text, macroTerms) &&
    hasAny(text, usMacroContextTerms)
  ) {
    candidates.push("MACRO_DATA_RELEASE");
  }

  return [...new Set(candidates)].sort((a, b) => PRIORITY[b] - PRIORITY[a]);
}
function themeFor(eventType, text) {
  if (eventType === "GEOPOLITICAL_OIL_SUPPLY_RISK") {
    return "OIL_SUPPLY_GEOPOLITICAL_RISK";
  }

  if (eventType === "ENERGY_SUPPLY_EVENT") {
    return "ENERGY_SUPPLY_DISRUPTION";
  }

  if (eventType === "TREASURY_RATES_RISK") {
    return "TREASURY_RATES_VOLATILITY";
  }

  if (eventType === "FINANCIAL_STRESS_EVENT") {
    return "FINANCIAL_SYSTEM_STRESS";
  }

  if (eventType === "FED_POLICY_EVENT") {
    return "FED_POLICY";
  }

  if (eventType === "TRADE_POLICY_RISK") {
    return "TRADE_POLICY";
  }

  if (eventType === "MACRO_DATA_RELEASE") {
    if (hasAny(text, ["cpi", "consumer price index"])) return "US_CPI";
    if (hasAny(text, ["pce", "personal consumption expenditures"])) return "US_PCE";
    if (hasAny(text, ["nonfarm payroll", "payrolls", "unemployment rate", "employment report"])) {
      return "US_LABOR_DATA";
    }
    if (hasAny(text, ["gdp", "gross domestic product"])) return "US_GDP";
    return "US_MACRO_DATA";
  }

  if (eventType === "GEOPOLITICAL_ESCALATION") {
    return "GEOPOLITICAL_ESCALATION";
  }

  return eventType;
}

function materialFor(eventType, text) {
  if (!eventType) return false;

  if (
    eventType === "GEOPOLITICAL_OIL_SUPPLY_RISK" &&
    isHormuzConcreteDisruption(text)
  ) {
    return true;
  }

  if (eventType === "GEOPOLITICAL_OIL_SUPPLY_RISK") {
    return hasAny(text, [
      "attack", "attacks", "attacked",
      "strike", "strikes", "struck", "striking",
      "airstrike", "airstrikes", "air strike", "air strikes",
      "missile", "blockade", "closure",
      "disruption", "halt", "sanction", "sanctions",
      "shipping", "tanker", "tankers", "supply", "exports"
    ]);
  }

  if (eventType === "GEOPOLITICAL_ESCALATION") {
    // Major strategic pairings (for example U.S.-Iran) are material when
    // paired with a concrete attack/strike/retaliation/response action.
    // This stays separate from generic crime/legal/historical use of
    // words such as "attack" or "war".
    if (isMajorStrategicEscalation(text)) {
      return true;
    }

    return hasAny(text, [
      "airstrike", "airstrikes", "air strike", "air strikes",
      "strike", "strikes", "struck", "striking",
      "missile", "missiles",
      "drone strike", "drone strikes",
      "military strike", "military strikes",
      "invasion", "blockade",
      "retaliation", "retaliates", "retaliated",
      "vow response", "vows response", "vowed response",
      "vow retaliation", "vows retaliation", "vowed retaliation",
      "response to attack",
      "troops deploy", "troops deployed",
      "deploys troops", "deployed troops",
      "hostilities intensify", "conflict escalates",
      "oil", "crude", "shipping", "tanker", "tankers",
      "hormuz", "red sea", "suez",
      "sanction", "sanctions"
    ]);
  }

  if (eventType === "FED_POLICY_EVENT") {
    return hasAny(text, [
      "decision", "statement", "press conference",
      "minutes", "testimony", "speech",
      "rate hike", "rate cut", "rates unchanged",
      "raise interest rates", "raises interest rates",
      "lower interest rates", "cut interest rates",
      "discount rate", "primary credit rate",
      "hawkish", "dovish", "tightening", "easing"
    ]);
  }

  if (eventType === "TREASURY_RATES_RISK") {
    return hasAny(text, [
      "yield", "auction", "selloff",
      "surge", "spike", "jump", "plunge",
      "record", "highest", "lowest",
      "liquidity", "disorder"
    ]);
  }

  if (eventType === "MACRO_DATA_RELEASE") {
    return hasAny(text, [
      "rose", "fell", "increased", "decreased",
      "unchanged", "actual", "reported", "came in",
      "above", "below", "unexpected", "surprise",
      "accelerated", "slowed", "revised"
    ]);
  }

  if (eventType === "TRADE_POLICY_RISK") {
    return hasAny(text, [
      "tariff", "tariffs", "duties",
      "export ban", "import ban", "export controls",
      "trade restriction", "trade restrictions",
      "embargo", "retaliation", "retaliates"
    ]);
  }

  if (eventType === "FINANCIAL_STRESS_EVENT") {
    return hasAny(text, [
      "bank run", "bank failure", "banking crisis",
      "liquidity crisis", "funding stress", "credit stress",
      "credit crisis", "systemic risk", "default",
      "deposit flight", "bailout", "bank rescue",
      "repo stress"
    ]);
  }

  if (eventType === "ENERGY_SUPPLY_EVENT") {
    return hasAny(text, [
      "outage", "production cut", "output cut",
      "halt", "disruption", "shortage",
      "attack", "sanction", "sanctions"
    ]);
  }

  return hasAny(text, MATERIAL_TERMS);
}
function severityFor(eventType, text, material) {
  if (!material) return "LOW";

  if (
    ["GEOPOLITICAL_OIL_SUPPLY_RISK", "FINANCIAL_STRESS_EVENT"].includes(eventType)
  ) {
    return "HIGH";
  }

  if (eventType === "GEOPOLITICAL_ESCALATION") {
    if (isMajorStrategicEscalation(text)) {
      return "HIGH";
    }

    if (
      hasAny(text, [
        "invasion",
        "blockade",
        "airstrike", "airstrikes", "air strike", "air strikes",
        "strike", "strikes", "struck", "striking",
        "missile", "missiles",
        "military strike", "military strikes",
        "hostilities intensify", "conflict escalates"
      ])
    ) {
      return "HIGH";
    }

    return "MODERATE";
  }

  if (
    eventType === "TREASURY_RATES_RISK" &&
    hasAny(text, [
      "disorder", "liquidity crisis", "record high",
      "yield spike", "yields surge", "weak auction"
    ])
  ) {
    return "HIGH";
  }

  return "MODERATE";
}
function oilSupplyRiskFor(eventType, text) {
  if (
    ["GEOPOLITICAL_OIL_SUPPLY_RISK", "ENERGY_SUPPLY_EVENT"].includes(eventType)
  ) {
    return true;
  }

  if (eventType !== "GEOPOLITICAL_ESCALATION") {
    return false;
  }

  return hasAll(text, [
    [
      "oil", "crude", "tanker", "shipping",
      "pipeline", "refinery",
      "hormuz", "red sea", "suez"
    ],
    [
      "supply", "disruption", "attack", "attacks", "attacked",
      "strike", "strikes", "struck", "striking",
      "closure", "blockade", "sanction", "shipping", "exports"
    ],
  ]);
}

function treasuryLiquidityRiskFor(eventType, text) {
  if (eventType === "TREASURY_RATES_RISK") {
    return true;
  }

  if (eventType !== "FINANCIAL_STRESS_EVENT") {
    return false;
  }

  return hasAny(text, [
    "funding", "liquidity", "credit",
    "bank", "banking", "repo",
    "commercial paper", "deposit",
    "counterparty", "systemic",
    "financial stability",
  ]);
}

function canonicalSourceUrl(value) {
  const raw = normalizeText(value);
  if (!raw) return null;

  try {
    const url = new URL(raw);
    url.hash = "";
    url.search = "";
    return url.toString();
  } catch {
    return raw;
  }
}

function stableProviderArticleId(article) {
  const sourceUrl = canonicalSourceUrl(article?.link);
  const source = normalizeText(article?.source).toLowerCase();
  const publishDate = parseIso(article?.publishDate) || "";
  const title = normalizeText(article?.title).toLowerCase();

  const identity = [sourceUrl || "", source, publishDate, title].join("|");

  if (!identity.replace(/\|/g, "")) {
    return null;
  }

  return createHash("sha256").update(identity).digest("hex").slice(0, 24);
}

export function normalizeFinlightArticle(
  article,
  now = new Date(),
  providerFetchedAtUtc = null
) {
  if (!article || typeof article !== "object") {
    return null;
  }

  const title = normalizeText(article?.title);
  const observedAt = parseIso(article?.publishDate);
  const providerArticleId = stableProviderArticleId(article);
  const sourceUrl = canonicalSourceUrl(article?.link);
  const publisherSource = normalizeText(article?.source) || null;

  if (!title || !observedAt || !providerArticleId) {
    return null;
  }

  const text = articleText(article);
  const candidates = classifyCandidates(text);
  const eventType = candidates[0] || null;

  if (!eventType || !APPROVED_EVENT_TYPES.includes(eventType)) {
    return null;
  }

  const material = materialFor(eventType, text);
  const expiresAt = addHours(observedAt, EXPIRY_HOURS[eventType]);
  const oilSupplyRisk = oilSupplyRiskFor(eventType, text);
  const treasuryLiquidityRisk = treasuryLiquidityRiskFor(eventType, text);
  const eventThreadKey = eventThreadKeyFor(
    eventType,
    primaryEntity(text),
    text
  );

  const nowMs = now instanceof Date ? now.getTime() : Date.parse(now);
  const expiresMs = Date.parse(expiresAt || "");
  const expired =
    Number.isFinite(nowMs) &&
    Number.isFinite(expiresMs) &&
    nowMs >= expiresMs;

  const fetchedAt = parseIso(providerFetchedAtUtc) || null;
  const providerFirstSeenAt = parseIso(article?.createdAt) || null;

  const publishedMs = Date.parse(observedAt);
  const firstSeenMs = Date.parse(providerFirstSeenAt || "");
  const fetchedMs = Date.parse(fetchedAt || "");

  const publisherToFinlightLatencyMs =
    Number.isFinite(publishedMs) && Number.isFinite(firstSeenMs)
      ? Math.max(0, firstSeenMs - publishedMs)
      : null;

  const finlightToEngineFetchLatencyMs =
    Number.isFinite(firstSeenMs) && Number.isFinite(fetchedMs)
      ? Math.max(0, fetchedMs - firstSeenMs)
      : null;

  // Compatibility metric retained during the Finlight migration.
  const publishedToEngineFetchLatencyMs =
    Number.isFinite(publishedMs) && Number.isFinite(fetchedMs)
      ? Math.max(0, fetchedMs - publishedMs)
      : null;

  return {
    eventId: `FL-${providerArticleId}`,
    providerArticleId,
    benzingaId: null,
    provider: ENGINE25_NEWS_PROVIDER,
    source: publisherSource || ENGINE25_NEWS_SOURCE,
    sourceFeed: ENGINE25_NEWS_SOURCE,
    sourceTier: ENGINE25_NEWS_SOURCE_TIER,
    sourceUrl,
    eventType,
    headlineSummary: title,
    material,
    observedAt,
    providerPublishedAt: observedAt,
    providerFirstSeenAt,
    engineFetchedAt: fetchedAt,
    normalizedAt: now instanceof Date ? now.toISOString() : parseIso(now),
    publisherToFinlightLatencyMs,
    finlightToEngineFetchLatencyMs,
    publishedToEngineFetchLatencyMs,
    expiresAt,
    requiresMarketConfirmation: true,
    status: expired ? "EVENT_EXPIRED" : "EVENT_DETECTED",
    primaryTheme: themeFor(eventType, text),
    primaryEntity: primaryEntity(text),
    eventThreadKey,
    latestDevelopmentAt: observedAt,
    developments: [],
    oilSupplyRisk,
    treasuryLiquidityRisk,
    severity: severityFor(eventType, text, material),
    sourceMetadata: {
      finlightCreatedAt: providerFirstSeenAt,
      language: normalizeText(article?.language) || null,
      categories: Array.isArray(article?.categories)
        ? article.categories.filter(Boolean)
        : [],
      countries: Array.isArray(article?.countries)
        ? article.countries.filter(Boolean)
        : [],
    },
  };
}

function sameSecondaryIdentity(a, b) {
  if (!a || !b || a.eventType !== b.eventType) {
    return false;
  }

  const sameEntity = Boolean(
    a.primaryEntity &&
    b.primaryEntity &&
    a.primaryEntity === b.primaryEntity
  );

  if (sameEntity) {
    return true;
  }

  const sameTheme = Boolean(
    a.primaryTheme &&
    b.primaryTheme &&
    a.primaryTheme === b.primaryTheme
  );

  if (!sameTheme) {
    return false;
  }

  // The Manager approved OR matching, but a generic theme alone must not
  // collapse obviously different real-world events.
  if (
    a.primaryTheme === "GEOPOLITICAL_ESCALATION" &&
    a.primaryEntity &&
    b.primaryEntity &&
    a.primaryEntity !== b.primaryEntity
  ) {
    return false;
  }

  if (
    a.primaryTheme === "GEOPOLITICAL_ESCALATION" &&
    !a.primaryEntity &&
    !b.primaryEntity
  ) {
    return false;
  }

  return true;
}

export function dedupeEngine25NewsEvents(events = []) {
  const sorted = [...events]
    .filter(Boolean)
    .sort(
      (a, b) =>
        Date.parse(a.observedAt || "") -
        Date.parse(b.observedAt || "")
    );

  const kept = [];
  const seenArticles = new Map();

  for (const rawEvent of sorted) {
    const event = {
      ...rawEvent,
      developments: Array.isArray(rawEvent?.developments)
        ? rawEvent.developments
        : [],
      latestDevelopmentAt:
        rawEvent?.latestDevelopmentAt || rawEvent?.observedAt || null,
    };

    const articleIdentity = developmentIdentity(event);

    if (!articleIdentity) continue;

    if (seenArticles.has(articleIdentity)) {
      const index = seenArticles.get(articleIdentity);
      kept[index] = mergeDevelopmentEvidence(kept[index], event);
      continue;
    }

    const observedMs = Date.parse(event.observedAt || "");
    let duplicateIndex = -1;

    for (let i = 0; i < kept.length; i += 1) {
      const prior = kept[i];
      if (!sameSecondaryIdentity(event, prior)) continue;

      const priorMs = Date.parse(prior.observedAt || "");
      if (
        Number.isFinite(observedMs) &&
        Number.isFinite(priorMs) &&
        Math.abs(priorMs - observedMs) <= 30 * 60 * 1000
      ) {
        duplicateIndex = i;
        break;
      }
    }

    if (duplicateIndex >= 0) {
      kept[duplicateIndex] = mergeDevelopmentEvidence(
        kept[duplicateIndex],
        event
      );
      seenArticles.set(articleIdentity, duplicateIndex);
      continue;
    }

    kept.push(event);
    seenArticles.set(articleIdentity, kept.length - 1);
  }

  return kept.sort(
    (a, b) =>
      Date.parse(a.observedAt || "") -
      Date.parse(b.observedAt || "")
  );
}

export function buildEngine25NewsThreads(events = []) {
  const threads = new Map();

  for (const event of [...events].filter(Boolean)) {
    const key =
      String(event?.eventThreadKey || "").trim() ||
      `${eventFamily(event?.eventType)}:${String(event?.primaryEntity || "UNRESOLVED")
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, "_")}`;

    if (!threads.has(key)) {
      threads.set(key, {
        threadId: key,
        family: eventFamily(event?.eventType),
        primaryEntity: event?.primaryEntity || null,
        primaryTheme: event?.primaryTheme || null,
        firstObservedAt: event?.observedAt || null,
        latestObservedAt: event?.latestDevelopmentAt || event?.observedAt || null,
        eventCount: 0,
        developmentCount: 0,
        materialEventCount: 0,
        highestSeverity: "LOW",
        oilSupplyRisk: false,
        treasuryLiquidityRisk: false,
        eventIds: [],
        developments: [],
      });
    }

    const thread = threads.get(key);
    thread.eventCount += 1;
    thread.materialEventCount += event?.material === true ? 1 : 0;
    thread.highestSeverity = maxSeverity(thread.highestSeverity, event?.severity);
    thread.oilSupplyRisk = thread.oilSupplyRisk || event?.oilSupplyRisk === true;
    thread.treasuryLiquidityRisk =
      thread.treasuryLiquidityRisk || event?.treasuryLiquidityRisk === true;

    if (event?.eventId) thread.eventIds.push(event.eventId);

    const allDevelopments = [
      developmentFromEvent(event),
      ...(Array.isArray(event?.developments) ? event.developments : []),
    ].filter(Boolean);

    for (const development of allDevelopments) {
      const id = developmentIdentity(development);
      if (
        id &&
        !thread.developments.some(
          (existing) => developmentIdentity(existing) === id
        )
      ) {
        thread.developments.push(development);
      }
    }

    thread.developmentCount = thread.developments.length;

    const candidateTimes = [
      thread.firstObservedAt,
      event?.observedAt,
      ...thread.developments.map((item) => item?.observedAt),
    ]
      .map((value) => Date.parse(value || ""))
      .filter(Number.isFinite);

    if (candidateTimes.length) {
      thread.firstObservedAt = new Date(Math.min(...candidateTimes)).toISOString();
      thread.latestObservedAt = new Date(Math.max(...candidateTimes)).toISOString();
    }
  }

  return [...threads.values()]
    .map((thread) => ({
      ...thread,
      eventIds: [...new Set(thread.eventIds)],
      developments: thread.developments.sort(
        (a, b) => Date.parse(a?.observedAt || "") - Date.parse(b?.observedAt || "")
      ),
    }))
    .sort(
      (a, b) =>
        Date.parse(b.latestObservedAt || "") -
        Date.parse(a.latestObservedAt || "")
    );
}

export function normalizeFinlightNews(
  results = [],
  now = new Date(),
  providerFetchedAtUtc = null
) {
  const fetched = Array.isArray(results) ? results : [];

  const relevant = fetched
    .map((article) =>
      normalizeFinlightArticle(article, now, providerFetchedAtUtc)
    )
    .filter(Boolean);

  const deduped = dedupeEngine25NewsEvents(relevant);

  return {
    itemsFetched: fetched.length,
    itemsRelevant: relevant.length,
    itemsMaterial: deduped.filter((event) => event.material === true).length,
    events: deduped,
  };
}
