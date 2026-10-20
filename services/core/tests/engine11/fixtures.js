import { validateCalendarPlan } from '../../logic/engine11/rawCandles/calendar.js';
import { range } from '../../logic/engine11/rawCandles/identity.js';
import { acquireRawEs } from '../../logic/engine11/rawCandles/provider.js';

export const FROM = '2026-10-12T13:00:00.000Z', TO = '2026-10-12T13:03:00.000Z';
export const ns = iso => String(BigInt(Date.parse(iso)) * 1000000n);
export function plan(overrides = {}) {
  return { exchange: 'CME', version: 'FIXTURE_calendar_v1', alignmentVersion: 'FIXTURE_epoch_v1',
    evidenceId: 'FIXTURE_NOT_EXCHANGE_EVIDENCE', timeframe: '1m', intervals: [0, 1, 2].map(i => ({
      start: new Date(Date.parse(FROM) + i * 60000).toISOString(),
      endExclusive: new Date(Date.parse(FROM) + (i + 1) * 60000).toISOString(), kind: 'OPEN',
      sessionId: 'FIXTURE_SESSION', tradingDate: '2026-10-12', closeConvention: 'LAST_TRADE',
      finalityEvidenceId: 'FIXTURE_FINALITY' })), ...overrides };
}
export function row(i = 0, overrides = {}) {
  return { ticker: 'ESZ6', window_start: ns(new Date(Date.parse(FROM) + i * 60000).toISOString()),
    open: 7800, high: 7801, low: 7799.75, close: 7800.25, volume: 10, ...overrides };
}
export function context(overrides = {}) {
  const query = { timeframe: '1m', range: range(FROM, TO) };
  return { contract: 'ESZ2026', providerTicker: 'ESZ6', provider: 'MASSIVE_FUTURES', timeframe: '1m',
    asOf: TO, sourceAsOf: TO, calendar: validateCalendarPlan(plan(), query), ...overrides };
}
export const response = (body, status = 200, headers = {}) => ({ ok: status >= 200 && status < 300, status,
  headers: { get: name => headers[name] ?? null }, text: async () => typeof body === 'string' ? body : JSON.stringify(body) });
export async function acquisition(overrides = {}) {
  return acquireRawEs({ contract: 'ESZ2026', providerTicker: 'ESZ6', timeframe: '1m', from: FROM, to: TO,
    asOf: TO, sourceAsOf: TO, calendar: plan(), apiKey: 'fixture-credential',
    fetchImpl: async () => response({ status: 'OK', results: [row(0), row(1), row(2)] }),
    sleep: async () => {}, ...overrides });
}
