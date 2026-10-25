import {POSITION_INTELLIGENCE_SCHEMA,MICRO_ACCOUNT} from "../contracts/positionIntelligence.v1.js";
const number=n=>typeof n==="number"&&Number.isFinite(n);
const rootSymbol=s=>/^\/?M?ES[A-Z]\d{2}(?::[A-Z]+)?$/.test(String(s||"").toUpperCase())||["ES","/ES","MES","/MES"].includes(String(s||"").toUpperCase());
const validDirection=d=>d==="LONG"||d==="SHORT";
function extractContracts(trade){
 const contracts=trade?.realBroker?.contracts;
 return Array.isArray(contracts)?contracts.filter(c=>c?.status==="OPEN"):[];
}
function attachPlan(trade,plan){
 // Real Schwab transactions and paper Engine9 plans do NOT automatically share identity.
 // Matching only a strategy, symbol, direction or account is never sufficient.
 const id=trade?.identity??{};
 if(plan?.managementReady!==true||plan?.official!==true||!plan?.planId||!plan?.candidateId||!plan?.strategyId)return null;
 if(!id.planId||!id.candidateId||!id.strategyId||id.planId!==plan.planId||id.candidateId!==plan.candidateId||id.strategyId!==plan.strategyId)return null;
 if(plan?.direction!==trade.direction||!number(plan.officialStopPrice)||!Array.isArray(plan.officialTargets))return null;
 return {planId:plan.planId,officialStopPrice:plan.officialStopPrice,officialTargets:plan.officialTargets.map(t=>({targetId:t.targetId,price:t.price,status:t.status??null})),planStatus:plan.planStatus??null,source:"ENGINE9_OFFICIAL_MANAGEMENT_PLAN"};
}
export function evaluatePositionIntelligence({journal=null,officialPlans=[],microAccount=MICRO_ACCOUNT}={}){
 const base={schema:POSITION_INTELLIGENCE_SCHEMA,degree:"micro",account:MICRO_ACCOUNT,mode:"READ_ONLY",state:"UNAVAILABLE",available:false,positions:[],reasonCodes:[],noPermissionCreated:true,noExecution:true,noJournalWrite:true,noOrderModification:true};
 if(microAccount!==MICRO_ACCOUNT)return {...base,reasonCodes:["MICRO_ACCOUNT_IDENTITY_MISMATCH"]};
 if(journal?.ok!==true||!Array.isArray(journal.trades))return {...base,reasonCodes:["ENGINE10_JOURNAL_UNAVAILABLE"]};
 if(!Array.isArray(officialPlans))return {...base,reasonCodes:["OFFICIAL_PLAN_INPUT_INVALID"]};
 const accountTrades=journal.trades.filter(t=>t?.accountMode==="REAL"&&t?.brokerAccountLabel===MICRO_ACCOUNT);
 const positions=[];let invalid=0;
 for(const t of accountTrades){
  if(t?.status==="CLOSED")continue;
  const open=extractContracts(t);
  if(!open.length)continue;
  if(!t.tradeId||!validDirection(t.direction)||!rootSymbol(t.symbol)){invalid++;continue;}
  for(const c of open){
   if(!c.contractId||!number(c.entryPrice)||c.entryPrice<=0){invalid++;continue;}
   const plan=officialPlans.map(p=>attachPlan(t,p)).find(Boolean)??null;
   positions.push({tradeId:t.tradeId,contractId:c.contractId,brokerAccountLabel:MICRO_ACCOUNT,direction:t.direction,symbol:t.symbol,entryPrice:c.entryPrice,
     contracts:1,unrealizedPnL:null,unrealizedPnLStatus:"VERIFIED_MARK_TO_MARKET_UNAVAILABLE",officialManagement:plan,
     entryThesisAvailable:!!(t.structuralContextAtEntry&&t.structuralContextAtEntry.reason!=="ENGINE22_STRUCTURE_UNAVAILABLE_AT_ENTRY"&&t.structuralContextAtEntry.historicalBackfill!==true),
     source:"ENGINE10_REAL_BROKER_CONTRACT"});
  }
 }
 if(invalid)return {...base,state:"UNAVAILABLE",reasonCodes:["INVALID_OPEN_REAL_CONTRACT",String(invalid)]};
 if(!positions.length)return {...base,state:"NO_OPEN_POSITIONS",available:true,reasonCodes:[]};
 const managed=positions.every(p=>p.officialManagement!==null);
 return {...base,state:managed?"OPEN_POSITIONS_WITH_OFFICIAL_PLAN":"OPEN_POSITIONS_UNMANAGED",available:true,positions,reasonCodes:managed?[]:["NO_IDENTITY_MATCHED_OFFICIAL_PLAN"]};
}
