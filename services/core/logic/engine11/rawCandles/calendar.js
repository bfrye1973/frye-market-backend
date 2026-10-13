import { hash, instant, requireTruth, RESOLUTIONS } from './identity.js';

// Phase 1 consumes an explicit, evidence-bearing interval plan. It does not
// invent a CME holiday schedule or mistake UTC-midnight for a trading session.
export function validateCalendarPlan(plan, query) {
  requireTruth(plan?.exchange === 'CME' && typeof plan.version === 'string' && plan.version.length > 0 &&
    typeof plan.alignmentVersion === 'string' && plan.alignmentVersion.length > 0 &&
    typeof plan.evidenceId === 'string' && plan.evidenceId.length > 0, 'CALENDAR_EVIDENCE_REQUIRED');
  requireTruth(plan.timeframe === query.timeframe && Array.isArray(plan.intervals) && plan.intervals.length <= 100000,
    'CALENDAR_TIMEFRAME_MISMATCH');
  const from = instant(query.range.fromInclusive), to = instant(query.range.toExclusive);
  let priorEnd = from;
  const intervals = plan.intervals.map(item => {
    const start = instant(item.start), end = instant(item.endExclusive);
    requireTruth(start >= priorEnd && end > start && start >= from && end <= to, 'INVALID_CALENDAR_INTERVAL');
    requireTruth(['OPEN', 'EXPECTED_CLOSURE'].includes(item.kind), 'INVALID_CALENDAR_INTERVAL_KIND');
    requireTruth(start === priorEnd, 'INCOMPLETE_CALENDAR_RANGE');
    if (item.kind === 'OPEN') {
      requireTruth(typeof item.sessionId === 'string' && item.sessionId && /^\d{4}-\d{2}-\d{2}$/.test(item.tradingDate || ''), 'SESSION_IDENTITY_REQUIRED');
      requireTruth(Number.isFinite(Date.parse(item.tradingDate + 'T00:00:00Z')) &&
        new Date(item.tradingDate + 'T00:00:00Z').toISOString().slice(0, 10) === item.tradingDate, 'INVALID_TRADING_DATE');
      requireTruth(['LAST_TRADE'].includes(item.closeConvention), 'UNSUPPORTED_CLOSE_CONVENTION');
      const seconds = RESOLUTIONS[query.timeframe]?.[1];
      if (seconds) requireTruth(end - start <= seconds * 1000, 'INVALID_INTERVAL_DURATION');
      requireTruth(typeof item.finalityEvidenceId === 'string' && item.finalityEvidenceId, 'FINALITY_EVIDENCE_REQUIRED');
    }
    priorEnd = end;
    return { ...item, start: new Date(start).toISOString(), endExclusive: new Date(end).toISOString() };
  });
  requireTruth(priorEnd === to, 'INCOMPLETE_CALENDAR_RANGE');
  const normalized = { exchange: 'CME', version: plan.version, alignmentVersion: plan.alignmentVersion,
    evidenceId: plan.evidenceId, timeframe: plan.timeframe, intervals };
  return { ...normalized, planHash: hash(normalized) };
}

export function assessCoverage(records, plan, acquisitionComplete, asOf, noTrades = []) {
  const clock = instant(asOf);
  const present = new Map(records.map(row => [row.intervalStart, row]));
  const intervalsByStart = new Map(plan.intervals.map(item => [item.start, item]));
  const verified = new Map();
  for (const item of noTrades) {
    requireTruth(item && typeof item.evidenceId === 'string' && item.evidenceId &&
      item.source === 'VERIFIED_SOURCE_ACTIVITY' && !verified.has(item.intervalStart), 'NO_TRADE_EVIDENCE_REQUIRED');
    const target = intervalsByStart.get(item.intervalStart);
    requireTruth(target?.kind === 'OPEN' && !present.has(item.intervalStart), 'NO_TRADE_EVIDENCE_CONFLICT');
    verified.set(item.intervalStart, item);
  }
  const gaps = [];
  for (const interval of plan.intervals) {
    const record = present.get(interval.start);
    if (interval.kind === 'EXPECTED_CLOSURE') {
      requireTruth(!record, 'BAR_DURING_EXPECTED_CLOSURE');
      continue;
    }
    if (instant(interval.endExclusive) > clock) { gaps.push({ start: interval.start, reason: 'PARTIAL_PERIOD' }); continue; }
    if (!record && !verified.has(interval.start)) gaps.push({ start: interval.start, reason: 'UNKNOWN_SOURCE_ABSENCE' });
    if (record && record.completionState !== 'COMPLETED') gaps.push({ start: interval.start, reason: 'SOURCE_FINALITY_UNVERIFIED' });
  }
  return { acquisitionComplete, calendarVersion: plan.version, calendarPlanHash: plan.planHash,
    coverageComplete: acquisitionComplete && gaps.length === 0, gaps,
    verifiedNoTrades: [...verified.values()], expectedClosures: plan.intervals.filter(x => x.kind === 'EXPECTED_CLOSURE').map(x => ({ start: x.start, endExclusive: x.endExclusive })) };
}
