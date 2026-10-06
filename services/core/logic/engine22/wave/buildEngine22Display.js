// services/core/logic/engine22/wave/buildEngine22Display.js
//
// Engine 22 human-display contract.
// degreeStates is the machine contract.
// engine22Display is a display-only projection of degreeStates.
// This module does not read runtime state/candles and does not calculate a wave count.

const DEGREE_ORDER = ["subminute", "minute", "minor", "intermediate", "primary"];

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const round2 = (v) => {
  const n = num(v);
  return n == null ? null : Math.round((n + Number.EPSILON) * 100) / 100;
};

const txt = (v) => {
  if (v == null) return null;
  const s = String(v).trim();
  return s || null;
};

const price = (v) => {
  const n = num(v);
  return n == null ? null : n.toFixed(2);
};

const title = (v) => {
  const s = txt(v);
  return s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : null;
};

const wave = (v) => {
  const s = txt(v);
  return s ? s.replace(/_/g, "-") : null;
};

function point(mark, side = null) {
  if (!mark || typeof mark !== "object") return null;
  const nested = side && mark?.[side] && typeof mark[side] === "object" ? mark[side] : null;
  const p = round2(nested?.price ?? nested?.value ?? mark?.price ?? mark?.value);
  const time = txt(nested?.time ?? nested?.timestamp ?? mark?.time ?? mark?.timestamp);
  return p == null && !time ? null : { price: p, time };
}

function pointText(p) {
  if (!p || p.price == null) return null;
  return p.time ? `${price(p.price)} — ${p.time}` : price(p.price);
}

function rangeText(low, high) {
  if (!low || !high || low.price == null || high.price == null) return null;
  return `${price(low.price)} → ${price(high.price)}`;
}

function status(mark) {
  return txt(mark?.status ?? mark?.maturity);
}

function row(label, value, options = {}) {
  const l = txt(label);
  const v = txt(value);
  if (!l || !v) return null;
  return {
    label: l,
    value: v,
    status: txt(options.status),
    tone: txt(options.tone),
    kind: txt(options.kind) || "text",
  };
}

const clean = (items) => items.filter(Boolean);

function normalizeLevels(levels) {
  if (!Array.isArray(levels)) return [];
  return levels.map((level) => {
    const label = txt(level?.label);
    const p = round2(level?.price);
    if (!label || p == null) return null;
    return { label, price: p, status: txt(level?.status) };
  }).filter(Boolean);
}

function targetModel(state) {
  if (!state || typeof state !== "object") return null;
  return [
    state.targetModel,
    state.activeFibModel,
    state.correctionModel?.targetModel,
    state.internalStructure?.retracementZone,
    state.internalStructure?.abcStructure?.waveC?.targetModel,
  ].find((v) => v && typeof v === "object") || null;
}

function levelsFor(state) {
  return normalizeLevels(targetModel(state)?.displayLevels);
}

function baseDegree(degree, state) {
  if (!state || typeof state !== "object" || state.active === false) {
    return {
      degree,
      label: title(degree),
      badge: null,
      headline: `${title(degree)} structure not published.`,
      active: false,
      direction: null,
      rows: [],
      levels: [],
      rules: [],
    };
  }

  const rows = clean([
    row("Direction", state.direction),
    row("Active Wave", wave(state.activeWave), { status: state.stage }),
    row(
      "Parent",
      [title(state.parentDegree), wave(state.parentWave)].filter(Boolean).join(" ")
    ),
  ]);

  for (const key of ["W1", "W2", "W3", "W4", "W5", "A", "B", "C", "D", "E"]) {
    const mark = state.marks?.[key];
    if (!mark || typeof mark !== "object") continue;
    const low = point(mark, "low");
    const high = point(mark, "high");
    const single = point(mark);
    const value = rangeText(low, high) || pointText(single);
    if (value) rows.push(row(key, value, { status: status(mark), kind: "mark" }));
  }

  return {
    degree,
    label: title(degree),
    badge: wave(state.activeWave) || wave(state.internalStructure?.currentInternalWave),
    headline: txt(state.headline) || `${title(degree)} structure active`,
    active: state.active !== false,
    direction: txt(state.direction),
    rows,
    levels: levelsFor(state),
    rules: [],
  };
}

