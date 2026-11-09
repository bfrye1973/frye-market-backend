// OFFLINE ONLY: node services/core/qa/runEngine16AbcReplay.mjs <local-engine11-json-file>
// Never fetches, modifies, or publishes market data. Does not read production secrets.
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {adaptEngine11OhlcForResearch,replayEngine11Research}
  from "../logic/engine16StructuralTracker/replayAndChartContracts.js";
const path=process.argv[2];
if(!path) {
  console.error("Usage: node services/core/qa/runEngine16AbcReplay.mjs <local-json-file>");
  process.exitCode=2;
} else {
  try {
    const bytes=readFileSync(path);
    const file=JSON.parse(bytes.toString("utf8"));
    // Explicit metadata wrapper required; raw public OHLC array alone cannot verify price basis.
    if(file?.schema!=="engine16.engine11OfflineReplayFixture.v1"||
      file?.symbol!=="ES"||!Array.isArray(file.bars)||!file.contract||
      !file.priceBasis||!file.timeframe||!file.mode)
      throw Error("ENGINE16_REPLAY_METADATA_REQUIRED");
    const sourceFingerprint="sha256:"+createHash("sha256").update(bytes).digest("hex");
    const normalized=adaptEngine11OhlcForResearch({...file,sourceFingerprint});
    const result=replayEngine11Research({input:normalized,pivotStrength:file.pivotStrength??1,
      maxCandidateAgeBars:file.maxCandidateAgeBars??null});
    const summary={schema:"engine16.offlineReplayReport.v1",researchOnly:true,noExecution:true,
      symbol:"ES",contract:file.contract,priceBasis:file.priceBasis,timeframe:file.timeframe,
      replayMode:result.replayMode,evidenceClockAuthority:result.evidenceClockAuthority,
      sourceFingerprint,sourceIntegrityStatus:result.sourceIntegrityStatus,
      historicallyVerified:false,barCount:normalized.bars.length,
      asOf:normalized.bars.at(-1)?.knownAt??null,
      snapshots:result.snapshots.length,eventCount:result.events.length,
      lastCandidates:result.snapshots.at(-1)?.candidates.length??0,
      eventReasons:Object.fromEntries([...new Set(result.events.map(e=>e.reason))].sort()
        .map(reason=>[reason,result.events.filter(e=>e.reason===reason).length]))};
    process.stdout.write(JSON.stringify(summary,null,2)+"\n");
  } catch(error) {
    console.error("ENGINE16_OFFLINE_REPLAY_ERROR:",error.message);
    process.exitCode=1;
  }
}
