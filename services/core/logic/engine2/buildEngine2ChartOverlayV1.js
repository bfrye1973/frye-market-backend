// Engine 2B v1 — read-only published-structure chart adapter.
// Never computes Fibonacci levels, changes engine state, or falls back from Micro to Subminute.
const DEGREE_NAMES = ["primary", "intermediate", "minor", "minute", "micro"];
const FIB_KEYS = /^(?:[er c][0-9]+|c[0-9]+)$/i;
const finite = (value) => value == null || value === "" ? null : Number.isFinite(Number(value)) ? Number(value) : null;
const safeArray = (v) => Array.isArray(v) ? v : [];
function addLine(lines, id, key, rawPrice, kind, sourcePath, status = null) {
  const price = finite(rawPrice);
  if (price == null || price <= 0) return;
  if (lines.some((x) => x.id === id)) return;
  lines.push({ id, key, price, kind, label: key.toUpperCase(), status, sourcePath });
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
      if (typeof value !== "number" && typeof value !== "string") continue;
      addLine(out, key, key, value, "FIB", path + "." + key);
    }
  }
  return out;
}
function markArray(marks, path) {
  const out = [];
  if (!marks || typeof marks !== "object") return out;
  const add = (name, node, source) => {
    const price = finite(node?.price ?? node?.p);
    const time = node?.time ?? node?.timestamp ?? null;
    if (price == null || price <= 0 || time == null) return;
    out.push({ id: name, label: name, price, time, status: node.status || null, sourcePath: source });
  };
  for (const [name, node] of Object.entries(marks)) {
    if (!node || typeof node !== "object") continue;
    if (node.low || node.high) {
      if (node.low) add(name + "_LOW", node.low, path + "." + name + ".low");
      if (node.high) add(name + "_HIGH", node.high, path + "." + name + ".high");
    } else add(name, node, path + "." + name);
  }
  return out;
}
function empty(degree, source, reason) {
  return { degree, drawable: false, reason, severity: "blocking", reasonCodes: [reason],
    sourceDegree: degree, wave: null, marks: [], lines: [], zones: [],
    provenance: { structuralSource: source, sourcesChecked: [source], fallbackUsed: false } };
}
export function buildEngine2ChartOverlayV1(snapshot, symbol = "ES") {
  if (symbol !== "ES") return { ok: false, schemaVersion: "engine2.chartOverlays.v1", symbol, error: "UNSUPPORTED_SYMBOL" };
  const strategy = snapshot?.strategies?.["intraday_scalp@10m"]?.engine22WaveStrategy ||
    snapshot?.strategies?.["minor_swing@1h"]?.engine22WaveStrategy || null;
  const degrees = {};
  const published = strategy?.degreeStates || {};
  const wavelength = strategy?.currentWavelength || null;
  for (const degree of DEGREE_NAMES) {
    const micro = degree === "micro";
    const source = micro ? "engine22WaveStrategy.currentWavelength.degrees.micro" :
      "engine22WaveStrategy.degreeStates." + degree;
    const state = micro ? wavelength?.degrees?.micro : published?.[degree];
    if (!state || typeof state !== "object") { degrees[degree] = empty(degree, source, "CANONICAL_DEGREE_UNAVAILABLE"); continue; }
    const marks = micro ? markArray(state?.microSequence?.marks || state?.microSequence?.waves, source + ".microSequence") :
      markArray(state.marks, source + ".marks");
    // For Micro only published currentWavelength levels are authoritative. Never substitute subminute.
    let lines = micro ? levelArray(state.levels, source + ".levels") :
      levelArray(state.activeFibModel?.displayLevels ?? state.activeFibModel?.levels ??
        state.targetModel?.displayLevels ?? state.targetModel?.levels, source + ".activeFibModel");
    const structuralLevels = [
      ["confirmation", state.confirmation, "CONFIRMATION"],
      ["invalidation", state.invalidation, "INVALIDATION"],
    ];
    for (const [key, price, kind] of structuralLevels)
      addLine(lines, key, key, price, kind, source + "." + key);
    for (const [i, price] of safeArray(state.confirmationLevels).entries())
      addLine(lines, "confirmation_" + i, "confirmation " + (i + 1), price, "CONFIRMATION", source + ".confirmationLevels[" + i + "]");
    const reason = lines.length || marks.length ? null : (micro ? "NO_CANONICAL_MICRO_LEVELS" : "NO_DRAWABLE_CANONICAL_STRUCTURE");
    degrees[degree] = { degree, sourceDegree: degree, parentDegree: micro ? "subminute" : (state.parentDegree || null),
      drawable: reason == null, reason, severity: reason ? "blocking" : null, reasonCodes: reason ? [reason] : [],
      wave: { current: state.activeWave || null, direction: state.direction || state.microSequence?.direction || null,
        status: state.stage || state.state || null, role: state.role || null },
      marks, lines, zones: [], provenance: { structuralSource: source, sourcesChecked: [source],
        sourceCountId: micro ? wavelength?.microCanonicalRef?.sourceCountId || null : null, fallbackUsed: false } };
  }
  return { ok: true, schemaVersion: "engine2.chartOverlays.v1", symbol: "ES", priceBasis: "ES_INDEX_POINTS",
    snapshot: { generatedAt: snapshot?.generatedAt || snapshot?.generated_at_utc || null,
      sourceTimestamp: wavelength?.sourceTimestamp || null,
      authorityConflict: wavelength?.canonicalWaveStateConflict === true },
    degrees, diagnostics: { failedDegrees: DEGREE_NAMES.filter((d) => !degrees[d].drawable) } };
}
export default buildEngine2ChartOverlayV1;
