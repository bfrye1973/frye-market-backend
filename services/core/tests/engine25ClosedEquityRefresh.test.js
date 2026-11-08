import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isClosedEquityRefresh } from "../logic/engine25/closedEquityRefreshScope.js";

test("Sunday closed futures permits read-only participation refresh",()=>{
  assert.equal(isClosedEquityRefresh({mode:"live",systemOperatingSession:{operating:false,session:"CLOSED"}}),true);
});
test("ES maintenance permits read-only participation refresh without ES jobs",()=>{
  assert.equal(isClosedEquityRefresh({mode:"live",systemOperatingSession:{operating:false,session:"MAINTENANCE"}}),true);
});
test("Open futures retains existing LIVE jobs",()=>{
  assert.equal(isClosedEquityRefresh({mode:"live",systemOperatingSession:{operating:true,session:"ES_GLOBEX"}}),false);
});
test("CORE and FULL refreshes are unchanged",()=>{
  for(const mode of ["core","full"]) assert.equal(isClosedEquityRefresh({mode,systemOperatingSession:{operating:false}}),false);
});
test("Route selects participation only when ES closed, without ES trade or macro steps",()=>{
  const root=path.dirname(fileURLToPath(import.meta.url));
  const route=fs.readFileSync(path.resolve(root,"../routes/engine25Refresh.js"),"utf8");
  const marker=route.match(/const CLOSED_EQUITY_STEPS = \[([\s\S]*?)\];/);
  assert.ok(marker);
  assert.match(marker[1],/updateEngine25Participation\.js/);
  assert.doesNotMatch(marker[1],/es_zone|macro|context|full_market|news|permission|strategy/i);
  assert.match(route,/closedEquitySync\s*\?\s*CLOSED_EQUITY_STEPS/);
  assert.match(route,/closedEquitySync\s*\?\s*CLOSED_EQUITY_REQUIRED_FILES/);
  assert.match(route,/mode === "live" && !closedEquitySync/);
  assert.match(route,/esLiveStepsSkipped: closedEquitySync/);
});
