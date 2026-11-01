import {readWaveHistory} from "./waveHistoryJournalV1.js";
import {writeFileSync,renameSync,openSync,closeSync,fsyncSync} from "node:fs";
import {join} from "node:path";
import {deflateRawSync} from "node:zlib";

// Zero-dependency XLSX exporter. The journal is the permanent record; Excel is a
// reproducible read-only view, regenerated atomically after every changed revision.
const escape=x=>String(x??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&apos;");
const bytes=x=>Buffer.from(x,"utf8");
const crcTable=Array.from({length:256},(_,n)=>{let c=n;for(let j=0;j<8;j++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;return c>>>0;});
function crc32(b){let c=0xffffffff;for(const x of b)c=crcTable[(c^x)&255]^(c>>>8);return(c^0xffffffff)>>>0;}
function zip(files){
 const locals=[],centrals=[];let offset=0;
 for(const [name,text] of files){
  const filename=bytes(name),raw=bytes(text),compressed=deflateRawSync(raw),crc=crc32(raw);
  const local=Buffer.alloc(30);local.writeUInt32LE(0x04034b50,0);local.writeUInt16LE(20,4);
  local.writeUInt16LE(8,8);local.writeUInt32LE(crc,14);local.writeUInt32LE(compressed.length,18);
  local.writeUInt32LE(raw.length,22);local.writeUInt16LE(filename.length,26);
  locals.push(local,filename,compressed);
  const central=Buffer.alloc(46);central.writeUInt32LE(0x02014b50,0);central.writeUInt16LE(20,4);
  central.writeUInt16LE(20,6);central.writeUInt16LE(8,10);central.writeUInt32LE(crc,16);
  central.writeUInt32LE(compressed.length,20);central.writeUInt32LE(raw.length,24);
  central.writeUInt16LE(filename.length,28);central.writeUInt32LE(offset,42);
  centrals.push(central,filename);
  offset+=local.length+filename.length+compressed.length;
 }
 const cd=Buffer.concat(centrals),end=Buffer.alloc(22);
 end.writeUInt32LE(0x06054b50,0);end.writeUInt16LE(files.length,8);end.writeUInt16LE(files.length,10);
 end.writeUInt32LE(cd.length,12);end.writeUInt32LE(offset,16);
 return Buffer.concat([...locals,cd,end]);
}
function cell(value,column,row){
 if(value===null||value===undefined||value==="")return "";
 const ref=String.fromCharCode(65+column)+row;
 if(typeof value==="number"&&Number.isFinite(value))return `<c r="${ref}"><v>${value}</v></c>`;
 return `<c r="${ref}" t="inlineStr"><is><t>${escape(value)}</t></is></c>`;
}
function sheet(headers,rows){
 const data=[headers,...rows].map((values,i)=>`<row r="${i+1}">${values.map((v,j)=>cell(v,j,i+1)).join("")}</row>`).join("");
 return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetData>${data}</sheetData><autoFilter ref="A1:${String.fromCharCode(64+headers.length)}${Math.max(1,rows.length+1)}"/></worksheet>`;
}
function flattenAnchors(value,path="",depth=0,out=[]){
 if(depth>9||value==null)return out;
 if(Array.isArray(value)){value.forEach((v,i)=>flattenAnchors(v,path+"["+i+"]",depth+1,out));return out;}
 if(typeof value!=="object")return out;
 for(const [k,v] of Object.entries(value)){
  if(["levels","fibReferences","touchEvidence","invalidations","reviewBoundary","projectionMethod"].includes(k))continue;
  const p=path?path+"."+k:k;
  if(v&&typeof v==="object")flattenAnchors(v,p,depth+1,out);
  else if(typeof v==="number"&&Number.isFinite(v)&&/(?:low|high|price|origin|start|end|pivot)/i.test(k)&&!/(?:length|ratio|revision|timestamp)/i.test(k))
   out.push({path:p,price:v});
 }
 return out;
}
export function buildWaveHistoryWorkbook({events}={}){
 if(!Array.isArray(events))throw Error("VERIFIED_EVENTS_REQUIRED");
 const degreeNames=["submicro","micro","subminute","minute","minor","intermediate","primary"];
 const current=[],history=[],changes=[],fibs=[],changeDetails=[];
 const latest=events.at(-1);
 let previous=null;
 for(const event of events){
  const c=event.content;
  // Record every changed primitive with its exact source path; no value is overwritten.
  function flat(v,p="",out={},depth=0){
   if(depth>12||v===undefined)return out;
   if(v!==null&&typeof v==="object"){
    for(const [key,val] of Object.entries(v))flat(val,p?p+"."+key:key,out,depth+1);
   }else out[p]=v;
   return out;
  }
  const before=previous?flat(previous.content.degrees):{},after=flat(c.degrees);
  for(const key of new Set([...Object.keys(before),...Object.keys(after)])){
   if(JSON.stringify(before[key])!==JSON.stringify(after[key]))
    changeDetails.push([event.revision,key,previous?before[key]??null:null,after[key]??null,
      event.observedAt,c.publishedAt,c.selectionApprovalReference]);
  }
  previous=event;
  for(const degree of degreeNames){
   const d=c.degrees?.[degree],m=d?.sourceModel;
   if(!m)continue;
   const anchors=flattenAnchors(m);
   for(const a of anchors){
    const row=[event.revision,degree,a.path,a.price,d.modelVersion,c.selectionRevision,c.publishedAt,event.observedAt,d.sourcePath,c.selectionApprovalReference];
    history.push(row);
    if(event===latest)current.push(row);
   }
   const seen=new Set();
   function collect(v,path="",depth=0){
    if(depth>9||!v||typeof v!=="object")return;
    if(Array.isArray(v)){
     if(v.every(x=>x&&typeof x==="object"&&"price" in x&&("key" in x||"label" in x))){
      for(const level of v)fibs.push([event.revision,degree,path,level.key??"",level.label??"",level.price??"",level.status??"",level.touchEvidenceType??"",d.modelVersion]);
     }else v.forEach((x,i)=>collect(x,path+"["+i+"]",depth+1));
    }else for(const [k,x] of Object.entries(v)){const p=path?path+"."+k:k;if(!seen.has(p)){seen.add(p);collect(x,p,depth+1);}}
   }
   collect(m);
  }
  changes.push([event.revision,event.observedAt,c.publishedAt,c.selectionRevision,c.selectionApprovalReference,c.modelFingerprint,c.evidenceFingerprint,event.contentHash,event.previousEventHash,event.eventHash]);
 }
 const h=["Revision","Degree","Source Anchor Path","ES Price","Model Version","Selection Revision","Published At UTC","Journal Observed UTC","Model Source","Approval Reference"];
 const specs=[
  ["Current Anchors",h,current],
  ["Complete History",h,history],
  ["Change Journal",["Revision","Observed UTC","Published UTC","Selection Revision","Approval Reference","Model Fingerprint","Evidence Fingerprint","Content Hash","Previous Event Hash","Event Hash"],changes],
  ["Change Details",["Revision","Exact Field Path","Previous Value","New Value","Observed UTC","Published UTC","Approval Reference"],changeDetails],
  ["Fibonacci History",["Revision","Degree","Fib Source Path","Level Key","Ratio","ES Price","Status","Evidence Type","Model Version"],fibs],
  ...degreeNames.map(d=>[d[0].toUpperCase()+d.slice(1),h,history.filter(x=>x[1]===d)])
 ];
 const sheets=specs.map((s,i)=>[`xl/worksheets/sheet${i+1}.xml`,sheet(s[1],s[2])]);
 const workbook=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${specs.map((s,i)=>`<sheet name="${escape(s[0])}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join("")}</sheets></workbook>`;
 const rels=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${specs.map((_,i)=>`<Relationship Id="rId${i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join("")}</Relationships>`;
 const types=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${specs.map((_,i)=>`<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`;
 const rootRels=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
 return zip([["[Content_Types].xml",types],["_rels/.rels",rootRels],["xl/workbook.xml",workbook],["xl/_rels/workbook.xml.rels",rels],...sheets]);
}
export function exportWaveHistoryWorkbook({directory}={}){
 const events=readWaveHistory({directory}); // full chain verified before export
 const buffer=buildWaveHistoryWorkbook({events});
 const target=join(directory,"Frye_Elliott_Wave_History.xlsx"),temp=target+".tmp";
 const fd=openSync(temp,"w");
 try{writeFileSync(fd,buffer);fsyncSync(fd);}finally{closeSync(fd);}
 renameSync(temp,target);
 return {path:target,revisions:events.length,bytes:buffer.length};
}
