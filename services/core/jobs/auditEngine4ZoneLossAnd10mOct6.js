import {
  buildEngine4AuthorizedReactionParticipation,
} from "../logic/engine4/buildAuthorizedReactionParticipation.js";

const DATE = "2026-10-06";
const TIMES = ["0910", "0916"];
const STRATEGY_ID = "intraday_scalp@10m";
const BASE = "https://frye-market-backend-1.onrender.com/api/v1/replay/es/snapshot";

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

const rows = [];

for (const time of TIMES) {
  const snapshot = await fetchReplay(time);
  const strategy = snapshot?.strategies?.[STRATEGY_ID] || null;
  const reaction = strategy?.confluence?.context?.reaction?.paperScalpReaction || null;
  const volume = strategy?.confluence?.context?.volume || {};
  const candidate = strategy?.engine26LocationCandidate || null;
  const handoff = strategy?.engine26ReactionHandoff || null;

  const newE4 = buildEngine4AuthorizedReactionParticipation({
    patchedConfluence: strategy?.confluence || null,
    paperScalpReaction: reaction,
    engine4FastImbalanceParticipation: volume?.engine4FastImbalanceParticipation || null,
    engine4CurrentScalpParticipation: volume?.engine4CurrentScalpParticipation || null,
    engine26LocationCandidate: candidate,
    engine26ReactionHandoff: handoff,
  });

  rows.push({
    time,
    price: candidate?.currentPrice ?? null,
    candidate: {
      direction: candidate?.direction ?? null,
      directionState: candidate?.directionState ?? null,
      candidateInvalidated: candidate?.candidateInvalidated ?? candidate?.invalidated ?? null,
      locationInvalidated: candidate?.locationInvalidated ?? null,
      entryZone: candidate?.entryZone ?? candidate?.zone ?? candidate?.negotiatedZone ?? null,
      invalidationFacts: candidate?.invalidationFacts ?? null,
      zoneMemorySummary: candidate?.zoneMemorySummary ?? null,
    },
    engine3: {
      direction: reaction?.direction ?? null,
      state: reaction?.reactionState ?? reaction?.state ?? null,
      quality: reaction?.quality ?? null,
      qualified: reaction?.engine3Strategy1QualifiedForEngine6 === true,
      entryZone: reaction?.entryZone ?? null,
      currentCandleStatus: reaction?.currentCandleStatus ?? null,
      currentCandle: reaction?.currentCandle ?? null,
      sourceTimeframe: reaction?.sourceTimeframe ?? null,
      reactionTimeframe: reaction?.reactionTimeframe ?? null,
      candleSourceFresh: reaction?.candleSourceFresh ?? null,
      invalidationFacts: reaction?.invalidationFacts ?? null,
      candidateInvalidated: reaction?.candidateInvalidated ?? null,
      validation5m: reaction?.reactionValidation5m
        ? {
            state: reaction.reactionValidation5m.validationState ?? null,
            direction: reaction.reactionValidation5m.direction ?? null,
            currentCandleStatus: reaction.reactionValidation5m.currentCandleStatus ?? null,
            currentCandle: reaction.reactionValidation5m.currentCandle ?? null,
            priorCandle: reaction.reactionValidation5m.priorCandle ?? null,
            stale: reaction.reactionValidation5m.stale ?? null,
          }
        : null,
    },
    engine4New: {
      state: newE4?.participationState ?? null,
      hardBlocked: newE4?.hardBlocked === true,
      blockers: newE4?.blockers ?? [],
      participation5mState: newE4?.participation5mState ?? null,
      participation5mCompleted: newE4?.participation5mCompleted ?? null,
      participation5mRatio: newE4?.participation5mVolumeRatio ?? null,
      broader10mActive: newE4?.broader10mActive ?? null,
      broader10mTrend: newE4?.broader10mVolumeTrend ?? null,
      broader10mRelativeVolume: newE4?.broader10mRelativeVolume ?? null,
      broader10mExpansion: newE4?.broader10mVolumeExpansion ?? null,
      broader10mConfirmed: newE4?.broader10mVolumeConfirmed ?? null,
      broader10mHighVolumeCandles: newE4?.broader10mHighVolumeCandles ?? null,
      currentCandleClosed: newE4?.currentCandleClosed ?? null,
      currentCandleStatus: newE4?.currentCandleStatus ?? null,
      lastCandle: newE4?.lastCandle ?? null,
      entryZone: newE4?.entryZone ?? null,
      reasonCodes: newE4?.reasonCodes ?? [],
    },
  });
}

console.log(JSON.stringify({ ok: true, date: DATE, rows }, null, 2));
