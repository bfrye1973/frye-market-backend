// services/core/jobs/previewEsManualZoneRollover.js
// Prints read-only ES manual zone rollover preview.
// Does not modify original manual zone file.

import { buildEsManualZoneRolloverPreview } from "../logic/rollover/esManualZoneRolloverAdapter.js";

function fmt(n) {
  const x = Number(n);
  return Number.isFinite(x) ? x.toFixed(2) : "NA";
}

function rangeText(range) {
  if (!range) return "NA";
  return `${fmt(range.lo)}-${fmt(range.hi)} / mid ${fmt(range.mid)}`;
}

function main() {
  const preview = buildEsManualZoneRolloverPreview();

  console.log("\n============================================================");
  console.log("ES MANUAL ZONE ROLLOVER PREVIEW — READ ONLY");
  console.log("============================================================");
  console.log(`Source contract:   ${preview.sourceFuturesContractCode}`);
  console.log(`Display contract:  ${preview.displayFuturesContractCode}`);
  console.log(`Polygon source:    ${preview.polygonSourceTicker}`);
  console.log(`Polygon display:   ${preview.polygonDisplayTicker}`);
  console.log(`Adjustment points: ${preview.rollAdjustmentPoints}`);
  console.log(`Adjustment method: ${preview.adjustmentMethod}`);
  console.log(`Adjustment time:   ${preview.adjustmentTimestamp || "NOT_SET"}`);
  console.log(`Manual zone file:  ${preview.filePath}`);
  console.log(`Zone count:        ${preview.zoneCount}`);
  console.log(`Skipped count:     ${preview.skippedCount}`);
  console.log("============================================================\n");

  for (const z of preview.zones) {
    console.log(`${z.zoneId} | line ${z.lineNumber}`);
    console.log(`  original: ${rangeText(z.original)}`);
    console.log(`  adjusted: ${rangeText(z.adjusted)}`);

    if (z.nestedOriginal) {
      console.log(`  nested original: ${rangeText(z.nestedOriginal)}`);
      console.log(`  nested adjusted: ${rangeText(z.nestedAdjusted)}`);
    }

    if (z.comment) {
      console.log(`  comment: ${z.comment}`);
    }

    console.log("");
  }

  if (preview.skippedCount > 0) {
    console.log("Skipped lines:");
    for (const s of preview.skipped) {
      console.log(
        `  line ${s.lineNumber}: ${s.reason || "SKIPPED"} | ${s.rawLine}`
      );
    }
    console.log("");
  }

  console.log("============================================================");
  console.log(preview.warning);
  console.log("============================================================\n");

  console.log(
    JSON.stringify(
      {
        ok: preview.ok,
        readOnly: preview.readOnly,
        protectedOriginal: preview.protectedOriginal,
        sourceFuturesContractCode: preview.sourceFuturesContractCode,
        displayFuturesContractCode: preview.displayFuturesContractCode,
        polygonSourceTicker: preview.polygonSourceTicker,
        polygonDisplayTicker: preview.polygonDisplayTicker,
        rollAdjustmentPoints: preview.rollAdjustmentPoints,
        adjustmentMethod: preview.adjustmentMethod,
        adjustmentTimestamp: preview.adjustmentTimestamp,
        zoneCount: preview.zoneCount,
        skippedCount: preview.skippedCount,
        zones: preview.zones.map((z) => ({
          zoneId: z.zoneId,
          lineNumber: z.lineNumber,
          type: z.type,
          original: z.original,
          adjusted: z.adjusted,
          nestedOriginal: z.nestedOriginal,
          nestedAdjusted: z.nestedAdjusted,
          comment: z.comment,
        })),
      },
      null,
      2
    )
  );
}

main();
