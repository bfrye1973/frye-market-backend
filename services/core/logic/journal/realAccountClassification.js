// Engine 10 — seven-account REAL Schwab campaign classification contract.
// Reporting labels are separate from broker account identity and FIFO owner.
// This module does not read Schwab, write journals, or place orders.

export const REAL_STRATEGY_CUTOVER_UTC = "2026-10-22T07:00:00.000Z";
export const REAL_ACCOUNT_CONTRACT_VERSION = "engine10.realAccountClassification.v1";

export const REAL_ACCOUNT_REGISTRY = Object.freeze([
  {brokerAccountLabel:"SCHWAB_0747",strategy:"SUBMICRO",historical:"SWING"},
  {brokerAccountLabel:"SCHWAB_6380",strategy:"MICRO",historical:"INTRADAY"},
  {brokerAccountLabel:"SCHWAB_7727",strategy:"SUBMINUTE",historical:null},
  {brokerAccountLabel:"SCHWAB_3914",strategy:"MINUTE",historical:null},
  {brokerAccountLabel:"SCHWAB_5671",strategy:"MINOR",historical:null},
  {brokerAccountLabel:"SCHWAB_2888",strategy:"INTERMEDIATE",historical:null},
  {brokerAccountLabel:"SCHWAB_0144",strategy:"PRIMARY",historical:null},
].map(v=>Object.freeze(v)));

// Owner-approved, transaction-specific exceptions. No other pre-cutover openings qualify.
export const VERIFIED_PRECUTOVER_ACCOUNT_EXCEPTIONS = Object.freeze([
  Object.freeze({
    brokerAccountLabel: "SCHWAB_7727",
    brokerTransactionId: "134185163978",
    openingTimeUtc: "2026-10-22T05:30:35.000Z",
    performanceGroup: "SUBMINUTE",
  }),
  Object.freeze({
    brokerAccountLabel: "SCHWAB_3914",
    brokerTransactionId: "134186181985",
    openingTimeUtc: "2026-10-22T06:29:15.000Z",
    performanceGroup: "MINUTE",
  }),
]);

const validGroups = new Set([
  "SWING","INTRADAY","SUBMICRO","MICRO","SUBMINUTE","MINUTE",
  "MINOR","INTERMEDIATE","PRIMARY",
]);
const normalized=v=>String(v??"").trim().toUpperCase();
const mapping=label=>REAL_ACCOUNT_REGISTRY.find(v=>v.brokerAccountLabel===normalized(label))||null;

export function classifyRealCampaignAtEntry({brokerAccountLabel,entryTime,brokerTransactionId=null,existingCampaign=null}={}){
  if(existingCampaign){
    const stored=normalized(existingCampaign?.performanceGroup||existingCampaign?.journalAccount);
    if(validGroups.has(stored))return {
      ok:true,classification:stored,source:"EXISTING_CAMPAIGN_LOCKED",
      brokerAccountLabel:normalized(existingCampaign.brokerAccountLabel||brokerAccountLabel),
      registryVersion:REAL_ACCOUNT_CONTRACT_VERSION,
    };
    return {ok:false,error:"EXISTING_CAMPAIGN_CLASSIFICATION_INVALID"};
  }
  const account=mapping(brokerAccountLabel);
  if(!account)return {ok:false,error:"UNAPPROVED_BROKER_ACCOUNT_IDENTITY"};
  const ms=Date.parse(String(entryTime??""));
  if(!Number.isFinite(ms))return {ok:false,error:"INVALID_ENTRY_TIME"};
  const after=ms>=Date.parse(REAL_STRATEGY_CUTOVER_UTC);
  if(!after&&!account.historical){
    const exception=VERIFIED_PRECUTOVER_ACCOUNT_EXCEPTIONS.find(e=>
      e.brokerAccountLabel===account.brokerAccountLabel &&
      e.brokerTransactionId===normalized(brokerTransactionId) &&
      Date.parse(e.openingTimeUtc)===ms
    );
    if(!exception)return {ok:false,error:"NO_APPROVED_PRECUTOVER_CLASSIFICATION"};
    return {
      ok:true,classification:exception.performanceGroup,
      source:"VERIFIED_PRECUTOVER_ACCOUNT_EXCEPTION",
      brokerAccountLabel:account.brokerAccountLabel,
      brokerTransactionId:exception.brokerTransactionId,
      registryVersion:REAL_ACCOUNT_CONTRACT_VERSION,
      cutoverUtc:REAL_STRATEGY_CUTOVER_UTC,
    };
  }
  return {
    ok:true,
    classification:after?account.strategy:account.historical,
    source:after?"STRATEGY_CUTOVER":"HISTORICAL_ACCOUNT",
    brokerAccountLabel:account.brokerAccountLabel,
    registryVersion:REAL_ACCOUNT_CONTRACT_VERSION,
    cutoverUtc:REAL_STRATEGY_CUTOVER_UTC,
  };
}

export function brokerIdentityPartition(brokerAccountLabel){
  const account=mapping(brokerAccountLabel);
  return account?.brokerAccountLabel||null;
}

export function isValidRealPerformanceGroup(value){
  return validGroups.has(normalized(value));
}
