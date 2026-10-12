import { mkdir, writeFile } from 'node:fs/promises';
import { probeAggregates } from './coverageAudit.mjs';
const apiKey = process.env.POLYGON_API_KEY;
if (!apiKey) throw new Error('Existing provider credential required.');
const specs = [
  { ticker: 'ESH0', from: '2020-03-09T00:00:00.000Z', to: '2020-03-11T00:00:00.000Z', resolution: '4hour' },
  { ticker: 'ESU6', from: '2026-09-09T00:00:00.000Z', to: '2026-09-12T00:00:00.000Z', resolution: '4hour' },
  { ticker: 'ESH0', from: '2020-03-01T00:00:00.000Z', to: '2020-04-01T00:00:00.000Z', resolution: '5min' },
  { ticker: 'ESH5', from: '2025-01-01T00:00:00.000Z', to: '2025-04-01T00:00:00.000Z', resolution: '5min' },
  { ticker: 'ESH0', from: '2020-03-01T00:00:00.000Z', to: '2020-04-01T00:00:00.000Z', resolution: '1hour' }
];
const observations = [];
for (const spec of specs) {
  const result = await probeAggregates({ ...spec, apiKey });
  observations.push(result); console.log('COLLISION_EVIDENCE ' + JSON.stringify(result));
}
await mkdir('research-evidence', { recursive: true });
await writeFile('research-evidence/es-source-collision.json', JSON.stringify({ purpose: 'ISOLATED_RESEARCH_ONLY', observations }, null, 2) + '\n');
