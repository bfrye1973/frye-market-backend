import fs from 'node:fs';import {inflateSync} from 'node:zlib';import {hash} from '../../../logic/engine11/continuousChartResearchV1/series.js';
export function readHandoff(){const p=JSON.parse(inflateSync(Buffer.from(fs.readFileSync('docs/architecture/evidence/engine11-research-chart-preview-handoff-v1.json.zlib.b64','utf8').trim(),'base64'))),{handoffVersion,...body}=p;if(handoffVersion!=='preview-handoff:'+hash(body))throw Error('HANDOFF_DIGEST');return p;}
if(process.argv[1]?.endsWith('read.mjs'))console.log(JSON.stringify(readHandoff(),null,2));
