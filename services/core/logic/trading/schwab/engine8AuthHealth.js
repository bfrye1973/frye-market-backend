// Engine 8C: safe OAuth health, deadline monitoring, and durable alert dedupe.
// No credentials or authorization URLs are persisted or sent in notifications.
import fs from "node:fs";
import path from "node:path";
import { getSchwabConfig } from "./schwabConfig.js";
import { getSafeTokenStatus } from "./schwabTokenStore.js";
import { readEngine8RealFillObserverState } from "./engine8RealFillStore.js";
import { sendPushover } from "../../alerts/pushover.js";

export function summarizeEngine8Health(now = Date.now()) {
  const token = getSafeTokenStatus();
  const state = readEngine8RealFillObserverState();
  const expiration = token.refreshExpiresAt ? Date.parse(token.refreshExpiresAt) : NaN;
  const hoursLeft = Number.isFinite(expiration) ? (expiration - now) / 3600000 : null;
  const recordedInvalidGrant = ["SCHWAB_6380", "SCHWAB_0747"].some(label => state.accounts?.[label]?.recoveryRequired === true && state.accounts?.[label]?.recoveryReason === "SCHWAB_INVALID_GRANT");
  const authHealth = recordedInvalidGrant ? "SCHWAB_INVALID_GRANT"
    : !token.hasRefreshToken ? "NOT_AUTHORIZED"
    : token.authorizationDeadlineStatus === "AUTH_DEADLINE_UNKNOWN" ? "AUTH_DEADLINE_UNKNOWN"
    : hoursLeft <= 0 ? "REFRESH_TOKEN_EXPIRED"
    : hoursLeft <= 24 ? "EXPIRING_WITHIN_24H"
    : hoursLeft <= 48 ? "EXPIRING_WITHIN_48H"
    : "AUTHORIZED_UNTIL_DEADLINE";
  const accounts = ["SCHWAB_6380", "SCHWAB_0747"].map(label => {
    const a = state.accounts?.[label] || {};
    const lastPoll = Date.parse(a.lastSuccessfulPollAt || "");
    const watcherHealthy = Number.isFinite(lastPoll) && now - lastPoll <= 180000;
    return {
      account: label,
      lastSuccessfulPollAt: a.lastSuccessfulPollAt || null,
      lastBrokerFillTimeSeen: a.lastBrokerFillTimeSeen || null,
      recoveryRequired: a.recoveryRequired === true,
      recoveryReason: a.recoveryReason || null,
      watcherHealth: watcherHealthy ? "RECENT_SUCCESS" : "STALE_OR_UNKNOWN",
      journalSyncHealth: a.recoveryRequired === true ? "RECOVERY_PENDING" : "NOT_INDEPENDENTLY_RECONCILED",
    };
  });
  return {
    authHealth, hoursUntilAuthorizationDeadline: hoursLeft === null ? null : Math.round(hoursLeft * 10) / 10,
    lastAuthorizationAt: token.lastAuthorizationAt,
    lastSuccessfulRefreshAt: token.lastSuccessfulRefreshAt,
    refreshTokenExpiresAt: token.refreshExpiresAt,
    accountDiscoveryHealth: recordedInvalidGrant ? "AUTHORIZATION_REJECTED" : accounts.every(a => a.watcherHealth === "RECENT_SUCCESS") ? "RECENTLY_POLLING_BOTH" : "UNVERIFIED",
    watcherHealth: accounts.every(a => a.watcherHealth === "RECENT_SUCCESS") ? "RECENT_SUCCESS" : "STALE_OR_UNKNOWN",
    journalSyncHealth: accounts.some(a => a.recoveryRequired) ? "RECOVERY_PENDING" : "NOT_INDEPENDENTLY_RECONCILED",
    accounts,
  };
}

function alertPath() {
  return path.join(getSchwabConfig().privateDataDir, "schwab-auth-alert-ledger.json");
}

export async function maybeNotifySchwabHealth({ failedReason = null, recovered = false } = {}) {
  const status = summarizeEngine8Health();
  const signals = [];
  if (failedReason === "SCHWAB_INVALID_GRANT") signals.push("INVALID_GRANT");
  else if (status.authHealth === "EXPIRING_WITHIN_24H") signals.push("AUTH_24H");
  else if (status.authHealth === "EXPIRING_WITHIN_48H") signals.push("AUTH_48H");
  if (recovered) signals.push("RECOVERY_COMPLETE");

  const file = alertPath();
  for (const signal of signals) {
    let ledger = {};
    try { ledger = JSON.parse(fs.readFileSync(file, "utf8")); } catch {}
    const periodKey = status.lastAuthorizationAt || "UNKNOWN_AUTHORIZATION";
    const key = signal + ":" + periodKey;
    if (ledger[key]) continue;
    const message = signal === "INVALID_GRANT" ? "Schwab rejected authorization. Journal updates may be interrupted. Use the approved secure reconnect flow."
      : signal === "RECOVERY_COMPLETE" ? "Engine 8 recovery polling completed successfully. Confirm Journal reconciliation before declaring all history current."
      : "Schwab authorization deadline approaching. Reauthorize using the secure Schwab flow.";
    const sent = await sendPushover({ title: "Frye Dashboard — Schwab", message });
    if (sent?.ok && !sent?.skipped) {
      fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
      ledger[key] = new Date().toISOString();
      const temp = file + "." + process.pid + ".tmp";
      fs.writeFileSync(temp, JSON.stringify(ledger), { mode: 0o600 });
      fs.renameSync(temp, file);
    }
  }
  return { authHealth: status.authHealth, signals };
}
