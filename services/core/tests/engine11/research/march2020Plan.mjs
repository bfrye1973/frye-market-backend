// Research query windows are NOT canonical rollover dates or approved anchors.
export const degreeInputs = [
  ['SUBMICRO', '5m', '5min', 300000], ['MICRO', '10m', '10min', 600000],
  ['SUBMINUTE', '1h', '1hour', 3600000], ['MINUTE', '4h', '4hour', 14400000],
  ['MINOR', '1d', '1session', null], ['INTERMEDIATE', '1w', '1week', null],
  ['PRIMARY', '1mo', '1month', null]
].map(([degree, timeframe, resolution, stepMs]) => ({ degree, timeframe, resolution, stepMs }));
export function targetWindows(asOf) {
  const stop = Date.parse(asOf), start = Date.parse('2020-03-01T00:00:00.000Z');
  if (!Number.isFinite(stop) || stop <= start) throw new Error('Invalid research as-of');
  const windows = [];
  for (let year = 2020; year <= new Date(stop).getUTCFullYear(); year++) {
    for (const [code, month] of [['H', 0], ['M', 3], ['U', 6], ['Z', 9]]) {
      const lo = Math.max(start, Date.UTC(year, month, 1));
      const hi = Math.min(stop, Date.UTC(year, month + 3, 1));
      if (lo >= hi) continue;
      windows.push({ fullContract: 'ES' + code + year, ticker: 'ES' + code + String(year).at(-1),
        year, from: new Date(lo).toISOString(), to: new Date(hi).toISOString(),
        role: 'CALENDAR_QUARTER_RESEARCH_WINDOW_NOT_ROLLOVER_POLICY' });
    }
  }
  // Explicit overlap around the March 2020 H -> M transition; no contract
  // selection, adjusted stitching or promotion of evidence is performed.
  windows.push({ fullContract: 'ESM2020', ticker: 'ESM0', year: 2020,
    from: '2020-03-01T00:00:00.000Z', to: new Date(Math.min(stop, Date.parse('2020-04-01T00:00:00.000Z'))).toISOString(),
    role: 'MARCH_2020_TRANSITION_OVERLAP_RESEARCH' });
  return windows;
}
