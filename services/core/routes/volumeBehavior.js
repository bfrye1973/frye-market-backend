// src/services/core/routes/volumeBehavior.js
//
// Thin contract wrapper ONLY.
// No scoring changes. No logic changes.
//
// GET /api/v1/volume-behavior?symbol=SPY&tf=1h&zoneLo=475.2&zoneHi=476.1
// Optional: touchIndex, lookback, reactionScore, mode
//
// NEW (derived fields only):
// - volumeRegime: QUIET | NORMAL | EXPANDING | TRAP_RISK
// - pressureBias: BEARISH_PRESSURE | NEUTRAL_PRESSURE
// - flowSummary: readable list of active flags/state
// - nextConfirm: short “what’s missing” message

import express from "express";
import { computeVolumeBehavior } from "../logic/volumeBehaviorEngine.js";
import { getBarsFromPolygon } from "../../../api/providers/polygonBars.js";

export const volumeBehaviorRouter = express.Router();

function deriveVolumeRegime(volumeScore, flags) {
  const trap = !!flags?.liquidityTrap;
  if (trap) return "TRAP_RISK";

  const vs = Number(volumeScore);
  if (!Number.isFinite(vs)) return "UNKNOWN";

  if (vs <= 3) return "QUIET";
  if (vs <= 7) return "NORMAL";
  return "EXPANDING";
}

function derivePressureBias(flags) {
  // Conservative v1:
  // - distribution => bearish pressure
  // - otherwise neutral (until we add initiativeSide BUY/SELL)
  if (flags?.distributionDetected) return "BEARISH_PRESSURE";
  return "NEUTRAL_PRESSURE";
}

function buildFlowSummary(result) {
  const flags = result?.flags || {};
  const out = [];

  if (result?.state) out.push(String(result.state).toUpperCase());

  if (flags.initiativeMoveConfirmed) out.push("INITIATIVE_PRESENT");
  if (flags.absorptionDetected) out.push("ABSORPTION_DETECTED");
  if (flags.distributionDetected) out.push("DISTRIBUTION_DETECTED");
  if (flags.reversalExpansion) out.push("REVERSAL_EXPANSION");
  if (flags.pullbackContraction) out.push("PULLBACK_CONTRACTION");
  if (flags.volumeDivergence) out.push("VOLUME_DIVERGENCE");
  if (flags.liquidityTrap) out.push("LIQUIDITY_TRAP");

  return out.length ? out : ["NO_ACTIVE_FLOW_SIGNAL"];
}

function nextConfirmText(regime, bias, flags) {
  if (flags?.liquidityTrap) return "Trap risk detected — wait for clean reclaim/confirmation.";
  if (regime === "QUIET") return "Volume is quiet — wait for expansion candle + follow-through.";
  if (bias === "BEARISH_PRESSURE") return "Bearish pressure flagged — confirm with displacement down / reclaim failure.";
  return "No strong volume signal — wait for initiative or absorption/distribution confirmation.";
}

volumeBehaviorRouter.get("/volume-behavior", async (req, res) => {
  try {
    const symbol = String(req.query.symbol || "SPY").toUpperCase();
    const tf = String(req.query.tf || "1h");

    const zoneLo = req.query.zoneLo != null ? Number(req.query.zoneLo) : null;
    const zoneHi = req.query.zoneHi != null ? Number(req.query.zoneHi) : null;

    if (!(Number.isFinite(zoneLo) && Number.isFinite(zoneHi))) {
      return res.status(400).json({
        error: "MISSING_ZONE_RANGE",
        message: "Provide zoneLo and zoneHi (numbers). Engine 1 owns zone selection.",
      });
    }

    const zone = { lo: zoneLo, hi: zoneHi };

    const lookback = req.query.lookback != null ? Number(req.query.lookback) : 60;
    const touchIndex = req.query.touchIndex != null ? Number(req.query.touchIndex) : null;
    const reactionScore = req.query.reactionScore != null ? Number(req.query.reactionScore) : null;

    const modeRaw = req.query.mode != null ? String(req.query.mode) : "";
    const mode = ["scalp", "swing", "long"].includes(modeRaw.toLowerCase())
      ? modeRaw.toLowerCase()
      : null;

    const days =
      tf === "1m" ? 5 :
      tf === "5m" ? 10 :
      tf === "10m" ? 14 :
      tf === "15m" ? 21 :
      tf === "30m" ? 35 :
      tf === "1h" ? 60 :
      tf === "4h" ? 180 :
      120;

    const bars = await getBarsFromPolygon(symbol, tf, days, { mode: "intraday" });

    const result = computeVolumeBehavior({
      bars,
      zone,
      touchIndex,
      reactionScore,
      opts: {
        lookbackBars: lookback,
        ...(mode ? { mode } : {}),
      },
    });

    // -------- NEW derived fields (no engine math change) --------
    const flags = result?.flags || {};
    const volumeScore = result?.volumeScore;

    const volumeRegime = deriveVolumeRegime(volumeScore, flags);
    const pressureBias = derivePressureBias(flags);
    const flowSummary = buildFlowSummary(result);
    const nextConfirm = nextConfirmText(volumeRegime, pressureBias, flags);

    return res.json({
      symbol,
      tf,
      mode: mode || "default",
      zone,

      ...result,

      // new derived fields
      volumeRegime,
      pressureBias,
      flowSummary,
      nextConfirm,
    });
  } catch (err) {
    return res.status(500).json({
      error: "VOLUME_BEHAVIOR_ERROR",
      message: err?.message || String(err),
    });
  }
});
