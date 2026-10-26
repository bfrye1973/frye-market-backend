export const microShadowHtml = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Engine 27 V3 Micro — Shadow / Not Trading</title>
<style>
:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;background:#060d17;color:#e9f2ff;font-family:system-ui,Arial,sans-serif}
main{max-width:1260px;margin:auto;padding:24px}h1{font-size:23px;margin:0 0 6px;letter-spacing:.04em}
p{color:#96aec7;margin:6px 0 20px}header{border-bottom:2px solid #cfad49;padding-bottom:16px;margin-bottom:20px}
.mast{display:flex;gap:10px;flex-wrap:wrap;align-items:center}.pill{background:#3b2711;color:#f8c55d;padding:7px 10px;border:1px solid #946a1a;border-radius:5px;font-size:12px;font-weight:800}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:12px}.card{background:#0b1725;border:1px solid #243951;border-radius:8px;padding:16px;min-height:140px}
.card h2{font-size:11px;letter-spacing:.1em;color:#8cbfe1;margin:0 0 12px;text-transform:uppercase}.big{font-size:30px;font-weight:800;letter-spacing:-.03em}
.row{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;padding:7px 0;border-bottom:1px solid #1b2f46;font-size:13px}.row:last-child{border:0}
.k{color:#94a9c0}.v{font-weight:700;text-align:right;overflow-wrap:anywhere}.amber{color:#f8bf58}.teal{color:#5de2b4}.red{color:#ff9191}
.full{grid-column:1/-1}.foot{font-size:12px;color:#71889f;padding:16px 0}
.metric-strip{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:9px;margin-bottom:14px}.metric{background:#0b1725;border:1px solid #243951;border-radius:8px;padding:11px;min-width:0}.metric-label{color:#8cbfe1;font-size:10px;letter-spacing:.06em;text-transform:uppercase}.metric-value{font-weight:800;font-size:22px;margin-top:5px}.metric-sub{color:#94a9c0;font-size:10px;overflow-wrap:anywhere}
.details{margin:8px 0 0;border-top:1px solid #243951;padding-top:9px}.details summary{cursor:pointer;font-size:12px;color:#8cbfe1;font-weight:700;list-style-position:inside}.details[open] summary{margin-bottom:8px}.micro-note{color:#94a9c0;font-size:11px;margin:9px 0 0}.compact-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.compact-grid>div{background:#0a1420;border:1px solid #243951;border-radius:6px;padding:10px;min-width:0}
.e29-summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin:8px 0}.e29-summary>div{padding:8px;background:#0a1420;border:1px solid #243951;border-radius:6px;display:flex;flex-direction:column;gap:4px}.e29-summary strong{font-size:12px;overflow-wrap:anywhere}.table-scroll{overflow-x:auto}.internals{width:100%;border-collapse:collapse;font-size:12px}.internals td,.internals th{padding:7px;border-bottom:1px solid #243951;text-align:left;overflow-wrap:anywhere}.internals th{color:#8cbfe1}@media(max-width:700px){.e29-summary{grid-template-columns:repeat(2,minmax(0,1fr))}.metric-strip{grid-template-columns:repeat(2,minmax(0,1fr))}.compact-grid{grid-template-columns:1fr}}
@media(max-width:540px){main{padding:12px}h1{font-size:18px}.big{font-size:25px}}
</style></head><body><main><header><div class="mast"><h1>ENGINE 27 V3 — MICRO INTELLIGENCE</h1><span class="pill">SHADOW / NOT TRADING</span></div>
<p>Read-only observation. No entries, exits, stops, order changes or trade authorization.</p></header>
<section aria-label="Engine 25 five metric overview"><div class="metric-strip">
<div class="metric"><div class="metric-label">Market health</div><div class="metric-value" id="metricHealth">—</div><div class="metric-sub" id="metricHealthSub">Source pending</div></div>
<div class="metric"><div class="metric-label">Breadth</div><div class="metric-value" id="metricBreadth">—</div><div class="metric-sub" id="metricBreadthSub">Source pending</div></div>
<div class="metric"><div class="metric-label">Stock volume</div><div class="metric-value" id="metricVolume">—</div><div class="metric-sub" id="metricVolumeSub">Coverage, not directional volume</div></div>
<div class="metric"><div class="metric-label">4H distribution</div><div class="metric-value" id="metricDistribution">—</div><div class="metric-sub" id="metricDistributionSub">Source pending</div></div>
<div class="metric"><div class="metric-label">1H weak sectors</div><div class="metric-value" id="metricSectors">—</div><div class="metric-sub" id="metricSectorsSub">Source pending</div></div>
</div><details class="details" id="hourDetails"><summary>View 1H participation details</summary><div class="compact-grid">
<div><h2>Breadth and sectors — 1H</h2><div class="row"><span class="k">Participation</span><span class="v" id="hourState">UNAVAILABLE</span></div><div class="row"><span class="k">Strong / neutral / weak</span><span class="v" id="hourSectors">UNAVAILABLE</span></div><div class="row"><span class="k">Evidence freshness</span><span class="v" id="hourFreshness">UNAVAILABLE</span></div><div class="row"><span class="k">Source timestamp</span><span class="v" id="hourTimestamp">UNAVAILABLE</span></div></div>
<div><h2>Stock volume — 1H</h2><div class="row"><span class="k">Advancing volume</span><span class="v">NOT IN THIS READER</span></div><div class="row"><span class="k">Declining volume</span><span class="v">NOT IN THIS READER</span></div><p class="micro-note">The current E25 canonical participation summary does not publish the pictured 1H totals directly. These are deliberately not reconstructed or invented in this first layout test.</p><div class="row"><span class="k">Live equity qualification</span><span class="v amber" id="hourQualification">NOT QUALIFIED</span></div></div>
</div></details><p class="micro-note">Owner-reported market context only. Values are not independent live trade confirmation; ES price uses individual futures trades.</p></section>
<div class="grid">
<section class="card"><h2>Live ES price</h2><div class="big" id="price">UNAVAILABLE</div><div class="row"><span class="k">Feed state</span><span class="v" id="feed">UNAVAILABLE</span></div><div class="row"><span class="k">Last ES trade</span><span class="v" id="last">—</span></div><div class="row"><span class="k">Resolved contract</span><span class="v" id="contract">—</span></div><div class="row"><span class="k">Provider trade events</span><span class="v" id="received">0</span></div><div class="row"><span class="k">Qualified trades</span><span class="v" id="qualified">0</span></div><div class="row"><span class="k">Source latency</span><span class="v" id="lag">UNAVAILABLE</span></div><div class="row"><span class="k">Feed issue</span><span class="v amber" id="issue">UNAVAILABLE</span></div></section>
<section class="card"><h2>Engine 22 Micro wave</h2><div class="big" id="wave">UNAVAILABLE</div><div class="row"><span class="k">Owner confirmation</span><span class="v" id="confirm">UNAVAILABLE</span></div><div class="row"><span class="k">Next provisional Fib</span><span class="v amber" id="fib">UNAVAILABLE</span></div><div class="row"><span class="k">Touch vs confirmation</span><span class="v amber" id="touch">UNAVAILABLE</span></div></section>
<section class="card"><h2>Neighboring degrees</h2><div class="row"><span class="k">Submicro</span><span class="v" id="left">UNAVAILABLE</span></div><div class="row"><span class="k">Subminute</span><span class="v" id="right">UNAVAILABLE</span></div><div class="row"><span class="k">Assessment</span><span class="v" id="neighbors">UNAVAILABLE</span></div></section>
<section class="card"><h2>Other market evidence</h2><details class="details"><summary>View source quality and cross-market status</summary>
<div class="row"><span class="k">Engine 25 ES regime</span><span class="v" id="e25">UNAVAILABLE</span></div>
<div class="row"><span class="k">Participation source</span><span class="v" id="e25source">UNAVAILABLE</span></div>
<div class="row"><span class="k">Breadth evidence</span><span class="v" id="breadth">UNAVAILABLE</span></div>
<div class="row"><span class="k">Sector evidence</span><span class="v" id="sectors">UNAVAILABLE</span></div>
<div class="row"><span class="k">Intraday volume coverage</span><span class="v" id="coverage">UNAVAILABLE</span></div>
<div class="row"><span class="k">Live equity confirmation</span><span class="v amber" id="equity">NOT QUALIFIED</span></div>
<div class="row"><span class="k">Participation reason</span><span class="v amber" id="e25reason">UNAVAILABLE</span></div>
<div class="row"><span class="k">Engine 29 tactical data</span><span class="v" id="e29context">UNAVAILABLE</span></div>
<div class="row"><span class="k">Engine 29 confirmation</span><span class="v amber" id="e29">UNAVAILABLE</span></div>
<div class="row"><span class="k">Engine 29 missing evidence</span><span class="v amber" id="e29missing">UNAVAILABLE</span></div>
<div class="row"><span class="k">QQQ hourly reaction</span><span class="v" id="qqq">UNAVAILABLE</span></div>
<div class="row"><span class="k">VIX hourly reaction</span><span class="v" id="vix">UNAVAILABLE</span></div></details></section>
<section class="card full"><h2>Engine 29 — Micro tactical evidence</h2>
<div class="e29-summary">
<div><span class="k">Bigger picture</span><strong id="e29big">UNAVAILABLE</strong></div>
<div><span class="k">1H tactical</span><strong id="e29tactical">UNAVAILABLE</strong></div>
<div><span class="k">30m fast shift</span><strong id="e29fast">UNAVAILABLE</strong></div>
<div><span class="k">ES parent move</span><strong id="e29move">UNAVAILABLE</strong></div></div>
<div class="row"><span class="k">Engine 29 evidence qualification</span><span class="v amber" id="e29quality">UNAVAILABLE</span></div>
<details class="details"><summary>View liquidity, trap, squeeze and market internals</summary>
<div class="e29-summary">
<div><span class="k">Liquidity</span><strong id="e29liquidity">UNAVAILABLE</strong></div>
<div><span class="k">Trap</span><strong id="e29trap">UNAVAILABLE</strong></div>
<div><span class="k">Squeeze</span><strong id="e29squeeze">UNAVAILABLE</strong></div>
<div><span class="k">Missing confirmation</span><strong id="e29missing2">UNAVAILABLE</strong></div></div>
<div class="table-scroll"><table class="internals"><thead><tr><th>Market internal</th><th>Structural</th><th>1H tactical</th><th>30m fast</th></tr></thead><tbody id="e29rows"></tbody></table></div>
<p class="micro-note">These columns come from Engine 29 owner-published group states. Missing rows remain unavailable. Degraded or stale evidence is not live confirmation.</p>
<div class="row"><span class="k">Source timestamp</span><span class="v" id="e29timestamp">UNAVAILABLE</span></div>
</details></section>
<section class="card full"><h2>Live QQQ / VIX price action — independent of hourly candles</h2>
<div class="compact-grid">
<div><h2>QQQ — direct stock trades</h2>
<div class="big" id="qqqLivePrice">—</div>
<div class="row"><span class="k">Live feed</span><span class="v" id="qqqLiveState">UNAVAILABLE</span></div>
<div class="row"><span class="k">Latest price change</span><span class="v" id="qqqLiveMove">UNAVAILABLE</span></div>
<div class="row"><span class="k">Price observation time</span><span class="v" id="qqqLiveTime">UNAVAILABLE</span></div></div>
<div><h2>VIX — direct calculated index value</h2>
<div class="big" id="vixLivePrice">—</div>
<div class="row"><span class="k">Live feed</span><span class="v" id="vixLiveState">UNAVAILABLE</span></div>
<div class="row"><span class="k">Latest value change</span><span class="v" id="vixLiveMove">UNAVAILABLE</span></div>
<div class="row"><span class="k">Index observation time</span><span class="v" id="vixLiveTime">UNAVAILABLE</span></div></div>
</div><p class="micro-note">Direct Polygon event observations; provider latency and connectivity are checked. VIX is a calculated index, not a traded stock. Live changes are diagnostic only and cannot authorize ES trades.</p></section>
<section class="card full"><h2>QQQ &amp; VIX — direct hourly market reactions</h2>
<div class="compact-grid">
<div><h2>QQQ · Nasdaq participation reference</h2>
<div class="row"><span class="k">Reaction status</span><span class="v" id="qqqDirect">UNAVAILABLE</span></div>
<div class="row"><span class="k">Evidence qualification</span><span class="v amber" id="qqqQualification">NOT CURRENT</span></div>
<div class="row"><span class="k">Latest completed 1H close</span><span class="v" id="qqqClose">UNAVAILABLE</span></div>
<div class="row"><span class="k">Confirmed / candidates</span><span class="v" id="qqqCounts">0 / 0</span></div></div>
<div><h2>VIX · Direct volatility index</h2>
<div class="row"><span class="k">Reaction status</span><span class="v" id="vixDirect">UNAVAILABLE</span></div>
<div class="row"><span class="k">Evidence qualification</span><span class="v amber" id="vixQualification">NOT CURRENT</span></div>
<div class="row"><span class="k">Latest completed 1H close</span><span class="v" id="vixClose">UNAVAILABLE</span></div>
<div class="row"><span class="k">Confirmed / candidates</span><span class="v" id="vixCounts">0 / 0</span></div></div>
</div><p class="micro-note">Completed hourly observations only. Candidate reactions are not confirmed. Stale or missing candles do not provide live ES trade permission.</p></section>
<section class="card"><h2>Schwab Micro account ••••6380</h2><div class="row"><span class="k">OPEN MES units (REAL)</span><span class="v" id="positions">UNAVAILABLE</span></div><div class="row"><span class="k">Position direction</span><span class="v" id="positionDirection">UNAVAILABLE</span></div><div class="row"><span class="k">Position source</span><span class="v" id="positionSource">UNAVAILABLE</span></div><div class="row"><span class="k">Original entry structure</span><span class="v amber" id="entry">ENTRY_STRUCTURE_UNAVAILABLE</span></div><div class="row"><span class="k">Official Engine 9 plan</span><span class="v" id="plan">UNAVAILABLE</span></div><div class="row"><span class="k">Hold / exit recommendation</span><span class="v">NONE — SHADOW ONLY</span></div></section>
<section class="card"><h2>Evidence quality</h2><div class="row"><span class="k">Snapshot state</span><span class="v" id="snapshot">UNAVAILABLE</span></div><div class="row"><span class="k">Historical calibration</span><span class="v">NOT CALIBRATED</span></div><div class="row"><span class="k">Execution permission</span><span class="v teal">DISABLED</span></div><div class="row"><span class="k">Last check</span><span class="v" id="updated">—</span></div></section>
</div><p class="foot">A trade touching a Fibonacci reference is NOT an Elliott wave completion. Missing source data is shown as UNAVAILABLE. All displayed price observations are read-only.</p></main>
<script>
const $=id=>document.getElementById(id);const set=(id,v)=>$(id).textContent=v===null||v===undefined||v===""?"UNAVAILABLE":String(v);
async function refresh(){try{const r=await fetch("/shadow/state",{cache:"no-store"});if(!r.ok)throw Error("Source unavailable");const d=await r.json(),o=d.observation??{},m=d.micro??{},mkt=m.modules?.marketConfirmation??{},na=m.modules?.neighboringAlignment??{};
set("feed",d.feed?.status??"UNAVAILABLE");set("received",d.feed?.diagnostics?.receivedTrades??0);set("qualified",d.feed?.diagnostics?.acceptedTrades??0);set("lag",Number.isFinite(d.feed?.diagnostics?.lastTradeLagMs)?Math.round(d.feed.diagnostics.lastTradeLagMs/1000)+" seconds":"UNAVAILABLE");set("issue",d.feed?.diagnostics?.lastRejectedReason??d.feed?.consumerReasonCodes?.[0]??"NONE");set("price",o.available?o.currentPrice:"UNAVAILABLE");set("last",o.available?o.lastTradeAt:"UNAVAILABLE");set("contract",d.feed?.contract??"UNAVAILABLE");
set("wave",d.owner?.activeWave&&d.owner?.direction?d.owner.activeWave+" "+d.owner.direction:"UNAVAILABLE");
set("confirm",d.owner?.confirmationStatus??"UNAVAILABLE");set("fib",o.nextProvisionalReference?.price??"UNAVAILABLE");
set("touch",o.available?(o.provisionalTouches?.length?"PRICE TOUCH — NOT CONFIRMED":"NO NEW TOUCH"):"UNAVAILABLE");
set("left",na.neighbors?.submicro?.direction??"UNAVAILABLE");set("right",na.neighbors?.subminute?.direction??"UNAVAILABLE");set("neighbors",na.state??"UNAVAILABLE");
const ev=d.marketEvidence??{},a=ev.engine25??{},b=ev.engine29??{};
const q=ev.microOverview??{},hour=ev.oneHour??{};
set("metricHealth",Number.isFinite(q.health?.value)?Math.round(q.health.value):"—");set("metricHealthSub",q.health?.label??"UNAVAILABLE");
set("metricBreadth",Number.isFinite(q.breadth?.value)?Math.round(q.breadth.value):"—");set("metricBreadthSub",q.breadth?.label??"UNAVAILABLE");
set("metricVolume",Number.isFinite(q.volume?.value)?q.volume.value.toFixed(1)+"%":"—");set("metricVolumeSub",q.volume?.qualified?"COVERAGE QUALIFIED":"COVERAGE / NOT QUALIFIED");
set("metricDistribution",Number.isFinite(q.distribution?.value)?Math.round(q.distribution.value):"—");set("metricDistributionSub",q.distribution?.label??"UNAVAILABLE");
set("metricSectors",Number.isFinite(q.sectors?.value)?q.sectors.value:"—");set("metricSectorsSub",(q.sectors?.label??"UNAVAILABLE")+" · "+(q.sectors?.freshness??"UNAVAILABLE"));
set("hourState",hour.state??"UNAVAILABLE");set("hourSectors",[hour.strong,hour.neutral,hour.weak].every(Number.isFinite)?[hour.strong,hour.neutral,hour.weak].join(" / "):"UNAVAILABLE");
set("hourFreshness",hour.freshness??"UNAVAILABLE");set("hourTimestamp",hour.sourceTimestamp??"UNAVAILABLE");
set("hourQualification",hour.sourceQualified?"QUALIFIED":"NOT QUALIFIED");
set("e25",mkt.sources?.engine25?.state??"UNAVAILABLE");
set("e25source",a.sourcePresent?"DATA PRESENT":"SOURCE UNAVAILABLE");
set("breadth",a.breadth?.label?(a.breadth.score===null?a.breadth.label:(a.breadth.score+" — "+a.breadth.label)):"UNAVAILABLE");
const sectors=a.sectors??{};set("sectors",Number.isFinite(sectors.bullish)&&Number.isFinite(sectors.neutral)&&Number.isFinite(sectors.bearish)?(sectors.bullish+" bullish / "+sectors.neutral+" neutral / "+sectors.bearish+" bearish"):"UNAVAILABLE");
set("coverage",Number.isFinite(a.volumeCoveragePct)?a.volumeCoveragePct.toFixed(2)+"%":"UNAVAILABLE");
set("equity",a.liveConfirmationQualified?"QUALIFIED":a.sourcePresent?"NOT QUALIFIED":"SOURCE UNAVAILABLE");
set("e25reason",a.participationReason??a.participationFreshness??"UNAVAILABLE");
set("e29context",b.sourcePresent?(b.tacticalState??b.overallState??"DATA PRESENT"):"SOURCE UNAVAILABLE");
set("e29",b.qualified?(mkt.sources?.engine29?.state??"QUALIFIED"):b.sourcePresent?(b.dataDegraded?"DEGRADED — NOT QUALIFIED":"NOT QUALIFIED"):"SOURCE UNAVAILABLE");
set("e29missing",b.sourcePresent?(b.missingConfirmations?.length?b.missingConfirmations.join(", "):"NONE REPORTED"):"UNAVAILABLE");
for(const [id,path] of [["qqq","qqq"],["vix","vix"]])set(id,mkt.sources?.[path]?.state??"UNAVAILABLE");
const n29=d.engine29MicroDisplay??{};
set("e29big",n29.biggerPicture??"UNAVAILABLE");set("e29tactical",n29.tactical??"UNAVAILABLE");
set("e29fast",n29.fastShift??"UNAVAILABLE");set("e29move",n29.move??"UNAVAILABLE");
set("e29quality",n29.qualified?"QUALIFIED":n29.present?(n29.quality+" — NOT QUALIFIED"):"SOURCE UNAVAILABLE");
set("e29liquidity",n29.liquidity??"UNAVAILABLE");set("e29trap",n29.trap??"UNAVAILABLE");
set("e29squeeze",n29.squeeze??"UNAVAILABLE");
set("e29missing2",n29.present?(n29.missingConfirmations?.length?n29.missingConfirmations.join(", "):"NONE REPORTED"):"UNAVAILABLE");
set("e29timestamp",n29.timestamp??"UNAVAILABLE");
const body=$("e29rows");body.replaceChildren();
for(const row of n29.rows??[]){
 const tr=document.createElement("tr");
 for(const value of [row.label,row.structural,row.hourly,row.thirtyMinute]){
  const td=document.createElement("td");td.textContent=value??"UNAVAILABLE";tr.appendChild(td);
 }
 body.appendChild(tr);
}
const a10=d.engine10MicroAccount??{};
const cm=d.liveCrossMarket??{};
for(const [key,prefix] of [["QQQ","qqq"],["VIX","vix"]]){
 const live=cm[key]??{};
 set(prefix+"LivePrice",live.available?live.price:"—");
 set(prefix+"LiveState",live.state??"UNAVAILABLE");
 set(prefix+"LiveMove",live.available?live.movement:"UNAVAILABLE");
 set(prefix+"LiveTime",live.sourceTime??"UNAVAILABLE");
}
const xv=d.qqqVix??{};
for(const [key,prefix] of [["qqq","qqq"],["vix","vix"]]){
 const z=xv[key]??{};
 set(prefix+"Direct",z.state??"UNAVAILABLE");
 set(prefix+"Qualification",z.qualification??"NOT CURRENT");
 set(prefix+"Close",z.lastHourlyCandleCloseAt??"UNAVAILABLE");
 set(prefix+"Counts",(z.confirmedCount??0)+" / "+(z.candidateCount??0));
}
set("positions",a10.available?a10.openContracts:"UNAVAILABLE");
set("positionDirection",a10.available?a10.direction:"UNAVAILABLE");
set("positionSource",a10.available?"ENGINE 10 / SNAPSHOT AGGREGATE":"UNAVAILABLE");
set("entry",a10.available?a10.entryThesisStatus:"ENTRY_STRUCTURE_UNAVAILABLE");
set("plan",a10.officialPlanStatus??"OFFICIAL_PLAN_UNAVAILABLE");
set("snapshot",d.snapshotStatus??"UNAVAILABLE");set("updated",d.updatedAt??"UNAVAILABLE");
}catch{set("feed","UNAVAILABLE");set("price","UNAVAILABLE");set("last","UNAVAILABLE");set("snapshot","UNAVAILABLE");}}
refresh();setInterval(refresh,2500);
</script></body></html>`;
