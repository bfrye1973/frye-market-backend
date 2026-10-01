// services/core/logic/engine25/buildSectorCardGroups.js
// Packaging helper for Engine25 sector-card group exposure.
// Reuses the existing 55/45 sector classification contract only.

export const CANONICAL_ENGINE25_SECTORS = [
  "Information Technology",
  "Communication Services",
  "Consumer Staples",
  "Utilities",
  "Real Estate",
  "Financials",
  "Health Care",
  "Industrials",
  "Energy",
  "Materials",
  "Consumer Discretionary",
];

const CANONICAL_BY_KEY = new Map(
  CANONICAL_ENGINE25_SECTORS.map((name) => [name.toLowerCase(), name])
);

const SECTOR_ALIASES = new Map([
  ["technology", "Information Technology"],
  ["tech", "Information Technology"],
  ["information technology", "Information Technology"],
  ["communication services", "Communication Services"],
  ["communications", "Communication Services"],
  ["consumer staples", "Consumer Staples"],
  ["utilities", "Utilities"],
  ["real estate", "Real Estate"],
  ["financials", "Financials"],
  ["financial", "Financials"],
  ["healthcare", "Health Care"],
  ["health care", "Health Care"],
  ["industrials", "Industrials"],
  ["energy", "Energy"],
  ["materials", "Materials"],
  ["consumer discretionary", "Consumer Discretionary"],
]);

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export function canonicalEngine25SectorName(value) {
  const key = String(value || "").trim().toLowerCase();
  if (!key) return null;
  return SECTOR_ALIASES.get(key) || CANONICAL_BY_KEY.get(key) || null;
}

export function classifyEngine25SectorCard(card) {
  const breadth = finite(card?.breadth_pct);
  const momentum = finite(card?.momentum_pct);

  if (breadth === null || momentum === null) return "UNAVAILABLE";
  if (breadth >= 55 && momentum >= 55) return "STRONG";
  if (breadth <= 45 && momentum <= 45) return "WEAK";
  return "NEUTRAL";
}

export function buildEngine25SectorGroups(cards) {
  const list = Array.isArray(cards) ? cards : [];
  const canonical = [];
  const duplicateNames = [];
  const unknownNames = [];
  const seen = new Set();

  for (const card of list) {
    const rawName = card?.sector || card?.name || null;
    const name = canonicalEngine25SectorName(rawName);

    if (!name) {
      unknownNames.push(String(rawName || "MISSING"));
      continue;
    }

    if (seen.has(name)) {
      duplicateNames.push(name);
      continue;
    }

    seen.add(name);
    canonical.push({ name, card });
  }

  const missingNames = CANONICAL_ENGINE25_SECTORS.filter(
    (name) => !seen.has(name)
  );

  const incompleteCards = canonical
    .filter(({ card }) => classifyEngine25SectorCard(card) === "UNAVAILABLE")
    .map(({ name }) => name);

  const complete =
    canonical.length === CANONICAL_ENGINE25_SECTORS.length &&
    duplicateNames.length === 0 &&
    unknownNames.length === 0 &&
    missingNames.length === 0 &&
    incompleteCards.length === 0;

  if (!complete) {
    return {
      available: false,
      complete: false,
      reason: "INCOMPLETE_CANONICAL_SECTOR_CARDS",
      strong: [],
      neutral: [],
      weak: [],
      expectedCount: CANONICAL_ENGINE25_SECTORS.length,
      receivedCanonicalCount: canonical.length,
      missingNames,
      duplicateNames,
      unknownNames,
      incompleteCards,
    };
  }

  const groups = {
    strong: [],
    neutral: [],
    weak: [],
  };

  for (const { name, card } of canonical) {
    const classification = classifyEngine25SectorCard(card);
    if (classification === "STRONG") groups.strong.push(name);
    else if (classification === "WEAK") groups.weak.push(name);
    else groups.neutral.push(name);
  }

  return {
    available: true,
    complete: true,
    reason: null,
    ...groups,
    expectedCount: CANONICAL_ENGINE25_SECTORS.length,
    receivedCanonicalCount: canonical.length,
    missingNames: [],
    duplicateNames: [],
    unknownNames: [],
    incompleteCards: [],
  };
}
