// services/core/logic/engine15Readiness.js
//
// Engine 15 — Readiness layer (read-only)
// LOCKED:
// - Does NOT generate trades
// - Does NOT change E3/E4 math
// - Does NOT call run-all-engines
// - Must never throw (caller will wrap, but we also guard)
// - Replay-safe when stored in snapshot

const DEFAULT_ALLOWED = ["NEGOTIATED", "INSTITUTIONAL"];

export function mapStrategyToMode(strategyId) {
  if (strategyId === "intraday_scalp@10m") return "scalp";
  if (strategyId === "minor_swing@1h") return "swing";
  if (strategyId === "intermediate_long@4h") return "long";
  return "swing";
}

export function pickZoneFromDecision(decision) {
  // Best-effort extraction from decision.context.engine1.active.*
  // We DO NOT depend on engine5-context endpoint (not stored and not replay deterministic).
  const ctx = decision?.context || {};
  const e1 = ctx.engine1 || {};
  const active = e1.active || {};

  // Candidate sources in priority order (mirrors your policy)
  const negotiated = active.negotiated || null;
  const shelf = active.shelf || null;
  const institutional =
    active.institutional ||
    ctx.institutionalContainer ||
    null;

  function norm(z, type, source) {
    if (!z) return null;
    const lo = Number(z.lo);
    const hi = Number(z.hi);
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;
    return {
      id: z.id ?? null,
      type,
      lo: Math.min(lo, hi),
      hi: Math.max(lo, hi),
      source,
    };
    }

  // Active first
  const aN = norm(negotiated, "NEGOTIATED", "decision.context.engine1.active.negotiated");
  if (aN) return aN;

  const aS = norm(shelf, "SHELF", "decision.context.engine1.active.shelf");
  if (aS) return aS;

  const aI = norm(institutional, "INSTITUTIONAL", "decision.context.engine1.active.institutional");
  if (aI) return aI;

  // If nothing active exists, we cannot safely pick without smzHierarchy scanning
  // (Caller can optionally pass smzHierarchy and implement a scan later).
  return null;
}

function distPts(price, lo, hi) {
  if (!Number.isFinite(price) || !Number.isFinite(lo) || !Number.isFinite(hi)) return null;
  if (price >= lo && price <= hi) return 0;
  return Math.min(Math.abs(price - lo), Math.abs(price - hi));
}

function isAllowedType(zoneType, allowed = DEFAULT_ALLOWED) {
  return Array.isArray(allowed) && allowed.includes(zoneType);
}

export function deriveVolumeRegime(engine4) {
  const f = engine4?.flags || {};
  if (f.reversalExpansion) return "REVERSAL_EXPANSION";
  if (f.pullbackContraction) return "PULLBACK_CONTRACTION";
  if (f.initiativeMoveConfirmed) return "INITIATIVE_MOVE";
  if (f.distributionDetected) return "DISTRIBUTION";
  if (f.absorptionDetected) return "ABSORPTION";
  if (f.liquidityTrap) return "LIQUIDITY_TRAP";
  if (f.volumeDivergence) return "VOLUME_DIVERGENCE";
  return "NEUTRAL";
}

export function deriveInitiativeSide(engine4) {
  // Engine 4 does not expose initiativeSide today; we derive best-effort
  // from its diagnostics (wick dominance + zonePos01) if present.
  const d = engine4?.diagnostics || {};
  const wick = d.wick || {};
  const pos = typeof d.zonePos01 === "number" ? d.zonePos01 : null; // 0 bottom, 1 top

  // Strong heuristic:
  // - lower wick dominant near bottom of zone => BUY initiative (defense)
  // - upper wick dominant near top of zone => SELL initiative (supply)
  if (wick.lowerDominant && pos !== null && pos <= 0.35) return "BUY";
  if (wick.upperDominant && pos !== null && pos >= 0.65) return "SELL";

  const divType = d?.divergence?.divergenceType || d?.divergenceType || null;
  if (divType === "weak_down") return "SELL";
  if (divType === "weak_up") return "BUY";

  return "UNKNOWN";
}

