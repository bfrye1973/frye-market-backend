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
@media(max-width:540px){main{padding:12px}h1{font-size:18px}.big{font-size:25px}}
</style></head><body><main><header><div class="mast"><h1>ENGINE 27 V3 — MICRO INTELLIGENCE</h1><span class="pill">SHADOW / NOT TRADING</span></div>
<p>Read-only observation. No entries, exits, stops, order changes or trade authorization.</p></header>
<div class="grid">
<section class="card"><h2>Live ES price</h2><div class="big" id="price">UNAVAILABLE</div><div class="row"><span class="k">Feed state</span><span class="v" id="feed">UNAVAILABLE</span></div><div class="row"><span class="k">Last ES trade</span><span class="v" id="last">—</span></div><div class="row"><span class="k">Resolved contract</span><span class="v" id="contract">—</span></div><div class="row"><span class="k">Provider trade events</span><span class="v" id="received">0</span></div><div class="row"><span class="k">Qualified trades</span><span class="v" id="qualified">0</span></div><div class="row"><span class="k">Source latency</span><span class="v" id="lag">UNAVAILABLE</span></div><div class="row"><span class="k">Feed issue</span><span class="v amber" id="issue">UNAVAILABLE</span></div></section>
<section class="card"><h2>Engine 22 Micro wave</h2><div class="big" id="wave">UNAVAILABLE</div><div class="row"><span class="k">Owner confirmation</span><span class="v" id="confirm">UNAVAILABLE</span></div><div class="row"><span class="k">Next provisional Fib</span><span class="v amber" id="fib">UNAVAILABLE</span></div><div class="row"><span class="k">Touch vs confirmation</span><span class="v amber" id="touch">UNAVAILABLE</span></div></section>
<section class="card"><h2>Neighboring degrees</h2><div class="row"><span class="k">Submicro</span><span class="v" id="left">UNAVAILABLE</span></div><div class="row"><span class="k">Subminute</span><span class="v" id="right">UNAVAILABLE</span></div><div class="row"><span class="k">Assessment</span><span class="v" id="neighbors">UNAVAILABLE</span></div></section>
<section class="card"><h2>Market evidence</h2><div class="row"><span class="k">Engine 25 participation</span><span class="v" id="participation">UNAVAILABLE</span></div><div class="row"><span class="k">Equity scanner</span><span class="v" id="equity">UNAVAILABLE</span></div><div class="row"><span class="k">Engine 25</span><span class="v" id="e25">UNAVAILABLE</span></div><div class="row"><span class="k">Engine 29</span><span class="v" id="e29">UNAVAILABLE</span></div><div class="row"><span class="k">QQQ</span><span class="v" id="qqq">UNAVAILABLE</span></div><div class="row"><span class="k">VIX</span><span class="v" id="vix">UNAVAILABLE</span></div></section>
<section class="card"><h2>Schwab Micro account ••••6380</h2><div class="row"><span class="k">OPEN contracts</span><span class="v" id="positions">UNAVAILABLE</span></div><div class="row"><span class="k">Original entry structure</span><span class="v amber" id="entry">ENTRY_STRUCTURE_UNAVAILABLE</span></div><div class="row"><span class="k">Official Engine 9 plan</span><span class="v" id="plan">UNAVAILABLE</span></div><div class="row"><span class="k">Hold / exit recommendation</span><span class="v">NONE — SHADOW ONLY</span></div></section>
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
set("participation",d.participation?.state??"UNAVAILABLE");set("equity",d.participation?.liveConfirmationUsable?"LIVE CONFIRMATION ELIGIBLE":d.participation?.contextOnly?"CLOSED — CONTEXT ONLY":"NOT LIVE CONFIRMED");
for(const [id,path] of [["e25","engine25"],["e29","engine29"],["qqq","qqq"],["vix","vix"]])set(id,mkt.sources?.[path]?.state??"UNAVAILABLE");
set("positions",m.modules?.positionIntelligence?.available?m.positionAssessment?.openContractCount:"UNAVAILABLE");
set("entry",m.modules?.entryThesisMemory?.positions?.length?m.modules.entryThesisMemory.positions[0].state:"ENTRY_STRUCTURE_UNAVAILABLE");
set("plan",m.modules?.positionIntelligence?.available?"SEE VERIFIED PLAN DETAILS":"UNAVAILABLE");
set("snapshot",d.snapshotStatus??"UNAVAILABLE");set("updated",d.updatedAt??"UNAVAILABLE");
}catch{set("feed","UNAVAILABLE");set("price","UNAVAILABLE");set("last","UNAVAILABLE");set("snapshot","UNAVAILABLE");}}
refresh();setInterval(refresh,2500);
</script></body></html>`;
