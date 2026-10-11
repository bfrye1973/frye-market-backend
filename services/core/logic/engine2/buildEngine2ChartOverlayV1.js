// Engine 2B v1 — read-only published-structure chart adapter.
// Never computes Fibonacci levels, changes engine state, or falls back from Micro to Subminute.
const DEGREE_NAMES = ["primary", "intermediate", "minor", "minute", "micro"];
const finite = (value) => value == null || value === "" || typeof value === "boolean" ? null : Number.isFinite(Number(value)) ? Number(value) : null;
const normalizeTime = (input) => {
  if (typeof input === "number" && Number.isFinite(input)) return input > 1e12 ? Math.floor(input / 1000) : Math.floor(input);
  if (typeof input !== "string" || !input.trim()) return null;
  const raw = input.trim();
  if (/^\d{10,13}$/.test(raw)) return normalizeTime(Number(raw));
  // Published timezone-naive Engine22 timestamps are Phoenix local by current convention.
  // Calendar date without time represents a day, not a verified intraday anchor.
  const normalized = raw.includes("T") ? raw : raw.replace(" ", "T");
  if (!/T\d{2}:\d{2}/.test(normalized)) return null;
  const zoned = /(?:Z|[+-]\d{2}:\d{2})$/.test(normalized) ? normalized : normalized + "-07:00";
  const ms = Date.parse(zoned);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
};
const safeArray = (v) => Array.isArray(v) ? v : [];
function addLine(lines, id, key, rawPrice, kind, sourcePath, status = null, displayLabel = null) {
  const price = finite(rawPrice);
  if (price == null || price <= 0) return;
  if (lines.some((x) => x.id === id)) return;
  lines.push({ id, key, price, kind, label: displayLabel || key.toUpperCase(), status, sourcePath });
}
function levelArray(levels, path) {
  const out = [];
  if (Array.isArray(levels)) {
    for (const [i, value] of levels.entries()) {
      if (!value || typeof value !== "object") continue;
      addLine(out, String(value.key || value.label || i), String(value.label || value.key || i),
        value.price, value.kind || "FIB", path + "[" + i + "]", value.status || null);
    }
  } else if (levels && typeof levels === "object") {
    for (const [key, value] of Object.entries(levels)) {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        addLine(out, key, key, value.price, value.kind || "FIB",
          path + "." + key, value.status || null, String(value.label || key));
        continue;
      }
      if (typeof value !== "number" && typeof value !== "string") continue;
      addLine(out, key, key, value, "FIB", path + "." + key);
    }
  }
  return out;
}
function markArray(marks, path) {
  const out = [];
  if (!marks || typeof marks !== "object") return out;
  const add = (name, node, source, parentStatus = null) => {
    const price = finite(node?.price ?? node?.p);
    const rawTime = node?.time ?? node?.timestamp ?? null;
    const time = normalizeTime(rawTime);
    if (price == null || price <= 0 || time == null) return;
    out.push({ id: name, label: name, price, time, status: node.status || parentStatus || null, sourcePath: source });
  };
  for (const [name, node] of Object.entries(marks)) {
    if (!node || typeof node !== "object") continue;
    if (node.low || node.high) {
      if (node.low) add(name + "_LOW", node.low, path + "." + name + ".low", node.status);
      if (node.high) add(name + "_HIGH", node.high, path + "." + name + ".high", node.status);
    } else add(name, node, path + "." + name);
  }
  return out;
}
function microMarks(state, source) {
  const seq = state?.microSequence || {};
  const out = [];
  const origin = seq.anchorProvenance || state.anchorProvenance || null;
  const originPrice = finite(origin?.price ?? seq.origin ?? state.origin);
  if (originPrice != null && normalizeTime(origin?.timestamp) != null) out.push({
    id: "MICRO_ORIGIN", label: "ORIGIN", price: originPrice, time: normalizeTime(origin.timestamp),
    status: "SOURCE_ANCHOR", sourcePath: source + ".microSequence.anchorProvenance"
  });
  const w1Price = finite(seq.w1Completion?.anchor ?? seq.confirmedW1High ?? seq.candidateW1High);
  const w1Time = normalizeTime(seq.w1Completion?.evidence?.sourceTimestamp ?? seq.w1ConfirmedAtBarTime ?? null);
  if (w1Price != null && w1Time != null) out.push({
    id: "MICRO_W1_HIGH", label: "W1", price: w1Price, time: w1Time,
    status: seq.w1Completion?.state || "CANDIDATE",
    sourcePath: source + ".microSequence.w1Completion"
  });
  const w2Price = finite(seq.w2Completion?.anchor ?? seq.confirmedW2Low);
  const w2Time = normalizeTime(seq.w2Completion?.evidence?.sourceTimestamp ?? null);
  if (w2Price != null && w2Time != null) out.push({
    id: "MICRO_W2_LOW", label: "W2", price: w2Price, time: w2Time,
    status: seq.w2Completion?.state || "CANDIDATE",
    sourcePath: source + ".microSequence.w2Completion"
  });
  return out;
}
function empty(degree, source, reason) {
  return { degree, drawable: false, reason, severity: "blocking", reasonCodes: [reason],
    sourceDegree: degree, wave: null, marks: [], lines: [], zones: [],
    provenance: { structuralSource: source, sourcesChecked: [source], fallbackUsed: false } };
}
export function buildEngine2ChartOverlayV1(snapshot, symbol = "ES") {
  if (symbol !== "ES") return { ok: false, schemaVersion: "engine2.chartOverlays.v1", symbol, error: "UNSUPPORTED_SYMBOL" };
  // Never combine structural degrees from different strategy snapshots.
  // The ES intraday lane is the published composite used by Engine 27.
  const strategy = snapshot?.strategies?.["intraday_scalp@10m"]?.engine22WaveStrategy || null;
  const degrees = {};
  const published = strategy?.degreeStates || {};
  const wavelength = strategy?.currentWavelength || null;
  for (const degree of DEGREE_NAMES) {
    const micro = degree === "micro";
    const source = micro ? "engine22WaveStrategy.currentWavelength.degrees.micro" :
      "engine22WaveStrategy.degreeStates." + degree;
    const state = micro ? wavelength?.degrees?.micro : published?.[degree];
    if (!state || typeof state !== "object") { degrees[degree] = empty(degree, source, "CANONICAL_DEGREE_UNAVAILABLE"); continue; }
    const marks = micro ? microMarks(state, source) :
      markArray(state.marks, source + ".marks");
    // For Micro only published currentWavelength levels are authoritative. Never substitute subminute.
    const activeFib = !micro && state.activeFibModel?.active === true ? state.activeFibModel : null;
    const structuralConflict = micro && wavelength?.canonicalWaveStateConflict === true;
    // Conflict is disclosed, not silently interpreted as confirmed evidence.
    // Inactive fibs must never be replaced with historical targetModel under an "active" label.
    let lines = micro ? levelArray(state.levels, source + ".levels") :
      activeFib ? levelArray(activeFib.levels ?? activeFib.displayLevels, source + ".activeFibModel") : [];
    // Prior Micro W1/W2 projection ladders remain structural references, NOT active W3 targets.
    // They may be displayed as context, with explicit provenance and non-authoritative kind.
    if (micro && lines.length === 0 && state?.microSequence) {
      const sequence = state.microSequence;
      for (const [waveKey, label] of [["projectedW1", "PRIOR W1"], ["projectedW2", "PRIOR W2"]]) {
        const reference = levelArray(sequence[waveKey], source + ".microSequence." + waveKey);
        for (const entry of reference) {
          lines.push({ ...entry, id: waveKey + "_" + entry.id,
            kind: "FIB_CONTEXT", label: label + " " + entry.label,
            status: entry.status || "REFERENCE", referenceOnly: true });
        }
      }
    }
    if (!micro && activeFib) {
      addLine(lines, "active_fib_invalidation", "active fib invalidation",
        activeFib.invalidationLevel, "INVALIDATION", source + ".activeFibModel.invalidationLevel");
    }
    const structuralLevels = [
      ["confirmation", state.confirmation, "CONFIRMATION"],
      ["invalidation", state.invalidation, "INVALIDATION"],
    ];
    for (const [key, price, kind] of structuralLevels)
      addLine(lines, key, key, price, kind, source + "." + key);
    for (const [i, price] of safeArray(state.confirmationLevels).entries())
      addLine(lines, "confirmation_" + i, "confirmation " + (i + 1), price, "CONFIRMATION", source + ".confirmationLevels[" + i + "]");
    const reason = lines.length || marks.length ? null : (micro ? "NO_CANONICAL_MICRO_LEVELS" : "NO_DRAWABLE_CANONICAL_STRUCTURE");
    const componentAvailability = {
      waveMarks: marks.length > 0,
      fibLevels: lines.some(line => line.kind === "FIB"),
      historicalFibReferences: lines.some(line => line.kind === "FIB_CONTEXT"),
      structuralLines: lines.some(line => line.kind !== "FIB"),
    };
    degrees[degree] = { degree, sourceDegree: degree, parentDegree: micro ? (wavelength?.degrees?.micro?.parentDegree || "subminute") : (state.parentDegree || null),
      drawable: reason == null, reason, severity: reason ? "blocking" : null, reasonCodes: reason ? [reason] : [],
      wave: { current: state.activeWave || null, direction: state.direction || state.microSequence?.direction || null,
        confirmationStatus: state.confirmationStatus || null,
        authorityConflict: structuralConflict,
        status: state.stage || state.state || null, role: state.role || null },
      marks, lines, zones: [], componentAvailability,
      model: micro ? { type: "MICRO_SEQUENTIAL", active: true } :
        { type: activeFib?.modelType || null, active: !!activeFib },
      provenance: { structuralSource: source, sourcesChecked: [source],
        sourceCountId: null,
        shadowMicroCanonicalRef: micro ? (wavelength?.microCanonicalRef || null) : null,
        shadowAuthority: micro ? "MICRO_V2_SHADOW_ONLY_NOT_USED" : null,
        sourceMode: micro ? (wavelength?.sourceMode || null) : null,
        fallbackUsed: false } };
  }
  return { ok: true, schemaVersion: "engine2.chartOverlays.v1", symbol: "ES", priceBasis: "ES_INDEX_POINTS",
    snapshot: { generatedAt: snapshot?.generatedAt || snapshot?.generated_at_utc || null,
      sourceTimestamp: wavelength?.sourceTimestamp || null,
      authorityConflict: wavelength?.canonicalWaveStateConflict === true },
    degrees, diagnostics: { failedDegrees: DEGREE_NAMES.filter((d) => !degrees[d].drawable) } };
}
export function validateEngine2ChartOverlayV1(payload) {
  const errors = [];
  if (!payload || payload.ok !== true || payload.schemaVersion !== "engine2.chartOverlays.v1" ||
      payload.symbol !== "ES") errors.push("INVALID_ENVELOPE");
  for (const degree of DEGREE_NAMES) {
    const d = payload?.degrees?.[degree];
    if (!d || d.degree !== degree || typeof d.drawable !== "boolean" ||
        !Array.isArray(d.lines) || !Array.isArray(d.marks)) {
      errors.push("INVALID_DEGREE_" + degree.toUpperCase());
      continue;
    }
    if (d.drawable !== (d.lines.length + d.marks.length > 0))
      errors.push("DRAWABLE_MISMATCH_" + degree.toUpperCase());
    for (const line of d.lines) {
      if (typeof line.id !== "string" || !Number.isFinite(line.price) ||
          line.price <= 0 || typeof line.sourcePath !== "string")
        errors.push("INVALID_LINE_" + degree.toUpperCase());
    }
    for (const mark of d.marks) {
      if (typeof mark.id !== "string" || !Number.isFinite(mark.price) ||
          !Number.isInteger(mark.time) || typeof mark.sourcePath !== "string")
        errors.push("INVALID_MARK_" + degree.toUpperCase());
    }
    if (degree === "micro" && d.sourceDegree !== "micro")
      errors.push("MICRO_IDENTITY_MISMATCH");
  }
  return { ok: errors.length === 0, errors };
}
export default buildEngine2ChartOverlayV1;
