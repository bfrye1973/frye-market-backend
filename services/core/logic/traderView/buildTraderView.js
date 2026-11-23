// Trader View v1 — read-only presentation adapter.
//
// Translates what engines ALREADY published into a small plain-English
// contract for the /trader-view screen. It never recomputes an engine
// decision, never creates permission, never executes.
//
//   Engine 26 = location        Engine 3 = reaction (direction)
//   Engine 4  = participation   Engine 6 = final PAPER permission
//   Engine 22 = wave structure (context)
//   Engine 25 / 29 / ES Master meter = market context
//
// Status vocabulary (display only):
//   READY   condition met        WAITING  not yet, nothing wrong
//   BLOCKED a rule says no       INFO     context only

export const TRADER_VIEW_SCHEMA = "traderView.v1";
export const TRADER_VIEW_STRATEGY = "intraday_scalp@10m";

const STALE_SNAPSHOT_MS = 5 * 60 * 1000;
// Display heuristic only: 10/20 EMA closer than this share of price = "flat".
const EMA_FLAT_PCT = 0.0005;

const n = (v) => (typeof v === "number" && Number.isFinite(v) ? v : (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : null));
const r2 = (v) => (v == null ? null : Math.round(v * 100) / 100);
const pts = (v) => (v == null ? "—" : v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }));
const up = (v) => (typeof v === "string" ? v.toUpperCase() : null);
const ms = (v) => { if (typeof v === "number") return v < 1e12 ? v * 1000 : v; const t = Date.parse(v ?? ""); return Number.isFinite(t) ? t : null; };

function section({ key, sourceEngine, sourcePath, status, state, label, plainEnglish, waitingFor = null, facts = [], sourceTimestamp = null, details = null, nowMs }) {
  const t = ms(sourceTimestamp);
  return {
    key, sourceEngine, sourcePath,
    status, state: state ?? null, label, plainEnglish, waitingFor,
    facts: facts.filter(Boolean),
    sourceTimestamp: sourceTimestamp ?? null,
    sourceAgeMs: t != null && nowMs != null ? Math.max(0, nowMs - t) : null,
    details: details ?? null,
    authority: "DISPLAY_ONLY",
  };
}

const unavailable = (key, sourceEngine, sourcePath, nowMs) => section({
  key, sourceEngine, sourcePath, status: "INFO", state: "UNAVAILABLE",
  label: "Unavailable", plainEnglish: `${sourceEngine} has not published this read.`, nowMs,
});

// ES Master gear, as documented on the cockpit: R <50 · N 50–62 · 1–4 in 7-pt steps · TURBO 90+.
export function gearFromMasterScore(score) {
  const s = n(score);
  if (s == null) return null;
  if (s < 50) return "R";
  if (s < 62) return "N";
  if (s >= 90) return "TURBO";
  return String(Math.min(4, Math.floor((s - 62) / 7) + 1));
}

function zoneOf(node) {
  const z = node?.confluence?.context?.reaction?.engine3V5?.normalizedZoneInput;
  const loc = node?.engine26LocationCandidate;
  const lo = n(z?.eligible ? z?.zone?.low : null) ?? n(loc?.entryZoneLow);
  const hi = n(z?.eligible ? z?.zone?.high : null) ?? n(loc?.entryZoneHigh);
  const mid = n(z?.eligible ? z?.zone?.midline : null) ?? n(loc?.entryZoneMidline) ?? (lo != null && hi != null ? (lo + hi) / 2 : null);
  if (lo == null || hi == null) return null;
  return { low: lo, high: hi, midline: r2(mid), zoneId: z?.zone?.zoneId ?? loc?.zoneId ?? null, type: z?.zone?.type ?? null };
}

