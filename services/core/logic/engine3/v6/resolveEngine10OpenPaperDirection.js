// Engine 10 Journal is the sole source of OPEN PAPER lifecycle truth.
// Refuse ambiguous/opposed records; never infer a trade from Engine 3 direction.
export function resolveEngine10OpenPaperDirection({
  trades=null,symbol="ES",strategyId="intraday_scalp@10m",
}={}){
 const matches=(Array.isArray(trades)?trades:[]).filter(t=>
   t?.status==="OPEN"&&t?.accountMode==="PAPER"&&t?.symbol===symbol&&
   t?.strategyId===strategyId);
 const directions=[...new Set(matches.map(t=>String(t?.direction??"").toUpperCase()))];
 if(matches.length===0)return {openTradeActive:false,lockedTradeDirection:"NEUTRAL",
   source:"ENGINE10_JOURNAL",reasonCode:"NO_OPEN_PAPER_TRADE"};
 if(directions.length!==1||!["LONG","SHORT"].includes(directions[0]))return {
   openTradeActive:false,lockedTradeDirection:"NEUTRAL",source:"ENGINE10_JOURNAL",
   reasonCode:"AMBIGUOUS_OR_INVALID_OPEN_PAPER_TRADE_DIRECTION",blocker:true};
 return {openTradeActive:true,lockedTradeDirection:directions[0],
   source:"ENGINE10_JOURNAL",reasonCode:"OPEN_PAPER_TRADE_DIRECTION_VERIFIED"};
}
export default resolveEngine10OpenPaperDirection;
