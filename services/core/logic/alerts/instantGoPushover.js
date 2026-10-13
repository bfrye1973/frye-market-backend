// services/core/logic/alerts/instantGoPushover.js
// Shared helper used by streamer to send instant Pushover on GO false->true.
// SAFE: never throws

import { sendPushover, pushoverConfig } from "./pushover.js";
import { readLedgerSafe, writeLedgerSafe } from "./goLedger.js";

function nowUtcIso() {
  return new Date().toISOString();
}

function fmtAzTimeFromMs(ms) {
  try {
    return new Date(ms).toLocaleTimeString("en-US", {
      timeZone: "America/Phoenix",
      hour12: false,
    });
  } catch {
    return "";
  }
}

function makeGoKey(symbol, go) {
  const dir = go?.direction || "NA";
  const atUtc = go?.atUtc || "NA";
  const trigger = go?.triggerType || "NA";
  return `${symbol}|SCALP|${dir}|${trigger}|${atUtc}`;
}

/**
 * maybeSendInstantGoAlert({ symbol, prevGo, nextGo })
 * - Sends ONLY on transition false -> true
 * - Dedupe + rate limit + cooldown block
 * - NEVER throws
 */
export async function maybeSendInstantGoAlert({ symbol = "SPY", prevGo, nextGo }) {
  try {
    const cfg = pushoverConfig();
    if (!cfg.enabled) return { ok: true, sent: false, why: "disabled" };

    const prevSignal = !!prevGo?.signal;
    const nextSignal = !!nextGo?.signal;

    // Transition false -> true only
    if (prevSignal || !nextSignal) return { ok: true, sent: false, why: "no_transition" };

    const ledger = readLedgerSafe();
    const newKey = makeGoKey(symbol, nextGo);

    // Dedupe
    if (ledger?.lastGoKey === newKey) {
      return { ok: true, sent: false, why: "duplicate_key" };
    }

    // Rate limit
    const minMs = (cfg.minIntervalSec || 60) * 1000;
    const lastSentMs = ledger?.lastSentAtUtc ? Date.parse(ledger.lastSentAtUtc) : 0;
    const nowMs = Date.now();
    if (lastSentMs && nowMs - lastSentMs < minMs) {
      return { ok: true, sent: false, why: "rate_limited" };
    }

    // Cooldown block
    const cooldownUntilMs = Number(nextGo?.cooldownUntilMs ?? 0) || 0;
    if (cooldownUntilMs && nowMs < cooldownUntilMs) {
      return { ok: true, sent: false, why: "cooldown_active" };
    }

    const title = `${symbol} GO (SCALP)`;
    const dir = nextGo?.direction || "NA";
    const triggerType = nextGo?.triggerType || "UNKNOWN";
    const triggerLine = Number.isFinite(nextGo?.triggerLine) ? String(nextGo.triggerLine) : "NA";
    const atUtc = nextGo?.atUtc || nowUtcIso();
    const price = Number.isFinite(nextGo?.price) ? String(nextGo.price) : "NA";
    const reasons = Array.isArray(nextGo?.reasonCodes) ? nextGo.reasonCodes.slice(0, 4).join(", ") : "";

    const cooldownAz = cooldownUntilMs ? fmtAzTimeFromMs(cooldownUntilMs) : "";

    const message = [
      `GO: YES`,
      `Direction: ${dir}`,
      `Trigger: ${triggerType} @ ${triggerLine}`,
      `Price: ${price}`,
      `Time UTC: ${atUtc}`,
      cooldownAz ? `Cooldown until (AZ): ${cooldownAz}` : null,
      reasons ? `Reason: ${reasons}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    const result = await sendPushover({
      title,
      message,
      url: "https://frye-dashboard.onrender.com/",
    });

    if (result.ok) {
      writeLedgerSafe({ lastSentAtUtc: nowUtcIso(), lastGoKey: newKey });
      return { ok: true, sent: true, goKey: newKey };
    }

    return { ok: false, sent: false, error: result.error || "pushover_failed" };
  } catch (e) {
    // Never crash streamer
    return { ok: false, sent: false, error: String(e?.message || e) };
  }
}
