// Engine 8 — versioned REAL Schwab account identity registry.
// Broker identity is immutable. Engine 10 alone owns historical vs strategy
// Journal classification and campaign cutover. No broker orders or writes.
export const SCHWAB_REAL_ACCOUNT_REGISTRY_VERSION = "engine8.schwabRealAccounts.v1";
export const SCHWAB_REAL_STRATEGY_CUTOVER_UTC = "2026-10-22T07:00:00.000Z";

// Nicknames and last four digits verified by owner; hashes must be resolved
// through authenticated Schwab discovery, never persisted in this registry.
export const SCHWAB_REAL_ACCOUNT_REGISTRY = Object.freeze([
  { last4:"0747", brokerAccountLabel:"SCHWAB_0747", strategy:"SUBMICRO", historicalJournalAccount:"SWING" },
  { last4:"6380", brokerAccountLabel:"SCHWAB_6380", strategy:"MICRO", historicalJournalAccount:"INTRADAY" },
  { last4:"7727", brokerAccountLabel:"SCHWAB_7727", strategy:"SUBMINUTE", historicalJournalAccount:null },
  { last4:"3914", brokerAccountLabel:"SCHWAB_3914", strategy:"MINUTE", historicalJournalAccount:null },
  { last4:"5671", brokerAccountLabel:"SCHWAB_5671", strategy:"MINOR", historicalJournalAccount:null },
  { last4:"2888", brokerAccountLabel:"SCHWAB_2888", strategy:"INTERMEDIATE", historicalJournalAccount:null },
  { last4:"0144", brokerAccountLabel:"SCHWAB_0144", strategy:"PRIMARY", historicalJournalAccount:null },
].map(x=>Object.freeze(x)));

export const LEGACY_SCHWAB_REAL_ACCOUNT_LABELS = Object.freeze(["SCHWAB_6380","SCHWAB_0747"]);
export const SEVEN_SCHWAB_REAL_ACCOUNT_LABELS = Object.freeze(SCHWAB_REAL_ACCOUNT_REGISTRY.map(x=>x.brokerAccountLabel));

export function findSchwabRealAccountByMaskedNumber(maskedAccountNumber) {
  const digits=String(maskedAccountNumber??"").replace(/\D/g,"");
  if(digits.length<4)return null;
  return SCHWAB_REAL_ACCOUNT_REGISTRY.find(x=>x.last4===digits.slice(-4))||null;
}

// Designed for downstream Engine 10 adoption. This hint MUST NOT be substituted
// for Engine 10's campaign-level classification/lot preservation.
export function getSchwabRealCutoverHint(maskedAccountNumber, entryTimeUtc) {
  const account=findSchwabRealAccountByMaskedNumber(maskedAccountNumber);
  const when=Date.parse(String(entryTimeUtc??""));
  if(!account||!Number.isFinite(when))return null;
  return {
    registryVersion:SCHWAB_REAL_ACCOUNT_REGISTRY_VERSION,
    brokerAccountLabel:account.brokerAccountLabel,
    strategy:account.strategy,
    proposedPerformanceGroup:when>=Date.parse(SCHWAB_REAL_STRATEGY_CUTOVER_UTC)
      ?account.strategy:account.historicalJournalAccount,
    cutoverUtc:SCHWAB_REAL_STRATEGY_CUTOVER_UTC,
    // Existing campaigns spanning cutover require Engine 10 lifecycle evidence.
    authoritative:false,
  };
}
