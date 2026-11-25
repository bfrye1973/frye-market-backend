// Engine 22 Strategy anchor revisions -> the EXISTING hash-linked node journal.
// No wave calculation or model approval. Producer consumes ONLY Engine22's
// workingWaveNodes snapshot from the same Strategy card shown to Engine2.
import {createHash} from "node:crypto";
import {readWaveHistory} from "./waveHistoryJournalV1.js";
import {NODE_EVENT_SCHEMA} from "./nodeIdentityLedgerV1.js";

const sha=x=>createHash("sha256").update(JSON.stringify(x)).digest("hex");
const tick=x=>typeof x==="number"&&Number.isFinite(x)&&x>0&&
  Math.abs(x*4-Math.round(x*4))<1e-8;
const SCHEMA="engine22.workingWaveNodes.v1";
export function collectPublishedWorkingNodeEventsV1({directory,packet,publishedAt}={}){
  if(!directory||!publishedAt||!Number.isFinite(Date.parse(publishedAt)))
    throw Error("ENGINE22_WORKING_NODES_CONTEXT_REQUIRED");
  // Until backend PR #275 is integrated, keep old journal publication behavior.
  if(!packet)return [];
  if(packet.schema!==SCHEMA||packet.authority!=="ENGINE22"||
     packet.readOnly!==true||packet.noExecution!==true||
     packet.ownerCountPromotion!==false||packet.symbol!=="ES"||
     packet.available!==true) throw Error("ENGINE22_WORKING_NODES_SCHEMA_MISMATCH");
  const history=readWaveHistory({directory});
  const latest=new Map();
  for(const publication of history)
    for(const event of publication.nodeEvents??[])latest.set(event.nodeId,event);
  const records=[],visited=new Set();
  const order=["primary","intermediate","minor","minute","subminute","micro","submicro"];
  for(const degree of order){
    const section=packet.degrees?.[degree];
    if(!section)continue;
    if(section.degree!==degree||!Array.isArray(section.models))
      throw Error("ENGINE22_WORKING_NODES_DEGREE_MISMATCH");
    for(const model of section.models){
      if(model.degree!==degree||!Array.isArray(model.anchors)||
         (model.historicalAnchors!==undefined&&!Array.isArray(model.historicalAnchors))||
         model.scenarioStatus!=="RESEARCH_ONLY") throw Error("ENGINE22_WORKING_NODES_MODEL_INVALID");
      // Historical owner source corrections are retained in the same durable
      // journal, but never included in the current-degree chart node array.
      for(const node of [...(model.historicalAnchors??[]),...model.anchors]){
        if(node.degree!==degree||!node.nodeId||!node.sourceRevision||
           !node.sourcePath||!node.anchorField||!tick(node.price)||
           !["RESEARCH","SUPERSEDED"].includes(node.approvalStatus)||node.plotAllowed!==false||
           node.noExecution!==true||node.waveCompletionConfirmed!==false)
          throw Error("ENGINE22_WORKING_NODES_EVENT_UNSAFE");
        if(visited.has(node.nodeId))throw Error("ENGINE22_WORKING_NODES_DUPLICATE_NODE");
        visited.add(node.nodeId);
        const old=latest.get(node.nodeId);
        const previousKey=old?.sourceFingerprint??null;
        if(previousKey===node.sourceRevision)continue;
        const nextRevision=(old?.revision??0)+1;
        const eventId="working-"+sha([node.nodeId,node.sourceRevision,nextRevision]).slice(0,32);
        records.push({
          schema:NODE_EVENT_SCHEMA,type:old?"NODE_REVISED":"NODE_RECORDED",
          eventId,nodeId:node.nodeId,waveId:node.waveId,countId:node.countId,
          modelVersion:node.modelVersion,degree,parentWaveId:null,
          label:node.label,
          sourceReference:node.sourceFieldPath??(node.sourcePath+".anchors."+node.anchorField),
          sourceFingerprint:node.sourceRevision,
          priceBasisId:"UNVERIFIED_ES_CONTINUOUS",contractSymbol:"ES",
          marketAt:node.marketAtUtc??null,publishedAt,
          price:node.price,approvalStatus:node.approvalStatus,
          lifecycle:node.approvalStatus==="SUPERSEDED"?"SUPERSEDED":"DEVELOPING",
          revision:nextRevision,supersedesEventId:old?.eventId??null,
          supersedesNodeId:null,
          sourcePresentationOnly:true,originalMarketUtc:node.marketAtUtc??null,
          sourceTimestampConflict:node.sourceTimestampConflict===true,
          noExecution:true,
        });
      }
    }
  }
  return records;
}
