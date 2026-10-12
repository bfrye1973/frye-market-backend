// Durable isolated PAPER account registry. This does not create trades or journal records.
import fs from "node:fs";
import path from "node:path";
import {
  PAPER_DATA_DIR,atomicPaperWrite,withPaperInstructionLock
} from "./engine8PaperDurableStore.js";
import {
  MANUAL_PAPER_DEGREES,makeInitialManualPaperAccounts,
  validateManualPaperAccountRegistry
} from "./manualPaperAccountRegistry.js";

const ACCOUNT_FILE=path.join(PAPER_DATA_DIR,"manual-paper-accounts-v1.json");
function readExisting() {
  if (!fs.existsSync(ACCOUNT_FILE)) return null;
  const raw=fs.readFileSync(ACCOUNT_FILE,"utf8");
  return validateManualPaperAccountRegistry(JSON.parse(raw));
}
export function getManualPaperAccounts() {
  const snapshot=readExisting();
  if(!snapshot) return {
    ok:false,initialized:false,reason:"MANUAL_PAPER_ACCOUNTS_NOT_INITIALIZED",
    definitions:MANUAL_PAPER_DEGREES,accounts:[],combinedStartingCapital:70000
  };
  return {ok:true,initialized:true,version:snapshot.version,
    initializedAt:snapshot.initializedAt,accounts:snapshot.accounts,
    combinedStartingCapital:snapshot.combinedStartingCapital};
}
export async function initializeManualPaperAccounts() {
  // Explicit admin-only route must invoke this. Never initialize on GET/restart.
  return withPaperInstructionLock("__ENGINE8_PAPER_GLOBAL_WRITE__",async()=>{
    const previous=readExisting();
    if(previous) return {ok:true,alreadyInitialized:true,created:false,
      accounts:previous.accounts,combinedStartingCapital:70000};
    // Exact one-shot exclusive creation; no replacement if another process won.
    const snapshot=makeInitialManualPaperAccounts();
    validateManualPaperAccountRegistry(snapshot);
    fs.mkdirSync(PAPER_DATA_DIR,{recursive:true});
    const fd=fs.openSync(ACCOUNT_FILE,"wx",0o600);
    try {
      fs.writeFileSync(fd,JSON.stringify(snapshot,null,2),"utf8");
      fs.fsyncSync(fd);
    } finally {fs.closeSync(fd);}
    const check=readExisting();
    return {ok:true,created:true,alreadyInitialized:false,
      accounts:check.accounts,combinedStartingCapital:70000};
  });
}
export function readManualPaperAccount(accountId) {
  const state=getManualPaperAccounts();
  if(!state.ok)return state;
  const account=state.accounts.find(a=>a.accountId===accountId);
  return account?{ok:true,account}:{ok:false,reason:"UNKNOWN_MANUAL_PAPER_ACCOUNT"};
}
