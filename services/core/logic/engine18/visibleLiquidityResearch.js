// Engine 18: evidence descriptors from a TRUSTED, reconstructed order book.
// Scores are relative concentration measures, not calibrated probabilities or trade signals.
export function summarizeEngine18VisibleLiquidity({ book, feed, currentPrice, topLevels=10 }={}) {
  if(!book||!feed||book.contractSymbol!==feed.contractSymbol) throw Error("ENGINE18_DEPTH_BASIS_MISMATCH");
  if(!Number.isFinite(currentPrice)||currentPrice<=0||!Number.isInteger(topLevels)||topLevels<1||topLevels>100) throw Error("ENGINE18_DEPTH_INVALID_ARGUMENT");
  const trusted = feed.liquidityDataUsable===true && book.usableForLiquidityInference===true &&
    book.seeded===true && book.gapDetected===false && book.crossedBook===false;
  if(!trusted) return {schema:"engine18.visibleLiquidity.v1",contractSymbol:book.contractSymbol,usable:false,
    reason:"UNTRUSTED_BOOK_OR_FEED",levels:[],noExecution:true};
  const bid=Array.isArray(book.bids)?book.bids.slice(0,topLevels):[];
  const ask=Array.isArray(book.asks)?book.asks.slice(0,topLevels):[];
  const selected=[...bid.map(x=>({...x,side:"BID"})),...ask.map(x=>({...x,side:"ASK"}))];
  if(!selected.length) return {schema:"engine18.visibleLiquidity.v1",contractSymbol:book.contractSymbol,usable:false,
    reason:"EMPTY_ORDER_BOOK",levels:[],noExecution:true};
  if(selected.some(x=>!Number.isInteger(x.priceTicks)||!Number.isSafeInteger(x.quantity)||x.quantity<=0))
    throw Error("ENGINE18_DEPTH_INVALID_LEVEL");
  const maxQty=Math.max(...selected.map(x=>x.quantity));
  const levels=selected.map(x=>({
    side:x.side,price:x.priceTicks*0.25,quantity:x.quantity,
    distanceTicks:Math.round(Math.abs(x.priceTicks*0.25-currentPrice)/0.25),
    relativeDepth:x.quantity/maxQty,
    observedSource:"DISPLAYED_ORDER_BOOK",isHiddenStopEvidence:false
  })).sort((a,b)=>b.relativeDepth-a.relativeDepth||a.distanceTicks-b.distanceTicks);
  return {schema:"engine18.visibleLiquidity.v1",contractSymbol:book.contractSymbol,
    usable:true,asOfEventTimeNs:book.lastEventTimeNs,levels,
    noExecution:true,calibratedProbability:false,
    limitations:["Displayed liquidity can be canceled immediately","Relative depth is not a prediction probability"]};
}
