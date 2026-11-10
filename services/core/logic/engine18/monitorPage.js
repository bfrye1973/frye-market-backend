// Public operational monitor only. No prices, market depth payloads, order IDs,
// credentials, tokens, or proprietary market events are served here.
export const ENGINE18_MONITOR_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Engine 18 | Liquidity Monitor</title>
<style>
:root{color-scheme:dark;font-family:system-ui,-apple-system,Segoe UI,sans-serif;background:#101722;color:#f3f6fa}
*{box-sizing:border-box}body{margin:0 auto;max-width:1020px;padding:32px 18px}
h1{font-size:29px;margin:8px 0}p{color:#aebac9;line-height:1.6}
.kicker{font-size:12px;letter-spacing:.14em;color:#8dc9ec;font-weight:750}
.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin:22px 0}
.card{background:#1b2533;border:1px solid #354357;border-radius:14px;padding:20px}
.card .label{color:#b8c4d3;font-size:13px}.card .value{font-size:29px;font-weight:750;margin-top:9px;font-variant-numeric:tabular-nums}
.good{color:#79daa0}.warning{color:#f3cb83}.bad{color:#f4a1a1}.muted{color:#91a3b6}
.header{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap}
.tag{padding:7px 12px;background:#243248;border-radius:99px;font-weight:700;font-size:13px}
table{border-collapse:collapse;width:100%;margin-top:14px;font-size:14px}
td{padding:12px 4px;border-bottom:1px solid #354357}td:last-child{text-align:right;font-variant-numeric:tabular-nums}
a{color:#a1cff9}small{color:#92a5b8}
@media(max-width:700px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}.card{padding:15px}}
</style></head><body>
<div class="kicker">FRYE DASHBOARD · ENGINE 18</div>
<div class="header"><h1>Liquidity Intelligence Monitor</h1><span id="status" class="tag">Connecting…</span></div>
<p>Ironbeam ES demo · Level 2 market depth and executed trades · Research-only monitoring</p>
<div class="grid">
<div class="card"><div class="label">Depth messages</div><div class="value" id="depth">—</div></div>
<div class="card"><div class="label">Trade messages</div><div class="value" id="trades">—</div></div>
<div class="card"><div class="label">Candidate liquidity zones</div><div class="value" id="zones">—</div></div>
<div class="card"><div class="label">Reconnects</div><div class="value" id="reconnects">—</div></div>
</div>
<div class="card"><strong>Data quality & connection</strong>
<table><tr><td>Market-data stream</td><td id="state">—</td></tr>
<tr><td>Latest message (Arizona time)</td><td id="last">—</td></tr>
<tr><td>Distinct order-book images</td><td id="images">—</td></tr>
<tr><td>Level 3 individual orders</td><td>Not connected</td></tr>
<tr><td>Data tier / timing</td><td>Demo · live entitlement not verified</td></tr>
<tr><td>Trade execution</td><td>Disabled</td></tr></table></div>
<p id="updated">Waiting for first refresh…</p>
<small>Operational counters only. A detected concentration is not a guaranteed liquidity target; no raw exchange market data is exposed. Counters reset when the service restarts. Refreshes every 5 seconds.</small>
<script>
(function(){
 const el=id=>document.getElementById(id);
 function num(v){return typeof v==='number'?v.toLocaleString('en-US'):'—';}
 async function refresh(){
  try{
   const response=await fetch('/health',{cache:'no-store'});
   if(!response.ok)throw Error('HTTP '+response.status);
   const d=await response.json(),m=d.ironbeamLevel2Status||{},f=m.frames||{},z=m.zoneSummary||{};
   el('status').textContent=m.connected?'RECEIVING':'NOT CONNECTED';
   el('status').className='tag '+(m.connected?'good':'warning');
   el('depth').textContent=num(f.d);el('trades').textContent=num(f.tr);
   el('zones').textContent=num(z.zoneCount);el('reconnects').textContent=num(m.reconnects);
   el('state').textContent=m.state||'UNKNOWN';el('images').textContent=num(z.images);
   el('last').textContent=m.lastFrameReceivedAt?new Date(m.lastFrameReceivedAt).toLocaleString('en-US',{timeZone:'America/Phoenix'}):'No messages yet';
   el('updated').textContent='Status checked '+new Date().toLocaleTimeString('en-US',{timeZone:'America/Phoenix'})+' Arizona';
  }catch{
   el('status').textContent='STATUS UNAVAILABLE';el('status').className='tag bad';
   el('updated').textContent='Unable to read Engine 18 health status.';
  }
 }
 refresh();setInterval(refresh,5000);
})();
</script></body></html>`;
