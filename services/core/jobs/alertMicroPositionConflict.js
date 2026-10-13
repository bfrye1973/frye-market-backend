// Engine 13 — Micro position-conflict Pushover alerts.
//
// Consumes only the already-built Strategy 1 snapshot.
// Does not calculate Micro structure or position truth.
// Does not mutate any trading engine.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import {
  sendPushover,
  pushoverConfig,
} from "../logic/alerts/pushover.js";

import {
  readMicroPositionLedgerSafe,
  writeMicroPositionLedgerSafe,
} from "../logic/alerts/microPositionLedger.js";

const __filename =
  fileURLToPath(import.meta.url);

const __dirname =
  path.dirname(__filename);

const SNAPSHOT_FILE =
  path.resolve(
    __dirname,
    "../data/strategy-snapshot-es.json"
  );

const SEVERITY_RANK = Object.freeze({
  NONE: 0,
  LOW: 1,
  MODERATE: 2,
  HIGH: 3,
  CRITICAL: 4,
});

function upper(value) {
  return String(value ?? "")
    .trim()
    .toUpperCase();
}

function rank(value) {
  return (
    SEVERITY_RANK[
      upper(value)
    ] ?? 0
  );
}

function keyFor({
  tradeId,
  sourceCountId,
} = {}) {
  if (!tradeId || !sourceCountId) {
    return null;
  }

  return [
    "ES",
    "MICRO_POSITION",
    String(tradeId),
    String(sourceCountId),
  ].join("|");
}

function signatureFor({
  position,
  context,
  eventType,
} = {}) {
  return [
    eventType,
    position?.tradeId ?? "NO_TRADE",
    context?.sourceCountId ?? "NO_COUNT",
    position?.conflictSeverity ?? "NONE",
    context?.micro?.activeWave ?? "NO_WAVE",
    context?.micro?.microTimingState ?? "NO_TIMING",
    position?.remainingQty ?? "NO_QTY",
    position?.direction ?? "NO_POSITION_DIRECTION",
    context?.micro?.tradeDirection ?? "NO_MICRO_DIRECTION",
  ].join("|");
}

function rateLimited({
  previous,
  now,
  minIntervalSec,
  severityUpgrade,
} = {}) {
  if (severityUpgrade) return false;

  const last =
    previous?.lastSentAtUtc
      ? Date.parse(
          previous.lastSentAtUtc
        )
      : null;

  if (!Number.isFinite(last)) {
    return false;
  }

  return (
    Number(now) - last <
    Math.max(
      0,
      Number(minIntervalSec) || 0
    ) * 1000
  );
}

export function decideMicroPositionAlerts({
  context,
  ledger = {},
  now = Date.now(),
  minIntervalSec = 60,
} = {}) {
  if (
    !context ||
    context?.engine !==
      "micro.positionAwareness.v1"
  ) {
    return {
      events: [],
      reason:
        "INVALID_MICRO_POSITION_CONTEXT",
    };
  }

  const entries =
    ledger?.entries &&
    typeof ledger.entries === "object"
      ? ledger.entries
      : {};

  const events = [];

  for (
    const position of
    context?.positions || []
  ) {
    const key =
      keyFor({
        tradeId:
          position?.tradeId,
        sourceCountId:
          context?.sourceCountId,
      });

    if (!key) continue;

    const previous =
      entries[key] || null;

    const currentSeverity =
      upper(
        position
          ?.conflictSeverity ||
        "NONE"
      );

    const currentRank =
      rank(currentSeverity);

    const previousRank =
      rank(
        previous?.lastSeverity ||
        "NONE"
      );

    const freshEnough =
      position
        ?.positionTruthFreshness
        ?.reliableForAlerts === true;

    if (
      position?.accountMode === "REAL" &&
      !freshEnough
    ) {
      continue;
    }

    let eventType = null;

    if (
      position?.conflict === true &&
      currentRank >=
        rank("MODERATE")
    ) {
      if (
        previousRank >
        currentRank
      ) {
        eventType =
          "CONFLICT_EASING";
      } else {
        eventType =
          "CONFLICT_ALERT";
      }
    } else if (
      position?.conflict !== true &&
      previousRank >=
        rank("MODERATE")
    ) {
      eventType =
        "CONFLICT_RESOLVED";
    } else {
      continue;
    }

    const signature =
      signatureFor({
        position,
        context,
        eventType,
      });

    if (
      previous?.lastSignature ===
      signature
    ) {
      continue;
    }

    const severityUpgrade =
      currentRank >
      previousRank;

    if (
      rateLimited({
        previous,
        now,
        minIntervalSec,
        severityUpgrade,
      })
    ) {
      continue;
    }

    events.push({
      key,
      signature,
      eventType,
      severity:
        currentSeverity,
      severityUpgrade,
      tradeId:
        position.tradeId,
      accountMode:
        position.accountMode,
      journalAccount:
        position.journalAccount,
      direction:
        position.direction,
      remainingQty:
        position.remainingQty,
      averageEntry:
        position.averageEntry,
      pointsFromEntry:
        position.pointsFromEntry,
      activeWave:
        context?.micro?.activeWave ??
        null,
      microDirection:
        context?.micro?.tradeDirection ??
        null,
      microTimingState:
        context?.micro?.microTimingState ??
        null,
      sourceCountId:
        context?.sourceCountId ??
        null,
      doNotAddAgainstImpulse:
        position
          ?.doNotAddAgainstImpulse ===
        true,
      preview:
        position?.alertPreview ??
        null,
    });
  }

  return {
    events,
    reason:
      events.length
        ? "ALERT_EVENTS_AVAILABLE"
        : "NO_NEW_ALERT_EVENT",
  };
}

