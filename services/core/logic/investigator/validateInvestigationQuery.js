// services/core/logic/investigator/validateInvestigationQuery.js
//
// Strict query validation. Unknown or repeated parameters are rejected.
// Values never reach the filesystem except through these validated forms.

import { STRATEGY_LANES } from "./authorityRegistry.js";

export const LIMITS = Object.freeze({
  defaultWindowMinutes: 15,
  maxWindowMinutes: 60,
  maxRecords: 50,
  maxResponseBytesSummary: 512 * 1024,
  maxResponseBytesFull: 2 * 1024 * 1024,
});

const ALLOWED = new Set(["date", "time", "strategyId", "candidateId", "planId", "tradeId", "windowMinutes", "detail"]);
const ID_RE = /^[A-Za-z0-9_.:-]{1,128}$/;

function isRealDate(s) {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function isHHMM(s) {
  if (typeof s !== "string" || !/^\d{4}$/.test(s)) return false;
  const h = Number(s.slice(0, 2));
  const m = Number(s.slice(2));
  return h <= 23 && m <= 59;
}

export function validateInvestigationQuery(query = {}) {
  const errors = [];
  for (const [key, value] of Object.entries(query)) {
    if (!ALLOWED.has(key)) errors.push({ field: key, error: "UNKNOWN_PARAMETER" });
    else if (typeof value !== "string") errors.push({ field: key, error: "PARAMETER_MUST_BE_SINGLE_STRING" });
  }
  if (errors.length) return { ok: false, errors };

  const { date, time, strategyId, candidateId, planId, tradeId, windowMinutes, detail } = query;
  if (!isRealDate(date)) errors.push({ field: "date", error: "INVALID_DATE" });
  if (!isHHMM(time)) errors.push({ field: "time", error: "INVALID_TIME_HHMM" });
  if (!STRATEGY_LANES.includes(strategyId)) errors.push({ field: "strategyId", error: "UNKNOWN_STRATEGY" });
  for (const [field, v] of [["candidateId", candidateId], ["planId", planId], ["tradeId", tradeId]]) {
    if (v !== undefined && !ID_RE.test(v)) errors.push({ field, error: "INVALID_ID_FORMAT" });
  }
  let window = LIMITS.defaultWindowMinutes;
  if (windowMinutes !== undefined) {
    if (!/^\d{1,2}$/.test(windowMinutes) || Number(windowMinutes) < 1 || Number(windowMinutes) > LIMITS.maxWindowMinutes) {
      errors.push({ field: "windowMinutes", error: "WINDOW_OUT_OF_RANGE_1_TO_60" });
    } else {
      window = Number(windowMinutes);
    }
  }
  const mode = detail === undefined ? "summary" : detail;
  if (mode !== "summary" && mode !== "full") errors.push({ field: "detail", error: "DETAIL_MUST_BE_SUMMARY_OR_FULL" });
  if (errors.length) return { ok: false, errors };

  return {
    ok: true,
    value: {
      date, time, strategyId,
      candidateId: candidateId ?? null,
      planId: planId ?? null,
      tradeId: tradeId ?? null,
      windowMinutes: window,
      detail: mode,
    },
  };
}
