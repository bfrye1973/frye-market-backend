import fs from 'node:fs';import assert from 'node:assert/strict';import {gunzipSync,inflateSync} from 'node:zlib';import {comparisonPacket,digest,ORIGINAL_SHA} from '../../../logic/engine11/tradingViewBasisResearchV1/compare.js';import {readPacket} from './readPacket.mjs';
const raw=gunzipSync(fs.readFileSync(process.argv[2]));if(digest(raw)!==ORIGINAL_SHA)throw Error('AUTHENTIC_ARCHIVE_DIGEST');
const r=JSON.parse(inflateSync(Buffer.from(fs.readFileSync('docs/architecture/evidence/engine11-seven-degree-reconciliation-v1.json.zlib.b64','utf8').trim(),'base64')));
assert.deepEqual(comparisonPacket(r,JSON.parse(raw)),readPacket());console.log('EXACT_FIVE_NODE_PACKET_REPLAY: 5 nodes / 55 source observations / 0 chart promotions');
