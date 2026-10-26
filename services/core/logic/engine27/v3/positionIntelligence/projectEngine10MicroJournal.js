// Read-only Engine10 REAL Schwab Micro adapter. Input must come from an
// authorized source; this module never fetches Journal or stores broker data.
const string=x=>typeof x==="string"&&x.trim()?x:null;
const validTime=x=>!!string(x)&&Number.isFinite(Date.parse(x));
const num=x=>typeof x==="number"&&Number.isFinite(x);
const symbol=x=>/^\/?MES[A-Z]\d{2}(?::[A-Z]+)?$/i.test(String(x??""));
export function projectEngine10MicroJournal(journal=null){
 const fail=(reason)=>({ok:false,source:"ENGINE10_REAL_JOURNAL",mode:"READ_ONLY",
  reasonCodes:[reason],trades:[],noExecution:true,noJournalWrite:true});
 if(journal?.ok!==true||!Array.isArray(journal.trades))return fail("ENGINE10_AUTHORIZED_SOURCE_UNAVAILABLE");
 const rows=[];const seen=new Set();
 for(const t of journal.trades){
  if(t?.brokerAccountLabel!=="SCHWAB_6380"||t?.accountMode!=="REAL")continue;
  if(t.status==="CLOSED")continue;
  const contracts=t?.realBroker?.contracts;
  if(!Array.isArray(contracts))return fail("ENGINE10_CONTRACT_LEDGER_MISSING");
  const open=contracts.filter(c=>c?.status==="OPEN");
  if(!open.length)continue;
  if(!string(t.tradeId)||!["LONG","SHORT"].includes(t.direction)||!symbol(t.symbol))
   return fail("ENGINE10_MICRO_CAMPAIGN_INVALID");
  for(const c of open){
   if(!string(c.contractId)||!num(c.entryPrice)||c.entryPrice<=0||
    !validTime(c.openingFillTime)||!string(c.futuresContractCode)||
    !symbol(c.futuresContractCode)||
    (c.brokerAccountLabel&&c.brokerAccountLabel!=="SCHWAB_6380")||
    (c.direction&&c.direction!==t.direction)||
    (c.tradeId&&c.tradeId!==t.tradeId)||
    !string(c.openingBrokerTransactionId)||!string(c.openingBrokerFillLegId))
     return fail("ENGINE10_MICRO_CONTRACT_PROVENANCE_INVALID");
   const key=c.contractId;
   if(seen.has(key))return fail("ENGINE10_DUPLICATE_OPEN_CONTRACT_ID");
   seen.add(key);
  }
  // Keep the exact canonical trade and entry context ONLY in the trusted
  // server-side manager input. Never return this object via the browser API.
  rows.push(t);
 }
 return {ok:true,source:"ENGINE10_REAL_JOURNAL",mode:"READ_ONLY",
  reasonCodes:[],trades:rows,noExecution:true,noJournalWrite:true};
}
export function summarizeEngine10Micro(positionIntelligence=null,entryThesisMemory=null){
 const positions=positionIntelligence?.positions;
 if(positionIntelligence?.available!==true||!Array.isArray(positions))return {
  sourceAvailable:false,openContracts:null,positionState:"UNAVAILABLE",
  directions:[],entryThesisStatus:"ENTRY_STRUCTURE_UNAVAILABLE",
  officialPlanStatus:"OFFICIAL_PLAN_UNAVAILABLE",noExecution:true
 };
 const directions=[...new Set(positions.map(p=>p.direction).filter(Boolean))];
 const theses=entryThesisMemory?.positions;
 const thesisStatus=Array.isArray(theses)&&theses.length?
  (theses.every(x=>x.available===true)?"CAPTURED_WITH_PROVENANCE":"ENTRY_STRUCTURE_UNAVAILABLE"):"ENTRY_STRUCTURE_UNAVAILABLE";
 return {sourceAvailable:true,openContracts:positions.length,
  positionState:positionIntelligence.state,directions,
  entryThesisStatus:thesisStatus,
  officialPlanStatus:positions.length>0&&positions.every(x=>x.officialManagement!==null)?
   "OFFICIAL_PLAN_IDENTITY_MATCHED":"OFFICIAL_PLAN_UNAVAILABLE",
  noExecution:true};
}
