import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const route=readFileSync(new URL('../routes/futuresOhlc.js',import.meta.url),'utf8');
test('route evidence metadata is feature-gated OFF by default',()=>{
 assert.match(route,/ENGINE11_SOURCE_RECEIPT_V3_ENABLED === "1"/);
 assert.match(route,/String\(req\.query\.evidence \|\| ""\) === "1"/);
 assert.match(route,/return res\.json\(evidence \? \{ bars, engine11Receipt: result\.engine11Receipt \} : bars\)/);
});
test('route reuses existing upstream response without extra fetch',()=>{
 assert.equal((route.match(/await fetch\(url\.toString\(\)/g)||[]).length,2); // resolver + aggregate
 assert.match(route,/const reader = r\.body\.getReader\(\)/);
 assert.match(route,/engine11Receipt = captureReceiptV3/);
 assert.doesNotMatch(route,/writeFile|createWriteStream|bodyStore|mkdirSync/);
});
