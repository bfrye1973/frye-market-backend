// Reusable pure authorization/CORS guard for read-only Engine22 node history.
// No Express dependency; tests run without installing backend dependencies.
// The existing Bearer token remains required for full history/workbook routes.
import {createHash,timingSafeEqual} from "node:crypto";
const CHART_ORIGIN="https://frye-dashboard.onrender.com";
const PATHS=new Set(["/nodes","/nodes/current"]);
const hash=x=>createHash("sha256").update(x).digest();
export function authorizedOwnerNodeRead(req,settings=process.env){
 if(req.method!=="GET"||!PATHS.has(req.path)||
    settings.ENGINE2C_HISTORY_ENABLED!=="true"||
    settings.ENGINE2C_HISTORY_LICENSED!=="true")return false;
 const origin=req.get("origin");
 if(origin&&origin!==CHART_ORIGIN)return false;
 const expected=settings.ENGINE2C_HISTORY_OWNER_KEY;
 const provided=req.get("x-engine2c-access");
 if(typeof expected!=="string"||expected.length<32||
    typeof provided!=="string"||provided.length<16||provided.length>2048)return false;
 return timingSafeEqual(hash(provided),hash(expected));
}
export function setRestrictedNodeCors(req,res){
 const origin=req.get("origin");
 res.set("Vary","Origin, Access-Control-Request-Headers");
 res.removeHeader("Access-Control-Allow-Credentials");
 if(origin===CHART_ORIGIN){
  res.set("Access-Control-Allow-Origin",CHART_ORIGIN);
  res.set("Access-Control-Allow-Headers","Accept, X-Engine2C-Access");
  res.set("Access-Control-Allow-Methods","GET, OPTIONS");
 } else {
  res.removeHeader("Access-Control-Allow-Origin");
  res.removeHeader("Access-Control-Allow-Headers");
  res.removeHeader("Access-Control-Allow-Methods");
 }
}
// Mounted before the existing global CORS preflight handler.
export function nodeHistoryPreflight(req,res){
 setRestrictedNodeCors(req,res);
 res.set("Cache-Control","no-store");
 return res.status(204).end();
}
