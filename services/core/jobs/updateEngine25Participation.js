// services/core/jobs/updateEngine25Participation.js
// Lightweight Engine 25 canonical participation publisher.
//
// One canonical scanner-derived Engine25 build -> two publications:
//   engine25-participation.json        (new permanent contract)
//   engine25-sector-health-test.json   (temporary compatibility)
// No Engine29 job is invoked here.
//
// Phase D additive publishing:
// - preserve every existing participation field
// - append fastParticipation / blendedParticipation / sourceDiagnostics
// - canonical blend inputs come directly from /live/intraday, /live/hourly,
//   /live/4h, and /live/eod
// - do not consume the legacy 65/35 combinedRead

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { buildEngine25SectorHealth } from "../logic/engine25SectorHealth.js";
import { buildEngine25ParticipationArtifact } from "../logic/engine25/buildParticipationArtifact.js";
import { buildEngine25BlendedParticipation } from "../logic/engine25/buildBlendedParticipation.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.join(__dirname, "..", "data");

const DEFAULT_BACKEND_BASE =
  process.env.BACKEND_BASE || "https://frye-market-backend-1.onrender.com";

export const PARTICIPATION_FILE = path.join(
  DATA_DIR,
  "engine25-participation.json"
);

export const LEGACY_COMPATIBILITY_FILE = path.join(
  DATA_DIR,
  "engine25-sector-health-test.json"
);

async function fetchJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  const text = await response.text();

  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`ENGINE25_BLEND_INVALID_JSON ${url}: ${text.slice(0, 160)}`);
  }

  if (!response.ok) {
    throw new Error(
      `ENGINE25_BLEND_HTTP_${response.status} ${url}: ${text.slice(0, 160)}`
    );
  }

  return json;
}

export async function fetchCanonicalParticipationInputs({
  backendBase = DEFAULT_BACKEND_BASE,
  fetchJsonFn = fetchJson,
} = {}) {
  const base = String(backendBase || DEFAULT_BACKEND_BASE).replace(/\/+$/, "");

  const routes = {
    intraday: `${base}/live/intraday`,
    hourly: `${base}/live/hourly`,
    fourHour: `${base}/live/4h`,
    eod: `${base}/live/eod`,
  };

  const [intraday, hourly, fourHour, eod] = await Promise.all([
    fetchJsonFn(routes.intraday),
    fetchJsonFn(routes.hourly),
    fetchJsonFn(routes.fourHour),
    fetchJsonFn(routes.eod),
  ]);

  return {
    routes,
    intraday,
    hourly,
    fourHour,
    eod,
  };
}

export function buildPublishedEngine25Participation({
  sectorHealth,
  canonicalInputs = null,
  now = Date.now(),
} = {}) {
  if (!sectorHealth || typeof sectorHealth !== "object") {
    throw new Error("ENGINE25_PARTICIPATION_SOURCE_REQUIRED");
  }

  const baseArtifact = buildEngine25ParticipationArtifact({
    sectorHealth,
    now,
  });

  if (!canonicalInputs) return baseArtifact;

  const blended = buildEngine25BlendedParticipation({
    intraday: canonicalInputs.intraday,
    hourly: canonicalInputs.hourly,
    fourHour: canonicalInputs.fourHour,
    eod: canonicalInputs.eod,
    now,
  });

  return {
    ...baseArtifact,
    fastParticipation: blended.fastParticipation,
    blendedParticipation: blended.blendedParticipation,
    sourceDiagnostics: blended.sourceDiagnostics,
    blendedParticipationMeta: {
      engine: blended.engine,
      schema: blended.schema,
      authority: blended.authority,
      config: blended.config,
      canonicalRoutes: canonicalInputs.routes || {
        intraday: "/live/intraday",
        hourly: "/live/hourly",
        fourHour: "/live/4h",
        eod: "/live/eod",
      },
    },
  };
}

export function publishEngine25Participation({
  sectorHealth,
  canonicalInputs = null,
  now = Date.now(),
  participationFile = PARTICIPATION_FILE,
  legacyFile = LEGACY_COMPATIBILITY_FILE,
} = {}) {
  const artifact = buildPublishedEngine25Participation({
    sectorHealth,
    canonicalInputs,
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
  loadCanonicalInputs = fetchCanonicalParticipationInputs,
  now = Date.now(),
  participationFile = PARTICIPATION_FILE,
  legacyFile = LEGACY_COMPATIBILITY_FILE,
} = {}) {
  const [sectorHealth, canonicalInputs] = await Promise.all([
    buildSectorHealth(),
    loadCanonicalInputs(),
  ]);

  return publishEngine25Participation({
    sectorHealth,
    canonicalInputs,
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
          fastParticipation: result.artifact.fastParticipation,
          blendedParticipation: result.artifact.blendedParticipation,
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
