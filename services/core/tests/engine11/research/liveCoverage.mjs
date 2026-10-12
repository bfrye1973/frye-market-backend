import { mkdir, writeFile } from 'node:fs/promises';
import { requestJson, verifyContract, probeAggregates } from './coverageAudit.mjs';
const apiKey = process.env.POLYGON_API_KEY;
if (!apiKey) throw new Error('Existing provider credential unavailable; do not purchase or change plans.');
const report = { schema: 'engine11.coverage-research.v1', purpose: 'ISOLATED_RESEARCH_ONLY',
  startedAt: new Date().toISOString(), sourceFinality: 'UNKNOWN', calendarAccepted: false,
  structuralEligible: false, coverageComplete: false, contracts: [], diagnostics: [],
  policy: 'Empty, denied and missing data are negative evidence. No synthetic filling, publication or consumer cutover.' };
const quarters = [['H', '03'], ['M', '06'], ['U', '09'], ['Z', '12']];
// 40 point-in-time contract lookups and at most 40 small annual/session probes.
// A one-page native session query can return at most ~252 rows per contract/year.
for (let year = 2017; year <= 2026; year++) for (const [code, month] of quarters) {
  const ticker = 'ES' + code + String(year).at(-1), date = `${year}-${month}-01`;
  const url = new URL('https://api.massive.com/futures/v1/contracts');
  url.search = new URLSearchParams({ date, product_code: 'ES', ticker, limit: '100' }).toString();
  const metadata = await requestJson(url.toString(), { apiKey });
  const identity = verifyContract(metadata.body?.results ?? [], ticker, year);
  const item = { fullContract: 'ES' + code + year, ticker, metadataDate: date, metadataStatus: metadata.status, ...identity };
  if (identity.verified) {
    item.sessionProbe = await probeAggregates({ ticker, from: `${year}-01-01T00:00:00.000Z`,
      to: `${year + 1}-01-01T00:00:00.000Z`, apiKey });
  } else item.unavailable = 'FULL_YEAR_IDENTITY_NOT_VERIFIED';
  report.contracts.push(item);
  console.log('CONTRACT_EVIDENCE ' + JSON.stringify(item));
}
const diagnosticSpecs = [
  { name: 'pre_documented_2017_floor', ticker: 'ESZ6', from: '2016-09-01T00:00:00.000Z', to: '2017-01-01T00:00:00.000Z' },
  { name: 'documented_2017_start', ticker: 'ESM7', from: '2017-03-01T00:00:00.000Z', to: '2017-05-01T00:00:00.000Z' },
  { name: 'normal_session_and_maintenance', ticker: 'ESU6', from: '2026-09-10T20:00:00.000Z', to: '2026-09-10T22:15:00.000Z', resolution: '1min', stepMs: 60000 },
  { name: 'weekend_absence', ticker: 'ESU6', from: '2026-09-12T12:00:00.000Z', to: '2026-09-12T13:00:00.000Z', resolution: '1min', stepMs: 60000 },
  { name: 'dst_spring_transition', ticker: 'ESH6', from: '2026-03-06T22:00:00.000Z', to: '2026-03-09T23:00:00.000Z', resolution: '1min', stepMs: 60000 },
  { name: 'legacy_1day_semantics', ticker: 'ESU6', from: '2026-09-09T00:00:00.000Z', to: '2026-09-12T00:00:00.000Z', resolution: '1day' },
  { name: 'native_session_semantics', ticker: 'ESU6', from: '2026-09-09T00:00:00.000Z', to: '2026-09-12T00:00:00.000Z' },
  { name: 'authentic_over_50000_pagination', ticker: 'ESU6', from: '2026-06-01T00:00:00.000Z', to: '2026-09-18T13:30:00.000Z', resolution: '1min', maxPages: 5, stepMs: 60000 },
  { name: 'repeat_historical_observation_a', ticker: 'ESU6', from: '2026-09-10T13:00:00.000Z', to: '2026-09-10T13:30:00.000Z', resolution: '10min', stepMs: 600000 },
  { name: 'repeat_historical_observation_b', ticker: 'ESU6', from: '2026-09-10T13:00:00.000Z', to: '2026-09-10T13:30:00.000Z', resolution: '10min', stepMs: 600000 }
];
for (const spec of diagnosticSpecs) {
  const result = { name: spec.name, identityAccepted: false, ...await probeAggregates({ ...spec, apiKey }) };
  // Diagnostics intentionally do not assert full-year identity or completeness.
  // Short-ticker samples cannot be promoted independently of metadata findings.
  report.diagnostics.push(result); console.log('DIAGNOSTIC_EVIDENCE ' + JSON.stringify(result));
}
report.finishedAt = new Date().toISOString();
report.summary = { verifiedContractIdentities: report.contracts.filter(x => x.verified).length,
  contractsWithObservedData: report.contracts.filter(x => x.sessionProbe?.inRangeRows > 0).length,
  unavailableContracts: report.contracts.filter(x => !x.verified || !x.sessionProbe?.inRangeRows).map(x => x.fullContract),
  integrityFindings: [...report.contracts.flatMap(x => x.sessionProbe ? [x.sessionProbe] : []), ...report.diagnostics]
    .filter(x => x.errors.length || x.conflicts).map(x => ({ ticker: x.ticker, from: x.from, errors: x.errors, conflicts: x.conflicts })),
  repeatIdentical: report.diagnostics.at(-1).rowDigest === report.diagnostics.at(-2).rowDigest,
  finalityConclusion: 'Matching repeat observations do not establish provider finality or a completion watermark.' };
await mkdir('research-evidence', { recursive: true });
await writeFile('research-evidence/es-history-coverage.json', JSON.stringify(report, null, 2) + '\n');
console.log('RESEARCH_SUMMARY ' + JSON.stringify(report.summary));
// A green research run means the bounded experiment executed; it does not mean
// historical source acceptance. All negative results remain in the artifact.
