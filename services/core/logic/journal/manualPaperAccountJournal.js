// Engine 10 — additive MANUAL PAPER account contract journal.
// Strictly separate from REAL Schwab and the existing trade-journal.json.
// Engine 8 owns execution identities; Engine 10 owns contract IDs, FIFO and P&L.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {PAPER_DATA_DIR,atomicPaperWrite} from "../trading/engine8PaperDurableStore.js";
import {MANUAL_PAPER_DEGREES,getManualPaperRiskPolicy} from "../trading/manualPaperAccountRegistry.js";

const FILE=path.join(PAPER_DATA_DIR,"manual-paper-engine10-journal-v1.json");
const VERSION="engine10.manualPaperAccounts.v1";
const round=v=>Math.round((Number(v)+Number.EPSILON)*100)/100;
const hash=s=>crypto.createHash("sha256").update(String(s)).digest("hex").slice(0,24);
function empty() {return {version:VERSION,createdAt:new Date().toISOString(),
  accounts:Object.fromEntries(MANUAL_PAPER_DEGREES.map(a=>[a.accountId,{
    executions:[],contracts:[],highWaterEquity:10000,initialCapital:10000
  }]))};}
function check(raw){
  if(!raw || raw.version!==VERSION || !raw.accounts || typeof raw.accounts!=="object" ||
    Object.keys(raw.accounts).length!==7)throw Error("ENGINE10_MANUAL_PAPER_JOURNAL_CORRUPT");
  for(const a of MANUAL_PAPER_DEGREES){
    const row=raw.accounts[a.accountId];
    if(!row || !Array.isArray(row.executions) || !Array.isArray(row.contracts) ||
      !Number.isFinite(row.highWaterEquity)||row.initialCapital!==10000)
      throw Error("ENGINE10_MANUAL_PAPER_JOURNAL_ACCOUNT_CORRUPT");
  }
  return raw;
}
export function readEngine10ManualPaperJournal(){
  if(!fs.existsSync(FILE))return null;
  return check(JSON.parse(fs.readFileSync(FILE,"utf8")));
}
function aggregates(row,marks={}){
  const policy=getManualPaperRiskPolicy();
  const open=row.contracts.filter(c=>c.status==="OPEN");
  const closed=row.contracts.filter(c=>c.status==="CLOSED");
  const fees=round(row.executions.reduce((s,x)=>s+x.fee,0));
  const grossRealized=round(closed.reduce((s,c)=>s+c.grossRealizedPnL,0));
  const realizedPnL=round(grossRealized-fees);
  const cashBalance=round(10000+realizedPnL);
  const marginUsed=round(open.reduce((s,c)=>s+policy.simulatedInitialMargin[c.root],0));
  const unrealizedPnL=round(open.reduce((s,c)=>{
    const mark=marks[c.symbol]??c.entryPrice;
    return s+(c.side==="LONG"?mark-c.entryPrice:c.entryPrice-mark)*c.multiplier;
  },0));
  const equity=round(cashBalance+unrealizedPnL);
  const wins=closed.filter(c=>c.grossRealizedPnL>0);
  const losses=closed.filter(c=>c.grossRealizedPnL<0);
  const grossWins=round(wins.reduce((s,c)=>s+c.grossRealizedPnL,0));
  const grossLosses=round(-losses.reduce((s,c)=>s+c.grossRealizedPnL,0));
  const positions={};
  for(const c of open){
    const existing=positions[c.symbol]||{symbol:c.symbol,side:c.side,qty:0,averageEntryPrice:0};
    existing.averageEntryPrice=(existing.averageEntryPrice*existing.qty+c.entryPrice)/(existing.qty+1);
    existing.qty++;
    positions[c.symbol]=existing;
  }
  for(const p of Object.values(positions))p.averageEntryPrice=round(p.averageEntryPrice);
  return {startingCapital:10000,cashBalance,realizedPnL,unrealizedPnL,equity,
    marginUsed,availableFunds:round(cashBalance-marginUsed),feesPaid:fees,
    openContracts:open.length,openTrades:new Set(open.map(c=>c.tradeId)).size,
    positions,closedContracts:closed.length,winningContracts:wins.length,
    losingContracts:losses.length,winPercentage:closed.length?round(wins.length/closed.length*100):0,
    profitFactor:grossLosses>0?round(grossWins/grossLosses):null,
    highWaterEquity:row.highWaterEquity,
    currentDrawdown:round(Math.max(0,row.highWaterEquity-equity)),
    executions:row.executions};
}
export function readEngine10ManualPaperAccounts(){
  const raw=readEngine10ManualPaperJournal();
  if(!raw)return {ok:true,empty:true,accounts:Object.fromEntries(MANUAL_PAPER_DEGREES.map(a=>
    [a.accountId,aggregates({contracts:[],executions:[],highWaterEquity:10000})]))};
  return {ok:true,empty:false,accounts:Object.fromEntries(MANUAL_PAPER_DEGREES.map(a=>
    [a.accountId,aggregates(raw.accounts[a.accountId])]))};
}
export function applyEngine10ManualPaperFill(fill){
  // CALLER MUST hold global persistent Engine 8 order lock.
  const {accountId,idempotencyKey,executionId,orderId,opening,side,
    symbol,root,price,qty,multiplier,fee,marginRequired}=fill||{};
  if(!MANUAL_PAPER_DEGREES.some(a=>a.accountId===accountId) ||
     !idempotencyKey || !executionId || !orderId ||
     !["LONG","SHORT"].includes(side) ||
     !/^(ES|MES)[HMUZ]\d{2}$/.test(String(symbol||"")) ||
     !Number.isSafeInteger(qty)||qty<=0||
     !Number.isFinite(price)||price<=0||
     !Number.isFinite(fee)||fee<0 ||
     ![5,50].includes(multiplier) || !["ES","MES"].includes(root)){
    throw Error("ENGINE10_MANUAL_FILL_INVALID");
  }
  const raw=readEngine10ManualPaperJournal()||empty();
  const row=raw.accounts[accountId];
  const duplicate=row.executions.find(e=>e.idempotencyKey===idempotencyKey);
  if(duplicate){
    if(duplicate.executionId!==executionId||duplicate.orderId!==orderId)
      throw Error("ENGINE10_MANUAL_IDENTITY_COLLISION");
    return {ok:true,duplicate:true,tradeId:duplicate.tradeId,
      executionId,orderId,journalStatus:"JOURNAL_COMPLETE",
      account:aggregates(row)};
  }
  const account=aggregates(row);
  let tradeId,contractIds=[];
  if(opening){
    const previous=account.positions[symbol];
    if(previous&&previous.side!==side)throw Error("ENGINE10_MANUAL_REVERSAL_FORBIDDEN");
    if(account.openContracts+qty>getManualPaperRiskPolicy().maxContractsPerAccount)
      throw Error("ENGINE10_POSITION_LIMIT");
    if(!Number.isFinite(marginRequired)||account.availableFunds<marginRequired+fee)
      throw Error("ENGINE10_INSUFFICIENT_MARGIN");
    tradeId="MPT-"+hash(accountId+"|"+executionId);
    for(let i=0;i<qty;i++){
      const contractId="MPC-"+hash(executionId+"|"+i);
      contractIds.push(contractId);
      row.contracts.push({contractId,tradeId,accountId,symbol,root,side,
        multiplier,entryPrice:price,entryExecutionId:executionId,
        entryOrderId:orderId,entryFee:round(fee/qty),
        entryAt:new Date().toISOString(),status:"OPEN",grossRealizedPnL:0});
    }
  }else{
    const candidates=row.contracts.filter(c=>c.status==="OPEN" && c.symbol===symbol && c.side===side)
      .sort((a,b)=>a.entryAt.localeCompare(b.entryAt)||a.contractId.localeCompare(b.contractId));
    if(candidates.length<qty)throw Error("ENGINE10_MANUAL_CLOSE_EXCEEDS_OPEN");
    contractIds=candidates.slice(0,qty).map(c=>c.contractId);
    tradeId=candidates[0].tradeId;
    for(const c of candidates.slice(0,qty)){
      c.status="CLOSED";c.exitPrice=price;c.exitExecutionId=executionId;
      c.exitOrderId=orderId;c.exitAt=new Date().toISOString();
      c.exitFee=round(fee/qty);
      c.grossRealizedPnL=round((side==="LONG"?price-c.entryPrice:c.entryPrice-price)*multiplier);
    }
  }
  const event={executionId,orderId,idempotencyKey,accountId,
    symbol,side,qty,price,opening,fee,tradeId,contractIds,at:new Date().toISOString()};
  row.executions.push(event);
  const projected=aggregates(row);
  row.highWaterEquity=Math.max(row.highWaterEquity,projected.equity);
  atomicPaperWrite(FILE,raw);
  return {ok:true,duplicate:false,journalStatus:"JOURNAL_COMPLETE",
    tradeId,contractIds,executionId,orderId,account:aggregates(row)};
}
