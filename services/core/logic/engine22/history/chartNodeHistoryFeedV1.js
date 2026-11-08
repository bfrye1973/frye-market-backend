// Safe Engine 22 -> Engine 2 history feed. It uses the same hash-verified journal
// and immutable per-node event validation; never exposes an unapproved chart plot.
import {pageWaveHistory,readWaveHistory} from "./waveHistoryJournalV1.js";
import {replayNodeIdentityEvents} from "./nodeIdentityLedgerV1.js";

const VERSION="engine22.chartNodeHistoryPage.v1";
const requireCursor=(afterRevision,limit)=>{
 if(!Number.isSafeInteger(afterRevision)||afterRevision<0||
    !Number.isSafeInteger(limit)||limit<1||limit>100)
  throw Error("INVALID_HISTORY_PAGINATION");
};
const toRecord=(node,publicationRevision)=>{
 const hasTime=typeof node.marketAt==="string";
 return {
  nodeId:node.nodeId,waveId:node.waveId,countId:node.countId,
  modelVersion:node.modelVersion,degree:node.degree,parentWaveId:node.parentWaveId,
  label:node.label,marketAtUtc:node.marketAt,publishedAtUtc:node.publishedAt,
  esPrice:node.price,contractSymbol:node.contractSymbol,priceBasisId:node.priceBasisId,
  approvalStatus:node.approvalStatus,lifecycle:node.lifecycle,
  sourceReference:node.sourceReference,sourceFingerprint:node.sourceFingerprint,
  sourceRevision:node.revision,publicationRevision,
  supersedesNodeId:node.supersedesNodeId,supersedesEventId:node.supersedesEventId,
  // Approval and timestamp alone are not enough without independent ES/Engine11
  // basis evidence and an authorized as-of chart contract.
  plotAllowed:false,
  plotReason:!hasTime?"MISSING_MARKET_TIMESTAMP":
   node.approvalStatus!=="OWNER_APPROVED"?"UNAPPROVED_WAVE":
   "ENGINE11_PRICE_BASIS_AND_ASOF_VERIFICATION_PENDING"
 };
};
export function pageEngine22NodeHistory({directory,afterRevision=0,limit=50}={}){
 requireCursor(afterRevision,limit);
 const page=pageWaveHistory({directory,afterRevision,limit});
 const records=[];
 for(const publication of page.items)
  for(const node of publication.nodeEvents??[])records.push(toRecord(node,publication.revision));
 return {schema:VERSION,readOnly:true,noExecution:true,historicalAsOfSupported:false,
  afterRevision,nextRevision:page.nextRevision,hasMore:page.hasMore,
  totalRevisions:page.totalRevisions,records};
}
export function latestEngine22NodeHistory({directory}={}){
 // Full journal validation also catches invalid prior revisions; do not silently
 // provide a partial current count from a broken historical chain.
 const events=readWaveHistory({directory});
 const latest=new Map();
 for(const publication of events)
  for(const node of publication.nodeEvents??[])latest.set(node.nodeId,toRecord(node,publication.revision));
 return {schema:"engine22.chartNodeCurrent.v1",readOnly:true,
  latestRevision:events.at(-1)?.revision??0,historicalAsOfSupported:false,
  records:[...latest.values()],plotAllowed:false,noExecution:true};
}
