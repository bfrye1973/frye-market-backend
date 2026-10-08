// services/core/logic/engine22/wave/buildEngine22Display.js
//
// Engine 22 human-display contract.
// degreeStates remains the machine contract.
// engine22Display is the display-only projection consumed by React.
// Frontend must render this packet; it must not calculate wave structure.

const DEGREE_ORDER = ["micro", "subminute", "minute", "minor", "intermediate", "primary"];

const MICRO_MARKS = {
  w1Low: { price: 7675.0, time: "2026-10-01 07:00" },
  w1High: { price: 7805.0, time: "2026-10-02 07:00" },
  w2Low: { price: 7757.75, time: "2026-10-05 03:00" },
  w3High: { price: 7897.75, time: "2026-10-06 07:00" },
  w4Low: { price: 7784.00, time: "2026-10-08 (user-updated; exact time unverified)" },
};

const CURRENT_LOCKED = {
  minorW5Invalidation: 7398.0,
  minuteW3Origin: 7576.0,
  minuteW3Reclaim: 7848.5,
  minuteW3Confirmation: 7906.25,
  subminuteW2Low: 7671.5,
  subminuteW3Start: 7671.5,
};

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
  return levels
    .map((level) => {
      const label = txt(level?.label);
      const p = round2(level?.price);
      if (!label || p == null) return null;
      return { label, price: p, status: txt(level?.status) };
    })
    .filter(Boolean);
}

function targetModel(state) {
  if (!state || typeof state !== "object") return null;
  return (
    [
      state.targetModel,
      state.activeFibModel,
      state.correctionModel?.targetModel,
      state.internalStructure?.retracementZone,
      state.internalStructure?.abcStructure?.waveC?.targetModel,
    ].find((v) => v && typeof v === "object") || null
  );
}

function levelsFor(state) {
  return normalizeLevels(targetModel(state)?.displayLevels);
}