export function computeReadiness({
  symbol,
  tf,
  strategyId,
  price,
  zone,
  engine3,
  engine4,
  permission,
  allowedZones = DEFAULT_ALLOWED,
  nearThresholdPts = 1.5,
}) {
  // Must never throw
  try {
    const out = {
      ok: true,
      symbol,
      tf,
      strategyId,
      mode: mapStrategyToMode(strategyId),
      price: Number.isFinite(price) ? price : null,

      zone: {
        allowed: allowedZones,
        selected: zone || null,
        inAllowedZone: false,
        nearAllowedZone: false,
        distancePts: null,
      },

      engine3: engine3 || null,
      engine4: null,
      permission: permission || null,

      readiness: {
        state: "WAIT",
        reasonCodes: [],
        next: [],
      },
    };

    // Attach E4 with derived fields
    if (engine4) {
      out.engine4 = {
        ...engine4,
        regime: deriveVolumeRegime(engine4),
        initiativeSide: deriveInitiativeSide(engine4),
      };
    }

    // Zone gating
    const z = zone;
    const p = out.price;

    if (z && Number.isFinite(p)) {
      const d = distPts(p, z.lo, z.hi);
      out.zone.distancePts = d;

      const allowed = isAllowedType(z.type, allowedZones);
      const inZone = d === 0;

      out.zone.inAllowedZone = Boolean(allowed && inZone);
      out.zone.nearAllowedZone = Boolean(allowed && d !== null && d <= nearThresholdPts);

      if (out.zone.inAllowedZone) out.readiness.reasonCodes.push("IN_ALLOWED_ZONE");
      else if (out.zone.nearAllowedZone) out.readiness.reasonCodes.push("NEAR_ALLOWED_ZONE");
      else out.readiness.reasonCodes.push("WAIT_NOT_NEAR_ALLOWED_ZONE");
    } else {
      out.readiness.reasonCodes.push("NO_ZONE_CONTEXT");
    }

    // E3 arming
    const e3Stage = engine3?.stage || null;
    const e3Armed = Boolean(engine3?.armed);
    if (e3Stage === "CONFIRMED") out.readiness.reasonCodes.push("STRUCTURE_CONFIRMED");
    else if (e3Armed || e3Stage === "ARMED" || e3Stage === "TRIGGERED") out.readiness.reasonCodes.push("ARMING_STRUCTURE");

    // E4 arming
    const vs = typeof out.engine4?.volumeScore === "number" ? out.engine4.volumeScore : null;
    if (vs !== null && vs >= 7) out.readiness.reasonCodes.push("VOLUME_STRONG");
    const reg = out.engine4?.regime;
    if (reg && reg !== "NEUTRAL") out.readiness.reasonCodes.push(`VOLUME_${reg}`);

    // Compute state (simple + stable)
    const near = Boolean(out.zone.nearAllowedZone);
    const inAllowed = Boolean(out.zone.inAllowedZone);
    const hasArming = out.readiness.reasonCodes.includes("ARMING_STRUCTURE") || out.readiness.reasonCodes.includes("VOLUME_STRONG");
    const confirmed = out.readiness.reasonCodes.includes("STRUCTURE_CONFIRMED");

    if (!near && !inAllowed) {
      out.readiness.state = "WAIT";
    } else if (!inAllowed && (near || hasArming)) {
      out.readiness.state = hasArming ? "ARMING" : "NEAR";
    } else if (inAllowed) {
      if (confirmed) out.readiness.state = "CONFIRMED";
      else if (hasArming) out.readiness.state = "READY";
      else out.readiness.state = "NEAR";
    }

    // Next steps (UX)
    if (z && Number.isFinite(z.lo) && Number.isFinite(z.hi)) {
      out.readiness.next.push(`Zone: ${z.lo.toFixed(2)}–${z.hi.toFixed(2)} (${z.type})`);
      if (!inAllowed) out.readiness.next.push("Wait for re-entry into allowed zone");
    }
    if (e3Stage !== "CONFIRMED") out.readiness.next.push("E3: wait for CONFIRMED or stronger reaction");
    if (vs !== null && vs < 7) out.readiness.next.push("E4: wait for volumeScore ≥ 7 or regime shift");

    return out;
  } catch (e) {
    return {
      ok: false,
      error: String(e?.message || e),
      readiness: { state: "WAIT", reasonCodes: ["ENGINE15_COMPUTE_ERROR"], next: [] },
    };
  }
}
