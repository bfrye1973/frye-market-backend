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

function section({ key, sourceEngine, sourcePath, status, state, label, plainEnglish, waitingFor = null, facts = [], sourceTimestamp = null, details = null, extra = null, nowMs }) {
  const t = ms(sourceTimestamp);
  return {
    key, sourceEngine, sourcePath,
    status, state: state ?? null, label, plainEnglish, waitingFor,
    facts: facts.filter(Boolean),
    sourceTimestamp: sourceTimestamp ?? null,
    sourceAgeMs: t != null && nowMs != null ? Math.max(0, nowMs - t) : null,
    details: details ?? null,
    ...(extra || {}),
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

// ---- Engine 3 explain block (display only) ----
// Every line comes from Engine 3 v5's published fields and rule codes. Nothing here
// evaluates a rule: it reads Engine 3's own state machine, control and quality outputs.
const sideOf = (controlState) => {
  const c = up(controlState);
  if (c === "SELLERS_CONTROL") return "Sellers";
  if (c === "BUYERS_CONTROL") return "Buyers";
  if (c) return "Mixed";
  return null;
};
const isoFromSec = (t) => (Number.isFinite(Number(t)) ? new Date(Number(t) * 1000).toISOString() : null);
const bar = (b) => b ? { time: isoFromSec(b.time), open: n(b.open), high: n(b.high), low: n(b.low), close: n(b.close) } : null;

export function buildEngine3Explain(reaction, { history = null } = {}) {
  const v5 = reaction?.engine3V5;
  if (!v5) return null;
  const sm = v5.stateMachine || {};
  const codes = Array.isArray(v5.trace?.stateMachine?.reasonCodes) ? v5.trace.stateMachine.reasonCodes : (Array.isArray(sm.reasonCodes) ? sm.reasonCodes : []);
  const has = (c) => codes.includes(c);
  const pa = v5.evidence?.priceAction || {};
  const f5 = v5.evidence?.fiveMinute || {};
  const zoneOk = v5.normalizedZoneInput ? v5.normalizedZoneInput.eligible === true : null;
  const official = up(v5.canonical?.canonical?.direction ?? sm.direction) || "NEUTRAL";
  const control = up(pa.controlState ?? sm.controlState) || null;
  const side = sideOf(control);
  const quality = up(pa.quality ?? sm.quality) || null;
  const qScore = n(pa.qualityScore);
  const sc = { buyers: n(pa.buyerScore), sellers: n(pa.sellerScore), mixed: n(pa.mixedScore) };
  const scoreText = sc.sellers != null && sc.buyers != null ? ` (sellers ${sc.sellers} vs buyers ${sc.buyers})` : "";
  const qualityText = quality ? `${quality}${qScore != null ? ` (${qScore})` : ""}` : "unknown";

  let whyWaiting = null;
  let stillNeeds = null;
  if (official === "LONG" || official === "SHORT") {
    whyWaiting = null;
  } else if (zoneOk === false) {
    whyWaiting = "Engine 3 has no authorized Engine 26 zone to evaluate right now.";
    stillNeeds = "An active, authorized Engine 26 negotiated zone.";
  } else if (has("ENGINE3_V5_DIRECTIONAL_CONTROL_PRESENT_BUT_QUALITY_NOT_QUALIFIED") || has("ENGINE3_V5_FRESH_DIRECTION_QUALITY_NOT_QUALIFIED")) {
    whyWaiting = `${side || "One side"} ${side === "Mixed" ? "are" : "are"} in control${scoreText}, but the reaction quality is ${qualityText}. Engine 3 only sets a new direction when quality is GOOD or STRONG.`;
    stillNeeds = `Quality GOOD or STRONG while ${side ? side.toLowerCase() : "the same side"} keep control on completed 5-minute price action.`;
  } else if (side === "Mixed" || !control) {
    whyWaiting = "Buyers and sellers are contested; neither side has control yet.";
    stillNeeds = "One side taking clear control inside the zone on completed 5-minute price action.";
  } else {
    whyWaiting = `Engine 3 is holding ${official}: ${String(sm.canonicalSource || sm.stateTransition || "waiting").replace(/_/g, " ").toLowerCase()}.`;
  }

  const checks = [
    { label: "Price inside the authorized zone", done: up(pa.latestZoneCloseRelation) === "INSIDE_ZONE" && zoneOk !== false, source: "priceAction.latestZoneCloseRelation" },
    { label: "One side has control", done: side === "Sellers" || side === "Buyers", source: "priceAction.controlState" },
    { label: "Quality GOOD or STRONG", done: quality === "GOOD" || quality === "STRONG", source: "priceAction.quality; rule FRESH_DIRECTION_REQUIRES_GOOD_OR_STRONG_QUALITY" },
    { label: "Engine 3 direction set", done: official === "LONG" || official === "SHORT", source: "canonical.canonical.direction" },
  ];

  const bars = f5.completed?.normalized?.bars;
  const lastBar = Array.isArray(bars) && bars.length ? bars[bars.length - 1] : null;
  const c5 = f5.completed || {};
  const lastCompleted5m = lastBar ? {
    ...bar(lastBar),
    zoneRelation: c5.followThrough?.latestRelation ?? null,
    contact: c5.contact?.contactState ?? null,
    reaction: c5.reaction?.reactionState ?? null,
    followThrough: c5.followThrough?.followThroughState ?? null,
    control: c5.control?.controlState ?? null,
    quality: c5.quality?.quality ?? null,
    qualityScore: n(c5.quality?.qualityScore),
    stateMachineHandoffEligible: f5.stateMachineHandoff ? f5.stateMachineHandoff.eligible === true : null,
  } : null;
  const forming5m = f5.completion?.formingBarPresent && f5.completion?.formingBar ? { ...bar(f5.completion.formingBar), note: "Still forming; Engine 3 does not use it to set direction." } : null;

  // Engine 3 v6 shadow, only if Engine 3 publishes it. No authority.
  const v6Key = reaction ? Object.keys(reaction).find((k) => /^engine3V6/i.test(k)) : null;
  const v6 = v6Key ? reaction[v6Key] : null;
  const v6Shadow = v6 ? {
    sourcePath: `strategies.intraday_scalp@10m.confluence.context.reaction.${v6Key}`,
    direction: up(v6.canonical?.canonical?.direction ?? v6.direction) || null,
    reason: v6.canonical?.canonical?.canonicalSource ?? v6.stateMachine?.canonicalSource ?? v6.reason ?? null,
    quality: up(v6.canonical?.canonical?.quality ?? v6.quality) || null,
    authority: "SHADOW_NO_AUTHORITY",
  } : null;

  return {
    officialDirection: official,
    observedControl: { state: control, side, confidence: up(pa.controlConfidence) || null, scores: sc, diagnosticOnly: true,
      evidence: { buyers: pa.control?.evidence?.buyers?.reasons || [], sellers: pa.control?.evidence?.sellers?.reasons || [], mixed: pa.control?.evidence?.mixed?.reasons || [] } },
    quality: { value: quality, score: qScore, reasons: pa.qualityEvidence?.scoring?.reasons || [] },
    whyWaiting,
    stillNeeds,
    stateTransition: sm.stateTransition ?? null,
    canonicalSource: sm.canonicalSource ?? null,
    sourcePrefix: "strategies.intraday_scalp@10m.confluence.context.reaction.engine3V5",
    ruleCodes: codes.filter((c) => !/NO_PERMISSION_CREATED|NO_EXECUTION|STATE_MACHINE_RAN|SOLE_CANONICAL|TIMEFRAME_LABELS|OWNS_INITIAL/.test(c)).map((c) => c.replace(/^ENGINE3_V5_/, "")),
    checks,
    lastCompleted5m,
    forming5m,
    directionHistory: history,
    v6Shadow,
  };
}

/**
 * Direction history recorded by Trader View (Engine 3 does not publish one).
 * Pure: returns a new state. Records a row when Engine 3's canonical direction changes
 * between snapshots Trader View has read. Lost on backend restart; labeled as such.
 */
export function updateEngine3DirectionHistory(state, snapshot, { max = 20, startedAt = null } = {}) {
  const prev = state && Array.isArray(state.entries) ? state : { startedAt: startedAt ?? new Date().toISOString(), entries: [], lastSnapshotAt: null };
  const node = snapshot?.strategies?.[TRADER_VIEW_STRATEGY];
  const v5 = node?.confluence?.context?.reaction?.engine3V5;
  const dir = up(v5?.canonical?.canonical?.direction ?? v5?.stateMachine?.direction);
  const at = snapshot?.now ?? null;
  if (!dir || !at || at === prev.lastSnapshotAt) return prev;
  const last = prev.entries[0] || null;
  if (last && last.to === dir) return { ...prev, lastSnapshotAt: at };
  const sm = v5?.stateMachine || {};
  const row = {
    at, from: last ? last.to : null, to: dir,
    stateTransition: sm.stateTransition ?? v5?.canonical?.canonical?.stateTransition ?? null,
    canonicalSource: sm.canonicalSource ?? v5?.canonical?.canonical?.canonicalSource ?? null,
    controlState: v5?.evidence?.priceAction?.controlState ?? sm.controlState ?? null,
    quality: v5?.evidence?.priceAction?.quality ?? sm.quality ?? null,
    firstObservation: !last,
  };
  return { ...prev, entries: [row, ...prev.entries].slice(0, max), lastSnapshotAt: at };
}

export function directionHistoryView(state) {
  if (!state) return null;
  return {
    recordedBy: "Trader View endpoint (Engine 3 does not publish a history)",
    since: state.startedAt,
    note: "Changes Trader View observed in the snapshots it read since the backend started. Lost on restart.",
    entries: state.entries,
  };
}

function buildReaction(node, nowMs, opts = {}) {
  const reaction = node?.confluence?.context?.reaction;
  const e3 = reaction?.engine3V5;
  const rd = reaction?.engine3Strategy1Readiness;
  const path = "strategies.intraday_scalp@10m.confluence.context.reaction.engine3V5.canonical.canonical";
  const c = e3?.canonical?.canonical;
  if (!c) return unavailable("reaction", "Engine 3", path, nowMs);
  const psr = reaction?.paperScalpReaction || {};
  const tf = (o, src) => o ? {
    state: o.state ?? null, direction: o.direction ?? null, quality: o.quality ?? null,
    completedState: o.completedPriceActionState ?? null, completedDirection: o.completedPriceActionDirection ?? null,
    diagnosticOnly: o.diagnosticOnly !== false, sourcePath: `paperScalpReaction.${src}`,
  } : null;
  const timeframes = {
    pathPrefix: "strategies.intraday_scalp@10m.confluence.context.reaction",
    oneMinute: tf(psr.reactionObservation1m, "reactionObservation1m"),
    fiveMinute: tf(psr.reactionValidation5m, "reactionValidation5m"),
    tenMinute: tf(psr.tenMinuteConfirmation, "tenMinuteConfirmation") ?? tf(psr.broaderReaction10m, "broaderReaction10m"),
    authority: "EVIDENCE_ONLY_CANONICAL_DIRECTION_DECIDES",
  };
  const dir = up(c.direction) || "NEUTRAL";
  const has = dir === "LONG" || dir === "SHORT";
  const explain = buildEngine3Explain(reaction, { history: opts.reactionHistory ?? null });
  const obs = explain?.observedControl;
  return section({
    key: "reaction", sourceEngine: "Engine 3", sourcePath: path, nowMs,
    status: has ? "READY" : "WAITING", state: dir,
    label: has ? `${dir} reaction` : "No reaction yet",
    // Engine 3's own words when it publishes them.
    plainEnglish: rd?.plainEnglishMeaning || (has ? `Engine 3 reads a ${dir.toLowerCase()} reaction at the zone.` : "No reaction to read yet."),
    waitingFor: has ? null : (explain?.stillNeeds || "A rejection or a failed break at the zone edge, confirmed on a completed 5-minute bar."),
    facts: [
      { label: "Official direction", value: dir },
      obs?.side && { label: "Observed control (diagnostic)", value: `${obs.side}${obs.confidence ? ` · ${obs.confidence}` : ""}` },
      c.quality && { label: "Quality", value: `${up(c.quality)}${explain?.quality?.score != null ? ` · ${explain.quality.score}` : ""}` },
      rd?.readinessState && { label: "Readiness", value: rd.readinessState },
    ],
    sourceTimestamp: e3?.canonical?.snapshotTime ?? e3?.normalizedZoneInput?.identity?.snapshotTime ?? e3?.evaluatedAt ?? null,
    details: { timeframes },
    extra: { explain },
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
      shadow: { version: v2.version ?? null, participationState: v2.participationState ?? null, confirmationState: v2.confirmationState ?? null, relVol, relVolDefinition: "completed 5m volume / median of prior 20 completed bars", authority: "SHADOW_ONLY" },
      canonicalLegacyRatio: { currentVsPriorVolumeRatio: n(v1?.currentVsPriorVolumeRatio), definition: "current vs prior 5m bar (current bar may still be forming)", authority: "CANONICAL_V1_EVIDENCE" },
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

// ---- Engine 22: authorized count vs owner research (display only) ----
// Authorized = engine22WaveStrategy.authorizedWorkingStructure (what Engine 6 advisory and
// Engine 27 read). Research = currentWavelength.ownerWaveRoadmap (OWNER_WORKING_RESEARCH_ONLY).
// Research is never promoted to the authorized count, and neither feeds the verdict.
// Nothing here is tied to a specific revision: whatever is published is read and described.
const E22_AUTH_DEGREES = ["minor", "minute", "subminute", "micro", "submicro"];
const E22_ALL_DEGREES = ["primary", "intermediate", "minor", "minute", "subminute", "micro", "submicro"];
const E22_RECONCILE_ISSUE = "frye-market-backend#378";
const E22_AUTH_STALE_MS = 15 * 60 * 1000;

const cap = (x) => (x ? String(x).charAt(0).toUpperCase() + String(x).slice(1) : x);

/** Normalize one degree read into a comparable meaning. */
export function e22Meaning(d) {
  if (!d) return null;
  const wave = d.activeWave ? String(d.activeWave).toUpperCase() : null;
  const dir = d.direction ? String(d.direction).toUpperCase() : null;
  const st = String(d.stage || "").toUpperCase();
  let kind = "ACTIVE";
  if (wave === "RECOUNT" || /CLEARED|RECOUNT/.test(st)) kind = "RECOUNT";
  else if (wave === "UNRESOLVED" || /UNRESOLVED/.test(st)) kind = "UNRESOLVED";
  else if (d.completionConfirmed !== true && /CANDIDATE|UNCONFIRMED/.test(st)) kind = "CANDIDATE";
  const realWave = wave && wave !== "RECOUNT" && wave !== "UNRESOLVED" ? wave : null;
  const realDir = dir && dir !== "NEUTRAL" && dir !== "NONE" ? dir : null;
  return { kind, wave: realWave, direction: realDir, candidate: /CANDIDATE/.test(st) };
}

/** Plain-English text for one degree. */
export function e22Text(d) {
  const m = e22Meaning(d);
  if (!m) return null;
  if (m.kind === "RECOUNT") return "Cleared (recount pending)";
  if (m.kind === "UNRESOLVED") return "Unresolved";
  const base = [m.wave, m.direction].filter(Boolean).join(" ") || "Unknown";
  if (m.kind === "CANDIDATE") return m.candidate ? `${base} candidate (unconfirmed)` : `${base} (unconfirmed)`;
  return base;
}

/** Same meaning? Recount/unresolved must match kind; otherwise wave + direction must match. */
function sameMeaning(a, b) {
  const x = e22Meaning(a), y = e22Meaning(b);
  if (!x || !y) return true;
  if (x.kind === "RECOUNT" || y.kind === "RECOUNT" || x.kind === "UNRESOLVED" || y.kind === "UNRESOLVED") return x.kind === y.kind;
  return x.wave === y.wave && x.direction === y.direction;
}

/** "Minor, Minute and Subminute cleared (recount pending); Micro W1 UP candidate (unconfirmed); Submicro unresolved" */
function describeDegrees(degrees, order) {
  const parts = [];
  let cleared = [];
  const flush = () => {
    if (!cleared.length) return;
    const names = cleared.map(cap);
    const list = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0];
    parts.push(`${list} cleared (recount pending)`);
    cleared = [];
  };
  for (const k of order) {
    const d = degrees[k];
    if (!d) continue;
    if (e22Meaning(d).kind === "RECOUNT") { cleared.push(k); continue; }
    flush();
    const t = e22Text(d);
    parts.push(`${cap(k)} ${t === "Unresolved" ? "unresolved" : t}`);
  }
  flush();
  return parts.join("; ");
}

const pickDegree = (d) => ({
  activeWave: d.activeWave ?? null, direction: d.direction ?? null, stage: d.stage ?? null,
  completionConfirmed: d.completionConfirmed === true,
  meaning: e22Text(d),
});

export function buildE22Contexts(w, nowMs) {
  const aws = w?.authorizedWorkingStructure || null;
  const awsOk = !!(aws && aws.degrees && typeof aws.degrees === "object");
  const publishedMs = awsOk && aws.publishedAt ? Date.parse(aws.publishedAt) : NaN;
  const ageMs = Number.isFinite(publishedMs) && Number.isFinite(nowMs) ? Math.max(0, nowMs - publishedMs) : null;
  const authorized = awsOk
    ? {
        available: true,
        schema: aws.schema ?? null,
        status: aws.status ?? null,
        publicationRevision: aws.publicationRevision ?? null,
        selectionApprovalReference: aws.selectionApprovalReference ?? null,
        publishedAt: aws.publishedAt ?? null,
        ageMs,
        stale: ageMs == null ? true : ageMs > E22_AUTH_STALE_MS,
        pointInTimeAsOfAvailable: aws.pointInTimeAsOfAvailable ?? null,
        sourcePath: "strategies.intraday_scalp@10m.engine22WaveStrategy.authorizedWorkingStructure",
        degrees: Object.fromEntries(
          E22_ALL_DEGREES.filter((k) => aws.degrees[k] && aws.degrees[k].available !== false).map((k) => {
            const d = aws.degrees[k];
            return [k, { ...pickDegree(d), selectionStatus: d.selectionStatus ?? null, sourcePath: d.sourcePath ?? null }];
          })
        ),
      }
    : { available: false, sourcePath: "strategies.intraday_scalp@10m.engine22WaveStrategy.authorizedWorkingStructure" };

  const rm = w?.currentWavelength?.ownerWaveRoadmap || null;
  const rmOk = !!(rm && typeof rm === "object" && rm.schema);
  const research = rmOk
    ? {
        available: true,
        schema: rm.schema ?? null,
        publicationType: rm.publicationType ?? null,
        effectiveAtUtc: rm.effectiveAtUtc ?? null,
        pointInTimeSourceVerified: rm.pointInTimeSourceVerified === true,
        priceBasisVerified: rm.priceBasisVerified === true,
        source: rm.source ?? null,
        sourcePath: "strategies.intraday_scalp@10m.engine22WaveStrategy.currentWavelength.ownerWaveRoadmap",
        degrees: Object.fromEntries(
          E22_ALL_DEGREES.filter((k) => rm[k]).map((k) => {
            const d = rm[k];
            const out = { ...pickDegree(d), alternatives: Array.isArray(d.alternatives) ? d.alternatives : [] };
            if (d.observedReferenceHigh) {
              out.observedReferenceHigh = {
                price: n(d.observedReferenceHigh.price), dateAz: d.observedReferenceHigh.dateAz ?? null,
                verified: d.observedReferenceHigh.verified === true,
                note: "Historical chart reference only — not an ending pivot, not a trade trigger.",
              };
            }
            return [k, out];
          })
        ),
      }
    : { available: false, sourcePath: "strategies.intraday_scalp@10m.engine22WaveStrategy.currentWavelength.ownerWaveRoadmap" };

  const conflicts = [];
  if (authorized.available && research.available) {
    for (const k of E22_ALL_DEGREES) {
      const a = aws.degrees[k];
      const r = rm[k];
      if (!a || !r || a.available === false) continue;
      if (!sameMeaning(a, r)) conflicts.push({ degree: k, authorized: e22Text(a), research: e22Text(r) });
    }
  }
  let status;
  if (!authorized.available && !research.available) status = "UNKNOWN";
  else if (!authorized.available) status = "RECOUNT_PENDING";
  else if (conflicts.length) status = "RECONCILIATION_PENDING";
  else status = "IN_SYNC";

  return {
    authorizedWaveContext: authorized,
    researchWaveContext: research,
    reconciliation: {
      status,
      conflicts,
      trackedIn: status === "IN_SYNC" ? null : E22_RECONCILE_ISSUE,
      rule: "Research is context only. It never replaces the authorized count and never creates permission.",
    },
  };
}

function buildStructure(node, price, nowMs) {
  const w = node?.engine22WaveStrategy;
  const path = "strategies.intraday_scalp@10m.engine22WaveStrategy";
  if (!w) return unavailable("structure", "Engine 22", path, nowMs);

  const ctx = buildE22Contexts(w, nowMs);
  const A = ctx.authorizedWaveContext;
  const R = ctx.researchWaveContext;
  const rec = ctx.reconciliation;
  const chartMinute = w?.degreeStates?.minute?.headline ?? null;
  const awsDeg = w?.authorizedWorkingStructure?.degrees || {};
  const rmRaw = w?.currentWavelength?.ownerWaveRoadmap || {};

  // The card reads the Micro chart first (Strategy 1 trading degree), then Submicro, then the higher degrees.
  const microLine = A.available ? describeDegrees(awsDeg, ["micro", "submicro"]) : null;
  const higherLine = A.available ? describeDegrees(awsDeg, ["minor", "minute", "subminute"]) : null;
  const authLine = A.available ? describeDegrees(awsDeg, E22_AUTH_DEGREES) : null;
  // Research adds what the authorized trading degrees don't: the higher degrees.
  const resHigher = R.available ? describeDegrees(rmRaw, ["primary", "intermediate"]) : null;

  let label;
  if (rec.status === "UNKNOWN") label = "Wave count unknown";
  else if (rec.status === "RECOUNT_PENDING") label = "Authorized count missing — recount pending";
  else label = microLine ? microLine : (authLine ? `${authLine.charAt(0).toUpperCase()}${authLine.slice(1)}` : "Wave structure");

  const parts = [];
  if (microLine) parts.push(`Micro chart (authorized${A.publicationRevision != null ? `, rev ${A.publicationRevision}` : ""}, what Engine 6 and Engine 27 read): ${microLine}.`);
  if (higherLine) parts.push(`Higher degrees: ${higherLine}.`);
  if (A.available && A.stale) parts.push(`This count is stale (published ${A.ageMs == null ? "at an unknown time" : `${Math.round(A.ageMs / 60000)} min ago`}).`);
  if (resHigher) parts.push(`Owner research, not confirmed: ${resHigher}.`);
  if (rec.status === "RECONCILIATION_PENDING") {
    parts.push(`Still differs from research: ${rec.conflicts.map((c) => `${cap(c.degree)} (authorized ${c.authorized} vs research ${c.research})`).join("; ")} — tracked in ${rec.trackedIn}.`);
  } else if (rec.status === "RECOUNT_PENDING") {
    parts.push(`Tracked in ${rec.trackedIn}.`);
  }
  parts.push("The wave count is context only: an UP candidate is not a LONG signal. Engine 6 decides.");

  // Display check only: older trade-summary levels very far from price.
  const s = w.tradeContextSummary || {};
  const levels = [n(s.topCandidate), n(s.hardInvalidation)].filter((v) => v != null && v > 0);
  const far = price != null ? levels.filter((v) => Math.abs(v - price) / price > 0.05) : [];

  const ad = A.available ? A.degrees : {};
  const rd = R.available ? R.degrees : {};
  const cleared = ["minor", "minute", "subminute"].filter((k) => ad[k] && e22Meaning(awsDeg[k]).kind === "RECOUNT");

  return section({
    key: "structure", sourceEngine: "Engine 22", sourcePath: path, nowMs,
    status: "INFO",
    state: rec.status,
    label,
    plainEnglish: parts.join(" "),
    waitingFor: "Context only. The wave count never creates a trade by itself.",
    facts: [
      { label: "Micro", value: ad.micro ? ad.micro.meaning : "Unknown" },
      { label: "Submicro", value: ad.submicro ? ad.submicro.meaning : "Unknown" },
      cleared.length === 3
        ? { label: "Minor / Minute / Subminute", value: "Cleared (recount)" }
        : ad.minute && { label: "Minute", value: ad.minute.meaning },
      rd.primary && { label: "Primary (research)", value: rd.primary.meaning },
      rd.intermediate && { label: "Intermediate (research)", value: rd.intermediate.meaning },
      { label: "Count status", value: rec.status },
    ],
    sourceTimestamp: A.publishedAt ?? R.effectiveAtUtc ?? w.sevenDegreeInvalidations?.evaluationTime ?? null,
    details: {
      authorizedWaveContext: A,
      researchWaveContext: R,
      reconciliation: rec,
      focusDegree: "micro",
      chartMinutePanel: chartMinute,
      retiredHeadline: s.headline ? { text: s.headline, note: "Older trade-summary headline; not shown as the current count." } : null,
      displayWarnings: far.length ? [{ code: "LEVELS_FAR_FROM_PRICE", levels: far, meaning: "Some older Engine 22 trade-summary levels are more than 5% from price; the count may need an owner update." }] : [],
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
        esTrendByTimeframe: meter?.lights ? Object.fromEntries(["10m", "30m", "1h", "4h", "1d"].filter((k) => meter.lights[k]).map((k) => [k, { score: r2(n(meter.lights[k].score)), state: meter.lights[k].state ?? null }])) : null,
        esTrendSource: "ES Master meter lights (price/EMA technicals per timeframe) — same inputs as the gear",
        marketBreadthByTimeframe: snapshot?.marketMind ? { "10m": { score: n(snapshot.marketMind.score10m), state: snapshot.marketMind.state10m ?? null }, "30m": { score: n(snapshot.marketMind.score30m), state: snapshot.marketMind.state30m ?? null }, "1h": { score: n(snapshot.marketMind.score1h), state: snapshot.marketMind.state1h ?? null }, "4h": { score: n(snapshot.marketMind.score4h), state: snapshot.marketMind.state4h ?? null }, eod: { score: n(snapshot.marketMind.scoreEOD), state: snapshot.marketMind.stateEOD ?? null } } : null,
        marketBreadthSource: "marketMind (whole-market internals: breadth/volume) — what the old Engine 25 panel shows",
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
export function buildTraderView({ snapshot = null, meter = null, nowMs = Date.now(), reactionHistory = null } = {}) {
  const node = snapshot?.strategies?.[TRADER_VIEW_STRATEGY] || null;
  const asOfMs = ms(snapshot?.now);
  const ageMs = asOfMs != null ? Math.max(0, nowMs - asOfMs) : null;
  // A price of 0 (or below) means "not set" upstream (e.g. Engine 22 overnight); show unknown, never 0.
  const px = (v) => { const x = n(v); return x != null && x > 0 ? x : null; };
  const price = px(node?.engine26LocationCandidate?.currentPrice) ?? px(node?.engine22WaveStrategy?.currentPrice) ?? px(snapshot?.emaPosture?.tenMinute?.close);

  const location = buildLocation(node, price, nowMs);
  const reaction = buildReaction(node, nowMs, { reactionHistory });
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