function buildLocation(node, price, nowMs) {
  const loc = node?.engine26LocationCandidate;
  const zone = zoneOf(node);
  const path = "strategies.intraday_scalp@10m.engine26LocationCandidate";
  if (!loc && !zone) return { sec: unavailable("location", "Engine 26", path, nowMs), zone: null, atZone: false };
  let where = null, distance = null, waitingFor = null;
  if (zone && price != null) {
    if (price < zone.low) { where = "BELOW"; distance = r2(zone.low - price); waitingFor = `Price to reach the bottom edge (${pts(zone.low)}).`; }
    else if (price > zone.high) { where = "ABOVE"; distance = r2(price - zone.high); waitingFor = `Price to reach the top edge (${pts(zone.high)}).`; }
    else { where = "INSIDE"; distance = 0; }
  }
  const atZone = where === "INSIDE";
  const watch = up(loc?.preferredDirection ?? loc?.directionBias);
  const plain = !zone ? "No active zone." : where === "INSIDE"
    ? `Price is inside the ${pts(zone.low)}–${pts(zone.high)} zone.`
    : `Zone ${pts(zone.low)}–${pts(zone.high)}. Price is ${pts(distance)} points ${where === "BELOW" ? "below" : "above"} it.`;
  return {
    zone, atZone, where, distance,
    sec: section({
      key: "location", sourceEngine: "Engine 26", sourcePath: path, nowMs,
      status: zone ? "READY" : "WAITING", state: loc?.status ?? null,
      label: zone ? "Zone found" : "No zone", plainEnglish: plain, waitingFor: atZone ? null : waitingFor,
      facts: [
        zone && { label: "Zone", value: `${pts(zone.low)}–${pts(zone.high)}` },
        zone?.midline != null && { label: "Midline (A++)", value: pts(zone.midline) },
        where && { label: "Distance", value: where === "INSIDE" ? "Inside" : `${pts(distance)} pts ${where.toLowerCase()}` },
        loc?.setupGrade && { label: "Grade", value: loc.setupGrade },
        watch && watch !== "NEUTRAL" && { label: "Engine 26 watching", value: `${watch} (watch only)` },
      ],
      sourceTimestamp: loc?.snapshotTime ?? null,
      details: { candidateId: loc?.candidateId ?? null, zoneId: zone?.zoneId ?? null, directionState: loc?.directionState ?? null },
    }),
  };
}

function buildReaction(node, nowMs) {
  const e3 = node?.confluence?.context?.reaction?.engine3V5;
  const rd = node?.confluence?.context?.reaction?.engine3Strategy1Readiness;
  const path = "strategies.intraday_scalp@10m.confluence.context.reaction.engine3V5.canonical.canonical";
  const c = e3?.canonical?.canonical;
  if (!c) return unavailable("reaction", "Engine 3", path, nowMs);
  const dir = up(c.direction) || "NEUTRAL";
  const has = dir === "LONG" || dir === "SHORT";
  return section({
    key: "reaction", sourceEngine: "Engine 3", sourcePath: path, nowMs,
    status: has ? "READY" : "WAITING", state: dir,
    label: has ? `${dir} reaction` : "No reaction yet",
    // Engine 3's own words when it publishes them.
    plainEnglish: rd?.plainEnglishMeaning || (has ? `Engine 3 reads a ${dir.toLowerCase()} reaction at the zone.` : "No reaction to read yet."),
    waitingFor: has ? null : "A rejection or a failed break at the zone edge, confirmed on a completed 5-minute bar.",
    facts: [
      { label: "Direction", value: dir },
      c.quality && { label: "Quality", value: up(c.quality) },
      rd?.readinessState && { label: "Readiness", value: rd.readinessState },
    ],
    sourceTimestamp: e3?.evaluatedAt ?? e3?.asOf ?? null,
  });
}

