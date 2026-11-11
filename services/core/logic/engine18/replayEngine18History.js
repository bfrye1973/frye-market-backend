import { normalizeEngine11ClosedBars } from "./engine11ClosedBarsAdapter.js";
import { analyzeEngine18Candles } from "./liquidityBaseline.js";

// The baseline replay intentionally separates signal-time information from future scoring.
// Events are recorded when their candle closes. Later candles are used ONLY to score outcomes.
export function replayEngine18History({
  rows, contractSymbol, timeframeSeconds = 300, lookback = 20,
  horizonBars = 6, minMoveTicks = 4, asOfUnixSec
} = {}) {
  if (![300, 600].includes(timeframeSeconds)) throw Error("ENGINE18_REPLAY_5M_OR_10M_ONLY");
  if (!Number.isInteger(horizonBars) || horizonBars < 1 || horizonBars > 50) throw Error("ENGINE18_REPLAY_INVALID_HORIZON");
  if (!Number.isInteger(minMoveTicks) || minMoveTicks < 1 || minMoveTicks > 100) throw Error("ENGINE18_REPLAY_INVALID_MOVE");
  const parsed = normalizeEngine11ClosedBars(rows, { contractSymbol, timeframeSeconds, asOfUnixSec });
  const bars = parsed.bars;
  if (bars.length < lookback + 2) throw Error("ENGINE18_REPLAY_INSUFFICIENT_BARS");
  if (bars.length > 3000) throw Error("ENGINE18_REPLAY_MAX_3000_BARS");
  const signals = [];
  for (let i = lookback; i < bars.length; i++) {
    // Evaluate only the current closed bar plus its prior lookback: bounded CPU, same causal result.
    const prefix = bars.slice(i - lookback, i + 1);
    const r = analyzeEngine18Candles({ bars: prefix, lookback, contractSymbol });
    // An earlier event in the snapshot must never masquerade as a new event.
    for (const e of r.events.filter(e => e.time === bars[i].time)) {
      const direction = e.direction.startsWith("UP_") ? 1 : -1;
      const following = bars.slice(i + 1, i + 1 + horizonBars);
      // Forward horizon must be complete. No censored example counted as success/failure.
      const complete = following.length === horizonBars &&
        following.every((b, offset) => b.time === bars[i].time + (offset + 1) * timeframeSeconds);
      const futureClose = complete ? following.at(-1).close : null;
      const signedMove = complete ? direction * (futureClose - bars[i].close) : null;
      const target = minMoveTicks * 0.25;
      signals.push({
        eventTimeUnixSec: e.time,
        observedAfterCloseUnixSec: e.time + timeframeSeconds,
        type: e.type, liquidityLevel: e.level, direction: e.direction,
        eventClose: bars[i].close, evidence: e.evidence,
        evaluated: complete,
        evaluationStatus: complete ? "COMPLETE" : following.length < horizonBars ? "RIGHT_CENSORED" : "SESSION_GAP",
        futureClose,
        signedMovePoints: signedMove,
        favorableAtHorizon: complete ? signedMove >= target : null,
        againstAtHorizon: complete ? signedMove <= -target : null
      });
    }
  }
  const evaluated = signals.filter(s => s.evaluated);
  const favorable = evaluated.filter(s => s.favorableAtHorizon).length;
  const against = evaluated.filter(s => s.againstAtHorizon).length;
  return {
    schema: "engine18.causalReplay.v1", engine: 18, noExecution: true, researchOnly: true,
    actualMarketData: "UNVERIFIED_INPUT",
    provenanceVerified: false,
    source: parsed.source, contractSymbol, timeframeSeconds, lookback, horizonBars, minMoveTicks,
    asOfUnixSec, candles: bars.length, signals,
    summary: { signals: signals.length, evaluated: evaluated.length, unevaluated: signals.length-evaluated.length,
      favorable, against, favorableRate: evaluated.length ? favorable/evaluated.length : null },
    limitations: ["Input provenance and continuous contract price basis must be independently verified", "Direction and horizon are research heuristics, not live trading signals", "Non-overlapping validation and transaction costs still required"]
  };
}
