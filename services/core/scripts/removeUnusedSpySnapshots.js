// Owner-requested SPY *strategy snapshot* cleanup.
// Strictly scoped to services/core/data. Never traverses the trading journal,
// ES history, 100GB /var/data/replay, or other symbol/market artifacts.
// Dry-run is the default. Applying requires an explicit --apply operator action.
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const CORE_DATA_DIR=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../data");
const SPY_FILES=Object.freeze([
  "strategy-snapshot.json",
  "strategy-snapshot.json.tmp",
  "strategy-snapshot.json.bak",
  "strategy-snapshot-spy.json",
  "strategy-snapshot-spy.json.tmp",
  "strategy-snapshot-spy.json.bak"
]);

export function removeUnusedSpySnapshots({dataDir=CORE_DATA_DIR,apply=false}={}){
  if(typeof dataDir!=="string"||typeof apply!=="boolean")throw Error("invalid cleanup options");
  const root=path.resolve(dataDir);
  const matches=[];
  for(const name of SPY_FILES){
    const target=path.join(root,name);
    let stat;
    try{stat=fs.lstatSync(target);}
    catch(e){if(e?.code==="ENOENT")continue;throw e;}
    if(!stat.isFile()||stat.isSymbolicLink())throw Error("refusing non-regular SPY snapshot");
    matches.push({name,bytes:stat.size});
    if(apply)fs.unlinkSync(target);
  }
  return Object.freeze({schema:"frye.spySnapshotCleanup.v1",scope:"SERVICES_CORE_DATA_ONLY",
    apply,files:matches,deleted:apply?matches.length:0,
    excluded:["ES snapshots","journal","replay","trading state","unrelated SPY data"]});
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2);
  if(args.some(arg=>arg!=="--apply"))throw Error("only --apply is supported");
  console.log(JSON.stringify(removeUnusedSpySnapshots({apply:args.includes("--apply")})));
}