function buildParticipation(node, nowMs) {
  const vol = node?.confluence?.context?.volume || {};
  const v1 = vol.engine4AuthorizedReactionParticipation?.participation5m;
  const v2 = vol.engine4V2Shadow;
  const path = "strategies.intraday_scalp@10m.confluence.context.volume.engine4AuthorizedReactionParticipation.participation5m";
  if (!v1 && !v2) return unavailable("participation", "Engine 4", path, nowMs);
  const st = up(v1?.state) || "UNRESOLVED";
  const status = ["CONFIRMED", "SUPPORTIVE", "CONFIRMING"].includes(st) ? "READY" : st === "ADVERSE" ? "BLOCKED" : "WAITING";
  const relVol = n(v2?.evidence?.relVol);
  const warnings = (v2?.warnings || []).map((w) => ({ code: w.code, side: w.side ?? null, engine29Read: w.engine29Read ?? null, meaning: w.meaning ?? null }));
  const volWord = relVol == null ? null : relVol >= 1.25 ? "heavy" : relVol >= 0.9 ? "normal" : "light";
  const plain = status === "READY" ? "Volume is backing the move on a completed bar."
    : status === "BLOCKED" ? "Volume is pushing against the setup."
    : volWord ? `Volume is ${volWord} (${relVol}× normal on the last completed 5-minute bar). ${warnings.length ? "Warnings below." : "No warning signs."}`
    : "Waiting for completed-bar volume evidence.";
  return section({
    key: "participation", sourceEngine: "Engine 4", sourcePath: path, nowMs,
    status, state: st, label: status === "READY" ? "Volume confirms" : status === "BLOCKED" ? "Volume against" : "Waiting for volume",
    plainEnglish: plain,
    waitingFor: status === "WAITING" ? "Engine 3 to pick a direction, then volume to back it on a completed bar." : null,
    facts: [
      { label: "Engine 4 state", value: st },
      v1?.quality && { label: "Quality", value: up(v1.quality) },
      relVol != null && { label: "5-min vs normal (shadow)", value: `${relVol}×` },
      { label: "Warnings", value: warnings.length ? warnings.map((w) => w.code).join(", ") : "None" },
    ],
    sourceTimestamp: v2?.evaluationTimeMs ?? null,
    details: v2 ? {
      shadow: { version: v2.version ?? null, participationState: v2.participationState ?? null, confirmationState: v2.confirmationState ?? null, authority: "SHADOW_ONLY" },
      warnings,
    } : null,
  });
}

const STAND_DOWN = new Set(["STAND_DOWN", "BLOCK", "BLOCKED", "NO_TRADE", "DENY", "DENIED"]);
function buildPermission(node, nowMs) {
  const p = node?.permission;
  const path = "strategies.intraday_scalp@10m.permission";
  if (!p?.permission) return { sec: unavailable("permission", "Engine 6", path, nowMs), allowed: false, decision: null };
  const decision = up(p.permission);
  const size = n(p.sizeMultiplier);
  const allowed = !STAND_DOWN.has(decision) && size != null && size > 0;
  const status = allowed ? "READY" : STAND_DOWN.has(decision) ? "BLOCKED" : "WAITING";
  return {
    allowed, decision,
    sec: section({
      key: "permission", sourceEngine: "Engine 6", sourcePath: path, nowMs,
      status, state: decision, label: allowed ? "Paper trade allowed" : decision === "STAND_DOWN" ? "Stand down" : decision,
      plainEnglish: allowed
        ? `Engine 6 allows a paper trade (size ×${size}).`
        : "Engine 6 says stand down: the setup is not complete.",
      waitingFor: allowed ? null : "Engines 3 and 4 to confirm at the zone.",
      facts: [
        { label: "Decision", value: decision },
        { label: "Size", value: size == null ? "—" : `×${size}` },
      ],
      sourceTimestamp: p.asOf ?? null,
      details: { reasonCodes: Array.isArray(p.reasonCodes) ? p.reasonCodes.slice(0, 60) : [] },
    }),
  };
}

function buildStructure(node, price, nowMs) {
  const w = node?.engine22WaveStrategy;
  const path = "strategies.intraday_scalp@10m.engine22WaveStrategy";
  if (!w) return unavailable("structure", "Engine 22", path, nowMs);
  const s = w.tradeContextSummary || {};
  const opp = w.waveOpportunity || {};
  // Display check only: levels very far from price may mean the count needs an owner update.
  const levels = [n(s.topCandidate), n(s.hardInvalidation)].filter((v) => v != null);
  const far = price != null ? levels.filter((v) => Math.abs(v - price) / price > 0.05) : [];
  return section({
    key: "structure", sourceEngine: "Engine 22", sourcePath: path, nowMs,
    status: "INFO", state: s.bias ?? opp.setupType ?? null,
    label: s.headline || opp.setupType || "Wave structure",
    plainEnglish: s.subheadline || "Engine 22 wave context.",
    waitingFor: "Context only. The wave count never creates a trade by itself.",
    facts: [
      opp.degree && { label: "Degree", value: opp.degree },
      opp.readiness && { label: "Readiness", value: opp.readiness },
      opp.direction && { label: "Direction", value: opp.direction },
      opp.chaseRisk && { label: "Chase risk", value: opp.chaseRisk },
    ],
    sourceTimestamp: w.sevenDegreeInvalidations?.evaluationTime ?? null,
    details: {
      keyLevels: { topCandidate: n(s.topCandidate), hardInvalidation: n(s.hardInvalidation) },
      displayWarnings: far.length ? [{ code: "LEVELS_FAR_FROM_PRICE", levels: far, meaning: "Some Engine 22 levels are more than 5% from price; the count may need an owner update." }] : [],
    },
  });
}

