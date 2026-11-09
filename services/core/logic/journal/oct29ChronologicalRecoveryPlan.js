// Engine 10B — isolated, deterministic October 29 chronological recovery plan.
// PURE TRANSFORM: NO JOURNAL, LEDGER, WATERMARK OR BROKER WRITES.
export const OCT29_TARGETS=Object.freeze([
 Object.freeze({account:"SCHWAB_0747",missing:"134842005669",later:"134847497356",
 tradeId:"TRD-MES-schwab_real_broker-2026-10-29T13-42-25+0000-4b0b",
 at:"2026-10-29T13:34:11.000Z",price:7736.5,qty:1,fees:2.6,contract:"MESZ26"}),
 Object.freeze({account:"SCHWAB_6380",missing:"134843195314",later:"134846674229",
 tradeId:"TRD-MES-schwab_real_broker-2026-10-29T13-42-10+0000-49be",
 at:"2026-10-29T13:35:05.000Z",price:7735,qty:1,fees:2.6,contract:"MESZ26"})
]);
const norm=v=>String(v??"").trim().toUpperCase();
const num=v=>v===null||v===undefined||v===""?null:Number(v);
const time=v=>{const x=Date.parse(v??"");return Number.isFinite(x)?x:null;};
const round=v=>Math.round((v+Number.EPSILON)*100)/100;
const copy=x=>structuredClone(x);
const err=(code,extra={})=>({ok:false,error:code,...extra});
const eq=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const tracked=["tradeId","brokerAccountLabel","performanceGroup","status","direction","futuresContractCode"];
function targetFill(state,t){
 const rows=Object.values(state?.observations||{}).filter(x=>{
  const f=x.normalizedFill||{};
  return norm(f.brokerAccountLabel||x.brokerAccountLabel)===t.account &&
   String(f.brokerTransactionId||x.brokerTransactionId)===t.missing;
 });
 if(rows.length!==1)return err("EXPECTED_ONE_DURABLE_FILL",{count:rows.length});
 const record=rows[0],f=record.normalizedFill;
 if(!f)return err("NORMALIZED_FILL_MISSING");
 if(record.delivered===true)return err("ALREADY_DELIVERED_RECHECK_JOURNAL");
 if(norm(f.positionEffect)!=="OPENING"||norm(f.direction)!=="LONG"||
    norm(f.side)!=="BUY"||norm(f.futuresContractCode)!==t.contract||
    num(f.quantity)!==1||num(f.fillPrice)!==t.price||
    time(f.fillTime)!==time(t.at)||num(f.totalFees)!==t.fees||
    norm(f.brokerAccountLabel)!==t.account)return err("ORIGINAL_BROKER_EVIDENCE_MISMATCH");
 if(f.brokerFillLegId) return err("UNEXPECTED_FILL_LEG_REQUIRES_EXACT_IDENTITY_REVIEW");
 return {ok:true,fill:f};
}
export function planOct29Recovery(journal,state){
 if(!Array.isArray(journal))return err("EXPECTED_JOURNAL_ARRAY");
 if(!state||!state.observations)return err("ENGINE8_LEDGER_REQUIRED");
 const changed=copy(journal),details=[],errors=[];
 for(const t of OCT29_TARGETS){
  const found=journal.filter(x=>x.tradeId===t.tradeId);
  if(found.length!==1){errors.push({account:t.account,error:"CAMPAIGN_NOT_UNIQUE",count:found.length});continue;}
  const original=found[0],c=changed.find(x=>x.tradeId===t.tradeId);
  const source=targetFill(state,t);
  if(!source.ok){errors.push({account:t.account,...source});continue;}
  const f=source.fill;
  if(norm(c.accountMode)!=="REAL"||norm(c.brokerAccountLabel||c.realBroker?.brokerAccountLabel)!==t.account||
    norm(c.direction)!=="LONG"||norm(c.futuresContractCode||c.realBroker?.futuresContractCode)!==t.contract||
    norm(c.status)!=="OPEN"||!["SUBMICRO","MICRO"].includes(norm(c.performanceGroup))){
     errors.push({account:t.account,error:"CAMPAIGN_IDENTITY_MISMATCH"});continue;
  }
  if(t.account==="SCHWAB_0747"&&norm(c.performanceGroup)!=="SUBMICRO"||
     t.account==="SCHWAB_6380"&&norm(c.performanceGroup)!=="MICRO"){
     errors.push({account:t.account,error:"STRATEGY_GROUP_MISMATCH"});continue;
  }
  const entries=(c.events||[]).filter(e=>["REAL_ENTRY_FILL","REAL_SCALE_IN_FILL"].includes(norm(e.eventType)));
  const exits=(c.events||[]).filter(e=>["REAL_PARTIAL_EXIT","REAL_FINAL_EXIT"].includes(norm(e.eventType)));
  if(exits.length||Number(c.qty?.cumulativeExitQuantity)!==0){
   errors.push({account:t.account,error:"CLOSING_PRESENT_REQUIRES_FIFO_REPLAY"});continue;
  }
  if(!entries.some(e=>String(e.brokerTransactionId)===t.later)||entries.some(e=>String(e.brokerTransactionId)===t.missing)){
   errors.push({account:t.account,error:"LATER_ENTRY_MISSING_OR_EARLIER_DUPLICATE"});continue;
  }
  const lots=c.realBroker?.remainingLots||[],contracts=c.realBroker?.contracts||[];
  if(!Array.isArray(lots)||!Array.isArray(contracts)||lots.length!==Number(c.qty?.remainingQty)||
     contracts.filter(x=>norm(x.status)==="OPEN").length!==lots.length||
     lots.some(l=>norm(l.futuresContractCode)!==t.contract)){
   errors.push({account:t.account,error:"CURRENT_FIFO_INVENTORY_NOT_VERIFIED"});continue;
  }
  const id=`${t.tradeId}|CTR|${t.missing}|1`;
  if(contracts.some(v=>v.contractId===id)||journal.some(x=>JSON.stringify(x.events||[]).includes(t.missing))){
   errors.push({account:t.account,error:"DUPLICATE_FILL_OR_CONTRACT_EXISTS"});continue;
  }
  const contract={...copy(contracts[0]),contractId:id,tradeId:t.tradeId,
   openingBrokerTransactionId:t.missing,openingBrokerFillLegId:null,
   openingBrokerOrderId:f.brokerOrderId??null,openingFillTime:f.fillTime,
   entryPrice:f.fillPrice,status:"OPEN",closingBrokerTransactionId:null,
   closingFillTime:null,exitPrice:null,realizedPoints:null,grossRealizedPnL:null};
  const lot={...copy(lots[0]),contractId:id,brokerTransactionId:t.missing,
   brokerFillLegId:null,brokerFillIdentity:f.brokerFillIdentity??null,
   fillTime:f.fillTime,price:f.fillPrice,qty:1};
  const event={...copy(entries[0]),eventType:"REAL_SCALE_IN_FILL",ts:f.fillTime,
   brokerTransactionId:t.missing,brokerFillLegId:null,
   brokerFillIdentity:f.brokerFillIdentity??null,brokerOrderId:f.brokerOrderId??null,
   brokerDedupeKey:f.brokerDedupeKey??null,price:f.fillPrice,fillQuantity:1,
   commission:f.commission??null,futuresExchangeFee:f.futuresExchangeFee??null,
   otherFees:f.otherFees??0,totalFees:f.totalFees,
   remainingQty:null,eventRealizedPoints:null,grossEventRealizedPnL:null,
   eventRealizedPnL:null,netEventRealizedPnL:null,closedContracts:[],
   positionEffect:"OPENING",side:"BUY",direction:"LONG",
   action:"SCALE_IN",reason:"REAL_SCALE_IN_FILL"};
  const orderedEvents=[...c.events,event].sort((a,b)=>time(a.ts)-time(b.ts));
  if(orderedEvents.some(e=>time(e.ts)===null)){errors.push({account:t.account,error:"INVALID_EVENT_TIMESTAMP"});continue;}
  let accumulated=0;
  for(const e of orderedEvents){
   if(["REAL_ENTRY_FILL","REAL_SCALE_IN_FILL"].includes(norm(e.eventType))){
    accumulated+=Number(e.fillQuantity||0);
    e.remainingQty=accumulated;
   }
  }
  c.events=orderedEvents;
  const orderedLots=[lot,...lots].sort((a,b)=>time(a.fillTime)-time(b.fillTime));
  c.realBroker.remainingLots=copy(orderedLots);
  c.brokerImport.remainingLots=copy(orderedLots);
  c.realBroker.contracts=[...contracts,contract].sort((a,b)=>time(a.openingFillTime)-time(b.openingFillTime));
  c.brokerImport.contracts=copy(c.realBroker.contracts);
  const qtyBefore=Number(original.qty.remainingQty),qtyAfter=qtyBefore+1;
  c.qty.remainingQty=qtyAfter;
  c.qty.originalQty=Number(original.qty.originalQty)+1;
  c.qty.cumulativeOpeningQuantity=Number(original.qty.cumulativeOpeningQuantity)+1;
  c.qty.cumulativeFilledQuantity=Number(original.qty.cumulativeFilledQuantity)+1;
  c.entry.qty=c.qty.originalQty;
  const weighted=orderedLots.reduce((sum,x)=>sum+Number(x.price)*Number(x.qty),0)/qtyAfter;
  c.entry.price=round(weighted);
  c.brokerImport.remainingAverageEntry=round(weighted);
  const totalFees=round(orderedEvents.filter(e=>["REAL_ENTRY_FILL","REAL_SCALE_IN_FILL","REAL_PARTIAL_EXIT","REAL_FINAL_EXIT"].includes(norm(e.eventType))).reduce((sum,e)=>sum+Number(e.totalFees||0),0));
  c.summary.actualFees=totalFees;
  c.summary.actualCommission=round(orderedEvents.reduce((sum,e)=>sum+Number(e.commission||0),0));
  c.summary.futuresExchangeFees=round(orderedEvents.reduce((sum,e)=>sum+Number(e.futuresExchangeFee||0),0));
  c.summary.otherBrokerFees=round(orderedEvents.reduce((sum,e)=>sum+Number(e.otherFees||0),0));
  c.summary.netRealizedPnL=round(Number(c.summary.grossRealizedPnL||0)-totalFees);
  c.brokerImport.actualFees=totalFees;
  c.brokerImport.actualCommission=c.summary.actualCommission;
  c.brokerImport.futuresExchangeFees=c.summary.futuresExchangeFees;
  c.brokerImport.netRealizedTradePnL=c.summary.netRealizedPnL;
  // Preserve existing immutable campaign creation timestamp and original entry event.
  // Original earlier execution time is preserved on the added event/contract/lot.
  c.updatedAt=original.updatedAt;
  for(const key of tracked)if(!eq(c[key],original[key]))errors.push({account:t.account,error:"PRESERVED_IDENTITY_CHANGED",key});
  details.push({account:t.account,tradeId:t.tradeId,missing:t.missing,later:t.later,
   newContractId:id,qtyBefore,qtyAfter,feesBefore:original.summary.actualFees,feesAfter:totalFees,
   priceBefore:original.brokerImport?.remainingAverageEntry,priceAfter:round(weighted),
   originalCampaignEntryTime:original.entry.time,earliestBrokerExecutionAt:t.at,
   eventCountBefore:original.events.length,eventCountAfter:c.events.length,
   netBefore:original.summary.netRealizedPnL,netAfter:c.summary.netRealizedPnL,
   note:"Historical campaign entry timestamp intentionally preserved; earlier execution appears as separate chronological broker event."});
 }
 if(errors.length||details.length!==2)return err("RECOVERY_PREFLIGHT_BLOCKED",{details,errors});
 const byId=new Map(details.map(x=>[x.tradeId,x]));
 for(let i=0;i<journal.length;i++){
  if(!byId.has(journal[i].tradeId)&&!eq(journal[i],changed[i]))
   return err("UNRELATED_CAMPAIGN_CHANGED");
 }
 return {ok:true,readOnly:true,details,candidate:changed};
}
