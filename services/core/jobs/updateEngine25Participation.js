// services/core/jobs/updateEngine25Participation.js
// Lightweight Engine 25 canonical participation publisher.
//
// One canonical scanner-derived Engine25 build -> two publications:
//   engine25-participation.json        (new permanent contract)
//   engine25-sector-health-test.json   (temporary compatibility)
// No Engine29 job is invoked here.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { buildEngine25SectorHealth } from "../logic/engine25SectorHealth.js";
import { buildEngine25ParticipationArtifact } from "../logic/engine25/buildParticipationArtifact.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, "..", "data");

export const PARTICIPATION_FILE = path.join(
  DATA_DIR,
  "engine25-participation.json"
);

export const LEGACY_COMPATIBILITY_FILE = path.join(
  DATA_DIR,
  "engine25-sector-health-test.json"
);

export function publishEngine25Participation({
  sectorHealth,
  now = Date.now(),
  participationFile = PARTICIPATION_FILE,
  legacyFile = LEGACY_COMPATIBILITY_FILE,
} = {}) {
  if (!sectorHealth || typeof sectorHealth !== "object") {
    throw new Error("ENGINE25_PARTICIPATION_SOURCE_REQUIRED");
  }

  const artifact = buildEngine25ParticipationArtifact({
    sectorHealth,
    now,
  });

  fs.mkdirSync(path.dirname(participationFile), { recursive: true });
  fs.writeFileSync(participationFile, JSON.stringify(artifact, null, 2));
  fs.writeFileSync(legacyFile, JSON.stringify(sectorHealth, null, 2));

  return {
    ok: artifact.ok === true,
    artifact,
    participationFile,
    legacyFile,
  };
}

export async function runEngine25ParticipationPublisher({
  buildSectorHealth = buildEngine25SectorHealth,
  now = Date.now(),
  participationFile = PARTICIPATION_FILE,
  legacyFile = LEGACY_COMPATIBILITY_FILE,
} = {}) {
  const sectorHealth = await buildSectorHealth();

  return publishEngine25Participation({
    sectorHealth,
    now,
    participationFile,
    legacyFile,
  });
}

const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === __filename;

if (isDirectRun) {
  try {
    const result = await runEngine25ParticipationPublisher();

    console.log(
      JSON.stringify(
        {
          ok: result.ok,
          engine: result.artifact.engine,
          generatedAt: result.artifact.generatedAt,
          freshness: result.artifact.freshness,
          participationFile: result.participationFile,
          legacyFile: result.legacyFile,
          scannerBuildCount: 1,
          engine29Triggered: false,
        },
        null,
        2
      )
    );

    if (!result.ok) process.exit(1);
  } catch (error) {
    console.error(
      "[Engine25Participation] FAILED",
      error?.stack || error?.message || String(error)
    );
    process.exit(1);
  }
}
