// Engine 18 internal normalized MBO simulator/reconstructor.
// This is NOT yet a Databento decoder or proof of live CME order-book access.
// Only consumes normalized events with verified contract, monotonic sequence and integer tick prices.
// A snapshot must be seeded from the vendor before interpreting real book levels.
export function reconstructEngine18OrderBook({ events, contractSymbol, seeded = false } = {}) {
  if (!/^ES[HMUZ]\d{1,2}$/.test(contractSymbol || "")) throw Error("ENGINE18_BOOK_EXPLICIT_ES_CONTRACT_REQUIRED");
  if (!Array.isArray(events)) throw Error("ENGINE18_BOOK_EVENTS_REQUIRED");
  if (events.length > 100000) throw Error("ENGINE18_BOOK_EVENT_LIMIT");
  const orders = new Map();
  let prevSeq = null;
  let lastEventTimeNs = null;
  let gapDetected = false;
  const actions = { ADD:0, MODIFY:0, CANCEL:0, FILL:0 };
  for (const e of events) {
    if (!e || e.contractSymbol !== contractSymbol) throw Error("ENGINE18_BOOK_CONTRACT_MISMATCH");
    if (!Number.isSafeInteger(e.sequence) || e.sequence < 0 ||
        typeof e.eventTimeNs !== "string" || !/^\\d{1,19}$/.test(e.eventTimeNs)) throw Error("ENGINE18_BOOK_INVALID_CLOCK_OR_SEQUENCE");
    if (prevSeq !== null && e.sequence <= prevSeq) throw Error("ENGINE18_BOOK_OUT_OF_ORDER");
    if (lastEventTimeNs !== null && BigInt(e.eventTimeNs) < BigInt(lastEventTimeNs)) throw Error("ENGINE18_BOOK_OUT_OF_ORDER_TIME");
    if (prevSeq !== null && e.sequence !== prevSeq + 1) gapDetected = true;
    prevSeq=e.sequence;lastEventTimeNs=e.eventTimeNs;
    const id=String(e.orderId || "");
    if (!id) throw Error("ENGINE18_BOOK_ORDER_ID_REQUIRED");
    if (!Object.hasOwn(actions,e.action)) throw Error("ENGINE18_BOOK_UNSUPPORTED_ACTION");
    actions[e.action]++;
    const old=orders.get(id);
    if (e.action === "ADD") {
      if (old) throw Error("ENGINE18_BOOK_DUPLICATE_ORDER");
      if (!["BID","ASK"].includes(e.side) || !Number.isSafeInteger(e.priceTicks) ||
          !Number.isSafeInteger(e.quantity) || e.quantity <= 0) throw Error("ENGINE18_BOOK_INVALID_ADD");
      orders.set(id,{side:e.side,priceTicks:e.priceTicks,quantity:e.quantity});
    } else {
      if (!old) throw Error("ENGINE18_BOOK_UNKNOWN_ORDER");
      if (e.action === "CANCEL") {
        orders.delete(id);
      } else if (e.action === "MODIFY") {
        if (!Number.isSafeInteger(e.quantity) || e.quantity <= 0 ||
            (e.priceTicks != null && !Number.isSafeInteger(e.priceTicks))) throw Error("ENGINE18_BOOK_INVALID_MODIFY");
        orders.set(id,{...old,priceTicks:e.priceTicks ?? old.priceTicks,quantity:e.quantity});
      } else {
        if (!Number.isSafeInteger(e.quantity) || e.quantity <= 0 || e.quantity > old.quantity) throw Error("ENGINE18_BOOK_INVALID_FILL");
        if (e.quantity === old.quantity) orders.delete(id);
        else orders.set(id,{...old,quantity:old.quantity-e.quantity});
      }
    }
  }
  const aggregate=(side)=> {
    const levels=new Map();
    for(const order of orders.values()) if(order.side===side) levels.set(order.priceTicks,(levels.get(order.priceTicks)||0)+order.quantity);
    return [...levels].map(([priceTicks,quantity])=>({priceTicks,price:priceTicks*0.25,quantity}))
      .sort((a,b)=>side==="BID"?b.priceTicks-a.priceTicks:a.priceTicks-b.priceTicks);
  };
  const bids=aggregate("BID"), asks=aggregate("ASK");
  return {
    schema:"engine18.orderBookResearch.v1",noExecution:true,contractSymbol,
    seeded, gapDetected, usableForLiquidityInference:seeded && !gapDetected,
    lastSequence:prevSeq,lastEventTimeNs,activeOrders:orders.size,actions,
    bids,asks,
    crossedBook:!!(bids.length&&asks.length&&bids[0].priceTicks>=asks[0].priceTicks),
    limitations:["Normalized internal events only; vendor adapter not connected","Unseeded or gapped book must not be treated as live resting-liquidity truth"]
  };
}
