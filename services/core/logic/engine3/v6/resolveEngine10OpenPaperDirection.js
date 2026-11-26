// Read-only Engine 10 OPEN PAPER lifecycle adapter.
// Never interpret a failed/ambiguous journal read as an explicit trade close.
// The prior lock is advisory continuity for an already VERIFIED Engine10 fill;
// the Manager must explicitly approve canonical v5 use before a merge.
export function resolveEngine10OpenPaperDirection({
 trades=null,symbol="ES",strategyId="intraday_scalp@10m",
 readSucceeded=true,priorVerifiedLock=null,evaluationTimeMs=null,
 lockTtlMs=10*60*1000,
}={}){
 const now=typeof evaluationTimeMs==="number"&&Number.isFinite(evaluationTimeMs)?evaluationTimeMs:null;
 const prior=priorVerifiedLock;
 const priorTime=typeof prior?.verifiedAtMs==="number"&&Number.isFinite(prior.verifiedAtMs)
   ?prior.verifiedAtMs:null;
 const validPrior=prior?.source==="ENGINE10_JOURNAL"&&prior?.symbol===symbol&&
   prior?.strategyId===strategyId&&typeof prior?.tradeId==="string"&&
   prior.tradeId.length>0&&["LONG","SHORT"].includes(prior?.lockedTradeDirection)&&
   typeof prior?.remainingQty==="number"&&Number.isFinite(prior.remainingQty)&&prior.remainingQty>0&&
   priorTime!==null&&now!==null&&now>=priorTime&&
   now-priorTime<=lockTtlMs&&Number.isFinite(lockTtlMs)&&lockTtlMs>0;
 const fail=(reasonCode)=>{
  if(validPrior)return {openTradeActive:true,lockedTradeDirection:prior.lockedTradeDirection,
   tradeId:prior.tradeId,remainingQty:prior.remainingQty,
   source:"ENGINE10_JOURNAL",symbol,strategyId,blocker:true,lifecycleVerified:false,
   fallbackFromVerified:true,lockAgeMs:now-priorTime,reasonCode:reasonCode+"_HELD_RECENT_VERIFIED_LOCK"};
  return {openTradeActive:false,lockedTradeDirection:"NEUTRAL",
   source:"ENGINE10_JOURNAL",symbol,strategyId,blocker:true,lifecycleVerified:false,
   fallbackFromVerified:false,reasonCode:prior?"VERIFIED_LOCK_EXPIRED_OR_INVALID_"+reasonCode:reasonCode};
 };
 if(readSucceeded!==true||!Array.isArray(trades))
   return fail("ENGINE10_OPEN_TRADE_READ_UNVERIFIED");
 const matches=trades.filter(t=>
   t?.status==="OPEN"&&t?.accountMode==="PAPER"&&t?.symbol===symbol&&
   t?.strategyId===strategyId);
 if(matches.length===0)return {openTradeActive:false,lockedTradeDirection:"NEUTRAL",
   source:"ENGINE10_JOURNAL",symbol,strategyId,reasonCode:"NO_OPEN_PAPER_TRADE",
   blocker:false,lifecycleVerified:true,fallbackFromVerified:false};
 // Multiple OPEN records may be independently owned positions.
 // Do not select an arbitrary direction; hold only a recent previously verified lock.
 if(matches.length!==1)return fail("MULTIPLE_OPEN_PAPER_TRADES_REQUIRE_IDENTITY_RESOLUTION");
 const trade=matches[0];
 const remaining=trade?.qty?.remainingQty;
 if(typeof trade?.tradeId!=="string"||!trade.tradeId.trim()||
    typeof remaining!=="number"||!Number.isFinite(remaining)||remaining<=0)
   return fail("OPEN_PAPER_TRADE_IDENTITY_OR_QUANTITY_UNVERIFIED");
 const direction=String(trade?.direction??"").toUpperCase();
 if(!["LONG","SHORT"].includes(direction))return fail("INVALID_OPEN_PAPER_DIRECTION");
 return {openTradeActive:true,lockedTradeDirection:direction,
   source:"ENGINE10_JOURNAL",symbol,strategyId,
   reasonCode:"OPEN_PAPER_TRADE_DIRECTION_VERIFIED",
   blocker:false,lifecycleVerified:true,fallbackFromVerified:false,
   verifiedAtMs:now,tradeId:trade.tradeId,remainingQty:remaining};
}
export default resolveEngine10OpenPaperDirection;
