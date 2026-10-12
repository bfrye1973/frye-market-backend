import { mkdir, writeFile } from 'node:fs/promises';
import { probeAggregates } from './coverageAudit.mjs';
import { degreeInputs, targetWindows } from './march2020Plan.mjs';
const apiKey = process.env.POLYGON_API_KEY;
if (!apiKey) throw new Error('Existing provider credential required; no new provider commitment authorized.');
const asOf = new Date().toISOString(), windows = targetWindows(asOf);
const report = { schema: 'engine11.march2020-research.v1', purpose: 'ISOLATED_RESEARCH_ONLY',
  acquisitionTarget: '2020-03-01T00:00:00.000Z', asOf,
  primaryAnchorApproved: false, continuousSeriesPublished: false, rolloverPolicySelected: false,
  sourceFinality: 'UNKNOWN', calendarAccepted: false, structuralEligible: false, observations: [] };
for (const window of windows) for (const input of degreeInputs) {
  const result = { fullContractCandidate: window.fullContract, contractIdentityAccepted: false,
    role: window.role, degree: input.degree, timeframe: input.timeframe,
    ...await probeAggregates({ ...window, ...input, apiKey, maxPages: 3 }) };
  report.observations.push(result);
  console.log('MARCH2020_EVIDENCE ' + JSON.stringify(result));
}
report.degreeReadiness = degreeInputs.map(input => {
  const rows = report.observations.filter(x => x.degree === input.degree);
  return { degree: input.degree, timeframe: input.timeframe, queriedWindows: rows.length,
    nonemptyWindows: rows.filter(x => x.inRangeRows > 0).length,
    returnedBars: rows.reduce((sum, x) => sum + x.inRangeRows, 0),
    failedWindows: rows.filter(x => !x.traversalComplete).map(x => ({ contract: x.fullContractCandidate, reason: x.failure })),
    integrityFindings: rows.filter(x => x.errors.length || x.conflicts).map(x => ({ contract: x.fullContractCandidate, errors: x.errors, conflicts: x.conflicts })),
    emptyWindows: rows.filter(x => x.inRangeRows === 0).map(x => x.fullContractCandidate),
    internalGapCount: rows.reduce((sum, x) => sum + x.gapCount, 0),
    readiness: 'DIAGNOSTIC_EVIDENCE_ONLY_NOT_STRUCTURAL_SOURCE_ACCEPTED',
    blockers: ['FULL_CONTRACT_LINEAGE', 'DATED_CALENDAR', 'COMPLETED_CANDLE_EVIDENCE', 'ROLLOVER_SELECTION', 'ENGINE22_SOURCE_SUFFICIENCY'] };
});
await mkdir('research-evidence', { recursive: true });
await writeFile('research-evidence/es-march2020-seven-degree.json', JSON.stringify(report, null, 2) + '\n');
console.log('MARCH2020_SUMMARY ' + JSON.stringify(report.degreeReadiness));