function buildMarket(snapshot, node, meter, nowMs) {
  const e25 = snapshot?.engine25Context || node?.engine25Context || null;
  const e29 = node?.confluence?.context?.volume?.engine4V2Shadow?.engine29Context || null;
  const ema10m = snapshot?.emaPosture?.tenMinute || null;
  const master = meter?.master || null;
  const score = n(master?.score);
  const gear = gearFromMasterScore(score);
  const e10 = n(ema10m?.ema10), e20 = n(ema10m?.ema20), close = n(ema10m?.close);
  const emaFlat = e10 != null && e20 != null && close ? Math.abs(e10 - e20) / close < EMA_FLAT_PCT : null;
  const direction = gear == null ? "UNAVAILABLE" : gear === "R" ? "BEARISH" : gear === "N" ? "NEUTRAL" : "BULLISH";
  const gearLabel = gear == null ? "—" : gear === "R" ? "Reverse" : gear === "N" ? "Neutral" : gear === "TURBO" ? "Turbo" : `Bull ${gear}`;
  const parts = [];
  parts.push(score == null ? "Market direction unavailable." : `Market direction: ${gearLabel} (ES Master ${r2(score)}, blended 10m/30m/1H/4H/daily).`);
  if (emaFlat === true) parts.push("10-minute 10/20 EMA are flat on top of each other: no short-term trend.");
  else if (emaFlat === false) parts.push(`10-minute 10 EMA is ${e10 > e20 ? "above" : "below"} the 20: short-term ${e10 > e20 ? "up" : "down"}.`);
  if (e29?.available) parts.push(`Engine 29 30-minute: ${e29.trend}${e29.live?.state ? `; 10-minute: ${e29.live.state.replace(/_/g, " ").toLowerCase()}` : ""}.`);
  return {
    direction: { state: direction, gear, gearLabel, masterScore: r2(score), masterState: master?.state ?? null, weights: master?.weights ?? null, source: "ES Master meter (/api/v1/futures/market-meter)", authority: "DISPLAY_ONLY" },
    sec: section({
      key: "marketContext", sourceEngine: "Engines 25 / 29 + ES Master", sourcePath: "engine25Context · engine4V2Shadow.engine29Context · futures/market-meter.master", nowMs,
      status: "INFO", state: direction, label: gear == null ? "Market context" : `${gearLabel}${emaFlat ? " — no short-term trend" : ""}`,
      plainEnglish: parts.join(" "),
      waitingFor: "Context only.",
      facts: [
        score != null && { label: "ES Master", value: `${r2(score)} · ${master?.state ?? ""}`.trim() },
        n(e25?.marketHealth?.score) != null && { label: "Market health", value: `${r2(n(e25.marketHealth.score))} · ${e25.marketHealth.regime ?? ""}`.trim() },
        emaFlat != null && { label: "10m 10/20 EMA", value: emaFlat ? "Flat (no trend)" : e10 > e20 ? "10 above 20" : "10 below 20" },
        e29?.available && { label: "Engine 29 30m", value: e29.trend },
      ],
      sourceTimestamp: meter?.updated_at_utc ?? e25?.generatedAtUtc ?? null,
      details: {
        engine25: e25 ? { score: n(e25.score), regime: e25.regime ?? null, permissionContext: e25.permission ?? null, plainEnglish: e25.zoneAwareRead?.plainEnglish ?? null } : null,
        engine29: e29 ? { trend: e29.trend ?? null, parentDirection: e29.parentDirection ?? null, live: e29.live ?? null, squeeze: e29.squeeze ?? null, receipt: e29.receipt ?? null } : null,
        ema10m: { ema10: r2(e10), ema20: r2(e20), flat: emaFlat, flatRule: `|EMA10-EMA20| < ${EMA_FLAT_PCT * 100}% of price (display heuristic)` },
      },
    }),
  };
}

