#!/usr/bin/env node
// Engine 8A / Engine 10B: PRIVATE READ-ONLY seven-account broker evidence.
// Run in an isolated checkout with existing Schwab env access.
// NEVER invokes REAL order methods, Engine 10 ingestion, or watermark writes.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {getSchwabAccountNumbers,schwabApiRequest} from "../logic/trading/schwab/schwabClient.js";
import {selectApprovedSchwabRealAccounts} from "../logic/trading/schwab/selectApprovedSchwabRealAccounts.js";
import {normalizeSchwabRealFutureTransaction,normalizeSchwabRealFutureTransactionLegs}
  from "../logic/trading/schwab/engine8RealFillNormalizer.js";
import {readEngine8RealFillObserverState} from "../logic/trading/schwab/engine8RealFillStore.js";

const START="2026-10-21T00:00:00.000Z";
const END=new Date().toISOString();
const EXPECTED_CLOSING_DAY="2026-10-23";
const iso=x=>{const d=Date.parse(String(x??""));return Number.isFinite(d)?new Date(d).toISOString():null;};
const str=x=>String(x??"").trim();
const records=[];
const errors=[];
const byAccount={};
const closedToday=[];
const identityKeys=new Set();
const duplicateIdentities=[];
const state=readEngine8RealFillObserverState();
const observed=Object.values(state.observations||{});
const selection=selectApprovedSchwabRealAccounts(
 (await getSchwabAccountNumbers()).accounts||[],{accountScope:"SEVEN_STRATEGIES"}
);
if(!selection.ok)throw Error("SEVEN_ACCOUNT_DISCOVERY_FAILED:"+JSON.stringify(selection.errors));

const statusFor=(f)=>{
  const found=observed.filter(r=>
    str(r.brokerAccountLabel||r.normalizedFill?.brokerAccountLabel)===str(f.brokerAccountLabel)&&
    (str(r.brokerFillIdentity||r.normalizedFill?.brokerFillIdentity) &&
       str(r.brokerFillIdentity||r.normalizedFill?.brokerFillIdentity)===str(f.brokerFillIdentity) ||
     str(r.brokerTransactionId||r.normalizedFill?.brokerTransactionId)===str(f.brokerTransactionId)&&
       !str(r.brokerFillLegId||r.normalizedFill?.brokerFillLegId)&&!str(f.brokerFillLegId))
  );
  if(!found.length)return {status:"NOT_OBSERVED",matchedLedgerRecords:0};
  if(found.some(r=>r.delivered===true&&r.deliveryStatus==="ENGINE10_ACKNOWLEDGED"))
    return {status:"ENGINE10_ACKNOWLEDGED",matchedLedgerRecords:found.length};
  if(found.some(r=>r.delivered===true))
    return {status:"DELIVERED_FLAG_NO_EXPLICIT_ACK",matchedLedgerRecords:found.length};
  return {status:"NOT_ACKNOWLEDGED",matchedLedgerRecords:found.length,
    ledgerStatuses:[...new Set(found.map(r=>str(r.deliveryStatus)))]};
};

for(const {account,identity} of selection.approved){
  const label=identity.brokerAccountLabel;
  const count={strategy:identity.strategy,transactions:0,normalizedFillLegs:0,
    openingLegs:0,closingLegs:0,closingLegsOct23:0,
    engine10Acknowledged:0,notAcknowledged:0,notObserved:0,
    duplicateIdentities:0,normalizationErrors:0,
    watermark:state.accounts?.[label]||null};
  byAccount[label]=count;
  const endpoint="/accounts/"+encodeURIComponent(account.accountHash)+"/transactions"+
    "?startDate="+encodeURIComponent(START)+"&endDate="+encodeURIComponent(END)+"&types=TRADE";
  try{
    const res=await schwabApiRequest(endpoint,{method:"GET",operation:"ENGINE8_READ_ONLY_OCT23_AUDIT"});
    if(!Array.isArray(res.body))throw Error("NON_ARRAY_TRANSACTION_RESPONSE");
    count.transactions=res.body.length;
    for(const t of res.body){
      let n=normalizeSchwabRealFutureTransaction({transaction:t,
        maskedAccountNumber:account.maskedAccountNumber,accountScope:"SEVEN_STRATEGIES"});
      if(!n.ok&&n.reason==="MULTIPLE_FUTURE_TRANSFER_ITEMS_UNSUPPORTED")
        n=normalizeSchwabRealFutureTransactionLegs({transaction:t,
          maskedAccountNumber:account.maskedAccountNumber,accountScope:"SEVEN_STRATEGIES"});
      if(!n.ok){
        if(n.skipped===true||n.reason==="SCHWAB_TRADE_HAS_NO_FUTURE_TRANSFER_ITEM")continue;
        count.normalizationErrors++;errors.push({account:label,id:str(t.activityId),reason:n.reason});
        continue;
      }
      for(const candidate of n.candidates||[{fill:n.fill}]){
        const f=candidate.fill;
        const identityKey=[f.brokerAccountLabel,f.brokerTransactionId,
          f.brokerFillLegId||"LEGACY",f.brokerFillIdentity||""].join("|");
        if(identityKeys.has(identityKey)){
          count.duplicateIdentities++;duplicateIdentities.push(identityKey);
        }
        identityKeys.add(identityKey);
        const delivery=statusFor(f);
        count.normalizedFillLegs++;
        if(f.positionEffect==="OPENING")count.openingLegs++;
        if(f.positionEffect==="CLOSING")count.closingLegs++;
        if(delivery.status==="ENGINE10_ACKNOWLEDGED")count.engine10Acknowledged++;
        else if(delivery.status==="NOT_OBSERVED")count.notObserved++;
        else count.notAcknowledged++;
        const row={
          brokerAccountLabel:f.brokerAccountLabel,
          strategy:identity.strategy,
          brokerTransactionId:f.brokerTransactionId,
          brokerFillLegId:f.brokerFillLegId||null,
          brokerFillIdentity:f.brokerFillIdentity||null,
          brokerOrderId:f.brokerOrderId||null,
          originalFillTime:f.fillTime,
          fillTimeUtc:iso(f.fillTime),
          futuresContractCode:f.futuresContractCode,
          brokerSymbol:f.brokerSymbol,
          positionEffect:f.positionEffect,
          side:f.side,direction:f.direction,
          quantity:f.quantity,fillPrice:f.fillPrice,
          commission:f.commission,futuresExchangeFee:f.futuresExchangeFee,
          otherFees:f.otherFees,totalFees:f.totalFees,
          delivery
        };
        records.push(row);
        if(f.positionEffect==="CLOSING"&&row.fillTimeUtc?.slice(0,10)===EXPECTED_CLOSING_DAY){
          count.closingLegsOct23++;
          closedToday.push(row);
        }
      }
    }
  }catch(e){errors.push({account:label,reason:String(e?.message||e).slice(0,220)});}
}

