// Engine 18 isolated Render bootstrap. No external data connections or execution.
// The API key is injected only through Render's protected Environment settings.
// No secret values are ever returned or logged here.
import http from "node:http";
const port = Number(process.env.PORT || 10000);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error("ENGINE18_INVALID_PORT");
const service = http.createServer((req,res) => {
  const pathname = new URL(req.url || "/", "http://localhost").pathname;
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  if (req.method !== "GET" || !["/health","/"].includes(pathname)) {
    res.writeHead(404);
    res.end(JSON.stringify({ok:false,error:"NOT_FOUND"}));
    return;
  }
  res.writeHead(200);
  res.end(JSON.stringify({
    ok:true,
    service:"engine18-liquidity-intelligence",
    mode:"ISOLATED_BOOTSTRAP",
    tradingEnabled:false,
    liveMarketDataConnected:false,
    apiKeyConfigured:typeof process.env.DATABENTO_API_KEY==="string" &&
      process.env.DATABENTO_API_KEY.trim().length>0
  }));
});
service.listen(port,"0.0.0.0",()=>console.log("Engine 18 isolated bootstrap listening; no market-data collection or trading enabled"));