/**
 * @param {object} p
 * @param {object} p.snapshot  strategy-snapshot-es.json (what dashboard-snapshot serves)
 * @param {object|null} p.meter  /api/v1/futures/market-meter?symbol=ES response
 * @param {number} p.nowMs
 */
export function buildTraderView({ snapshot = null, meter = null, nowMs = Date.now() } = {}) {
  const node = snapshot?.strategies?.[TRADER_VIEW_STRATEGY] || null;
  const asOfMs = ms(snapshot?.now);
  const ageMs = asOfMs != null ? Math.max(0, nowMs - asOfMs) : null;
  const price = n(node?.engine26LocationCandidate?.currentPrice) ?? n(node?.engine22WaveStrategy?.currentPrice) ?? n(snapshot?.emaPosture?.tenMinute?.close);

  const location = buildLocation(node, price, nowMs);
  const reaction = buildReaction(node, nowMs);
  const participation = buildParticipation(node, nowMs);
  const permission = buildPermission(node, nowMs);
  const structure = buildStructure(node, price, nowMs);
  const market = buildMarket(snapshot, node, meter, nowMs);

  const freshness = {
    status: !snapshot ? "UNAVAILABLE" : ageMs == null ? "UNKNOWN" : ageMs > STALE_SNAPSHOT_MS ? "STALE" : "LIVE",
    snapshotAsOf: snapshot?.now ?? null,
    snapshotAgeMs: ageMs,
    meterAvailable: market.direction.masterScore != null,
    notes: [],
  };
  if (freshness.status === "STALE") freshness.notes.push("Engine snapshot is more than 5 minutes old.");
  if (!freshness.meterAvailable) freshness.notes.push("ES Master meter unavailable.");

  const verdict = permission.allowed
    ? { state: "PAPER_ALLOWED", label: "PAPER TRADE ALLOWED", plainEnglish: "Engine 6 allows a paper trade.", source: "Engine 6" }
    : { state: "NO_TRADE", label: "NO TRADE — WAITING", plainEnglish: `Engine 6: ${permission.decision === "STAND_DOWN" ? "stand down" : (permission.decision || "unavailable").toLowerCase()}.`, source: "Engine 6" };

  const z = location.zone;
  const summary = [
    z ? (location.atZone ? `Price is inside the ${pts(z.low)}–${pts(z.high)} zone.` : `Price is ${pts(location.distance)} points ${location.where === "BELOW" ? "below" : "above"} the ${pts(z.low)}–${pts(z.high)} zone.`) : "No active zone.",
    market.sec.plainEnglish,
    location.atZone ? (reaction.status === "READY" ? "Engine 3 has a reaction; watching volume." : "Watching for a reaction at the zone.") : "Nothing to do until price reaches the zone.",
  ].join(" ");

  return {
    schema: TRADER_VIEW_SCHEMA,
    symbol: "ES",
    strategyId: TRADER_VIEW_STRATEGY,
    generatedAt: new Date(nowMs).toISOString(),
    price,
    freshness,
    authority: { displayOnly: true, noPermissionCreated: true, noExecution: true, finalPermission: "Engine 6" },
    verdict,
    marketDirection: market.direction,
    rightNow: { plainEnglish: summary },
    checklist: [
      { step: 1, label: z ? `Zone found (${pts(z.low)}–${pts(z.high)})` : "Zone found", done: location.sec.status === "READY", source: "Engine 26" },
      { step: 2, label: "Price reaches the zone", done: location.atZone === true, source: "Engine 26" },
      { step: 3, label: "Reaction confirms: Engine 3", done: reaction.status === "READY", source: "Engine 3" },
      { step: 4, label: "Volume backs it on a completed bar: Engine 4", done: participation.status === "READY", source: "Engine 4" },
    ],
    pipeline: [location.sec, reaction, participation, permission.sec].map((s) => ({ key: s.key, sourceEngine: s.sourceEngine, status: s.status })),
    sections: {
      location: location.sec,
      reaction,
      participation,
      permission: permission.sec,
      structure,
      marketContext: market.sec,
    },
  };
}
