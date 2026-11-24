// services/core/logic/investigator/redactInvestigationPayload.js
//
// Recursive redaction applied to every Trade Investigator response.
//   - secrets/credentials: removed entirely
//   - account / broker identifiers: replaced by a short salted-free hash tag
//     (stable for correlation, not reversible to the identifier)
//   - licensed raw bar arrays: replaced by a count
// Returns a new object; never mutates evidence.

import crypto from "node:crypto";

const REMOVE_KEY = /(secret|password|passphrase|apikey|api_key|credential|privatekey|private_key)|^(authorization|cookie|set-cookie|token|accesstoken|access_token|refreshtoken|refresh_token|idtoken|id_token|bearer|bearertoken)$/i;
const HASH_KEYS = new Set([
  "accountId", "accountNumber", "accountHash", "hashValue",
  "brokerAccountLabel", "physicalAccount", "reportedAccount", "journalAccount",
  "brokerAccountId", "brokerTransactionId", "transactionId", "activityId",
  "schwabAccountHash", "accountLabel",
]);
const RAW_BAR_KEYS = new Set([
  "bars", "candles", "rawBars", "normalizedBars", "ohlc", "ohlcv",
  "candleFacts", "rawCandles", "sourceBars",
]);
// Broker account labels like SCHWAB_0747 embed account digits.
const ACCOUNT_LABEL_VALUE = /\b(SCHWAB|TDA|IBKR|IRONBEAM)_\d{3,}\b/gi;

function tag(value) {
  const h = crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 12);
  return "redacted:" + h;
}

export function redactInvestigationPayload(value, depth = 0) {
  if (depth > 64) return "[REDACTED_DEPTH_LIMIT]";
  if (typeof value === "string") return value.replace(ACCOUNT_LABEL_VALUE, (m) => tag(m));
  if (Array.isArray(value)) return value.map((v) => redactInvestigationPayload(v, depth + 1));
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const [key, v] of Object.entries(value)) {
    if (REMOVE_KEY.test(key)) continue;
    if (HASH_KEYS.has(key)) {
      out[key] = v === null || v === undefined || v === "" ? v : tag(v);
      continue;
    }
    if (RAW_BAR_KEYS.has(key) && Array.isArray(v)) {
      out[key] = { redacted: "LICENSED_RAW_BARS_OMITTED", count: v.length };
      continue;
    }
    out[key] = redactInvestigationPayload(v, depth + 1);
  }
  return out;
}
