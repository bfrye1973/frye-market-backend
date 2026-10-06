import {
  buildEngine4AuthorizedReactionParticipation,
} from "../logic/engine4/buildAuthorizedReactionParticipation.js";
import {
  evaluateEngine6Strategy1Phase4Contract,
} from "../logic/engine6/strategy1PermissionContract.js";

const DATE = "2026-10-06";
const TIMES = ["0901","0904","0907","0910","0913","0916","0919","0922"];
const STRATEGY_ID = "intraday_scalp@10m";
const BASE = "https://frye-market-backend-1.onrender.com/api/v1/replay/es/snapshot";

function pick(obj, keys) {
  const out = {};
  for (const key of keys) out[key] = obj?.[key] ?? null;
  return out;
}

async function fetchReplay(time) {
  const url =
    BASE +
    "?date=" + encodeURIComponent(DATE) +
    "&time=" + encodeURIComponent(time) +
    "&strategyId=" + encodeURIComponent(STRATEGY_ID);

  const response = await fetch(url, {
    headers: { accept: "application/json", "cache-control": "no-store" },
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error("Replay fetch failed " + time + " " + response.status + " " + text.slice(0, 300));
  }
  return JSON.parse(text);
}

function summarizeE4(e4) {
  return {
    state: e4?.participationState ?? null,
    direction: e4?.direction ?? null,
    quality: e4?.participationQuality ?? null,
    confirmed: e4?.participationConfirmed === true,
    allowed: e4?.allowed === true,
    hardBlocked: e4?.hardBlocked === true,
    blockers: Array.isArray(e4?.blockers) ? e4.blockers : [],
    participation5mState: e4?.participation5mState ?? null,
    participation5mQuality: e4?.participation5mQuality ?? null,
    participation5mCompleted: e4?.participation5mCompleted ?? null,
    participation5mVolumeRatio: e4?.participation5mVolumeRatio ?? null,
    participation5mCandleDirection: e4?.participation5mCandleDirection ?? null,
    participation5mPriceProgressDirection: e4?.participation5mPriceProgressDirection ?? null,
    broader10mVolumeTrend: e4?.broader10mVolumeTrend ?? null,
    broader10mRelativeVolume: e4?.broader10mRelativeVolume ?? null,
    broader10mVolumeExpansion: e4?.broader10mVolumeExpansion ?? null,
    broader10mVolumeConfirmed: e4?.broader10mVolumeConfirmed ?? null,
  };
}

function summarizeE6(e6) {
  return {
    decision: e6?.decision ?? null,
    permissionState: e6?.permissionState ?? null,
    direction: e6?.direction ?? null,
    allowed: e6?.allowed === true,
    paperAllowed: e6?.paperAllowed === true,
    blockers: Array.isArray(e6?.blockers) ? e6.blockers : [],
  };
}

const rows = [];

for (const time of TIMES) {
  const snapshot = await fetchReplay(time);
  const strategy = snapshot?.strategies?.[STRATEGY_ID];

  if (!strategy) {
    rows.push({ time, error: "STRATEGY_MISSING" });
    continue;
  }

  const reaction =
    strategy?.confluence?.context?.reaction?.paperScalpReaction || null;

  const volumeContext =
    strategy?.confluence?.context?.volume || {};

  const oldE4 =
    volumeContext?.engine4AuthorizedReactionParticipation || null;

  const fast =
    volumeContext?.engine4FastImbalanceParticipation || null;

  const current =
    volumeContext?.engine4CurrentScalpParticipation || null;

  const candidate =
    strategy?.engine26LocationCandidate || null;

  const handoff =
    strategy?.engine26ReactionHandoff || null;

  const newE4 =
    buildEngine4AuthorizedReactionParticipation({
      patchedConfluence: strategy?.confluence || null,
      paperScalpReaction: reaction,
      engine4FastImbalanceParticipation: fast,
      engine4CurrentScalpParticipation: current,
      engine26LocationCandidate: candidate,
      engine26ReactionHandoff: handoff,
    });

  const oldE6 =
    strategy?.permission?.paper || null;

  const newE6 =
    evaluateEngine6Strategy1Phase4Contract({
      symbol: "ES",
      strategyId: STRATEGY_ID,
      engine26LocationCandidate: candidate,
      engine3Reaction: reaction,
      engine4Participation: newE4,
      engine26ImbalanceWatch:
        strategy?.engine26PrePermissionWatch ||
        strategy?.engine26ImbalanceWatch ||
        null,
      confluence: strategy?.confluence || null,
      direction: reaction?.direction || null,
    });

  rows.push({
    time,
    price:
      candidate?.currentPrice ??
      strategy?.confluence?.price ??
      strategy?.confluence?.currentPrice ??
      null,

    engine3: {
      ...pick(reaction, [
        "state",
        "reactionState",
        "direction",
        "quality",
        "allowed",
        "engine3Strategy1QualifiedForEngine6",
      ]),
      validation5m: reaction?.reactionValidation5m
        ? {
            validationState: reaction.reactionValidation5m.validationState ?? null,
            direction: reaction.reactionValidation5m.direction ?? null,
            quality: reaction.reactionValidation5m.quality ?? null,
            stale: reaction.reactionValidation5m.stale ?? null,
            currentCandleStatus: reaction.reactionValidation5m.currentCandleStatus ?? null,
            currentCandle: reaction.reactionValidation5m.currentCandle ?? null,
            priorCandle: reaction.reactionValidation5m.priorCandle ?? null,
          }
        : null,
    },

    engine4_1m: {
      status: newE4?.observationStatus ?? null,
      direction: newE4?.observation1mDirection ?? null,
      quality: newE4?.observation1mQuality ?? null,
      volumeRatio: newE4?.observation1mVolumeRatio ?? null,
      read: newE4?.currentVolumeReaction ?? null,
    },

    oldEngine4: summarizeE4(oldE4),
    newEngine4: summarizeE4(newE4),

    oldEngine6: summarizeE6(oldE6),
    newEngine6: summarizeE6(newE6),
  });
}

const compactRows = rows.map((row) => ({
  time: row.time,
  price: row.price ?? null,
  e3Direction: row.engine3?.direction ?? null,
  e3Quality: row.engine3?.quality ?? null,
  e3Qualified: row.engine3?.engine3Strategy1QualifiedForEngine6 === true,
  e3Validation5mDirection: row.engine3?.validation5m?.direction ?? null,
  e3Validation5mState: row.engine3?.validation5m?.validationState ?? null,
  e3Validation5mStatus: row.engine3?.validation5m?.currentCandleStatus ?? null,
  new5mState: row.newEngine4?.participation5mState ?? null,
  new5mCompleted: row.newEngine4?.participation5mCompleted ?? null,
  new5mRatio: row.newEngine4?.participation5mVolumeRatio ?? null,
  oldE4State: row.oldEngine4?.state ?? null,
  oldE4HardBlocked: row.oldEngine4?.hardBlocked === true,
  newE4State: row.newEngine4?.state ?? null,
  newE4HardBlocked: row.newEngine4?.hardBlocked === true,
  newE4Blockers: row.newEngine4?.blockers ?? [],
  oldE6Decision: row.oldEngine6?.decision ?? null,
  oldE6Allowed: row.oldEngine6?.allowed === true,
  newE6Decision: row.newEngine6?.decision ?? null,
  newE6Allowed: row.newEngine6?.allowed === true,
  newE6Blockers: row.newEngine6?.blockers ?? [],
}));

console.log(JSON.stringify({
  ok: true,
  date: DATE,
  strategyId: STRATEGY_ID,
  times: TIMES,
  compactRows,
}, null, 2));
