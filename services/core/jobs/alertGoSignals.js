// src/services/core/jobs/alertGoSignals.js
// Checks /api/v1/scalp-status and sends Pushover when GO flips false -> true.
// LOCKED rules: dedupe key + min interval + cooldown block.

import { sendPushover, pushoverConfig } from "../logic/alerts/pushover.js";
import { readLedgerSafe, writeLedgerSafe } from "../logic/alerts/goLedger.js";

function nowUtcIso() {
  return new Date().toISOString();
}

function fmtAzTime(ms) {
  try {
    return new Date(ms).toLocaleTimeString("en-US", {
      timeZone: "America/Phoenix",
      hour12: false,
    });
  } catch {
    return "";
  }
}

function shortenReasonCodes(reasonCodes) {
  if (!Array.isArray(reasonCodes) || reasonCodes.length === 0) return "";
  return reasonCodes.slice(0, 4).join(", ");
}

function makeGoKey(go) {
  const dir = go?.direction || "NA";
  const atUtc = go?.atUtc || "NA";
  return `SPY|SCALP|${dir}|${atUtc}`;
}

function shouldSend({ go, ledger, cfg }) {
  // Must be GO true
  if (!go?.signal) return { ok: false, why: "go=false" };

  const newKey = makeGoKey(go);
  const lastKey = ledger?.lastGoKey || null;

  // Dedupe: same GO window
  if (newKey === lastKey) return { ok: false, why: "duplicate_key", newKey };

  // Rate limit
  const minMs = (cfg.minIntervalSec || 60) * 1000;
  const lastSentMs = ledger?.lastSentAtUtc ? Date.parse(ledger.lastSentAtUtc) : 0;
  const nowMs = Date.now();
  if (lastSentMs && nowMs - lastSentMs < minMs) {
    return { ok: false, why: "rate_limited", newKey };
  }

  // Cooldown block
  const cooldownUntilMs = Number(go?.cooldownUntilMs ?? 0) || 0;
  if (cooldownUntilMs && nowMs < cooldownUntilMs) {
    return { ok: false, why: "cooldown_active", newKey, cooldownUntilMs };
  }

  // Transition rule (false -> true):
  // We don't have historical "previous go.signal" from streamer, so ledger is our memory.
  // If lastGoAtUtc equals current atUtc, treat as already-sent (covered by key).
  return { ok: true, newKey };
}

async function fetchScalpStatus(baseUrl) {
  const url = `${baseUrl.replace(/\/$/, "")}/api/v1/scalp-status?symbol=SPY`;
  const res = await fetch(url, { method: "GET", headers: { "Accept": "application/json" } });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`scalp-status HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  return res.json();
}

/**
 * runAlertGoSignals({ baseUrl })
 * - baseUrl should be Backend-1 public base, e.g. https://<your-core>.onrender.com
 */
export async function runAlertGoSignals({ baseUrl }) {
  const cfg = pushoverConfig();
  const ledger = readLedgerSafe();

  // Even if disabled, still update ledger with latest cooldown info? We keep it simple:
  // If disabled, do nothing.
  if (!cfg.enabled) {
    return { ok: true, skipped: "disabled" };
  }

  let payload;
  try {
    payload = await fetchScalpStatus(baseUrl);
  } catch (e) {
    return { ok: false, error: `fetch_failed: ${String(e?.message || e)}` };
  }

  const go = payload?.go || null;

  const decision = shouldSend({ go, ledger, cfg });
  if (!decision.ok) {
    // Still persist cooldown info if present (helps governance)
    const nextLedger = {
      ...ledger,
      cooldownUntilMs: Number(go?.cooldownUntilMs ?? ledger?.cooldownUntilMs ?? 0) || 0,
    };
    writeLedgerSafe(nextLedger);
    return { ok: true, sent: false, why: decision.why };
  }

  const title = "SPY GO (SCALP)";
  const triggerType = go?.triggerType || "UNKNOWN";
  const triggerLine = go?.triggerLine != null ? String(go.triggerLine) : "NA";
  const dir = go?.direction || "NA";
  const atUtc = go?.atUtc || nowUtcIso();
  const price = go?.price != null ? String(go.price) : "NA";
  const reasons = shortenReasonCodes(go?.reasonCodes);

  const cooldownUntilMs = Number(go?.cooldownUntilMs ?? 0) || 0;
  const cooldownAz = cooldownUntilMs ? fmtAzTime(cooldownUntilMs) : "";

  const msgLines = [
    `GO: YES`,
    `Direction: ${dir}`,
    `Trigger: ${triggerType} @ ${triggerLine}`,
    `Price: ${price}`,
    `Time UTC: ${atUtc}`,
    cooldownAz ? `Cooldown until (AZ): ${cooldownAz}` : null,
    reasons ? `Reason: ${reasons}` : null,
  ].filter(Boolean);

  const message = msgLines.join("\n");

  const result = await sendPushover({
    title,
    message,
    url: "https://frye-dashboard.onrender.com/",
  });

  // Update ledger even if pushover fails, but only commit lastGoKey if it succeeded.
  const nextLedger = {
    lastSentAtUtc: result.ok ? nowUtcIso() : (ledger?.lastSentAtUtc ?? null),
    lastGoAtUtc: go?.atUtc ?? null,
    lastGoKey: result.ok ? decision.newKey : (ledger?.lastGoKey ?? null),
    cooldownUntilMs: Number(go?.cooldownUntilMs ?? 0) || 0,
  };

  writeLedgerSafe(nextLedger);

  return { ok: result.ok, sent: result.ok, pushover: result, goKey: decision.newKey };
}

// CLI support: node jobs/alertGoSignals.js
if (import.meta.url === `file://${process.argv[1]}`) {
  const baseUrl =
    process.env.CORE_BASE_URL ||
    process.env.RENDER_EXTERNAL_URL || // Render often injects this
    "";

  if (!baseUrl) {
    console.error("Missing CORE_BASE_URL (or RENDER_EXTERNAL_URL). Example: https://<service>.onrender.com");
    process.exit(1);
  }

  runAlertGoSignals({ baseUrl })
    .then((out) => {
      console.log(JSON.stringify(out, null, 2));
      process.exit(out.ok ? 0 : 2);
    })
    .catch((e) => {
      console.error(e);
      process.exit(2);
    });
}