function alertText(event) {
  const prefix =
    event.eventType ===
      "CONFLICT_RESOLVED"
      ? "✅"
      : event.eventType ===
        "CONFLICT_EASING"
      ? "🟡"
      : event.severity ===
        "CRITICAL"
      ? "🚨"
      : "⚠️";

  const title =
    event.eventType ===
      "CONFLICT_RESOLVED"
      ? `${prefix} MICRO POSITION CONFLICT RESOLVED`
      : event.eventType ===
        "CONFLICT_EASING"
      ? `${prefix} MICRO POSITION CONFLICT EASING`
      : `${prefix} MICRO POSITION CONFLICT ${event.severity}`;

  if (
    event.eventType ===
    "CONFLICT_RESOLVED"
  ) {
    return {
      title,
      message:
        `The prior Micro conflict for your ${event.direction} position is no longer active. Current Micro: ${event.activeWave ?? "NA"} ${event.microDirection ?? "NEUTRAL"} / ${event.microTimingState ?? "UNKNOWN"}.`,
    };
  }

  if (
    event.eventType ===
    "CONFLICT_EASING"
  ) {
    return {
      title,
      message:
        `The Micro conflict against your ${event.direction} position is easing. Severity is now ${event.severity}. Current Micro: ${event.activeWave ?? "NA"} ${event.microDirection ?? "NEUTRAL"} / ${event.microTimingState ?? "UNKNOWN"}.`,
    };
  }

  const base =
    event?.preview?.message ||
    `Your ${event.direction} position conflicts with current Micro structure.`;

  return {
    title,
    message: [
      base,
      `Position: ${event.direction} x${event.remainingQty ?? "?"} (${event.accountMode ?? "UNKNOWN"})`,
      event.averageEntry != null
        ? `Avg entry: ${Number(event.averageEntry).toFixed(2)}`
        : null,
      event.pointsFromEntry != null
        ? `Points from entry: ${Number(event.pointsFromEntry).toFixed(2)}`
        : null,
      event.doNotAddAgainstImpulse
        ? "DO NOT ADD against the emerging Micro impulse."
        : null,
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

export async function runMicroPositionAlerts({
  context,
  now = Date.now(),
  ledger = null,
  send = sendPushover,
} = {}) {
  const cfg =
    pushoverConfig();

  const currentLedger =
    ledger ||
    readMicroPositionLedgerSafe();

  const decision =
    decideMicroPositionAlerts({
      context,
      ledger:
        currentLedger,
      now,
      minIntervalSec:
        cfg.minIntervalSec,
    });

  if (!cfg.enabled) {
    return {
      ok: true,
      sent: 0,
      skipped:
        "PUSHOVER_DISABLED",
      decision,
    };
  }

  if (
    decision.events.length === 0
  ) {
    return {
      ok: true,
      sent: 0,
      decision,
    };
  }

  const next = {
    ...currentLedger,
    entries: {
      ...(currentLedger.entries || {}),
    },
  };

  let sent = 0;
  const results = [];

  for (
    const event of
    decision.events
  ) {
    const copy =
      alertText(event);

    const response =
      await send({
        title: copy.title,
        message: copy.message,
        url:
          "https://frye-dashboard.onrender.com/",
      });

    results.push({
      key:
        event.key,
      eventType:
        event.eventType,
      severity:
        event.severity,
      ok:
        response?.ok === true,
    });

    if (
      response?.ok !== true
    ) {
      continue;
    }

    sent += 1;

    next.entries[event.key] = {
      tradeId:
        event.tradeId,
      sourceCountId:
        event.sourceCountId,
      lastSeverity:
        event.eventType ===
          "CONFLICT_RESOLVED"
          ? "NONE"
          : event.severity,
      lastEventType:
        event.eventType,
      lastSignature:
        event.signature,
      lastSentAtUtc:
        new Date(now)
          .toISOString(),
      remainingQty:
        event.remainingQty,
      positionDirection:
        event.direction,
      microDirection:
        event.microDirection,
      activeWave:
        event.activeWave,
      microTimingState:
        event.microTimingState,
    };
  }

  if (sent > 0) {
    const write =
      writeMicroPositionLedgerSafe(
        next
      );

    if (!write.ok) {
      return {
        ok: false,
        sent,
        error:
          "MICRO_POSITION_ALERT_LEDGER_WRITE_FAILED",
        ledgerError:
          write.error,
        results,
      };
    }
  }

  return {
    ok: true,
    sent,
    results,
    decision,
  };
}

export async function runMicroPositionAlertsFromSnapshot({
  snapshotFile =
    SNAPSHOT_FILE,
  now = Date.now(),
} = {}) {
  try {
    if (
      !fs.existsSync(
        snapshotFile
      )
    ) {
      return {
        ok: false,
        sent: 0,
        error:
          "ES_STRATEGY_SNAPSHOT_NOT_FOUND",
      };
    }

    const snapshot =
      JSON.parse(
        fs.readFileSync(
          snapshotFile,
          "utf8"
        )
      );

    const context =
      snapshot
        ?.strategies
        ?.[
          "intraday_scalp@10m"
        ]
        ?.microPositionContext ||
      null;

    return runMicroPositionAlerts({
      context,
      now,
    });
  } catch (error) {
    return {
      ok: false,
      sent: 0,
      error:
        String(
          error?.message || error
        ),
    };
  }
}

if (
  process.argv[1] &&
  path.resolve(
    process.argv[1]
  ) === __filename
) {
  const out =
    await runMicroPositionAlertsFromSnapshot();

  console.log(
    JSON.stringify(
      out,
      null,
      2
    )
  );

  process.exit(
    out.ok ? 0 : 1
  );
}

export default runMicroPositionAlerts;
