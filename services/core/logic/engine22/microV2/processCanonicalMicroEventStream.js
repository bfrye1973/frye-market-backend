// Engine 22 Micro Lifecycle V2 — deterministic event-stream processor.
//
// Live and Replay must feed equivalent ordered observations through this same
// pure processor. This module does not fetch data or create trading authority.

import {
  reduceCanonicalMicroState,
} from "./reduceCanonicalMicroState.js";

import {
  applyCanonicalMicroIntrabarFibObservation,
} from "./applyCanonicalMicroIntrabarFibObservation.js";

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function toMs(value) {
  if (value == null || value === "") {
    return null;
  }

  const numeric = Number(value);

  if (
    Number.isFinite(numeric) &&
    numeric > 0
  ) {
    return numeric < 1e12
      ? numeric * 1000
      : numeric;
  }

  const parsed =
    Date.parse(value);

  return Number.isFinite(parsed)
    ? parsed
    : null;
}

function eventTimestamp(event) {
  return (
    event
      ?.evidence
      ?.sourceTimestamp ??
    event?.sourceTimestamp ??
    null
  );
}

export function processCanonicalMicroEventStream({
  initialState,
  events = [],
} = {}) {
  let state =
    clone(initialState);

  const results = [];

  let previousTimestampMs =
    null;

  for (
    let index = 0;
    index < events.length;
    index += 1
  ) {
    const event =
      clone(events[index]);

    const timestamp =
      eventTimestamp(event);

    const timestampMs =
      toMs(timestamp);

    if (timestampMs == null) {
      results.push({
        index,
        applied: false,
        eventType:
          event?.type ?? null,
        reasonCodes: [
          "EVENT_SOURCE_TIMESTAMP_REQUIRED",
        ],
      });

      continue;
    }

    if (
      previousTimestampMs != null &&
      timestampMs <
        previousTimestampMs
    ) {
      results.push({
        index,
        applied: false,
        eventType:
          event?.type ?? null,
        reasonCodes: [
          "OUT_OF_ORDER_MICRO_EVENT_STREAM",
        ],
      });

      continue;
    }

    let result;

    if (
      event.type ===
      "INTRABAR_FIB_OBSERVATION"
    ) {
      result =
        applyCanonicalMicroIntrabarFibObservation(
          state,
          {
            sourceTimestamp:
              event.sourceTimestamp,
            rawHigh:
              event.rawHigh,
            rawLow:
              event.rawLow,
            levels:
              event.levels,
            source:
              event.source,
          }
        );
    } else {
      result =
        reduceCanonicalMicroState(
          state,
          event
        );
    }

    if (result.applied) {
      state =
        result.state;

      previousTimestampMs =
        timestampMs;
    }

    results.push({
      index,
      applied:
        result.applied === true,
      eventType:
        event.type,
      reasonCodes:
        result.reasonCodes || [],
      revision:
        result.state?.revision ??
        null,
      activeWave:
        result.state?.activeWave ??
        null,
      countStatus:
        result.state?.countStatus ??
        null,
    });
  }

  return {
    state,
    results,

    appliedCount:
      results.filter(
        (entry) =>
          entry.applied === true
      ).length,

    rejectedCount:
      results.filter(
        (entry) =>
          entry.applied !== true
      ).length,

    reasonCodes: [
      "CANONICAL_MICRO_EVENT_STREAM_PROCESSED",
    ],
  };
}

export function compareCanonicalMicroReplayEquivalence({
  liveInitialState,
  replayInitialState,
  observations = [],
} = {}) {
  const live =
    processCanonicalMicroEventStream({
      initialState:
        liveInitialState,
      events:
        observations,
    });

  const replay =
    processCanonicalMicroEventStream({
      initialState:
        replayInitialState,
      events:
        observations,
    });

  const liveJson =
    JSON.stringify(
      live.state
    );

  const replayJson =
    JSON.stringify(
      replay.state
    );

  const equivalent =
    liveJson === replayJson;

  return {
    equivalent,

    live:
      live.state,

    replay:
      replay.state,

    liveResults:
      live.results,

    replayResults:
      replay.results,

    reasonCodes:
      equivalent
        ? [
            "LIVE_REPLAY_MICRO_STATE_EQUIVALENT",
          ]
        : [
            "LIVE_REPLAY_MICRO_STATE_MISMATCH",
            "FAIL_CLOSED",
          ],
  };
}

export default {
  processCanonicalMicroEventStream,
  compareCanonicalMicroReplayEquivalence,
};
