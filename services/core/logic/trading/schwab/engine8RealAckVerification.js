// Engine 8 — exact, read-only Engine 10 REAL fill identity verification.
// Never infer receipt from a broker parent ID alone when explicit legs differ.
// No Journal writes, broker orders, or watermark updates.
import fs from "node:fs";
const label=x=>String(x??"").trim().toUpperCase();
const val=x=>String(x??"").trim();
const num=x=>x===null||x===undefined||x===""?null:Number(x);
const time=x=>{const n=Date.parse(String(x??""));return Number.isFinite(n)?n:null;};
const ACCOUNT_BY_HISTORIC={SWING:"SCHWAB_0747",INTRADAY:"SCHWAB_6380"};
export const OCT23_ACK_REPAIR_IDS=Object.freeze([
 "134078717961","134080532535","134138034104"
]);
export function verifyEngine10RealFillIdentity(trades,fill){
 if(!Array.isArray(trades)||!fill||!val(fill.brokerTransactionId)||
    !val(fill.brokerAccountLabel))return {ok:false,reason:"IDENTITY_INPUT_INVALID"};
 const matches=[];
 for(const trade of trades){
  if(label(trade?.accountMode)!=="REAL")continue;
  const physical=label(trade.brokerAccountLabel||trade.realBroker?.brokerAccountLabel||
    ACCOUNT_BY_HISTORIC[label(trade.journalAccount)]);
  if(!physical||physical!==label(fill.brokerAccountLabel))continue;
  for(const event of trade.events||[]){
   if(val(event.brokerTransactionId)!==val(fill.brokerTransactionId))continue;
   if(event.brokerFillLegId&&fill.brokerFillLegId&&
      val(event.brokerFillLegId)!==val(fill.brokerFillLegId))continue;
   // Legacy parent-only events may match a leg-aware candidate only if its
   // original geometry can be independently proven; never match by parent alone.
   const p=num(event.price??event.fillPrice);
   const q=num(event.fillQuantity??event.qtyFilled??event.quantity);
   const ts=time(event.ts??event.fillTime);
   if(p===null||q===null||ts===null||num(fill.fillPrice)!==p||
      num(fill.quantity)!==q||time(fill.fillTime)!==ts)continue;
   if(label(event.broker||"SCHWAB")!=="SCHWAB")continue;
   if(event.futuresContractCode&&fill.futuresContractCode&&
      label(event.futuresContractCode)!==label(fill.futuresContractCode))continue;
   if(event.positionEffect&&fill.positionEffect&&
      label(event.positionEffect)!==label(fill.positionEffect))continue;
   if(event.side&&fill.side&&label(event.side)!==label(fill.side))continue;
   matches.push({tradeId:trade.tradeId,eventType:event.eventType,
     brokerTransactionId:event.brokerTransactionId,brokerFillLegId:event.brokerFillLegId||null});
  }
 }
 if(matches.length===1&&val(matches[0].tradeId))
   return {ok:true,confirmed:true,tradeId:matches[0].tradeId,match:matches[0]};
 return {ok:true,confirmed:false,reason:matches.length?"AMBIGUOUS_JOURNAL_IDENTITY":"NOT_IN_JOURNAL",matchCount:matches.length};
}
export function readEngine10JournalForRealAck(file=process.env.TRADE_JOURNAL_DIR
 ?process.env.TRADE_JOURNAL_DIR+"/trade-journal.json"
 :"/var/data/replay/journal/trade-journal.json"){
 const parsed=JSON.parse(fs.readFileSync(file,"utf8"));
 if(!Array.isArray(parsed))throw Error("ENGINE10_JOURNAL_NOT_ARRAY");
 return parsed;
}
