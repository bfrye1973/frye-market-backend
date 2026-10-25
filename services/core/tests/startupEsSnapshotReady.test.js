import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
const root=path.resolve(import.meta.dirname,"..");
test("Render server startup builds both SPY and ES snapshots",()=>{
 const src=fs.readFileSync(path.join(root,"server.js"),"utf8");
 const match=src.match(/function runStartupSnapshotBuild\(\) \{[\s\S]*?\n\}/);
 assert.ok(match,"startup snapshot helper must exist");
 assert.match(match[0],/spawn\("node", \["\.\/jobs\/buildAllStrategySnapshots\.js"\]/);
 assert.doesNotMatch(match[0],/spawn\("node", \["\.\/jobs\/buildStrategySnapshot\.js"\]/);
 const all=fs.readFileSync(path.join(root,"jobs/buildAllStrategySnapshots.js"),"utf8");
 assert.match(all,/const SYMBOLS = \["SPY", "ES"\]/);
 assert.match(all,/SYMBOL: symbol/);
 const route=fs.readFileSync(path.join(root,"routes/dashboardSnapshot.js"),"utf8");
 assert.match(route,/strategy-snapshot-es\.json/);
});
