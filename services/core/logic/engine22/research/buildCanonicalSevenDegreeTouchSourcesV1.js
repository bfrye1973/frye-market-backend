// Engine 22C: canonical seven-degree touch source adapter.
// This adapter does not approve counts, infer contract identity, or promote V3
// shadow projections. Legacy Subminute-to-Micro fallback is never touch eligible.
import { validateEngine22V3Canonical } from "../v3/canonicalStructure.js";

export const SEVEN_TOUCH_DEGREES = Object.freeze([
  "submicro", "micro", "subminute", "minute", "minor",
  "intermediate", "primary",
]);

const V3_KEYS = Object.freeze({submicro:"INTRADAY_SUBMICRO",micro:"MICRO"});
const own = (object,key) => Object.prototype.hasOwnProperty.call(object ?? {},key);
const nonblank = x => typeof x === "string" && x.trim().length > 0;

function fromV3(count) {
  // V3 bootstrap count identity is not the same as Fib-model approval.
  // A shadow-only or price-only Fib is never eligible for canonical touches.
  const fib = count?.fibModel;
  const hasApproval = fib?.approved === true &&
    fib?.active === true && fib?.provisional !== true &&
    fib?.watchOnly !== true && fib?.publishAuthorized === true;
  return {
    activeWave: count?.activeWave ?? null,
    sourceCountId: count?.countId ?? null,
    activeFibModel: hasApproval && nonblank(fib?.sourceCountId) &&
      fib.sourceCountId === count.countId
      ? { ...fib, sourceCountId:count.countId }
      : null,
  };
}

export function buildCanonicalSevenDegreeTouchSourcesV1({
  degreeStates = {}, activeStructures = {}, v3Canonical = null,
} = {}) {
  const result = {}, diagnostics = {};
  const v3Validation = v3Canonical == null
    ? {ok:false,errors:["V3_CANONICAL_NOT_PROVIDED"]}
    : validateEngine22V3Canonical(v3Canonical);
  for (const degree of SEVEN_TOUCH_DEGREES) {
    if (own(V3_KEYS,degree)) {
      const count = v3Validation.ok ? v3Canonical.degrees[V3_KEYS[degree]] : null;
      result[degree] = count ? fromV3(count) : {activeFibModel:null};
      diagnostics[degree] = !v3Validation.ok ? "V3_CANONICAL_UNVERIFIED"
        : result[degree].activeFibModel ? "EXPLICIT_V3_FIB_APPROVAL"
        : "V3_COUNT_PRESENT_FIB_APPROVAL_PENDING";
      continue;
    }
    // Important: never select degreeStates.subminute when it was produced
    // from activeStructures.micro via the legacy display fallback.
    if (degree === "subminute" && !own(activeStructures,"subminute")) {
      result[degree] = {activeFibModel:null};
      diagnostics[degree] = "INDEPENDENT_SUBMINUTE_STRUCTURE_MISSING";
      continue;
    }
    result[degree] = degreeStates?.[degree] ?? {activeFibModel:null};
    diagnostics[degree] = result[degree]?.activeFibModel?.approved === true
      ? "EXPLICIT_FIB_APPROVAL_PRESENT" : "FIB_APPROVAL_PENDING";
  }
  return {
    schema:"engine22.canonicalSevenDegreeTouchSources.v1",
    degrees:result,diagnostics,v3Validation:v3Validation.ok
      ? {ok:true} : {ok:false,errors:v3Validation.errors},
    noExecution:true,
  };
}
