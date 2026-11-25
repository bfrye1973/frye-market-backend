// Engine 8D optional PAPER-only browser session boundary.
// Browser NEVER receives ENGINE8_ADMIN_SECRET. A separately admin-authorized,
// one-time pairing grants a short-lived in-memory bearer session.
// No Schwab or REAL broker privileges are delegated here.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import {PAPER_DATA_DIR,atomicPaperWrite,withPaperInstructionLock} from "./engine8PaperDurableStore.js";
const FILE=path.join(PAPER_DATA_DIR,"manual-paper-access-v1.json");
const sha=value=>crypto.createHash("sha256").update(value).digest("hex");
const now=()=>Date.now();
function allowOrigin(origin) {
  const configured=String(process.env.ENGINE8_MANUAL_PAPER_ALLOWED_ORIGINS||"")
    .split(",").map(v=>v.trim()).filter(Boolean);
  return origin && configured.includes(origin);
}
function read(){
  if(!fs.existsSync(FILE))return {version:1,pairing:null,sessions:{}};
  const x=JSON.parse(fs.readFileSync(FILE,"utf8"));
  if(x?.version!==1 || typeof x.sessions!=="object" || !x.sessions || Array.isArray(x.sessions))
    throw Error("PAPER_ACCESS_RECORD_INVALID");
  return x;
}
async function mutate(operation) {
  return withPaperInstructionLock("__ENGINE8_PAPER_GLOBAL_WRITE__",operation);
}
export async function issueManualPaperPairing() {
  return mutate(()=>{
    const code=crypto.randomBytes(24).toString("base64url");
    const state=read();
    state.pairing={hash:sha(code),expiresAt:now()+5*60*1000};
    atomicPaperWrite(FILE,state);
    return {ok:true,pairingCode:code,expiresInSeconds:300};
  });
}
export async function redeemManualPaperPairing({pairingCode,origin}={}) {
  if(!allowOrigin(origin))return {ok:false,reason:"MANUAL_PAPER_ORIGIN_NOT_ALLOWED"};
  const code=String(pairingCode||"");
  if(code.length<20||code.length>128)return {ok:false,reason:"PAIRING_CODE_INVALID"};
  return mutate(()=>{
    const state=read();
    if(!state.pairing||state.pairing.expiresAt<now()||
      !crypto.timingSafeEqual(Buffer.from(state.pairing.hash,"hex"),Buffer.from(sha(code),"hex")))
      return {ok:false,reason:"PAIRING_CODE_INVALID_OR_EXPIRED"};
    state.pairing=null; // one time only
    const token=crypto.randomBytes(32).toString("base64url");
    const expiresAt=now()+60*60*1000;
    state.sessions[sha(token)]={origin,expiresAt};
    atomicPaperWrite(FILE,state);
    return {ok:true,accessToken:token,expiresAt:new Date(expiresAt).toISOString()};
  });
}
export function requireManualPaperSession(req,res,next){
  try{
    const origin=req.headers.origin;
    if(!allowOrigin(origin))
      return res.status(403).json({ok:false,reason:"MANUAL_PAPER_ORIGIN_NOT_ALLOWED"});
    const bearer=String(req.headers.authorization||"");
    if(!/^Bearer [A-Za-z0-9_-]{40,128}$/.test(bearer))
      return res.status(401).json({ok:false,reason:"MANUAL_PAPER_SESSION_REQUIRED"});
    const token=bearer.slice(7),state=read();
    const session=state.sessions[sha(token)];
    if(!session||session.origin!==origin||session.expiresAt<now())
      return res.status(401).json({ok:false,reason:"MANUAL_PAPER_SESSION_INVALID"});
    return next();
  }catch{
    return res.status(503).json({ok:false,reason:"MANUAL_PAPER_ACCESS_STORE_UNAVAILABLE"});
  }
}
