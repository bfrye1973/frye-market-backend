// Engine 8D Phase 2 — seven independent MANUAL PAPER account identities.
// Not the REAL Schwab strategyAccountRegistry; no automated execution authority.
export const MANUAL_PAPER_ACCOUNT_VERSION = "engine8.manualPaperAccounts.v1";
export const MANUAL_PAPER_INITIAL_CAPITAL = 10000;
export const MANUAL_PAPER_DEGREES = Object.freeze([
  ["PAPER-01-SUBMICRO", "INTRADAY_SUBMICRO", "SUBMICRO"],
  ["PAPER-02-MICRO", "MICRO", "MICRO / INTRADAY"],
  ["PAPER-03-SUBMINUTE", "SUBMINUTE", "SUBMINUTE"],
  ["PAPER-04-MINUTE", "MINUTE", "MINUTE"],
  ["PAPER-05-MINOR", "MINOR", "MINOR"],
  ["PAPER-06-INTERMEDIATE", "INTERMEDIATE", "INTERMEDIATE"],
  ["PAPER-07-PRIMARY", "PRIMARY", "PRIMARY"],
].map(([accountId, strategyDegreeId, displayName]) =>
  Object.freeze({accountId, strategyDegreeId, displayName, startingCapital:10000})
));
const REGISTRY = new Map(MANUAL_PAPER_DEGREES.map(a=>[a.accountId,a]));
export function getManualPaperAccountDefinition(accountId) {
  return REGISTRY.get(String(accountId||"")) || null;
}
export function makeInitialManualPaperAccounts() {
  return {
    version: MANUAL_PAPER_ACCOUNT_VERSION,
    initializedAt: new Date().toISOString(),
    accounts: MANUAL_PAPER_DEGREES.map(def=>({
      ...def,accountMode:"PAPER",currency:"USD",cashBalance:10000,
      realizedPnL:0,unrealizedPnL:0,equity:10000,
      marginUsed:0,availableFunds:10000,feesPaid:0,
      openContracts:0,openTrades:0,positions:{},
      executions:[],lastExecutionId:null,journalStatus:"READY"
    })),
    combinedStartingCapital:70000
  };
}
export function validateManualPaperAccountRegistry(value) {
  if (!value || value.version!==MANUAL_PAPER_ACCOUNT_VERSION ||
      !Array.isArray(value.accounts) || value.accounts.length!==7 ||
      value.combinedStartingCapital!==70000) {
    throw new Error("MANUAL_PAPER_REGISTRY_INVALID");
  }
  const ids=new Set();
  for (let i=0;i<7;i++) {
    const a=value.accounts[i],expected=MANUAL_PAPER_DEGREES[i];
    if (!a || a.accountId!==expected.accountId ||
        a.strategyDegreeId!==expected.strategyDegreeId ||
        a.startingCapital!==10000 || a.accountMode!=="PAPER" ||
        ids.has(a.accountId) || !Number.isFinite(a.cashBalance) ||
        !Number.isFinite(a.equity) || !Number.isFinite(a.realizedPnL) ||
        !Number.isFinite(a.unrealizedPnL) || !a.positions ||
        !Array.isArray(a.executions)) {
      throw new Error("MANUAL_PAPER_ACCOUNT_INVARIANT_FAILED");
    }
    ids.add(a.accountId);
  }
  return value;
}
export function validateFuturesContract(symbol,price,qty) {
  const raw=String(symbol||"").toUpperCase().trim();
  const m=/^(MES|ES)([HMUZ])(\d{2})$/.exec(raw);
  if (!m) return {ok:false,reason:"INVALID_ES_MES_EXPIRATION"};
  const year=2000+Number(m[3]);
  if(year<2020||year>2099)return {ok:false,reason:"INVALID_CONTRACT_YEAR"};
  const p=Number(price),q=Number(qty);
  if(!Number.isFinite(p)||p<=0||Math.abs(Math.round(p*4)-p*4)>1e-8)
    return {ok:false,reason:"INVALID_FUTURES_TICK_PRICE"};
  if(!Number.isSafeInteger(q)||q<=0)
    return {ok:false,reason:"INVALID_CONTRACT_QUANTITY"};
  return {ok:true,symbol:raw,root:m[1],expiration:m[2]+m[3],
    multiplier:m[1]==="ES"?50:5,tickSize:0.25,
    tickValue:m[1]==="ES"?12.5:1.25,price:p,qty:q};
}
export const MANUAL_PAPER_RISK_POLICY = Object.freeze({
  policyVersion:"manual-paper-risk.v1",accountCapital:10000,
  simulatedInitialMargin:{ES:15000,MES:1500},
  feePerContractPerSide:{ES:2.5,MES:1.25},
  maxContractsPerAccount:6,slippageModel:"MANUAL_EXPLICIT_FILL_PRICE",
  markPolicy:"NO_AUTOMATIC_MARKS",
});

function positiveEnv(name,fallback){
  const raw=String(process.env[name]||"").trim();
  if(!raw)return fallback;
  const value=Number(raw);
  if(!Number.isFinite(value)||value<=0)throw Error("INVALID_MANUAL_PAPER_POLICY_"+name);
  return value;
}
export function getManualPaperRiskPolicy(){
  return Object.freeze({
    ...MANUAL_PAPER_RISK_POLICY,
    simulatedInitialMargin:Object.freeze({
      ES:positiveEnv("ENGINE8_MANUAL_PAPER_MARGIN_ES",15000),
      MES:positiveEnv("ENGINE8_MANUAL_PAPER_MARGIN_MES",1500)
    }),
    feePerContractPerSide:Object.freeze({
      ES:positiveEnv("ENGINE8_MANUAL_PAPER_FEE_ES",2.5),
      MES:positiveEnv("ENGINE8_MANUAL_PAPER_FEE_MES",1.25)
    }),
    maxContractsPerAccount:Math.floor(positiveEnv("ENGINE8_MANUAL_PAPER_MAX_CONTRACTS",6)),
  });
}
