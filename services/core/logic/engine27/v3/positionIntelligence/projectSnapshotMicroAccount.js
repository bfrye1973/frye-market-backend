// Existing canonical ES snapshot -> safe Micro account aggregate, no full Journal.
// Engine10 owns REAL contracts. This is a position overview, NOT contract ledger.
const valid=x=>typeof x==="string"&&x.length>0;
export function projectSnapshotMicroAccount(snapshot=null){
 const unavailable=reason=>({schema:"engine27.v3.microAccountSnapshot.v1",
  source:"ENGINE10_STRATEGY_ACCOUNT_MONITORING",available:false,
  reasonCodes:[reason],openContracts:null,direction:null,
  entryThesisStatus:"ENTRY_STRUCTURE_UNAVAILABLE",officialPlanStatus:"OFFICIAL_PLAN_UNAVAILABLE",
  aggregateOnly:true,noExecution:true});
 const monitor=snapshot?.strategyAccountMonitoring;
 if(snapshot?.symbol!=="ES"||monitor?.version!=="redline.strategyAccountMonitoring.v2"||
    monitor?.mode!=="READ_ONLY"||!Array.isArray(monitor.accounts))
  return unavailable("CANONICAL_ACCOUNT_MONITOR_UNAVAILABLE");
 const matches=monitor.accounts.filter(x=>x?.accountRole==="INTRADAY"&&x?.degree==="micro"&&
   x?.brokerBinding?.brokerAccountLabel==="SCHWAB_6380");
 // Some registry contracts store the binding string directly: fail-closed until verified.
 if(matches.length!==1)return unavailable("MICRO_PHYSICAL_ACCOUNT_BINDING_NOT_VERIFIED");
 const account=matches[0];const pos=account.position;
 if(!pos||typeof pos.contracts!=="number"||!Number.isInteger(pos.contracts)||pos.contracts<0||
  (pos.positionPresent!==true&&pos.contracts!==0))
  return unavailable("MICRO_ACCOUNT_POSITION_AGGREGATE_INVALID");
 if(pos.contracts>0&&!["LONG","SHORT","MIXED"].includes(pos.direction))
  return unavailable("MICRO_ACCOUNT_DIRECTION_INVALID");
 return {schema:"engine27.v3.microAccountSnapshot.v1",source:"ENGINE10_STRATEGY_ACCOUNT_MONITORING",
  available:true,reasonCodes:[],openContracts:pos.contracts,
  direction:pos.direction??"FLAT",campaignCount:pos.campaignCount??null,
  entryThesisStatus:valid(account.thesisState)?account.thesisState:"ENTRY_STRUCTURE_UNAVAILABLE",
  officialPlanStatus:"OFFICIAL_PLAN_UNAVAILABLE",aggregateOnly:true,noExecution:true};
}
