// Engine 22 wave-history v1 isolated proof. No live engine wiring or execution authority.
import { createHash } from "node:crypto";
export const WAVE_HISTORY_SCHEMA = "engine22.waveHistoryEvent.v1";
const DEGREES = new Set(["submicro","micro","subminute","minute","minor","intermediate","primary"]);
const STATES = new Set(["DEVELOPING","COMPLETION_CANDIDATE","CONFIRMED","LOCKED","SUPERSEDED","INVALIDATED"]);
const TYPES = new Set(["WAVE_RECORDED","WAVE_REVISED","WAVE_STATUS_CHANGED"]);
const required = s => typeof s === "string" && s.trim().length > 0;
const timestamp = s => required(s) && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(s) && Number.isFinite(Date.parse(s));
const tick = n => typeof n === "number" && Number.isFinite(n) && n > 0 && Math.abs(n * 4 - Math.round(n * 4)) < 1e-8;
const fail = why => { throw new Error("ENGINE22_HISTORY_" + why); };
const digest = x => createHash("sha256").update(JSON.stringify(x)).digest("hex");
export function validateWaveHistoryEvent(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) fail("INVALID_EVENT");
  const e = structuredClone(input);
  if (e.schema !== WAVE_HISTORY_SCHEMA || !TYPES.has(e.type)) fail("SCHEMA_OR_TYPE");
  for (const k of ["eventId","waveId","countId","modelVersion","approvalStatus","sourceFingerprint","priceBasisId","contractSymbol"])
    if (!required(e[k])) fail("MISSING_" + k);
  if (!DEGREES.has(e.degree) || !STATES.has(e.lifecycle)) fail("DEGREE_OR_STATUS");
  if (!Number.isSafeInteger(e.revision) || e.revision < 1) fail("REVISION");
  if (!timestamp(e.publishedAt)) fail("PUBLISHED_AT");
  if (e.parentWaveId != null && !required(e.parentWaveId)) fail("PARENT");
  if (e.parentWaveId === e.waveId) fail("SELF_PARENT");
  if (!e.anchor || !required(e.anchor.label) || !tick(e.anchor.price)) fail("ANCHOR");
  if (e.anchor.marketAt != null && !timestamp(e.anchor.marketAt)) fail("MARKET_AT");
  if (e.supersedesEventId != null && !required(e.supersedesEventId)) fail("SUPERSEDES");
  if (e.fibLevels != null && (!Array.isArray(e.fibLevels) || e.fibLevels.some(f=>!required(f.key)||!required(f.method)||!Number.isFinite(f.ratio)||!tick(f.price)))) fail("FIBS");
  if (["CONFIRMED","LOCKED"].includes(e.lifecycle) && (e.approvalStatus !== "OWNER_APPROVED" || !timestamp(e.anchor.marketAt))) fail("CONFIRMATION_REQUIRES_APPROVAL_AND_EXACT_TIME");
  return e;
}
export function replayWaveHistory(events) {
  if (!Array.isArray(events)) fail("EVENTS_REQUIRED");
  const ids=new Map(), latest=new Map();
  for (const input of events) {
    const e=validateWaveHistoryEvent(input), hash=digest(e);
    if (ids.has(e.eventId)) {
      if (ids.get(e.eventId)!==hash) fail("CONFLICTING_EVENT_ID");
      continue;
    }
    const prev=latest.get(e.waveId);
    if (!prev) {
      if (e.type!=="WAVE_RECORDED" || e.revision!==1 || e.supersedesEventId!=null) fail("INITIAL_EVENT_MISSING");
    } else {
      if (e.revision!==prev.revision+1 || e.supersedesEventId!==prev.eventId) fail("REVISION_GAP");
      if (e.countId!==prev.countId || e.degree!==prev.degree) fail("COUNT_IDENTITY_CHANGED");
      if (e.type==="WAVE_STATUS_CHANGED" && JSON.stringify(e.anchor)!==JSON.stringify(prev.anchor)) fail("STATUS_REWROTE_ANCHOR");
    }
    ids.set(e.eventId,hash);
    latest.set(e.waveId,e);
  }
  return {schema:"engine22.waveHistorySnapshot.v1",eventCount:ids.size,
    cursor:ids.size,waves:[...latest.values()].map(structuredClone),
    fingerprint:digest([...ids.values()]),noExecution:true,noPermissionCreated:true};
}
export function chartNodeFromHistory(event) {
  const e=validateWaveHistoryEvent(event);
  // Intentional fail-closed design until Engine 2 verifies the physical/continuous ES view.
  return {waveId:e.waveId,degree:e.degree,price:e.anchor.price,label:e.anchor.label,
    marketAt:e.anchor.marketAt??null,publishedAt:e.publishedAt,priceBasisId:e.priceBasisId,
    contractSymbol:e.contractSymbol,plotAllowed:false,
    reason:!e.anchor.marketAt?"MISSING_MARKET_TIMESTAMP":e.approvalStatus!=="OWNER_APPROVED"?"UNAPPROVED_MODEL":"CHART_PRICE_BASIS_ACCEPTANCE_PENDING"};
}
