import fs from 'node:fs';import {inflateSync} from 'node:zlib';import {digest} from '../../../logic/engine11/tradingViewBasisResearchV1/compare.js';
export function readPacket(){const p=JSON.parse(inflateSync(Buffer.from(fs.readFileSync('docs/architecture/evidence/engine11-tradingview-five-node-comparison-v1.json.zlib.b64','utf8').trim(),'base64'))),{packetVersion,...body}=p;if(packetVersion!=='tv-coordinate-research:'+digest(body))throw Error('PACKET_DIGEST');return p;}
if(process.argv[1]?.endsWith('readPacket.mjs'))console.log(JSON.stringify(readPacket(),null,2));
