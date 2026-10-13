// services/core/tests/engine25SectorGroupPackaging.test.js

import assert from "node:assert/strict";
import {
  CANONICAL_ENGINE25_SECTORS,
  buildEngine25SectorGroups,
  canonicalEngine25SectorName,
  classifyEngine25SectorCard,
} from "../logic/engine25/buildSectorCardGroups.js";

function run(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

const cards = [
  { sector: "tech", breadth_pct: 70, momentum_pct: 70 },
  { sector: "communication services", breadth_pct: 60, momentum_pct: 58 },
  { sector: "consumer staples", breadth_pct: 50, momentum_pct: 52 },
  { sector: "utilities", breadth_pct: 44, momentum_pct: 44 },
  { sector: "real estate", breadth_pct: 48, momentum_pct: 43 },
  { sector: "financials", breadth_pct: 56, momentum_pct: 61 },
  { sector: "Healthcare", breadth_pct: 42, momentum_pct: 41 },
  { sector: "industrials", breadth_pct: 57, momentum_pct: 56 },
  { sector: "energy", breadth_pct: 52, momentum_pct: 61 },
  { sector: "materials", breadth_pct: 39, momentum_pct: 40 },
  { sector: "consumer discretionary", breadth_pct: 65, momentum_pct: 63 },
];

run("1 canonical names normalize aliases without duplicates", () => {
  assert.equal(canonicalEngine25SectorName("tech"), "Information Technology");
  assert.equal(canonicalEngine25SectorName("Healthcare"), "Health Care");
  assert.equal(
    new Set(CANONICAL_ENGINE25_SECTORS).size,
    CANONICAL_ENGINE25_SECTORS.length
  );
});

run("2 existing 55/45 rules classify strong weak neutral", () => {
  assert.equal(
    classifyEngine25SectorCard({ breadth_pct: 55, momentum_pct: 55 }),
    "STRONG"
  );
  assert.equal(
    classifyEngine25SectorCard({ breadth_pct: 45, momentum_pct: 45 }),
    "WEAK"
  );
  assert.equal(
    classifyEngine25SectorCard({ breadth_pct: 55, momentum_pct: 54.99 }),
    "NEUTRAL"
  );
  assert.equal(
    classifyEngine25SectorCard({ breadth_pct: null, momentum_pct: 55 }),
    "UNAVAILABLE"
  );
});

run("3 complete canonical set exposes exact group names once", () => {
  const result = buildEngine25SectorGroups(cards);

  assert.equal(result.available, true);
  assert.equal(result.complete, true);
  assert.deepEqual(result.strong, [
    "Information Technology",
    "Communication Services",
    "Financials",
    "Industrials",
    "Consumer Discretionary",
  ]);
  assert.deepEqual(result.neutral, [
    "Consumer Staples",
    "Real Estate",
    "Energy",
  ]);
  assert.deepEqual(result.weak, [
    "Utilities",
    "Health Care",
    "Materials",
  ]);

  const all = [...result.strong, ...result.neutral, ...result.weak];
  assert.equal(all.length, 11);
  assert.equal(new Set(all).size, 11);
  assert.deepEqual(
    [...all].sort(),
    [...CANONICAL_ENGINE25_SECTORS].sort()
  );
});

run("4 duplicate alias fails closed instead of forcing neutral", () => {
  const result = buildEngine25SectorGroups([
    ...cards,
    { sector: "Information Technology", breadth_pct: 60, momentum_pct: 60 },
  ]);

  assert.equal(result.available, false);
  assert.equal(result.complete, false);
  assert.deepEqual(result.strong, []);
  assert.deepEqual(result.neutral, []);
  assert.deepEqual(result.weak, []);
  assert.ok(result.duplicateNames.includes("Information Technology"));
});

run("5 missing sector fails closed", () => {
  const result = buildEngine25SectorGroups(cards.slice(0, 10));

  assert.equal(result.available, false);
  assert.equal(result.complete, false);
  assert.deepEqual(result.strong, []);
  assert.deepEqual(result.neutral, []);
  assert.deepEqual(result.weak, []);
  assert.ok(result.missingNames.includes("Consumer Discretionary"));
});

run("6 incomplete card values fail closed", () => {
  const broken = cards.map((card) => ({ ...card }));
  broken[0].breadth_pct = null;

  const result = buildEngine25SectorGroups(broken);

  assert.equal(result.available, false);
  assert.equal(result.complete, false);
  assert.deepEqual(result.strong, []);
  assert.deepEqual(result.neutral, []);
  assert.deepEqual(result.weak, []);
  assert.ok(result.incompleteCards.includes("Information Technology"));
});

console.log("engine25SectorGroupPackaging.test.js PASS");
