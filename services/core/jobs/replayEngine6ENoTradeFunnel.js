// Read-only historical Engine 6E funnel replay. No lookahead, no order execution.
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {buildNoTradeFunnel} from "../logic/engine6/6e-funnel/buildNoTradeFunnel.js";
import {validFunnelDate,summarizeFunnelCycles} from "../logic/engine6/6e-funnel/funnelDiagnosticStore.js";
const dirname=path.dirname(fileURLToPath(import.meta.url));
const date=process.argv[2];
if(!validFunnelDate(date)){
  console.error("Usage: node jobs/replayEngine6ENoTradeFunnel.js YYYY-MM-DD");
  process.exitCode=2;
}else{
  const base=process.env.REPLAY_DATA_DIR||path.resolve(dirname,"../data");
  const day=path.join(base,"replay","es",date);
  const files=fs.existsSync(day)?fs.readdirSync(day).filter(f=>/^[0-9]{4}\\.json$/.test(f)).sort():[];
  const records=[];
  for(const file of files){
    try{
      const input=JSON.parse(fs.readFileSync(path.join(day,file),"utf8"));
      if(input?.ok===true && input?.symbol==="ES")
        records.push(buildNoTradeFunnel(input)); // no executor inference; never future evidence
    }catch{/* invalid historical observations excluded, not fabricated */}
  }
  console.log(JSON.stringify({ok:true,mode:"READ_ONLY_HISTORICAL_REPLAY",sourceDate:date,
    observedSnapshots:records.length,foundFiles:files.length,
    ...summarizeFunnelCycles(records,date),noOrders:true,noJournalWrites:true},null,2));
}