function subminuteDisplay(state) {
  const base = baseDegree("subminute", state);
  if (!state || typeof state !== "object" || state.active === false) return base;

  const internal = state.internalStructure || {};
  const ref = internal.internalReference || {};
  const parentMap = state.targetModel?.parentMinuteW2CDownLevels || {};

  const parentLevels = [
    ["C 0.618", parentMap.c0618],
    ["C 0.786", parentMap.c0786],
    ["C 1.000", parentMap.c1000],
    ["C 1.272", parentMap.c1272],
    ["C 1.618", parentMap.c1618],
    ["C 2.000", parentMap.c2000],
  ].map(([label, value]) => {
    const p = round2(value);
    return p == null ? null : { label, price: p, status: "PARENT_MINUTE_MAP" };
  }).filter(Boolean);

  return {
    ...base,
    badge: "CONTEXT",
    rows: clean([
      row("Role", "Timing / context only"),
      row("Parent", [title(state.parentDegree), wave(state.parentWave)].filter(Boolean).join(" ")),
      row("Direction", state.direction),
      row("Current", txt(internal.currentInternalWave) || "Context only", { status: state.stage }),
      row("A Low", ref.aLow != null ? price(ref.aLow) : null, { kind: "mark" }),
      row("B High", ref.bHigh != null ? price(ref.bHigh) : null, { kind: "mark" }),
      row("Review", ref.review != null ? price(ref.review) : null, { tone: "warning" }),
      row("Larger Invalidation", ref.largerInvalidation != null ? price(ref.largerInvalidation) : null, { tone: "warning" }),
    ]),
    levels: parentLevels,
    rules: [
      "Subminute is timing/context only.",
      "Parent Minute W2-C levels are authoritative.",
      "Do not force a separate subminute count or target map.",
    ],
  };
}

function minuteDisplay(state) {
  const base = baseDegree("minute", state);
  if (!state || typeof state !== "object" || state.active === false) return base;

  const marks = state.marks || {};
  const model = state.targetModel || {};
  const w1Low = point(marks.W1, "low");
  const w1High = point(marks.W1, "high");
  const current = txt(model.currentInternalWave) ||
    txt(state.internalStructure?.currentInternalWave) ||
    wave(state.activeWave);

  const reclaim = round2(model.reclaimForW3Watch);
  const confirmation = round2(model.majorConfirmation);
  const review = round2(model.minorW2LowReview);
  const reference = round2(model.wave3SetupReference);
  const largerInvalidation = round2(model.largerInvalidationLevel);

  return {
    ...base,
    badge: wave(current) || base.badge,
    rows: clean([
      row("W1", rangeText(w1Low, w1High), { status: status(marks.W1), kind: "mark" }),
      row("A-down", pointText(point(marks.A)), { status: status(marks.A), kind: "mark" }),
      row("B-high", pointText(point(marks.B)), { status: status(marks.B), kind: "mark" }),
      row("Current", wave(current), { status: status(marks.C) || state.stage }),
      row("W3 Reclaim", reclaim != null ? price(reclaim) : null, { tone: "watch" }),
      row("W3 Confirmation", confirmation != null ? price(confirmation) : null, { tone: "watch" }),
      row("W2 Low Review", review != null ? price(review) : null, { tone: "warning" }),
      row("W1 Reference", reference != null ? price(reference) : null, { tone: "warning" }),
      row("Minor W5 Invalidation", largerInvalidation != null ? price(largerInvalidation) : null, { tone: "warning" }),
    ]),
    levels: normalizeLevels(model.displayLevels),
    rules: clean([
      reclaim != null && confirmation != null
        ? `Minute W3 is not confirmed until ${price(reclaim)} / ${price(confirmation)} reclaim.`
        : null,
      review != null && reference != null
        ? `Lose ${price(review)} / ${price(reference)} pressures the W2 low.`
        : null,
      largerInvalidation != null
        ? `Lose ${price(largerInvalidation)} invalidates Minor W5 active candidate.`
        : null,
    ]),
  };
}

