// Engine 8 manual PAPER execution. NO Schwab imports, NO automated signal inputs.
// Persistent Engine 8 fill envelope -> Engine 10 authoritative journal / FIFO.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {PAPER_DATA_DIR,atomicPaperWrite,withPaperInstructionLock} from "./engine8PaperDurableStore.js";
import {getManualPaperAccounts} from "./manualPaperAccountStore.js";
import {validateManualPaperInstruction} from "./validateManualPaperInstruction.js";
import {getManualPaperRiskPolicy} from "./manualPaperAccountRegistry.js";
import {
  readEngine10ManualPaperAccounts,applyEngine10ManualPaperFill
} from "../journal/manualPaperAccountJournal.js";

const FILE=path.join(PAPER_DATA_DIR,"manual-paper-instructions-v1.json");
let testJournalHook=null;
export function setManualPaperJournalHookForTests(hook){
  if(process.env.NODE_ENV!=="test")throw Error("TEST_HOOK_FORBIDDEN");
  testJournalHook=hook;
}
function delivery(fill){
  return process.env.NODE_ENV==="test" && testJournalHook
    ? testJournalHook(fill,applyEngine10ManualPaperFill)
    : applyEngine10ManualPaperFill(fill);
}
const clone=x=>JSON.parse(JSON.stringify(x));
function load(){
  if(!fs.existsSync(FILE))return {version:1,requests:{}};
  const raw=JSON.parse(fs.readFileSync(FILE,"utf8"));
  if(raw?.version!==1 || !raw.requests || Array.isArray(raw.requests) ||
     typeof raw.requests!=="object")throw Error("MANUAL_PAPER_INSTRUCTIONS_CORRUPT");
  return raw;
}
function save(raw){atomicPaperWrite(FILE,raw);}
const reject=reason=>({ok:false,rejected:true,reason});
async function exclusively(key,op){
  return withPaperInstructionLock("__ENGINE8_PAPER_GLOBAL_WRITE__",()=>
    withPaperInstructionLock(key,op));
}
export function getManualPaperAccountsOverview(){
  const initialized=getManualPaperAccounts();
  if(!initialized.ok) return {ok:true,initialized:false,accounts:[],
    totalEquity:null,startingCapital:70000,reason:initialized.reason,
    warning:"PAPER ACCOUNTS NOT INITIALIZED"};
  const journal=readEngine10ManualPaperAccounts();
  const saved=load();
  const accounts=initialized.accounts.map(def=>{
    const pending=Object.values(saved.requests).filter(r=>r.accountId===def.accountId &&
      r.status!=="JOURNAL_COMPLETE");
    return {...def,...journal.accounts[def.accountId],pendingJournalInstructions:pending.length,
      tradingBlocked:pending.length>0};
  });
  return {ok:true,initialized:true,accountMode:"PAPER",riskPolicy:getManualPaperRiskPolicy(),accounts,
    startingCapital:70000,totalEquity:accounts.reduce((n,a)=>n+a.equity,0),
    pendingJournalInstructions:accounts.reduce((n,a)=>n+a.pendingJournalInstructions,0),
    warning:"PAPER ONLY — NO REAL BROKER ORDERS"};
}
export async function executeManualPaperInstruction(instruction) {
  const key=String(instruction?.idempotencyKey||"").trim();
  if(key.length<8)return reject("MISSING_MANUAL_REQUEST_ID");
  return exclusively(key,async()=>{
    if(process.env.ENGINE8_KILL_SWITCH==="1")return reject("KILL_SWITCH");
    if(instruction?.ownerConfirmation!=="CONFIRM_PAPER")return reject("EXPLICIT_OWNER_CONFIRMATION_REQUIRED");
    const state=load();
    if(state.requests[key]){
      const prior=state.requests[key];
      return {ok:prior.status==="JOURNAL_COMPLETE",duplicate:true,
        reason:"ORIGINAL_INSTRUCTION_ALREADY_RECORDED",
        executionId:prior.executionId,orderId:prior.orderId,
        journalStatus:prior.status};
    }
    const overview=getManualPaperAccountsOverview();
    if(!overview.ok||!overview.initialized)return reject("MANUAL_PAPER_ACCOUNTS_NOT_INITIALIZED");
    const account=overview.accounts.find(a=>a.accountId===instruction?.accountId);
    if(!account)return reject("UNKNOWN_MANUAL_PAPER_ACCOUNT");
    if(account.tradingBlocked)return reject("ACCOUNT_JOURNAL_RECONCILIATION_REQUIRED");
    const v=validateManualPaperInstruction(instruction,account);
    if(!v.ok)return v;
    const executionId="MPE-"+crypto.randomUUID();
    const orderId="MPO-"+crypto.randomUUID();
    const fill={accountId:v.accountId,idempotencyKey:key,executionId,orderId,
      symbol:v.symbol,root:v.root,side:v.side,qty:v.qty,price:v.price,
      opening:v.opening,multiplier:v.multiplier,fee:v.fee,
      marginRequired:v.marginRequired||0,accountMode:"PAPER",paper:true,
      manual:true};
    state.requests[key]={idempotencyKey:key,accountId:v.accountId,
      orderId,executionId,fill,status:"RESERVED",createdAt:new Date().toISOString()};
    save(state);
    // This commits ONE original simulated fill envelope before Engine 10.
    state.requests[key].status="JOURNAL_PENDING";
    save(state);
    try{
      const result=await delivery(clone(fill));
      if(!result?.ok||!result.tradeId)throw Error("ENGINE10_ACKNOWLEDGMENT_MISSING");
      const current=load();
      if(current.requests[key]?.executionId!==executionId)
        throw Error("ORIGINAL_EXECUTION_IDENTITY_CHANGED");
      current.requests[key].status="JOURNAL_COMPLETE";
      current.requests[key].tradeId=result.tradeId;
      current.requests[key].contractIds=result.contractIds||[];
      current.requests[key].journalAcknowledgedAt=new Date().toISOString();
      save(current);
      return {ok:true,accountId:v.accountId,executionId,orderId,
        tradeId:result.tradeId,contractIds:result.contractIds,
        journalStatus:"JOURNAL_COMPLETE",duplicate:false,fill};
    }catch{
      return {ok:false,accountId:v.accountId,executionId,orderId,
        journalStatus:"JOURNAL_PENDING",reason:"ENGINE10_JOURNAL_ACK_PENDING",
        noDuplicateFill:true};
    }
  });
}
export async function retryManualPaperJournalOnly({idempotencyKey}={}){
  const key=String(idempotencyKey||"").trim();
  if(!key)return reject("MISSING_MANUAL_REQUEST_ID");
  return exclusively(key,async()=>{
    const state=load(),original=state.requests[key];
    if(!original)return reject("ORIGINAL_MANUAL_PAPER_INSTRUCTION_NOT_FOUND");
    if(original.status==="JOURNAL_COMPLETE")
      return {ok:true,duplicate:true,journalStatus:"JOURNAL_COMPLETE",
        executionId:original.executionId,tradeId:original.tradeId};
    if(original.status!=="JOURNAL_PENDING"||!original.fill)
      return reject("AMBIGUOUS_PAPER_FILL_REQUIRES_RECONCILIATION");
    try{
      const result=await delivery(clone(original.fill));
      if(!result?.ok||!result.tradeId)throw Error("ENGINE10_ACKNOWLEDGMENT_MISSING");
      const latest=load();
      if(latest.requests[key]?.executionId!==original.executionId)
        return reject("ORIGINAL_EXECUTION_IDENTITY_CHANGED");
      latest.requests[key].status="JOURNAL_COMPLETE";
      latest.requests[key].tradeId=result.tradeId;
      latest.requests[key].contractIds=result.contractIds||[];
      latest.requests[key].journalAcknowledgedAt=new Date().toISOString();
      save(latest);
      return {ok:true,journalStatus:"JOURNAL_COMPLETE",duplicate:result.duplicate===true,
        executionId:original.executionId,orderId:original.orderId,
        accountId:original.accountId,tradeId:result.tradeId};
    }catch{
      return {ok:false,journalStatus:"JOURNAL_PENDING",
        reason:"ENGINE10_JOURNAL_ACK_PENDING",executionId:original.executionId};
    }
  });
}
