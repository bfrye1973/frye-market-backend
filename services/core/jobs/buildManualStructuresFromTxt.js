// services/core/jobs/buildManualStructuresFromTxt.js
// Reads:  services/core/data/smz-manual-zones.txt
// Writes: services/core/data/smz-manual-structures.json
//
// Input lines:
//   686.00-688.70 | NEG 687.16-688.22   # optional comment
//   680.58-683.61                      # NEG optional
//
// Output matches schema you already use.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SYMBOL = "SPY";

const IN_TXT = path.resolve(__dirname, "../data/smz-manual-zones.txt");
const OUT_JSON = path.resolve(__dirname, "../data/smz-manual-structures.json");

const nowIso = () => new Date().toISOString();
const round2 = (x) => Math.round(Number(x) * 100) / 100;
const fmt2 = (x) => round2(x).toFixed(2);

function parseRangeToken(token) {
  // accepts "686.00-688.70" or "688.70-686.00"
  const t = String(token || "").trim();
  const m = t.match(/(-?\d+(?:\.\d+)?)\s*-\s*(-?\d+(?:\.\d+)?)/);
  if (!m) return null;
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  const hi = round2(Math.max(a, b));
  const lo = round2(Math.min(a, b));
  if (!(hi > lo)) return null;
  return { hi, lo };
}

function makeInstitutional(hi, lo) {
  const key = `MANUAL|${SYMBOL}|${fmt2(lo)}-${fmt2(hi)}`;
  return {
    structureKey: key,
    symbol: SYMBOL,
    tier: "structure",
    manualRange: [hi, lo],
    priceRange: [hi, lo],
    locked: true,
    rangeSource: "manual",
    status: "active",
    stickyConfirmed: true,
  };
}

function makeNegotiated(parentHi, parentLo, negHi, negLo, extraNote = "") {
  const key = `MANUAL|${SYMBOL}|NEG|${fmt2(negLo)}-${fmt2(negHi)}`;
  const baseNote = `NEGOTIATED / VALUE zone inside institutional ${fmt2(parentLo)}–${fmt2(parentHi)} (turquoise)`;
  const note = extraNote ? `${baseNote} — ${extraNote}` : baseNote;

  return {
    structureKey: key,
    symbol: SYMBOL,
    tier: "structure",
    manualRange: [negHi, negLo],
    priceRange: [negHi, negLo],
    locked: true,
    rangeSource: "manual",
    status: "active",
    stickyConfirmed: true,
    notes: note,
  };
}

function backupIfExists(filePath) {
  if (!fs.existsSync(filePath)) return;
  const ts = nowIso().replace(/[:.]/g, "-");
  const bak = filePath.replace(/\.json$/i, "") + `.backup.${ts}.json`;
  fs.copyFileSync(filePath, bak);
  console.log("[MANUAL] Backup created:", bak);
}

function main() {
  if (!fs.existsSync(IN_TXT)) {
    console.error("[MANUAL] Missing input file:", IN_TXT);
    process.exitCode = 1;
    return;
  }

  const raw = fs.readFileSync(IN_TXT, "utf8");
  const lines = raw.split(/\r?\n/);

  const structures = [];
  const errors = [];

  for (let idx = 0; idx < lines.length; idx++) {
    let line = lines[idx].trim();
    if (!line) continue;
    if (line.startsWith("#") || line.startsWith("//")) continue;

    // strip inline comment
    const hash = line.indexOf("#");
    const comment = hash >= 0 ? line.slice(hash + 1).trim() : "";
    if (hash >= 0) line = line.slice(0, hash).trim();

    // split parts by |
    const parts = line.split("|").map((p) => p.trim()).filter(Boolean);
    if (!parts.length) continue;

    // part0 must be the institutional range
    const instR = parseRangeToken(parts[0]);
    if (!instR) {
      errors.push(`Line ${idx + 1}: bad institutional range: "${parts[0]}"`);
      continue;
    }

    const inst = makeInstitutional(instR.hi, instR.lo);
    structures.push(inst);

    // optional NEG part
    const negPart = parts.find((p) => /^NEG\b/i.test(p));
    if (negPart) {
      const token = negPart.replace(/^NEG\b\s*/i, "").trim();
      const negR = parseRangeToken(token);
      if (!negR) {
        errors.push(`Line ${idx + 1}: bad NEG range: "${negPart}"`);
        continue;
      }

      // NEG must be inside parent
      if (!(negR.hi <= instR.hi && negR.lo >= instR.lo)) {
        errors.push(
          `Line ${idx + 1}: NEG ${fmt2(negR.lo)}-${fmt2(negR.hi)} is NOT inside parent ${fmt2(instR.lo)}-${fmt2(instR.hi)}`
        );
        continue;
      }

      structures.push(makeNegotiated(instR.hi, instR.lo, negR.hi, negR.lo, comment));
    }
  }

  if (errors.length) {
    console.error("[MANUAL] Errors found. Fix these lines:");
    for (const e of errors) console.error(" -", e);
    process.exitCode = 1;
    return;
  }

  const payload = {
    ok: true,
    meta: {
      schema: "smz-manual-structures@1",
      updatedUtc: nowIso(),
      symbol: SYMBOL,
      notes: "Generated from smz-manual-zones.txt (human-friendly source). Do not hand-edit this JSON.",
    },
    structures,
  };

  backupIfExists(OUT_JSON);
  fs.writeFileSync(OUT_JSON, JSON.stringify(payload, null, 2), "utf8");
  console.log("[MANUAL] Wrote:", OUT_JSON);
  console.log("[MANUAL] Structures:", structures.length);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export default main;
