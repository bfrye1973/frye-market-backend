// Engine 18 feed readiness gate. Wire a vendor-specific Rithmic adapter only after
// Ironbeam provides its API transport, entitlements, packet definitions and sequence semantics.
// Deliberately no broker order endpoints and no stored credentials.
export const ENGINE18_FEED_SCHEMA = "engine18.feedReadiness.v1";
const ES_CONTRACT=/^ES[HMUZ]\d{1,2}$/;
export function assessEngine18Feed({
  provider="RITHMIC",contractSymbol,connected=false,authenticated=false,
  entitlementMbo=false,subscriptionActive=false,snapshotSeeded=false,
  sequenceContinuous=false,lastMarketEventUnixMs=null,nowUnixMs,
  marketOpen=true,maxAgeMs=3000
}={}) {
  if(!Number.isSafeInteger(nowUnixMs)||nowUnixMs<=0) throw Error("ENGINE18_FEED_CLOCK_REQUIRED");
  if(!ES_CONTRACT.test(contractSymbol||"")) throw Error("ENGINE18_FEED_ES_CONTRACT_REQUIRED");
  if(!Number.isSafeInteger(maxAgeMs)||maxAgeMs<100||maxAgeMs>60000) throw Error("ENGINE18_FEED_INVALID_MAX_AGE");
  const ageMs=Number.isSafeInteger(lastMarketEventUnixMs) ? nowUnixMs-lastMarketEventUnixMs : null;
  const reasons=[];
  if(provider!=="RITHMIC") reasons.push("PROVIDER_NOT_CONFIGURED");
  if(!connected) reasons.push("DISCONNECTED");
  if(!authenticated) reasons.push("NOT_AUTHENTICATED");
  if(!entitlementMbo) reasons.push("MBO_NOT_ENTITLED");
  if(!subscriptionActive) reasons.push("SUBSCRIPTION_NOT_ACTIVE");
  if(!snapshotSeeded) reasons.push("BOOK_NOT_SEEDED");
  if(!sequenceContinuous) reasons.push("BOOK_SEQUENCE_UNVERIFIED");
  if(!marketOpen) reasons.push("MARKET_CLOSED");
  if(marketOpen && (ageMs===null || ageMs<0 || ageMs>maxAgeMs)) reasons.push("STALE_OR_MISSING_EVENTS");
  return {
    schema:ENGINE18_FEED_SCHEMA, provider,contractSymbol,asOfUnixMs:nowUnixMs,
    connected,authenticated,entitlementMbo,subscriptionActive,snapshotSeeded,sequenceContinuous,
    marketOpen,ageMs,
    liquidityDataUsable:reasons.length===0,
    reasons,readOnly:true,noExecution:true
  };
}
export function normalizeEngine18FeedEnvelope(envelope) {
  // Only accepts already-decoded, explicitly identified packets, never guesses
  // Rithmic fields from packet shape. Real decoder must be implemented from vendor specs.
  if(!envelope||envelope.adapterVersion!=="engine18.normalized.v1") throw Error("ENGINE18_UNSUPPORTED_ADAPTER_VERSION");
  if(envelope.provider!=="RITHMIC") throw Error("ENGINE18_UNSUPPORTED_FEED_PROVIDER");
  if(!ES_CONTRACT.test(envelope.contractSymbol||"")) throw Error("ENGINE18_ENVELOPE_ES_CONTRACT_REQUIRED");
  if(!["SNAPSHOT","ORDER_EVENT","TRADE","HEARTBEAT","DISCONNECT"].includes(envelope.kind)) throw Error("ENGINE18_UNSUPPORTED_ENVELOPE_KIND");
  if(typeof envelope.eventTimeNs!=="string"||!/^[0-9]{1,19}$/.test(envelope.eventTimeNs)) throw Error("ENGINE18_INVALID_EXCHANGE_TIME");
  return Object.freeze({...envelope,readOnly:true,noExecution:true});
}
