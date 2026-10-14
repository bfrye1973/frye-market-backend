// Engine 22 research-only Fib touch memory reducer — NOT WIRED TO LIVE SNAPSHOTS.
// A TOUCHED event must be attached to the precise canonical level/model/source,
// and repeated or later candles must never erase an earlier valid touch.
// Engine 11 must provide eligible timestamped, raw ES high/low observations.
// Engine 22 must approve the structural model before production integration.
const obj = x => x && typeof x === "object" && !Array.isArray(x) ? x : null;
const nonempty = x => typeof x === "string" && x.trim() ? x.trim() : null;
const price = x => typeof x === "number" && Number.isFinite(x) && x > 0 ? x : null;
const timeMs = x => typeof x === "string" && Number.isFinite(Date.parse(x)) ? Date.parse(x) : null;
export const FIB_TOUCH_DEGREES_V1 = Object.freeze([
  "submicro","micro","subminute","minute","minor","intermediate","primary",
]);
function identity(level) {
  if (!obj(level) || !FIB_TOUCH_DEGREES_V1.includes(level.degree)) return null;
  const fields = ["countId","modelKey","seriesId","priceBasis","key"];
  if (!fields.every(k => nonempty(level[k]))) return null;
  if (!price(level.price) || !["UP","DOWN"].includes(level.direction)) return null;
  if (timeMs(level.originAt) === null) return null;
  return fields.map(k=>level[k]).concat(level.degree,String(level.price)).join("|");
}
export function reduceFibTouchObservationV1({level, candle, previous=null}={}) {
  const id=identity(level), bar=obj(candle), old=obj(previous);
  const retained = id && old?.identity === id && old.status === "TOUCHED" &&
    nonempty(old.firstTouchedAt) && nonempty(old.firstTouchedBarId);
  if (!id) return {status:"UNAVAILABLE",reason:"LEVEL_IDENTITY_OR_MODEL_MISSING",identity:null};
  if (retained) return {...old}; // Immutable first touch for same exact model.
  const t=timeMs(bar?.sourceTimestamp), start=timeMs(level.originAt);
  const validSource=Boolean(bar?.seriesId===level.seriesId &&
    bar?.priceBasis===level.priceBasis && nonempty(bar?.sourceBarId) &&
    bar?.eligible===true && bar?.completed===true);
  if (!validSource || t===null || t<start || !price(bar?.high) || !price(bar?.low) ||
    bar.high<bar.low)
    return {identity:id,status:"WATCH",firstTouchedAt:null,firstTouchedBarId:null,
      reason:"ELIGIBLE_POST_ORIGIN_CANDLE_REQUIRED"};
  // For an upward extension the bar high must reach the line;
  // for a downward extension the bar low must reach the line.
  const touched=level.direction==="UP" ? bar.high>=level.price : bar.low<=level.price;
  return {identity:id,status:touched?"TOUCHED":"WATCH",
    firstTouchedAt:touched?bar.sourceTimestamp:null,
    firstTouchedBarId:touched?bar.sourceBarId:null,
    reason:touched?"ELIGIBLE_LEVEL_TOUCH":"NO_TOUCH"};
}
