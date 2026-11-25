// Engine 22 unified journal -> Engine 2 read-only metadata bridge.
// No node ID generation, no chart plot authorization, no wave count mutation.
// Keep selected model snapshots and research provenance distinct from finalized nodes.
const DEGREES = ["primary","intermediate","minor","minute","subminute","micro","submicro"];
export const WAVE_HISTORY_NODE_VIEW_SCHEMA = "engine22.waveHistoryNodeView.v1";
export function buildWaveHistoryNodeViewV1(historyEvent) {
  if (!historyEvent || historyEvent.schema !== "engine22.waveHistoryEvent.v1" ||
      !Number.isSafeInteger(historyEvent.revision) || historyEvent.revision < 1 ||
      historyEvent.content?.schema !== "engine22.waveHistoryObservation.v1")
    throw new Error("ENGINE22_HISTORY_REVISION_UNAVAILABLE");
  const observation = historyEvent.content;
  const degrees = {};
  for (const degree of DEGREES) {
    const source = observation.degrees?.[degree];
    if (!source || source.available !== true || !source.sourceModel ||
        !source.selection || !source.modelVersion) {
      degrees[degree] = {degree,available:false,plotAllowed:false,
        reason:"DEGREE_SOURCE_MISSING_OR_UNVERIFIED"};
      continue;
    }
    // Model snapshot is not an approved permanent node. Only the eventual
    // owner-approved node ledger may assign immutable IDs.
    degrees[degree] = {
      degree,available:true,sourcePath:source.sourcePath ?? null,
      modelVersion:source.modelVersion,activeWave:source.selection.activeWave ?? null,
      direction:source.selection.direction ?? null,
      approvalReference:observation.selectionApprovalReference ?? null,
      modelFingerprint:observation.modelFingerprint ?? null,
      permanentNodeId:null,parentWaveId:null,marketEventTimeUtc:null,
      esPriceBasisId:null,plotAllowed:false,
      plotReason:"PERMANENT_NODE_ID_TIME_AND_PRICE_BASIS_PENDING",
      noExecution:true,
    };
  }
  return {
    schema:WAVE_HISTORY_NODE_VIEW_SCHEMA,
    revision:historyEvent.revision,eventHash:historyEvent.eventHash ?? null,
    publishedAtUtc:observation.publishedAt ?? null,
    observedAtUtc:historyEvent.observedAt ?? null,
    historicalAsOfSupported:false,degreeOrder:DEGREES,degrees,
    noExecution:true,noPermissionCreated:true,
  };
}
