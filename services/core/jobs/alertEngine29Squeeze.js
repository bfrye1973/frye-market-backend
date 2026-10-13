// services/core/jobs/alertEngine29Squeeze.js
// Engine 13 — read-only Pushover consumer for Engine 29 Squeeze v2.
// Does not calculate squeeze math or trading authority.

import { sendPushover, pushoverConfig } from "../logic/alerts/pushover.js";
import {
  readSqueezeLedgerSafe,
  writeSqueezeLedgerSafe,
} from "../logic/alerts/squeezeLedger.js";

const WATCH = "SQUEEZE_WATCH";
const ACTIVE = "SQUEEZE_ACTIVE";

function fmt(v, digits = 1) {
  const n = Number(v);
  return Number.isFinite(n) ? n.toFixed(digits) : "NA";
}

function fmtAzTime(value) {
  const ms = Date.parse(String(value || ""));
  if (!Number.isFinite(ms)) return "NA";

  return new Date(ms).toLocaleTimeString("en-US", {
    timeZone: "America/Phoenix",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

function stageKey(campaign, stage) {
  const id = campaign?.campaignId;
  if (!id) return null;
  return `ES|SQUEEZE|${campaign.direction || "NA"}|${id}|${stage}`;
}

export function decideSqueezeAlert({
  campaign,
  ledger = {},
  now = Date.now(),
  minIntervalSec = 60,
} = {}) {
  if (!campaign || campaign?.version !== "engine29.squeezeCampaign.v2") {
    return { send: false, why: "invalid_contract" };
  }

  if (
    campaign?.available !== true ||
    campaign?.dataDegraded === true ||
    !campaign?.campaignId ||
    !["UP", "DOWN"].includes(campaign?.direction)
  ) {
    return { send: false, why: "unavailable_or_degraded" };
  }

  let stage = null;
  if (campaign.state === WATCH) stage = "WATCH";
  if (campaign.state === ACTIVE) stage = "ACTIVE";

  if (!stage) return { send: false, why: "state_not_alertable" };

  const key = stageKey(campaign, stage);
  if (!key) return { send: false, why: "missing_campaign_key" };

  if (stage === "WATCH" && ledger?.lastWatchKey === key) {
    return { send: false, why: "duplicate_watch", key, stage };
  }

  if (stage === "ACTIVE" && ledger?.lastActiveKey === key) {
    return { send: false, why: "duplicate_active", key, stage };
  }

  const lastSentMs = ledger?.lastSentAtUtc
    ? Date.parse(ledger.lastSentAtUtc)
    : 0;

  const minMs = Math.max(0, Number(minIntervalSec) || 0) * 1000;

  if (
    lastSentMs &&
    Number.isFinite(lastSentMs) &&
    Number(now) - lastSentMs < minMs
  ) {
    return { send: false, why: "rate_limited", key, stage };
  }

  return { send: true, key, stage };
}

function buildMessage(campaign, stage) {
  const upside = campaign.direction === "UP";
  const directionLabel = upside ? "UPSIDE" : "DOWNSIDE";
  const icon = stage === "ACTIVE" ? "🔥" : "⚡";
  const eventAt =
    stage === "ACTIVE"
      ? campaign.activeAt
      : campaign.watchAt;

  const title =
    `${icon} REDLINE ${directionLabel} SQUEEZE ${stage}`;

  const breadthSide = upside ? "advancing" : "declining";

  const message = [
    `ES ${directionLabel.toLowerCase()} squeeze ${stage === "ACTIVE" ? "ACTIVE" : "forming"}`,
    `Squeeze Pressure: ${fmt(campaign.squeezePressure)}`,
    `ES Abnormality: ${fmt(campaign.esAbnormalityQuality)}`,
    `Internal Divergence: ${fmt(campaign.internalDivergence)}`,
    `Participation: ${fmt(campaign.participationConfirmation)}`,
    `Breadth: ${fmt(campaign.directionalBreadthPct)}% ${breadthSide}`,
    `Time: ${fmtAzTime(eventAt)} AZ`,
  ].join("\n");

  return { title, message };
}

export async function runAlertEngine29Squeeze({
  campaign = null,
  now = Date.now(),
} = {}) {
  const cfg = pushoverConfig();
  const ledger = readSqueezeLedgerSafe();

  if (!cfg.enabled) {
    return { ok: true, sent: false, skipped: "disabled" };
  }

  const decision = decideSqueezeAlert({
    campaign,
    ledger,
    now,
    minIntervalSec: cfg.minIntervalSec,
  });

  if (!decision.send) {
    return {
      ok: true,
      sent: false,
      why: decision.why,
      key: decision.key ?? null,
    };
  }

  const { title, message } =
    buildMessage(campaign, decision.stage);

  const result = await sendPushover({
    title,
    message,
    url: "https://frye-dashboard.onrender.com/",
  });

  if (!result.ok) {
    return {
      ok: false,
      sent: false,
      error: result.error || "pushover_failed",
      key: decision.key,
    };
  }

  const next = {
    ...ledger,
    lastSentAtUtc: new Date(now).toISOString(),
    lastWatchKey:
      decision.stage === "WATCH"
        ? decision.key
        : ledger?.lastWatchKey ?? null,
    lastActiveKey:
      decision.stage === "ACTIVE"
        ? decision.key
        : ledger?.lastActiveKey ?? null,
  };

  const ledgerWrite = writeSqueezeLedgerSafe(next);

  if (!ledgerWrite.ok) {
    return {
      ok: false,
      sent: true,
      error: "ledger_write_failed",
      ledgerError: ledgerWrite.error,
      key: decision.key,
    };
  }

  return {
    ok: true,
    sent: true,
    stage: decision.stage,
    key: decision.key,
    pushover: result,
  };
}

export default runAlertEngine29Squeeze;


export async function runAlertEngine29SqueezeFromBackend({
  baseUrl,
  now = Date.now(),
} = {}) {
  const base = String(baseUrl || "").replace(/\/+$/, "");
  if (!base) {
    return { ok: false, sent: false, error: "missing_base_url" };
  }

  try {
    const response = await fetch(
      `${base}/api/v1/engine29/cross-market-stress`,
      {
        cache: "no-store",
        headers: { accept: "application/json", "cache-control": "no-store" },
      }
    );

    const text = await response.text();
    if (!response.ok) {
      return {
        ok: false,
        sent: false,
        error: `engine29_http_${response.status}: ${text.slice(0, 200)}`,
      };
    }

    const payload = JSON.parse(text);
    const campaign =
      payload?.data?.marketCharacter?.squeezeCampaign || null;

    return runAlertEngine29Squeeze({ campaign, now });
  } catch (error) {
    return {
      ok: false,
      sent: false,
      error: String(error?.message || error),
    };
  }
}
