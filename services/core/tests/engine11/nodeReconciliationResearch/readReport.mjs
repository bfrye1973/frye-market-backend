import fs from 'node:fs';import {inflateSync} from 'node:zlib';
import {hash} from '../../../logic/engine11/acceptanceResearchV1/eligibility.js';
const [encoded,manifest]=process.argv.slice(2);if(!encoded||!manifest)throw Error('Usage: readReport.mjs REPORT_ZLIB_B64 REPORT_INTEGRITY_JSON');
const bytes=inflateSync(Buffer.from(fs.readFileSync(encoded,'utf8').trim(),'base64')),m=JSON.parse(fs.readFileSync(manifest,'utf8'));if(hash(bytes)!==m.reportSha256)throw Error('RECONCILIATION_REPORT_TAMPER');
const report=JSON.parse(bytes);if(report.nodes.length!==40||report.fibs.length!==34||report.structuralEligible!==false)throw Error('RECONCILIATION_REPORT_SCOPE');console.log(bytes.toString('utf8'));
