// services/core/logic/engine25NewsFilter.js
// Engine 25 Finlight News v0.1
// Pure relevance, classification, expiry, and dedupe logic.
// No provider calls. No trade direction. No market confirmation thresholds.
//
// Provider contract:
// - Finlight is discovery only.
// - Original publisher/source remains visible on each normalized event.
// - NEWS IDENTIFIES THE EVENT. MARKETS CONFIRM THE EVENT.
// - One underlying news event = one canonical Engine 25 event.

import { createHash } from "crypto";

export const ENGINE25_NEWS_ENGINE = "engine25.finlightNews.v0.1";
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
  "attack", "attacks", "airstrike", "airstrikes", "strike", "strikes",
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
    "attack",
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
    "halt", "halted", "attack", "attacks",
    "sanction", "sanctions"
  ];

  const geopoliticalTerms = [
    "war", "military", "attack", "airstrike", "missile", "drone",
    "invasion", "retaliation", "ceasefire", "troops",
    "conflict", "hostilities", "sanction", "sanctions",
    "hormuz", "red sea"
  ];

  const militarySecurityTerms = [
    "military", "attack", "attacks",
    "airstrike", "airstrikes",
    "missile", "missiles",
    "drone", "drones",
    "invasion", "retaliation", "ceasefire",
    "troops", "conflict", "hostilities",
    "hormuz", "red sea"
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
  const independentMilitarySecurityMatch = hasAny(text, militarySecurityTerms);
  const hormuzConcreteDisruption = isHormuzConcreteDisruption(text);

  const treasuryContextMatch = hasAny(text, treasuryContextTerms);
  const treasuryRiskActionMatch = hasAny(text, treasuryRiskActionTerms);

  const fedEntityMatch = hasAny(text, fedEntityTerms);
  const fedPolicyMatch = hasAny(text, fedPolicyTerms);
  const fedOfficialActionMatch = hasAny(text, fedOfficialActionTerms);

  if (
    (hasAll(text, [oilTerms, supplyTerms]) && hasAny(text, geopoliticalTerms)) ||
    hormuzConcreteDisruption
  ) {
    candidates.push("GEOPOLITICAL_OIL_SUPPLY_RISK");
  }

  if (hasAny(text, stressTerms)) {
    candidates.push("FINANCIAL_STRESS_EVENT");
  }

  // Treasury risk now requires both a Treasury/bond-market context AND
  // a concrete rates/auction/selloff/liquidity action. Merely mentioning
  // Treasury, bonds, or yields in a general market wrap is not enough.
  if (treasuryContextMatch && treasuryRiskActionMatch) {
    candidates.push("TREASURY_RATES_RISK");
  }

  if (
    hasAny(text, energyTerms) &&
    hasAny(text, [
      "supply", "outage", "cut", "halt",
      "disruption", "shortage", "attack", "sanction"
    ])
  ) {
    candidates.push("ENERGY_SUPPLY_EVENT");
  }

  // Fed policy now requires an actual Fed entity + policy language,
  // or an explicit official Fed/FOMC action phrase.
  if (
    (fedEntityMatch && fedPolicyMatch) ||
    fedOfficialActionMatch
  ) {
    candidates.push("FED_POLICY_EVENT");
  }

  if (tradePolicyMatch) {
    candidates.push("TRADE_POLICY_RISK");
  }

  // Explicit tariff/trade-war stories stay TRADE_POLICY_RISK unless the
  // same article independently contains genuine military/security escalation.
  if (
    hasAny(text, geopoliticalTerms) &&
    (!tradePolicyMatch || independentMilitarySecurityMatch)
  ) {
    candidates.push("GEOPOLITICAL_ESCALATION");
  }

  if (hasAny(text, macroTerms)) {
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

  if (hasAny(text, MATERIAL_TERMS)) {
    return true;
  }

  if (
    eventType === "GEOPOLITICAL_OIL_SUPPLY_RISK" &&
    isHormuzConcreteDisruption(text)
  ) {
    return true;
  }

  if (eventType === "FED_POLICY_EVENT") {
    const fedPolicyMaterialTerms = [
      "decision", "statement", "press conference",
      "minutes", "testimony", "rate", "fomc",
      "interest rates",
      "raise interest rates",
      "raises interest rates",
      "raising interest rates",
      "lower interest rates",
      "cut interest rates",
      "rates higher",
      "rates lower",
      "discount rate",
      "primary credit rate"
    ];

    if (hasAny(text, fedPolicyMaterialTerms)) {
      return true;
    }

    const explicitFedContext = hasAny(text, [
      "federal reserve", "fomc",
      "boston fed", "cleveland fed", "minneapolis fed",
      "kansas city fed", "dallas fed", "new york fed",
      "chicago fed", "st. louis fed", "san francisco fed",
      "atlanta fed", "richmond fed", "philadelphia fed",
      "collins", "powell",
      "policy", "hike", "cut", "raise", "lower"
    ]);

    return explicitFedContext && hasTerm(text, "rates");
  }

  if (eventType === "TREASURY_RATES_RISK") {
    return hasAny(text, [
      "yield", "auction", "selloff",
      "surge", "spike", "jump", "plunge",
      "record", "highest", "lowest"
    ]);
  }

  if (eventType === "MACRO_DATA_RELEASE") {
    return hasAny(text, [
      "rose", "fell", "increased", "decreased",
      "unchanged", "actual", "reported", "came in",
      "above", "below", "unexpected", "surprise"
    ]);
  }

  return false;
}

function severityFor(eventType, text, material) {
  if (!material) return "LOW";

  if (
    hasAny(text, [
      "war", "invasion", "blockade", "closure",
      "bank run", "banking crisis", "liquidity crisis",
      "systemic risk", "default", "attack on", "attacks on"
    ])
  ) {
    return "HIGH";
  }

  if (
    ["GEOPOLITICAL_OIL_SUPPLY_RISK", "FINANCIAL_STRESS_EVENT"].includes(eventType)
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
      "supply", "disruption", "attack", "closure",
      "blockade", "sanction", "shipping", "exports"
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
        Date.parse(b.observedAt || "") -
        Date.parse(a.observedAt || "")
    );

  const kept = [];
  const seenArticles = new Set();

  for (const event of sorted) {
    const articleIdentity =
      String(event?.sourceUrl || "").trim() ||
      String(event?.providerArticleId || "").trim() ||
      String(event?.eventId || "").trim();

    if (!articleIdentity || seenArticles.has(articleIdentity)) {
      continue;
    }

    seenArticles.add(articleIdentity);

    const observedMs = Date.parse(event.observedAt || "");

    const duplicate = kept.some((prior) => {
      if (!sameSecondaryIdentity(event, prior)) {
        return false;
      }

      const priorMs = Date.parse(prior.observedAt || "");

      return (
        Number.isFinite(observedMs) &&
        Number.isFinite(priorMs) &&
        Math.abs(priorMs - observedMs) <= 30 * 60 * 1000
      );
    });

    if (!duplicate) {
      kept.push(event);
    }
  }

  return kept.sort(
    (a, b) =>
      Date.parse(a.observedAt || "") -
      Date.parse(b.observedAt || "")
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
