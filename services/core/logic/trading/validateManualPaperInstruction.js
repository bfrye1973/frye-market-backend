// Pure manual futures order validation; no automated strategy engine is consulted.
import {
  getManualPaperAccountDefinition,validateFuturesContract,getManualPaperRiskPolicy,
} from "./manualPaperAccountRegistry.js";

const ACTIONS = new Set(["BUY","SELL","REDUCE","CLOSE"]);
const INTENTS = new Set(["OPEN_LONG","OPEN_SHORT","CLOSE_LONG","CLOSE_SHORT"]);
function reject(reason){return {ok:false,rejected:true,reason};}
export function validateManualPaperInstruction(input, account, policy=getManualPaperRiskPolicy()) {
  if(!account || !getManualPaperAccountDefinition(account.accountId) ||
    account.accountMode!=="PAPER")return reject("UNKNOWN_OR_INACTIVE_PAPER_ACCOUNT");
  if(String(input?.accountId||"")!==account.accountId)return reject("ACCOUNT_IDENTITY_MISMATCH");
  const requestId=String(input?.idempotencyKey||"").trim();
  if(requestId.length<8 || requestId.length>160)return reject("INVALID_REQUEST_IDENTITY");
  const action=String(input?.action||"").trim().toUpperCase();
  const intent=String(input?.intent||"").trim().toUpperCase();
  if(!ACTIONS.has(action)||!INTENTS.has(intent))return reject("INVALID_MANUAL_ACTION_INTENT");
  if((intent==="OPEN_LONG" && action!=="BUY") ||
     (intent==="OPEN_SHORT" && action!=="SELL") ||
     (intent==="CLOSE_LONG" && !["REDUCE","CLOSE","SELL"].includes(action)) ||
     (intent==="CLOSE_SHORT" && !["REDUCE","CLOSE","BUY"].includes(action)))
      return reject("SIDE_AND_INTENT_CONFLICT");
  if(input?.paper===false || input?.real===true || input?.live===true ||
    ["REAL","LIVE"].includes(String(input?.accountMode||"").toUpperCase()))
      return reject("PAPER_ONLY_ENFORCED");
  const fut=validateFuturesContract(input?.contract,input?.price,input?.qty);
  if(!fut.ok)return reject(fut.reason);
  const opening=intent.startsWith("OPEN_");
  const positions=account.positions||{};
  const active=positions[fut.symbol]||null;
  if(opening){
    const desiredSide=intent==="OPEN_LONG"?"LONG":"SHORT";
    if(active && active.qty>0 && active.side!==desiredSide)return reject("POSITION_REVERSAL_FORBIDDEN");
    const openCount=Object.values(positions).reduce((s,p)=>s+(Number(p.qty)||0),0);
    if(openCount+fut.qty>policy.maxContractsPerAccount)return reject("ACCOUNT_POSITION_LIMIT_EXCEEDED");
    const margin=policy.simulatedInitialMargin[fut.root]*fut.qty;
    if(!Number.isFinite(margin)||margin<=0)return reject("MARGIN_POLICY_UNAVAILABLE");
    const available=Number(account.cashBalance)-Number(account.marginUsed||0);
    const fees=policy.feePerContractPerSide[fut.root]*fut.qty;
    if(!Number.isFinite(available)||available<margin+fees)return reject("INSUFFICIENT_SIMULATED_BUYING_POWER");
    return {ok:true,requestId,accountId:account.accountId,action,intent,
      ...fut,side:desiredSide,opening:true,marginRequired:margin,fee:fees,policyVersion:policy.policyVersion};
  }
  const expectedSide=intent==="CLOSE_LONG"?"LONG":"SHORT";
  if(!active || active.side!==expectedSide || !Number.isSafeInteger(active.qty) ||
     active.qty<fut.qty)return reject("CLOSE_QUANTITY_EXCEEDS_OWNED_POSITION");
  if(action==="CLOSE" && fut.qty!==active.qty)return reject("CLOSE_REQUIRES_FULL_QUANTITY");
  const fee=policy.feePerContractPerSide[fut.root]*fut.qty;
  return {ok:true,requestId,accountId:account.accountId,action,intent,
    ...fut,side:expectedSide,opening:false,fee,policyVersion:policy.policyVersion};
}
