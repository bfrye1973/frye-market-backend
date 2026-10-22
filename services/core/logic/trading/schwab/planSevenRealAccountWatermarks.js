// Engine 8 read-only plan for seven-account watermark cutover.
// No state writes, no Schwab calls, no Engine 10 account assignment.
// Existing two account watermarks are NEVER rewritten by this planner.
import {
  SCHWAB_REAL_ACCOUNT_REGISTRY,
  SCHWAB_REAL_STRATEGY_CUTOVER_UTC,
} from "./engine8RealAccountRegistry.js";

const validTime=v=>typeof v==="string" && Number.isFinite(Date.parse(v))
  ?new Date(v).toISOString():null;

// No gap is inferred from a lastSuccessfulPollAt timestamp alone.
// A fresh strategy account MUST be explicitly backfilled from the cutover
// before its normal short-window polling can be enabled.
export function planSevenRealAccountWatermarkCutover(state) {
  const existing=state?.accounts;
  if(!existing||typeof existing!=="object"||Array.isArray(existing))
    return {ok:false,reason:"ENGINE8_WATERMARK_STATE_NOT_AVAILABLE",accounts:[]};
  const accounts=[];
  for(const entry of SCHWAB_REAL_ACCOUNT_REGISTRY){
    const stored=existing[entry.brokerAccountLabel]||null;
    const historical=Boolean(entry.historicalJournalAccount);
    if(stored && stored.brokerAccountLabel && stored.brokerAccountLabel!==entry.brokerAccountLabel)
      return {ok:false,reason:"BROKER_WATERMARK_IDENTITY_CONFLICT",account:entry.brokerAccountLabel,accounts};
    if(stored?.journalAccount && historical && stored.journalAccount!==entry.historicalJournalAccount)
      return {ok:false,reason:"HISTORICAL_WATERMARK_ACCOUNT_CONFLICT",account:entry.brokerAccountLabel,accounts};
    if(stored && !historical && stored.journalAccount && stored.journalAccount!==entry.strategy)
      return {ok:false,reason:"NEW_WATERMARK_ACCOUNT_CONFLICT",account:entry.brokerAccountLabel,accounts};
    const lastFill=validTime(stored?.lastBrokerFillTimeSeen);
    if(stored?.lastBrokerFillTimeSeen && !lastFill)
      return {ok:false,reason:"INVALID_WATERMARK_TIMESTAMP",account:entry.brokerAccountLabel,accounts};
    accounts.push({
      brokerAccountLabel:entry.brokerAccountLabel,
      strategy:entry.strategy,
      historicalJournalAccount:entry.historicalJournalAccount,
      watermarkExists:Boolean(stored),
      lastBrokerFillTimeSeen:lastFill,
      lastSuccessfulPollAt:validTime(stored?.lastSuccessfulPollAt),
      // Plan is intentionally non-authoritative: Engine 10 approval required.
      earliestRequiredReconciliationUtc:historical
        ?null:SCHWAB_REAL_STRATEGY_CUTOVER_UTC,
      mustPreserveExistingWatermark:historical,
      requiresEngine10Reconciliation:true,
      canEnableLiveDelivery:false,
    });
  }
  return {ok:true,cutoverUtc:SCHWAB_REAL_STRATEGY_CUTOVER_UTC,
    version:"engine8.sevenRealAccountWatermarkPlan.v1",
    accounts,readOnly:true,canEnableLiveDelivery:false};
}
