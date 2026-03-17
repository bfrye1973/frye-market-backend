// services/core/logic/engine14/constants.js

export const ENGINE14_VERSION = "engine14_v1";

export const SETUP_TYPES = {
  NONE: "NONE",
  ACCEPTANCE: "ACCEPTANCE",
  FAILURE: "FAILURE",
  UPPER_REJECTION: "UPPER_REJECTION",
  LOWER_REJECTION: "LOWER_REJECTION",
  DISPLACEMENT_RETEST: "DISPLACEMENT_RETEST",
};

export const DIRECTIONS = {
  LONG: "LONG",
  SHORT: "SHORT",
  NONE: "NONE",
};

export const STAGES = {
  NONE: "NONE",
  EARLY: "EARLY",
  CONFIRMING: "CONFIRMING",
  CONFIRMED: "CONFIRMED",
  FAILED: "FAILED",
  EXPIRED: "EXPIRED",
};

export const BEHAVIORS = {
  CONTINUATION: "CONTINUATION",
  REVERSAL: "REVERSAL",
  MOMENTUM_CONTINUATION: "MOMENTUM_CONTINUATION",
  NONE: "NONE",
};

export const ZONE_BEHAVIOR = {
  ACCEPTING_HIGHER: "ACCEPTING_HIGHER",
  ACCEPTING_LOWER: "ACCEPTING_LOWER",
  REJECTING_HIGH: "REJECTING_HIGH",
  REJECTING_LOW: "REJECTING_LOW",
  DISPLACEMENT: "DISPLACEMENT",
  NONE: "NONE",
};

export const THRESHOLDS = {
  displacement: {
    rangeStrong: 1.8,
    rangeExceptional: 2.2,
    bodyStrong: 0.65,
    bodyExceptional: 0.72,
    volStrong: 1.4,
  },
  confirmation: {
    range: 1.4,
    body: 0.55,
  },
  compression: {
    widthThreshold: 5,
    minBars: 4,
    inspectBars: 10,
  },
};

export const QUALITY_BUCKETS = [
  { min: 90, label: "A+" },
  { min: 80, label: "A" },
  { min: 70, label: "B" },
  { min: 60, label: "C" },
  { min: 0, label: "D" },
];
