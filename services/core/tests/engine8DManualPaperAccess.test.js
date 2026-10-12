import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
const dir=fs.mkdtempSync(path.join(os.tmpdir(),"manual-paper-session-"));
process.env.ENGINE8_PAPER_DATA_DIR=dir;
process.env.ENGINE8_MANUAL_PAPER_ALLOWED_ORIGINS="https://paper-ui.test";
const access=await import("../logic/trading/manualPaperAccessSession.js");
function verify(token,origin="https://paper-ui.test"){
  let status=200,body=null,allowed=false;
  const res={status(code){status=code;return this},json(x){body=x;return this}};
  access.requireManualPaperSession({headers:{origin,authorization:token? "Bearer "+token:""}},res,()=>{allowed=true});
  return {status,body,allowed};
}
test("no pairing means no browser manual trading privileges",()=>{
  assert.equal(verify().allowed,false);
  assert.equal(verify().status,401);
});
test("admin-created one-time pairing grants only approved origin",async()=>{
  const pairing=await access.issueManualPaperPairing();
  assert.equal(pairing.ok,true);
  assert.ok(pairing.pairingCode.length>20);
  const wrong=await access.redeemManualPaperPairing({pairingCode:pairing.pairingCode,origin:"https://untrusted.example"});
  assert.equal(wrong.ok,false);
  const valid=await access.redeemManualPaperPairing({pairingCode:pairing.pairingCode,origin:"https://paper-ui.test"});
  assert.equal(valid.ok,true);
  assert.equal(verify(valid.accessToken).allowed,true);
  assert.equal(verify(valid.accessToken,"https://untrusted.example").allowed,false);
  const duplicate=await access.redeemManualPaperPairing({pairingCode:pairing.pairingCode,origin:"https://paper-ui.test"});
  assert.equal(duplicate.ok,false);
  assert.equal(JSON.stringify(valid).includes("ENGINE8_ADMIN_SECRET"),false);
});
test("invalid and expired bearer tokens denied",async()=>{
  assert.equal(verify("invalid-token").allowed,false);
  const pairing=await access.issueManualPaperPairing();
  const valid=await access.redeemManualPaperPairing({pairingCode:pairing.pairingCode,origin:"https://paper-ui.test"});
  const file=path.join(dir,"manual-paper-access-v1.json");
  const state=JSON.parse(fs.readFileSync(file,"utf8"));
  for(const row of Object.values(state.sessions))row.expiresAt=1;
  fs.writeFileSync(file,JSON.stringify(state));
  assert.equal(verify(valid.accessToken).status,401);
});
test("manual execution, initialization, overview and Journal retry require operator authorization",()=>{
  const routes=fs.readFileSync(path.resolve("services/core/routes/trading.js"),"utf8");
  for(const endpoint of ["/manual-paper/execute","/manual-paper/retry-journal",
    "/manual-paper/overview","/manual-paper/initialize"]){
    const pos=routes.indexOf('"'+endpoint+'"');
    assert.ok(pos>0,"missing "+endpoint);
    assert.match(routes.slice(pos,pos+100),/requireManualPaperOperator/);
  }
  assert.match(routes,/router\.post\("\/manual-paper\/access\/pairing",requireEngine8Admin/);
});
process.on("exit",()=>fs.rmSync(dir,{recursive:true,force:true}));
