import test from "node:test";
import assert from "node:assert/strict";
import {microShadowHtml} from "../../../../../streamer/shadow/microShadowView.js";
test("isolated Micro view explicitly labels shadow and not trading",()=>{
 assert.match(microShadowHtml,/ENGINE 27 V3/);assert.match(microShadowHtml,/SHADOW \/ NOT TRADING/);
 assert.match(microShadowHtml,/ENTRY_STRUCTURE_UNAVAILABLE/);
 assert.match(microShadowHtml,/NOT CALIBRATED/);
 assert.match(microShadowHtml,/\/shadow\/state/);
 assert.doesNotMatch(microShadowHtml,/Place order|Execute trade/);
});
test("no synthetic prices embedded in shadow view",()=>{
 assert.match(microShadowHtml,/id="price">UNAVAILABLE/);
 assert.match(microShadowHtml,/id="feed">UNAVAILABLE/);
});
