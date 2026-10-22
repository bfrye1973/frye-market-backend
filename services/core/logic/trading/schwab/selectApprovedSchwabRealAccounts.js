// Engine 8 — authorize only the two explicitly approved REAL Schwab accounts.
// Read-only selection: never infer ownership from unrelated broker accounts.
import { resolveSchwabJournalAccount } from "./engine8RealFillNormalizer.js";

const EXPECTED = Object.freeze(["SCHWAB_6380", "SCHWAB_0747"]);

export function selectApprovedSchwabRealAccounts(discovered = []) {
  const approved = [];
  const skipped = [];
  const errors = [];
  const seen = new Set();

  for (const account of discovered) {
    const identity = resolveSchwabJournalAccount(account?.maskedAccountNumber);
    if (!identity.ok) {
      skipped.push({ reason: "UNRELATED_SCHWAB_ACCOUNT_SKIPPED" });
      continue;
    }
    const label = identity.brokerAccountLabel;
    if (seen.has(label)) {
      errors.push({ account: label, error: "DUPLICATE_APPROVED_SCHWAB_ACCOUNT" });
      continue;
    }
    seen.add(label);
    if (!account?.accountHash) {
      errors.push({ account: label, error: "APPROVED_SCHWAB_ACCOUNT_HASH_MISSING" });
      continue;
    }
    approved.push({ account, identity });
  }

  for (const label of EXPECTED) {
    if (!seen.has(label)) {
      errors.push({ account: label, error: "APPROVED_SCHWAB_ACCOUNT_MISSING" });
    }
  }

  return { ok: errors.length === 0, approved, skippedCount: skipped.length, errors };
}
