// Engine 8 — explicit approved REAL Schwab account selection.
// The default remains the historical two-account production contract until
// Engine 10 signs off on seven-account Journal ingestion and cutover.
import { resolveSchwabJournalAccount } from "./engine8RealFillNormalizer.js";
import {
  findSchwabRealAccountByMaskedNumber,
  LEGACY_SCHWAB_REAL_ACCOUNT_LABELS,
  SEVEN_SCHWAB_REAL_ACCOUNT_LABELS,
} from "./engine8RealAccountRegistry.js";

export function selectApprovedSchwabRealAccounts(discovered = [], { accountScope = "LEGACY_TWO" } = {}) {
  const seven = accountScope === "SEVEN_STRATEGIES";
  if (!seven && accountScope !== "LEGACY_TWO") {
    return { ok:false, approved:[], skippedCount:0,
      errors:[{error:"UNSUPPORTED_SCHWAB_ACCOUNT_SCOPE"}] };
  }
  const expected = seven ? SEVEN_SCHWAB_REAL_ACCOUNT_LABELS : LEGACY_SCHWAB_REAL_ACCOUNT_LABELS;
  const approved = [], errors = [];
  let skippedCount = 0;
  const seen = new Set();

  for (const account of discovered) {
    const registryEntry = findSchwabRealAccountByMaskedNumber(account?.maskedAccountNumber);
    if (!registryEntry || !expected.includes(registryEntry.brokerAccountLabel)) {
      skippedCount++;
      continue;
    }
    const label=registryEntry.brokerAccountLabel;
    if (seen.has(label)) {
      errors.push({account:label,error:"DUPLICATE_APPROVED_SCHWAB_ACCOUNT"});
      continue;
    }
    seen.add(label);
    if (!account?.accountHash) {
      errors.push({account:label,error:"APPROVED_SCHWAB_ACCOUNT_HASH_MISSING"});
      continue;
    }
    // Retain legacy normalization meaning for historical two-account delivery.
    // Seven-account scope returns broker identity only for new accounts. Engine 10
    // must supply the authoritative Journal account/partition before activation.
    const old=resolveSchwabJournalAccount(account.maskedAccountNumber);
    const identity={
      brokerAccountLabel:label,
      last4:registryEntry.last4,
      strategy:registryEntry.strategy,
      historicalJournalAccount:registryEntry.historicalJournalAccount,
      journalAccount:old.ok?old.journalAccount:null,
    };
    approved.push({account,identity});
  }
  for(const label of expected)if(!seen.has(label))
    errors.push({account:label,error:"APPROVED_SCHWAB_ACCOUNT_MISSING"});

  return {ok:errors.length===0,approved,skippedCount,errors,accountScope};
}
