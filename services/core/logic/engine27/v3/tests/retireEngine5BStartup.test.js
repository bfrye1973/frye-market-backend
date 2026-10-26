import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
const source=new URL("../../../../streamer/server.js",import.meta.url);
test("Backend2 does not import, run, or mount retired Engine5B",()=>{
 const s=fs.readFileSync(source,"utf8");
 assert.equal(s.includes("startEngine5B"),false);
 assert.equal(s.includes("scalpRouter"),false);
 assert.equal(s.includes('routes/scalp.js'),false);
 assert.equal(s.includes('engine5b/runner.js'),false);
});
test("Existing general market and ES futures streaming routes remain mounted",()=>{
 const s=fs.readFileSync(source,"utf8");
 assert.ok(s.includes('app.use("/stream", streamRouter)'));
 assert.ok(s.includes('app.use("/stream/futures", futuresRouter)'));
 assert.ok(s.includes('app.get("/healthz"'));
});
