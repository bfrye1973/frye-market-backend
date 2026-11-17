// Read-only Engine 10 OPEN PAPER lifecycle adapter.
// A missing/unreadable journal is NOT evidence that an existing trade closed.
// The adapter does not write to Engine 10, Engine 3, or permission.
export function resolveEngine10OpenPaperDirection({
  trades=null,symbol="ES",strategyId="intraday_scalp@10m",readSucceeded=true,
}={}){
 const fail=(reasonCode)=>({openTradeActive:false,lockedTradeDirection:"NEUTRAL",
   source:"ENGINE10_JOURNAL",reasonCode,blocker:true,lifecycleVerified:false});
 if(readSucceeded!==true||!Array.isArray(trades))return fail("ENGINE10_OPEN_TRADE_READ_UNVERIFIED");
 const matches=trades.filter(t=>
   t?.status==="OPEN"&&t?.accountMode==="PAPER"&&t?.symbol===symbol&&
   t?.strategyId===strategyId);
 if(matches.length===0)return {openTradeActive:false,lockedTradeDirection:"NEUTRAL",
   source:"ENGINE10_JOURNAL",reasonCode:"NO_OPEN_PAPER_TRADE",blocker:false,lifecycleVerified:true};
 // Multiple OPEN records may be independent positions, not duplicate readings.
 // Never choose a direction without an explicit position identity policy.
 if(matches.length!==1)return fail("MULTIPLE_OPEN_PAPER_TRADES_REQUIRE_IDENTITY_RESOLUTION");
 const direction=String(matches[0]?.direction??"").toUpperCase();
 if(!["LONG","SHORT"].includes(direction))return fail("INVALID_OPEN_PAPER_DIRECTION");
 return {openTradeActive:true,lockedTradeDirection:direction,
   source:"ENGINE10_JOURNAL",reasonCode:"OPEN_PAPER_TRADE_DIRECTION_VERIFIED",
   blocker:false,lifecycleVerified:true,tradeId:matches[0]?.tradeId??null};
}
export default resolveEngine10OpenPaperDirection;
