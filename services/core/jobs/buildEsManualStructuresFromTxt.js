// services/core/jobs/buildEsManualStructuresFromTxt.js
// Engine 1B — ES Manual Institutional / Negotiated Structures Builder
//
// Reads:  services/core/data/es-smz-manual-zones.txt
// Writes: services/core/data/es-smz-manual-structures.json
//
// Supported input formats:
//
// 1) NEG-only line:
//      | NEG 7435.50-7453.50   # optional comment
//      NEG 7390.00-7405.00
//
// 2) Parent + NEG line:
//      7196.50-7097.50 | NEG 7167.25-7122.75
//
// 3) Parent-only line:
//      7408.00-7424.00
//
// Notes:
// - ES prices are rounded to 0.25 ticks.
// - NEG-only lines create negotiated/value zones without a parent.
// - Parent + NEG lines create both institutional parent and negotiated child.
// - Reversed ranges are accepted and normalized.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SYMBOL = "ES";
const TICK_SIZE = 0.25;

const IN_TXT = path.resolve(__dirname, "../data/es-smz-manual-zones.txt");
const OUT_JSON = path.resolve(__dirname, "../data/es-smz-manual-structures.json");

const nowIso = () => new Date().toISOString();

function roundToTick(price, tick = TICK_SIZE) {
  if (price === null || price === undefined || price === "") return null;

  const n = Number(price);
  if (!Number.isFinite(n)) return null;

  return Number((Math.round(n / tick) * tick).toFixed(2));
}

function fmt2(x) {
  const n = roundToTick(x);
  return Number.isFinite(n) ? n.toFixed(2) : "NaN";
}

function parseRangeToken(token) {
  const t = String(token || "").trim();
  const m = t.match(/(-?\d+(?:\.\d+)?)\s*-\s*(-?\d+(?:\.\d+)?)/);

  if (!m) return null;

  const a = roundToTick(Number(m[1]));
  const b = roundToTick(Number(m[2]));

  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;

  const hi = roundToTick(Math.max(a, b));
  const lo = roundToTick(Math.min(a, b));

  if (!(hi > lo)) return null;

  return {
    hi,
    lo,
    mid: roundToTick((hi + lo) / 2),
    width: roundToTick(hi - lo),
  };
}

function makeInstitutional(hi, lo, extraNote = "") {
  const key = `MANUAL|${SYMBOL}|${fmt2(lo)}-${fmt2(hi)}`;

  return {
    structureKey: key,
    symbol: SYMBOL,
    tier: "structure",
    manualRange: [hi, lo],
    priceRange: [hi, lo],
    displayPriceRange: [hi, lo],
    locked: true,
    rangeSource: "manual",
    status: "active",
    stickyConfirmed: true,
    isNegotiated: false,
    notes: extraNote || "Manual ES institutional zone",
  };
}

function makeNegotiated({ negHi, negLo, parentHi = null, parentLo = null, extraNote = "" }) {
  const key = `MANUAL|${SYMBOL}|NEG|${fmt2(negLo)}-${fmt2(negHi)}`;

  const hasParent = Number.isFinite(parentHi) && Number.isFinite(parentLo);

  const baseNote = hasParent
    ? `NEGOTIATED / VALUE zone inside ES institutional ${fmt2(parentLo)}–${fmt2(parentHi)}`
    : "NEGOTIATED / VALUE zone from ES manual file";

  const note = extraNote ? `${baseNote} — ${extraNote}` : baseNote;

  return {
    structureKey: key,
    symbol: SYMBOL,
    tier: "structure",
    manualRange: [negHi, negLo],
    priceRange: [negHi, negLo],
    displayPriceRange: [negHi, negLo],
    locked: true,
    rangeSource: "manual",
    status: "active",
    stickyConfirmed: true,
    isNegotiated: true,
    notes: note,
  };
}

function backupIfExists(filePath) {
  if (!fs.existsSync(filePath)) return;

  const ts = nowIso().replace(/[:.]/g, "-");
  const bak = filePath.replace(/\.json$/i, "") + `.backup.${ts}.json`;

  fs.copyFileSync(filePath, bak);
  console.log("[ES MANUAL] Backup created:", bak);
}

