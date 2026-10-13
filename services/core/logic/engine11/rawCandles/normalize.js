import { id, hash, instant, requireTruth, timestampNs, validateProviderAlias, resolution } from './identity.js';

const numeric = (value, code) => { requireTruth(typeof value === 'number' && Number.isFinite(value), code); return value; };

export function normalizeRawCandle(row, context) {
  const instrument = validateProviderAlias(context.contract, context.providerTicker);
  requireTruth(row?.ticker === context.providerTicker, 'SOURCE_TICKER_MISMATCH');
  resolution(context.timeframe);
  const stamp = timestampNs(row.window_start);
  const interval = context.calendarIndex ? context.calendarIndex.get(stamp.intervalStart) : context.calendar.intervals.find(x => x.start === stamp.intervalStart);
  requireTruth(interval?.kind === 'OPEN', 'SOURCE_INTERVAL_NOT_IN_CALENDAR');
  const open = numeric(row.open, 'MISSING_OR_INVALID_OHLC'), high = numeric(row.high, 'MISSING_OR_INVALID_OHLC');
  const low = numeric(row.low, 'MISSING_OR_INVALID_OHLC'), close = numeric(row.close, 'MISSING_OR_INVALID_OHLC');
  requireTruth(low <= Math.min(open, close) && high >= Math.max(open, close) && low <= high && low > 0, 'INVALID_ES_OHLC');
  requireTruth([open, high, low, close].every(x => Number.isSafeInteger(x * 4)), 'NON_TICK_ALIGNED_ES_PRICE');
  const volume = row.volume == null ? null : numeric(row.volume, 'INVALID_VOLUME');
  requireTruth(volume === null || Number.isSafeInteger(volume) && volume >= 0, 'INVALID_VOLUME');
  if (row.session_end_date != null) requireTruth(row.session_end_date === interval.tradingDate, 'SOURCE_TRADING_DATE_MISMATCH');
  const raw = { ticker: row.ticker, window_start: stamp.sourceTimestampNs, open, high, low, close, volume,
    session_end_date: row.session_end_date ?? null, settlement_price: row.settlement_price ?? null,
    transactions: row.transactions ?? null, dollar_volume: row.dollar_volume ?? null };
  requireTruth(raw.settlement_price === null || typeof raw.settlement_price === 'number' && Number.isFinite(raw.settlement_price), 'INVALID_SETTLEMENT');
  requireTruth(raw.transactions === null || Number.isSafeInteger(raw.transactions) && raw.transactions >= 0, 'INVALID_TRANSACTIONS');
  requireTruth(raw.dollar_volume === null || typeof raw.dollar_volume === 'number' && Number.isFinite(raw.dollar_volume) && raw.dollar_volume >= 0, 'INVALID_DOLLAR_VOLUME');
  const sourceKey = id('source', { algorithm: 'engine11.raw-id.v1', provider: context.provider,
    instrumentId: instrument.instrumentId, sourceResolution: resolution(context.timeframe),
    sourceTimestampNs: stamp.sourceTimestampNs, alignmentVersion: context.calendar.alignmentVersion });
  const rawHash = hash(raw), rawRevisionId = id('raw-revision', { sourceKey, rawHash });
  const sourceAsOf = context.sourceAsOf == null ? null : new Date(instant(context.sourceAsOf)).toISOString();
  if (sourceAsOf) requireTruth(instant(sourceAsOf) <= instant(context.asOf), 'SOURCE_WATERMARK_AFTER_ASOF');
  const completionState = sourceAsOf && instant(interval.endExclusive) <= instant(sourceAsOf) &&
    instant(interval.endExclusive) <= instant(context.asOf) ? 'COMPLETED' : 'UNKNOWN';
  return { schemaVersion: 'engine11.rawCandles.v1', ...instrument, provider: context.provider,
    providerTicker: context.providerTicker, timeframe: context.timeframe, sourceResolution: resolution(context.timeframe),
    ...stamp, intervalEndExclusive: interval.endExclusive, sessionId: interval.sessionId,
    tradingDate: interval.tradingDate, calendarVersion: context.calendar.version,
    alignmentVersion: context.calendar.alignmentVersion, calendarEvidenceId: context.calendar.evidenceId,
    closeConvention: interval.closeConvention, sourceKey, rawCandleId: rawRevisionId, rawRevisionId,
    rawHash, raw, open, high, low, close, volume, priceBasis: 'RAW_CONTRACT', adjustmentPoints: 0,
    completionState, sourceAsOf, finalityEvidenceId: sourceAsOf ? interval.finalityEvidenceId : null,
    usageClass: 'ISOLATED_RESEARCH_ONLY', structuralEligible: false };
}

export function normalizeRawRows(rows, context) {
  requireTruth(Array.isArray(rows), 'INVALID_PROVIDER_RESULTS');
  const unique = new Map(), duplicates = [];
  const indexedContext = { ...context, calendarIndex: new Map(context.calendar.intervals.map(x => [x.start, x])) };
  for (const row of rows) {
    const candle = normalizeRawCandle(row, indexedContext);
    const previous = unique.get(candle.sourceKey);
    if (previous) {
      requireTruth(previous.rawRevisionId === candle.rawRevisionId, 'CONFLICTING_SOURCE_REVISION');
      duplicates.push({ sourceKey: candle.sourceKey, rawRevisionId: candle.rawRevisionId });
    } else unique.set(candle.sourceKey, candle);
  }
  return { records: [...unique.values()].sort((a, b) => a.intervalStart.localeCompare(b.intervalStart)), duplicates };
}