const inventory={retrievedAt:new Date().toISOString(),source:"SCHWAB_GET_ACCOUNTS_FIELDS_POSITIONS",
  brokerFuturesInventoryAuthoritative:false,accounts:{}};
try{
 const resp=await schwabApiRequest("/accounts?fields=positions",
   {method:"GET",operation:"ENGINE8_READ_ONLY_POSITIONS_AUDIT"});
 if(!Array.isArray(resp.body))throw Error("NON_ARRAY_POSITIONS_RESPONSE");
 for(const a of selection.approved){
   const ending=a.identity.last4;
   const match=resp.body.find(row=>str(row.securitiesAccount?.accountNumber).endsWith(ending));
   if(!match){errors.push({account:a.identity.brokerAccountLabel,reason:"ACCOUNT_MISSING_IN_POSITION_RESPONSE"});
     inventory.accounts[a.identity.brokerAccountLabel]={strategy:a.identity.strategy,status:"NOT_VERIFIED",futures:[]};continue;}
   const all=match.securitiesAccount?.positions||[];
   const futures=all.filter(p=>str(p.instrument?.assetType)==="FUTURE" ||
     /^\/?(MES|ES)[FGHJKMNQUVXZ]\d{1,2}/.test(str(p.instrument?.symbol)));
   inventory.accounts[a.identity.brokerAccountLabel]={
     strategy:a.identity.strategy,
     positionRecordsReturned:all.length,
     futures:futures.map(p=>({symbol:p.instrument?.symbol||null,
       longQuantity:p.longQuantity??null,shortQuantity:p.shortQuantity??null,
       averagePrice:p.averagePrice??p.averageLongPrice??p.averageShortPrice??null,
       costBasis:p.averagePrice??null})),
     status:futures.length?"BROKER_POSITION_RECORDS_PRESENT":"NO_FUTURES_RECORDS_RETURNED_NOT_PROOF_OF_FLAT"
   };
 }
}catch(e){errors.push({reason:"POSITIONS_API_FAILED",details:String(e?.message||e).slice(0,220)});}
records.sort((a,b)=>Date.parse(a.fillTimeUtc)-Date.parse(b.fillTimeUtc));
closedToday.sort((a,b)=>Date.parse(a.fillTimeUtc)-Date.parse(b.fillTimeUtc));
const evidence={schema:"engine8.oct23SevenRealBrokerReconciliation.v1",
  queryStartUtc:START,queryEndUtc:END,cutoverUtc:"2026-10-22T07:00:00.000Z",
  sevenAccountsDiscovered:selection.approved.length,byAccount,
  executions:records,oct23ClosingLegs:closedToday,inventory,
  duplicateIdentities,errors,readOnly:true};
const output="/tmp/engine8-oct23-seven-real-"+Date.now()+".json";
fs.writeFileSync(output,JSON.stringify(evidence,null,2),{flag:"wx",mode:0o600});
fs.chmodSync(output,0o600);
const sha=crypto.createHash("sha256").update(fs.readFileSync(output)).digest("hex");
console.log(JSON.stringify({
 status:errors.length||duplicateIdentities.length?"REQUIRES_INVESTIGATION":"BROKER_EVIDENCE_COLLECTED",
 evidencePath:output,sha256:sha,queryStartUtc:START,queryEndUtc:END,
 discovered:selection.approved.length,
 normalizedFillLegs:records.length,
 byAccount:Object.fromEntries(Object.entries(byAccount).map(([k,v])=>[k,{
  strategy:v.strategy,transactions:v.transactions,normalizedFillLegs:v.normalizedFillLegs,
  openingLegs:v.openingLegs,closingLegs:v.closingLegs,closingLegsOct23:v.closingLegsOct23,
  engine10Acknowledged:v.engine10Acknowledged,notAcknowledged:v.notAcknowledged,
  notObserved:v.notObserved,duplicateIdentities:v.duplicateIdentities,
  normalizationErrors:v.normalizationErrors
 }])),
 oct23ClosingExecutions:closedToday.map(f=>({
  account:f.brokerAccountLabel,strategy:f.strategy,id:f.brokerTransactionId,
  leg:f.brokerFillLegId,time:f.fillTimeUtc,contract:f.futuresContractCode,
  side:f.side,quantity:f.quantity,price:f.fillPrice,fees:f.totalFees,
  deliveryStatus:f.delivery.status
 })),
 inventory:inventory.accounts,errors,
 warning:"No FUTURES positions returned is NOT proof of a flat broker account. Full execution evidence remains private."},null,2));
if(errors.length||duplicateIdentities.length)process.exitCode=2;