function lineLooksNegOnly(parts) {
  if (!parts.length) return false;

  if (parts.length === 1 && /^NEG\b/i.test(parts[0])) return true;

  if (parts.length >= 1 && /^NEG\b/i.test(parts[0])) return true;

  if (parts.length >= 2 && parts[0] === "" && /^NEG\b/i.test(parts[1])) return true;

  return false;
}

function main() {
  if (!fs.existsSync(IN_TXT)) {
    console.error("[ES MANUAL] Missing input file:", IN_TXT);
    process.exitCode = 1;
    return;
  }

  const raw = fs.readFileSync(IN_TXT, "utf8");
  const lines = raw.split(/\r?\n/);

  const structures = [];
  const errors = [];
  const seen = new Set();

  function pushUnique(s) {
    if (!s?.structureKey) return;
    if (seen.has(s.structureKey)) return;

    seen.add(s.structureKey);
    structures.push(s);
  }

  for (let idx = 0; idx < lines.length; idx++) {
    const originalLine = lines[idx];

    let line = String(originalLine || "").trim();
    if (!line) continue;
    if (line.startsWith("#") || line.startsWith("//")) continue;

    const hash = line.indexOf("#");
    const comment = hash >= 0 ? line.slice(hash + 1).trim() : "";

    if (hash >= 0) line = line.slice(0, hash).trim();
    if (!line) continue;

    const rawParts = line.split("|").map((p) => p.trim());
    const parts = rawParts.filter(Boolean);

    if (!parts.length) continue;

    // Case A: starts with "| NEG ..." or "NEG ..."
    const startsWithPipeNeg = rawParts.length >= 2 && rawParts[0] === "" && /^NEG\b/i.test(rawParts[1]);
    const startsWithNeg = /^NEG\b/i.test(parts[0]);

    if (startsWithPipeNeg || startsWithNeg) {
      const negPart = startsWithPipeNeg ? rawParts[1] : parts[0];
      const token = negPart.replace(/^NEG\b\s*/i, "").trim();
      const negR = parseRangeToken(token);

      if (!negR) {
        errors.push(`Line ${idx + 1}: bad NEG-only range: "${originalLine}"`);
        continue;
      }

      pushUnique(
        makeNegotiated({
          negHi: negR.hi,
          negLo: negR.lo,
          extraNote: comment,
        })
      );

      continue;
    }

    // Case B: parent range first
    const instR = parseRangeToken(parts[0]);
    if (!instR) {
      errors.push(`Line ${idx + 1}: bad institutional range: "${parts[0]}"`);
      continue;
    }

    pushUnique(makeInstitutional(instR.hi, instR.lo, comment));

    // Optional NEG child
    const negPart = parts.find((p) => /^NEG\b/i.test(p));
    if (negPart) {
      const token = negPart.replace(/^NEG\b\s*/i, "").trim();
      const negR = parseRangeToken(token);

      if (!negR) {
        errors.push(`Line ${idx + 1}: bad NEG range: "${negPart}"`);
        continue;
      }

      if (!(negR.hi <= instR.hi && negR.lo >= instR.lo)) {
        errors.push(
          `Line ${idx + 1}: NEG ${fmt2(negR.lo)}-${fmt2(negR.hi)} is NOT inside parent ${fmt2(instR.lo)}-${fmt2(instR.hi)}`
        );
        continue;
      }

      pushUnique(
        makeNegotiated({
          negHi: negR.hi,
          negLo: negR.lo,
          parentHi: instR.hi,
          parentLo: instR.lo,
          extraNote: comment,
        })
      );
    }
  }

  if (errors.length) {
    console.error("[ES MANUAL] Errors found. Fix these lines:");
    for (const e of errors) console.error(" -", e);
    process.exitCode = 1;
    return;
  }

  const payload = {
    ok: true,
    meta: {
      schema: "es-smz-manual-structures@1",
      updatedUtc: nowIso(),
      symbol: SYMBOL,
      tickSize: TICK_SIZE,
      inputFile: path.basename(IN_TXT),
      notes: "Generated from es-smz-manual-zones.txt. Do not hand-edit this JSON.",
    },
    structures,
  };

  fs.mkdirSync(path.dirname(OUT_JSON), { recursive: true });
  backupIfExists(OUT_JSON);
  fs.writeFileSync(OUT_JSON, JSON.stringify(payload, null, 2), "utf8");

  console.log("[ES MANUAL] Wrote:", OUT_JSON);
  console.log("[ES MANUAL] Structures:", structures.length);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export default main;
