// Temporary opt-in, read-only production audit of the approved receipt-verify HTTP endpoint.
// Uses the backend's existing ENGINE_CRON_TOKEN in an INTERNAL header only.
// Does not reveal the token, raw market data, file paths, or receipt content.
// Disabled unless ENGINE29_ONE_SHOT_RECEIPT_AUDIT=1.
import fs from "node:fs";
import path from "node:path";

const DAY = "2026-11-23";
const REPLAY_TIME = "1209";
const EXPECTED_OBSERVATION = "2026-11-23T19:09:13.393Z";
const RECEIPT_DIR = "/var/data/replay/engine29/2026-11-23";
const RECEIPT_PATTERN = /^2026-11-23T\d{2}-\d{2}-\d{2}-\d{3}Z-[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\.json$/i;
const MAX_BYTES = 4 * 1024 * 1024;

export async function runEngine29OneShotReceiptAudit({
  enabled = process.env.ENGINE29_ONE_SHOT_RECEIPT_AUDIT === "1",
  token = process.env.ENGINE_CRON_TOKEN,
  port = Number(process.env.PORT) || 8080,
  receiptDir = RECEIPT_DIR,
  fsApi = fs,
  fetchFn = fetch,
  log = (...parts) => console.log(...parts),
} = {}) {
  if (!enabled) return { status:"DISABLED" };
  if (typeof token !== "string" || !token.trim()) {
    const report={ status:"BLOCKED", reason:"AUTH_NOT_CONFIGURED" };
    log("[engine29-disk-audit]", JSON.stringify(report));return report;
  }
  const rootStat=fsApi.lstatSync(receiptDir);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    const report={ status:"BLOCKED", reason:"UNSAFE_RECEIPT_DIRECTORY" };
    log("[engine29-disk-audit]", JSON.stringify(report));return report;
  }
  let file=null;
  const names=fsApi.readdirSync(receiptDir).filter(name => RECEIPT_PATTERN.test(name)).sort();
  for(const name of names) {
    const candidate=path.join(receiptDir,name);
    const stat=fsApi.lstatSync(candidate);
    if(stat.isSymbolicLink() || !stat.isFile() || stat.size>MAX_BYTES)continue;
    const fd=fsApi.openSync(candidate,fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    try {
      const fstat=fsApi.fstatSync(fd);
      if(!fstat.isFile() || fstat.dev!==stat.dev || fstat.ino!==stat.ino)continue;
      const context=JSON.parse(fsApi.readFileSync(fd,"utf8"));
      if(context?.schema==="engine29.downstreamContext.v1" &&
        context?.timestamp===EXPECTED_OBSERVATION) {
        file=name;break;
      }
    }catch{
      // Malformed receipt cannot be selected for the proof.
    }finally{fsApi.closeSync(fd);}
  }
  if(!file) {
    const report={status:"BLOCKED",reason:"MATCHING_DISK_RECEIPT_NOT_FOUND",observationTimestamp:EXPECTED_OBSERVATION};
    log("[engine29-disk-audit]",JSON.stringify(report));return report;
  }
  const query=new URLSearchParams({date:DAY,filename:file,replayDate:DAY,replayTime:REPLAY_TIME});
  const url="http://127.0.0.1:"+port+"/api/v1/engine29/receipt-verify?"+query.toString();
  let result, httpStatus;
  try {
    const response=await fetchFn(url,{
      headers:{accept:"application/json","X-ENGINE-CRON-TOKEN":token.trim()},
      signal:AbortSignal.timeout(20000)
    });
    httpStatus=response.status;
    result=await response.json();
  }catch{
    const report={status:"BLOCKED",reason:"VERIFIER_REQUEST_FAILED"};
    log("[engine29-disk-audit]",JSON.stringify(report));return report;
  }
  const verified=httpStatus===200 && result?.schema==="engine29.downstreamContext.v1" &&
    result?.exactMatch===true && result?.verified===true && result?.reason==="VERIFIED" &&
    result?.receiptContextSha256===result?.replayContextSha256 &&
    result?.receiptTimestamp===EXPECTED_OBSERVATION &&
    Number.isFinite(Date.parse(result?.replaySnapshot?.timestamp)) &&
    Date.parse(result?.receiptTimestamp)<=Date.parse(result?.replaySnapshot?.timestamp) &&
    /^[0-9a-f]{64}$/.test(result?.receiptFileSha256??"");
  const report={
    status:verified?"PASS":"FAIL",
    httpStatus,
    schema:result?.schema??null,
    receiptTimestamp:result?.receiptTimestamp??null,
    replaySnapshot:result?.replaySnapshot??null,
    receiptByteCount:result?.byteCount??null,
    receiptFileSha256:result?.receiptFileSha256??null,
    receiptContextSha256:result?.receiptContextSha256??null,
    replayContextSha256:result?.replayContextSha256??null,
    exactMatch:result?.exactMatch===true,
    reason:result?.reason??"NO_REASON",
    verified,
    metadataOnly:true,
    engine4LiquidityTrapBlocked:true,
  };
  log("[engine29-disk-audit]",JSON.stringify(report));
  return report;
}
