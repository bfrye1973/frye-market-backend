// Existing 2026-11-08 owner-sheet snapshot -> the EXISTING node journal.
// Do not reinterpret archival source notes as owner-approved plot coordinates.
import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {readWaveHistory} from "./waveHistoryJournalV1.js";
import {fileURLToPath} from "node:url";
const FIXTURE=fileURLToPath(new URL("./fixtures/ownerSheetAnchorsNov8V1.json",import.meta.url));
const stableId=(prefix,fields)=>prefix+"-"+createHash("sha256").update(JSON.stringify(fields)).digest("hex").slice(0,24);
const tick=n=>typeof n==="number"&&Number.isFinite(n)&&n>0&&Math.abs(n*4-Math.round(n*4))<1e-8;
function arizonaUtc(date,time){
 if(typeof date!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(date)||
    typeof time!=="string"||!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))return null;
 // America/Phoenix observes MST year-round; do not infer UNKNOWN coordinates.
 const utc=date+"T"+time+":00";
 const t=Date.parse(utc+"-07:00");
 return Number.isFinite(t)?new Date(t).toISOString():null;
}
export function collectExistingOwnerNodesV1({directory,publishedAt}={}){
 if(!directory||typeof publishedAt!=="string"||!Number.isFinite(Date.parse(publishedAt)))
  throw Error("ENGINE22_NODE_SOURCE_MISSING_PUBLICATION");
 const source=JSON.parse(readFileSync(FIXTURE,"utf8"));
 if(source.schema!=="engine22.ownerSheetAnchorSource.v1")throw Error("ENGINE22_NODE_SOURCE_CONTRACT");
 const prior=readWaveHistory({directory});
 const seen=new Set(prior.flatMap(p=>(p.nodeEvents??[]).map(n=>n.nodeId)));
 const records=[];
 for(const tab of source.tabs){
  for(const row of tab.rows){
   const [rowNum,rawDegree,label,dateAZ,timeAZ,rawPrice,evidence]=row;
   const price=rawPrice===null?null:Number(rawPrice);
   if(!tick(price))continue; // Unknown-coordinate rows remain in source workbook.
   const degree=rawDegree.toLowerCase();
   const sourceFingerprint=stableId("src",[source.workbookId,tab.sheetId,label,dateAZ,timeAZ,price,evidence]);
   const nodeId=stableId("node",[source.workbookId,tab.sheetId,degree,label,dateAZ,timeAZ,price]);
   if(seen.has(nodeId))continue;
   const marketAt=arizonaUtc(dateAZ,timeAZ);
   records.push({
    schema:"engine22.nodeHistoryEvent.v1",type:"NODE_RECORDED",
    eventId:stableId("event",[nodeId,"initial"]),nodeId,
    waveId:stableId("wave",[source.workbookId,tab.sheetId,degree,label]),
    countId:"sheet-source-"+tab.sheetId,modelVersion:"engine22.ownerSheetSourceNov8.v1",
    degree,parentWaveId:null,sourceReference:`sheet:${source.workbookId}:${tab.title}!A${rowNum}:F${rowNum}`,
    sourceFingerprint,priceBasisId:"UNVERIFIED_ES_CONTINUOUS",contractSymbol:"ES",
    label,marketAt,publishedAt,price,
    approvalStatus:"RESEARCH",lifecycle:"DEVELOPING",revision:1,
    supersedesEventId:null,supersedesNodeId:null,
    sourceEvidence:evidence,sourceRecordType:tab.title.includes("Archive")?"ARCHIVED_SOURCE":
      tab.title.includes("Proposed")?"PROPOSED_SOURCE":"HISTORICAL_SOURCE_UNVERIFIED",
    noExecution:true
   });
  }
 }
 return records;
}