function baseDegree(degree, state) {
  if (!state || typeof state !== "object" || state.active === false) {
    return {
      degree,
      label: title(degree),
      subtitle: "Structural context",
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
    row("Parent", [title(state.parentDegree), wave(state.parentWave)].filter(Boolean).join(" ")),
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
    subtitle: "Structural context",
    badge: wave(state.activeWave) || wave(state.internalStructure?.currentInternalWave),
    headline: txt(state.headline) || `${title(degree)} structure active`,
    active: state.active !== false,
    direction: txt(state.direction),
    rows,
    levels: levelsFor(state),
    rules: [],
  };
}

function microDisplay() {
  return {
    degree: "micro",
    label: "Micro",
    subtitle: "Immediate timing",
    badge: "W5",
    headline: "Micro W5 launch watch — W4 completed candidate at 7782.75",
    active: true,
    direction: "UP",
    rows: clean([
      row("Role", "Timing only"),
      row("Parent", "Subminute W3"),
      row("W1", `${price(MICRO_MARKS.w1Low.price)} → ${price(MICRO_MARKS.w1High.price)}`, { kind: "mark" }),
      row("W2", pointText(MICRO_MARKS.w2Low), { kind: "mark" }),
      row("W3", pointText(MICRO_MARKS.w3High), { kind: "mark" }),
      row("W4", pointText(MICRO_MARKS.w4Low), { status: "COMPLETED_CANDIDATE", kind: "mark" }),
      row("Current", "Micro W5 launch watch", { tone: "long" }),
      row("Invalid", `Below ${price(MICRO_MARKS.w4Low.price)}`, { tone: "warning" }),
      row("Confirm", `Reclaim / hold above ${price(MICRO_MARKS.w3High.price)}`, { tone: "watch" }),
    ]),
    levels: [
      { label: "W4 low", price: MICRO_MARKS.w4Low.price, status: "INVALIDATION" },
      { label: "W3 high", price: MICRO_MARKS.w3High.price, status: "CONFIRMATION" },
    ],
    rules: [
      "Micro is timing only — no execution or permission.",
      `Hold above ${price(MICRO_MARKS.w4Low.price)} keeps Micro W5 launch watch alive.`,
      `Reclaim ${price(MICRO_MARKS.w3High.price)} confirms Micro W5 strength.`,
    ],
  };
}

function subminuteDisplay(state) {
  const base = baseDegree("subminute", state);

  return {
    ...base,
    label: "Subminute",
    subtitle: "Immediate wave path",
    badge: "W3",
    headline: "Subminute W3 active candidate from 7671.50 — fib anchors provisional",
    active: true,
    direction: "UP",
    rows: clean([
      row("Role", "Immediate setup wave"),
      row("Parent", "Minute W3"),
      row("W2 low", price(CURRENT_LOCKED.subminuteW2Low), { status: "COMPLETED_CANDIDATE", kind: "mark" }),
      row("W3 start", price(CURRENT_LOCKED.subminuteW3Start), { status: "ACTIVE_CANDIDATE", kind: "mark" }),
      row("Current", "Subminute W3 active candidate", { tone: "long" }),
      row("Micro", "Micro W5 launch watch", { tone: "watch" }),
      row("Invalid", `Below ${price(CURRENT_LOCKED.subminuteW2Low)}`, { tone: "warning" }),
    ]),
    levels: [
      { label: "Sub W2 low", price: CURRENT_LOCKED.subminuteW2Low, status: "REVIEW" },
      { label: "Micro W4", price: MICRO_MARKS.w4Low.price, status: "TIMING" },
      { label: "Micro W3 high", price: MICRO_MARKS.w3High.price, status: "CONFIRMATION" },
    ],
    rules: [
      "Subminute owns the immediate wave sequence inside Minute W3.",
      `Lose ${price(CURRENT_LOCKED.subminuteW2Low)} fails the current Subminute W3 launch structure.`,
      "Micro timing is nested under Subminute and remains display-only.",
    ],
  };
}

function minuteDisplay(state) {
  const base = baseDegree("minute", state);

  return {
    ...base,
    label: "Minute",
    subtitle: "Tactical wave",
    badge: "W3",
    headline: "Minute W3 started from 7575 / 7576 — confirmation pending",
    active: true,
    direction: "UP",
    rows: clean([
      row("Role", "Tactical wave"),
      row("Origin", "7575 / 7576", { status: "STARTED" }),
      row("Current", "Minute W3 started — not fully confirmed", { tone: "long" }),
      row("Subminute", "W3 active candidate"),
      row("Reclaim", price(CURRENT_LOCKED.minuteW3Reclaim), { tone: "watch" }),
      row("Confirm", price(CURRENT_LOCKED.minuteW3Confirmation), { tone: "watch" }),
      row("Review", "Lose 7576 / 7591 pressures W2 low", { tone: "warning" }),
    ]),
    levels: [
      { label: "Origin", price: CURRENT_LOCKED.minuteW3Origin, status: "REVIEW" },
      { label: "Reclaim", price: CURRENT_LOCKED.minuteW3Reclaim, status: "WATCH" },
      { label: "Confirm", price: CURRENT_LOCKED.minuteW3Confirmation, status: "CONFIRMATION" },
    ],
    rules: [
      `Minute W3 started from ${price(CURRENT_LOCKED.minuteW3Origin)} but needs ${price(CURRENT_LOCKED.minuteW3Reclaim)} / ${price(CURRENT_LOCKED.minuteW3Confirmation)} confirmation.`,
      "Subminute and Micro own the immediate timing path.",
      `Lose ${price(CURRENT_LOCKED.minuteW3Origin)} pressures the Minute W3 origin.`,
    ],
  };
}

function minorDisplay(state) {
  const base = baseDegree("minor", state);
  if (!state || typeof state !== "object" || state.active === false) return base;

  const marks = state.marks || {};
  const w4 = point(marks.W4);
  const w5 = marks.W5 || {};
  const iw = w5.internalWaves || {};
  const w1 = iw.wave1 || {};
  const w2 = iw.wave2 || {};
  const w3 = iw.wave3 || {};
  const confirms = w3.confirmationLevels || {};

  const w1Range = num(w1.low) != null && num(w1.high) != null ? `${price(w1.low)} → ${price(w1.high)}` : null;

  const reclaim = round2(confirms.firstReclaim ?? CURRENT_LOCKED.minuteW3Reclaim);
  const confirmation = round2(confirms.majorBreakout ?? CURRENT_LOCKED.minuteW3Confirmation);
  const invalidation = round2(CURRENT_LOCKED.minorW5Invalidation ?? w4?.price);

  return {
    ...base,
    label: "Minor",
    subtitle: "Parent impulse candidate",
    badge: "W5",
    headline: "Minor W5 active candidate — Minute W3 started, confirmation pending",
    active: true,
    direction: "UP",
    rows: clean([
      row("Parent", [title(state.parentDegree), wave(state.parentWave)].filter(Boolean).join(" ")),
      row("W4 Complete", pointText(w4), { status: status(marks.W4), kind: "mark" }),
      row("W5 Start", w1.low != null ? `${price(w1.low)}${w1.lowTime ? ` — ${w1.lowTime}` : ""}` : null, { status: status(w5), kind: "mark" }),
      row("Internal W1", w1Range ? `${w1Range}${w1.highTime ? ` — high ${w1.highTime}` : ""}` : null, { status: w1.status, kind: "mark" }),
      row("Internal W2", w2.low != null ? `${price(w2.low)}${w2.time ? ` — ${w2.time}` : ""}` : null, { status: w2.status, kind: "mark" }),
      row("Minute W3", "Started / confirmation pending", { status: w3.status }),
      row("W3 Reclaim", reclaim != null ? price(reclaim) : null, { tone: "watch" }),
      row("W3 Confirmation", confirmation != null ? price(confirmation) : null, { tone: "watch" }),
      row("W5 Invalidation", invalidation != null ? price(invalidation) : null, { tone: "warning" }),
    ]),
    levels: [
      { label: "W3 reclaim", price: reclaim, status: "WATCH" },
      { label: "W3 confirm", price: confirmation, status: "CONFIRMATION" },
      { label: "W5 invalid", price: invalidation, status: "INVALIDATION" },
    ].filter((level) => level.price != null),
    rules: clean([
      reclaim != null && confirmation != null ? `Minute W3 confirmation needs ${price(reclaim)} / ${price(confirmation)} reclaim.` : null,
      invalidation != null ? `Lose ${price(invalidation)} invalidates Minor W5 active candidate.` : null,
    ]),
  };
}

function genericHigherDegree(degree, state) {
  return baseDegree(degree, state);
}

function flagsFor(degreeStates) {
  const states = ["subminute", "minute", "minor", "intermediate", "primary"]
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
    headline: "Micro W5 launch watch inside Subminute W3; Minute W3 confirmation pending.",
    degreeOrder: [...DEGREE_ORDER],
    degrees: {
      micro: microDisplay(),
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