function minorDisplay(state) {
  const base = baseDegree("minor", state);
  if (!state || typeof state !== "object" || state.active === false) return base;

  const marks = state.marks || {};
  const model = state.targetModel || {};
  const w4 = point(marks.W4);
  const w5 = marks.W5 || {};
  const iw = w5.internalWaves || {};
  const w1 = iw.wave1 || {};
  const w2 = iw.wave2 || {};
  const w3 = iw.wave3 || {};
  const confirms = w3.confirmationLevels || {};

  const w1Range = num(w1.low) != null && num(w1.high) != null
    ? `${price(w1.low)} → ${price(w1.high)}`
    : null;

  const reclaim = round2(confirms.firstReclaim ?? model.w3FirstConfirmation);
  const confirmation = round2(confirms.majorBreakout ?? model.w3MajorConfirmation);
  const warning = round2(model.warningLevel);
  const reference = round2(model.wave3StartReference);
  const invalidation = round2(model.invalidationLevel ?? w4?.price);

  return {
    ...base,
    badge: wave(state.activeWave) || "W5",
    rows: clean([
      row("Parent", [title(state.parentDegree), wave(state.parentWave)].filter(Boolean).join(" ")),
      row("W4 Complete", pointText(w4), { status: status(marks.W4), kind: "mark" }),
      row("W5 Start", w1.low != null ? `${price(w1.low)}${w1.lowTime ? ` — ${w1.lowTime}` : ""}` : null, { status: status(w5), kind: "mark" }),
      row("Internal W1", w1Range ? `${w1Range}${w1.highTime ? ` — high ${w1.highTime}` : ""}` : null, { status: w1.status, kind: "mark" }),
      row("Internal W2", w2.low != null ? `${price(w2.low)}${w2.time ? ` — ${w2.time}` : ""}` : null, { status: w2.status, kind: "mark" }),
      row("Minute W3", w3.status ? String(w3.status).replace(/_/g, " ") : null, { status: w3.status }),
      row("W3 Reclaim", reclaim != null ? price(reclaim) : null, { tone: "watch" }),
      row("W3 Confirmation", confirmation != null ? price(confirmation) : null, { tone: "watch" }),
      row("W5 Invalidation", invalidation != null ? price(invalidation) : null, { tone: "warning" }),
    ]),
    levels: normalizeLevels(model.displayLevels),
    rules: clean([
      reclaim != null && confirmation != null
        ? `Minute W3 is not confirmed until ${price(reclaim)} / ${price(confirmation)} reclaim.`
        : null,
      warning != null && reference != null
        ? `Lose ${price(warning)} / ${price(reference)} pressures the W2 low.`
        : null,
      invalidation != null
        ? `Lose ${price(invalidation)} invalidates Minor W5 active candidate.`
        : null,
    ]),
  };
}

function genericHigherDegree(degree, state) {
  return baseDegree(degree, state);
}

function flagsFor(degreeStates) {
  const states = DEGREE_ORDER
    .map((degree) => degreeStates?.[degree])
    .filter((state) => state && typeof state === "object" && state.active !== false);

  return {
    noExecution: states.length > 0 && states.every((state) => state.noExecution !== false),
    noPermissionCreated: states.length > 0 && states.every((state) => state.noPermissionCreated !== false),
    watchOnly: states.length > 0 && states.every((state) => state.watchOnly !== false),
  };
}

export function buildEngine22Display({ degreeStates = null } = {}) {
  if (!degreeStates || typeof degreeStates !== "object") return null;

  return {
    version: "engine22Display.v1",
    headline:
      txt(degreeStates?.minute?.headline) ||
      txt(degreeStates?.minor?.headline) ||
      "Engine 22 structure published.",
    degreeOrder: [...DEGREE_ORDER],
    degrees: {
      subminute: subminuteDisplay(degreeStates.subminute),
      minute: minuteDisplay(degreeStates.minute),
      minor: minorDisplay(degreeStates.minor),
      intermediate: genericHigherDegree("intermediate", degreeStates.intermediate),
      primary: genericHigherDegree("primary", degreeStates.primary),
    },
    flags: flagsFor(degreeStates),
  };
}

export default buildEngine22Display;
