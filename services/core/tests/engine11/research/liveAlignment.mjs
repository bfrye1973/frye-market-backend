import { mkdir, writeFile } from 'node:fs/promises';
import { requestJson } from './coverageAudit.mjs';
import { hash } from '../../../logic/engine11/rawCandles/identity.js';
import { createHash } from 'node:crypto';
const apiKey = process.env.POLYGON_API_KEY;
if (!apiKey) throw new Error('Existing credential required');
const samples = [];
for (const [ticker, from, to] of [['ESH0','2020-03-09T20:00:00Z','2020-03-10T00:00:00Z'], ['ESU6','2026-09-09T20:00:00Z','2026-09-10T00:00:00Z']]) {
  const data = {};
  for (const resolution of ['4hour','1hour']) {
    const url = new URL('https://api.massive.com/futures/v1/aggs/' + ticker);
    url.search = new URLSearchParams({ resolution, 'window_start.gte': String(BigInt(Date.parse(from))*1000000n), 'window_start.lt': String(BigInt(Date.parse(to))*1000000n), limit:'100',sort:'window_start.asc' });
    const response = await requestJson(url.toString(), { apiKey, captureSuccessBody: true });
    data[resolution] = { httpStatus: response.status, requestDigest: hash(url.toString()),
      payload: response.body, originalSuccessBodyText: response.bodyText ?? null,
      bodyUtf8Sha256: response.bodyText ? createHash('sha256').update(response.bodyText,'utf8').digest('hex') : null,
      traversalComplete: !!response.body && !response.body.next_url };
  }
  const reconciliation = (data['4hour'].payload?.results ?? []).map(parent => {
    const children = (data['1hour'].payload?.results ?? []).filter(row => row.session_end_date === parent.session_end_date && BigInt(row.window_start)>=BigInt(parent.window_start) && BigInt(row.window_start)<BigInt(parent.window_start)+14400000000000n);
    const aggregate = children.length ? { open:children[0].open,high:Math.max(...children.map(x=>x.high)),low:Math.min(...children.map(x=>x.low)),close:children.at(-1).close,volume:children.reduce((a,x)=>a+x.volume,0),transactions:children.reduce((a,x)=>a+x.transactions,0) } : null;
    return { parent, children, aggregate, matched: !!aggregate && Object.keys(aggregate).every(k=>aggregate[k]===parent[k]) };
  });
  const item = { ticker,from,to, observedAt:new Date().toISOString(),purpose:'ISOLATED_RESEARCH_ONLY', data,reconciliation,
    conclusion:'Comparison is evidence only; no calendar, source identity, causality or analytical interval is approved.' };
  samples.push(item); console.log('ALIGNMENT_EVIDENCE '+JSON.stringify(item));
}
await mkdir('research-evidence',{recursive:true});
await writeFile('research-evidence/es-alignment-reconciliation.json',JSON.stringify(samples,null,2)+'\n');
