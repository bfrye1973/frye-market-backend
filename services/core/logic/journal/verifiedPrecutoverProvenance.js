// Engine 10B: pure, read-only pre-cutover provenance planner.
// Only exact owner-approved campaign identities may receive explicit provenance.
import {classifyRealCampaignAtEntry} from "./realAccountClassification.js";

const EXPECTED=Object.freeze([
  Object.freeze({tradeId:"TRD-MES-schwab_real_broker-2026-10-22T05-30-35+0000-90dc",
    account:"SCHWAB_7727",transaction:"134185163978",time:"2026-10-22T05:30:35.000Z",group:"SUBMINUTE"}),
  Object.freeze({tradeId:"TRD-MES-schwab_real_broker-2026-10-22T06-29-15+0000-d892",
    account:"SCHWAB_3914",transaction:"134186181985",time:"2026-10-22T06:29:15.000Z",group:"MINUTE"}),
]);
const txt=x=>String(x??"").trim();
const up=x=>txt(x).toUpperCase();
const time=x=>{const t=Date.parse(txt(x));return Number.isFinite(t)?new Date(t).toISOString():null;};

export function planVerifiedPrecutoverProvenance(trades){
  if(!Array.isArray(trades))return {ok:false,errors:["NOT_A_JOURNAL_ARRAY"],changes:[]};
  const errors=[],changes=[];
  const seen=new Set();
  for(const e of EXPECTED){
    const matches=trades.filter(t=>t?.tradeId===e.tradeId);
    if(matches.length!==1){errors.push({tradeId:e.tradeId,reason:"EXPECTED_UNIQUE_CAMPAIGN",count:matches.length});continue;}
    const t=matches[0];
    const account=up(t.brokerAccountLabel||t.realBroker?.brokerAccountLabel);
    const entryId=txt(t.entry?.brokerTransactionId||t.events?.find(v=>v.eventType==="REAL_ENTRY_FILL")?.brokerTransactionId);
    const entryTime=time(t.entry?.time);
    const contractIds=(t.realBroker?.contracts||[]).map(c=>txt(c.contractId));
    const identityOk=up(t.accountMode)==="REAL" && account===e.account &&
      entryId===e.transaction && entryTime===e.time &&
      up(t.performanceGroup)===e.group &&
      contractIds.length===1 && contractIds[0].includes("|CTR|"+e.transaction+"|");
    const approved=classifyRealCampaignAtEntry({brokerAccountLabel:account,brokerTransactionId:entryId,entryTime});
    if(!identityOk||!approved.ok||approved.classification!==e.group||
       approved.source!=="VERIFIED_PRECUTOVER_ACCOUNT_EXCEPTION"){
      errors.push({tradeId:e.tradeId,reason:"IDENTITY_OR_EXCEPTION_CONTRACT_MISMATCH"});
      continue;
    }
    if(seen.has(e.tradeId)){errors.push({tradeId:e.tradeId,reason:"DUPLICATE_TARGET"});continue;}
    seen.add(e.tradeId);
    if(t.performanceClassificationSource==="VERIFIED_PRECUTOVER_ACCOUNT_EXCEPTION" &&
       t.performanceClassificationVersion===approved.registryVersion)continue;
    if(t.performanceClassificationSource!=="LEGACY_COMPATIBILITY"){
      errors.push({tradeId:e.tradeId,reason:"UNEXPECTED_EXISTING_PROVENANCE"});continue;
    }
    changes.push({tradeId:e.tradeId,from:t.performanceClassificationSource,
      to:approved.source,version:approved.registryVersion});
  }
  return {ok:errors.length===0,changes,errors,expectedCampaigns:EXPECTED.length,readOnly:true};
}
export function applyVerifiedPrecutoverProvenanceToCopy(trades,plan){
  if(!plan?.ok)throw Error("UNVERIFIED_PRECUTOVER_PROVENANCE_PLAN");
  const before=planVerifiedPrecutoverProvenance(trades);
  if(!before.ok||JSON.stringify(before.changes)!==JSON.stringify(plan.changes))
    throw Error("STALE_PRECUTOVER_PROVENANCE_PLAN");
  const result=structuredClone(trades);
  for(const c of plan.changes){
    const t=result.find(x=>x.tradeId===c.tradeId);
    t.performanceClassificationSource=c.to;
    t.performanceClassificationVersion=c.version;
  }
  return result;
}
