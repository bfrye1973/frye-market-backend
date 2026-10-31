#!/usr/bin/env node
// Research-only October 29 Engine 25 confirmation replay.
// Default cutoff: 2026-10-29 08:00 America/Phoenix = 15:00 UTC.
// This script never queries current live data. Inputs must be supplied explicitly.

import fs from "fs";
import { buildEngine25ConfirmationPacket } from "../services/core/logic/engine25/buildConfirmationPacket.js";

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function readJson(path, label) {
  if (!path) throw new Error(label + " path is required");
  if (!fs.existsSync(path)) throw new Error(label + " not found: " + path);
  return JSON.parse(fs.readFileSync(path, "utf8"));
}

const asOfUtc = arg("--as-of", "2026-10-29T15:00:00.000Z");
const marketMeterPath = arg("--market-meter");
const eodPath = arg("--eod-shadow");
const participationPath = arg("--participation");
const outPath = arg("--out", "/tmp/engine25-confirmation-oct29-0800.json");

const marketMeter = readJson(marketMeterPath, "market-meter");
const reconstructedEod = readJson(eodPath, "reconstructed-eod");
const participationArtifact = readJson(participationPath, "participation");

const packet = buildEngine25ConfirmationPacket({
  marketMeter,
  reconstructedEod,
  participationArtifact,
  asOfUtc,
  mode: "HISTORICAL_REPLAY",
  provenance: {
    esMaster: {
      kind: "RETROSPECTIVE_RECONSTRUCTION",
      reconstructed: true,
      originallyPublished: false,
      archiveReference: marketMeterPath,
    },
    fourHour: {
      kind: "ARCHIVED_OR_RETROSPECTIVE_INPUT",
      reconstructed: true,
      originallyPublished: false,
      archiveReference: marketMeterPath,
    },
    reconstructedEod: {
      kind: "RETROSPECTIVE_RECONSTRUCTION",
      reconstructed: true,
      originallyPublished: false,
      archiveReference: eodPath,
    },
  },
});

const output = {
  replay: {
    incidentDate: "2026-10-29",
    priorityWindow: "08:00 America/Phoenix",
    asOfUtc,
    purpose: "NO_LOOKAHEAD_CROSS_ENGINE_ACCEPTANCE",
    currentLiveDataQueried: false,
  },
  packet,
};

fs.writeFileSync(outPath, JSON.stringify(output, null, 2) + "\n");
console.log(JSON.stringify({
  ok: true,
  outPath,
  asOfUtc,
  score: packet.tradePermissionShadow.score,
  state: packet.tradePermissionShadow.state,
  insufficientData: packet.tradePermissionShadow.insufficientData,
  warnings: packet.warnings,
}, null, 2));
