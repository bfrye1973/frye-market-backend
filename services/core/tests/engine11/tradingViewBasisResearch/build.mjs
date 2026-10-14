import fs from 'node:fs';import {inflateSync} from 'node:zlib';
import {comparisonPacket,digest,ORIGINAL_SHA} from '../../../logic/engine11/tradingViewBasisResearchV1/compare.js';
const [rawFile,encoded,output]=process.argv.slice(2);if(!output)throw Error('Usage: build.mjs ORIGINAL_JSON PHASE2_REPORT_ZLIB_B64 OUTPUT_JSON');
const raw=fs.readFileSync(rawFile);if(digest(raw)!==ORIGINAL_SHA)throw Error('ORIGINAL_ARCHIVE_DIGEST');
const r=JSON.parse(inflateSync(Buffer.from(fs.readFileSync(encoded,'utf8').trim(),'base64')));
const result=comparisonPacket(r,JSON.parse(raw));fs.writeFileSync(output,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify({packetVersion:result.packetVersion,nodes:result.nodes.length,observations:result.nodes.reduce((a,n)=>a+n.evidence.length,0),exactEndpointComparisons:result.nodes.map(n=>[n.registryNodeId,n.exactEndpointComparisons.length]),verified:result.verifiedChartCoordinates}));
