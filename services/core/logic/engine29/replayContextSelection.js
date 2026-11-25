// Read-only selection of a recorded Engine 29 context for immutable Engine 12 Replay.
// Never attach an Engine 29 observation newer than the strategy snapshot being archived.
// This avoids look-ahead: the later live latest file is NOT what was known earlier.
export function selectEngine29ReplayContext(output, snapshotTime) {
  const context = output?.downstreamContext ?? null;
  if (!context || context.schema !== "engine29.downstreamContext.v1") return null;
  const recorded = Date.parse(context.timestamp ?? "");
  const snapshot = Date.parse(snapshotTime ?? "");
  if (!Number.isFinite(recorded) || !Number.isFinite(snapshot)) return null;
  if (recorded > snapshot) return null;
  return context;
}
