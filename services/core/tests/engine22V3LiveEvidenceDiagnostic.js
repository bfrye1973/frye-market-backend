import fs from "node:fs";
const raw=JSON.parse(fs.readFileSync(process.argv[2],"utf8"));
const stats=b=>({count:Array.isArray(b)?b.length:0,first:Array.isArray(b)?b[0]:null,last:Array.isArray(b)?b.at(-1):null});
const e=raw.strategies?.["intraday_scalp@10m"]?.engine22WaveStrategy;
console.log(JSON.stringify({snapshotTime:raw.now,topKeys:Object.keys(raw).slice(0,50),marketMeterKeys:Object.keys(raw.marketMeter||{}),
  rootLayers:Object.keys(raw.marketMeter?.layers||{}),strategyKeys:Object.keys(raw.strategies?.["intraday_scalp@10m"]||{}).slice(0,80),
  fiveMin:stats(raw.strategies?.["intraday_scalp@10m"]?.engine3DiagnosticBars?.fiveMinute?.bars),
  v3Present:!!e?.engine22V3Shadow, v3DegreeCount:Object.keys(e?.engine22V3Projection?.degreeStates||{}).length,
  v3NodeEvidencePresent:!!e?.engine22V3NodeEvidence,
  pathCandidates:Object.entries(raw).filter(([k])=>/market|candle|bar|ema/i.test(k)).map(([k,v])=>({key:k,keys:Object.keys(v||{}).slice(0,20)}))},null,2));
