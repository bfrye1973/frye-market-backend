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
import {
  buildEngine25ParticipationArtifact,
  expectedCompletedEquitySessionDate,
} from "../logic/engine25/buildParticipationArtifact.js";
import { buildEngine25BlendedParticipation } from "../logic/engine25/buildBlendedParticipation.js";
import { buildEngine25DistributionPressureV2 } from "../logic/engine25/buildDistributionPressureV2.js";

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

export const DISTRIBUTION_HISTORY_FILE =
  process.env.ENGINE25_DISTRIBUTION_HISTORY_FILE ||
  "/var/data/replay/engine25-distribution-v2-history.json";

const ARCHIVE_CONFIG = Object.freeze({
  "10m": {
    branch: "data-archive-10min",
    root: "data/engine25-10m-history",
    file: "engine25_10m_snapshot.json",
  },
  "30m": {
    branch: "data-archive-30m-internals",
    root: "data/engine25-30m-history",
    file: "engine25_30m_snapshot.json",
  },
});

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


export function readPersistentDistributionArtifact() {
  try {
    if (!fs.existsSync(DISTRIBUTION_HISTORY_FILE)) return null;
    const distributionPressure = JSON.parse(
      fs.readFileSync(DISTRIBUTION_HISTORY_FILE, "utf8")
    );
    if (distributionPressure?.schema !== "engine25.distributionPressure.v2") {
      return null;
    }
    return {
      participation: {
        distributionPressure,
      },
    };
  } catch {
    return null;
  }
}

export function writePersistentDistributionArtifact(distributionPressure) {
  if (distributionPressure?.schema !== "engine25.distributionPressure.v2") return;
  try {
    fs.mkdirSync(path.dirname(DISTRIBUTION_HISTORY_FILE), { recursive: true });
    fs.writeFileSync(
      DISTRIBUTION_HISTORY_FILE,
      JSON.stringify(distributionPressure, null, 2)
    );
  } catch (error) {
    console.warn(
      "[Engine25Distribution] persistent history write failed:",
      error?.message || String(error)
    );
  }
}

export function hasDistributionHistory(artifact) {
  const history =
    artifact?.participation?.distributionPressure?.history || null;
  return Boolean(
    history &&
      Object.values(history).some(
        (rows) => Array.isArray(rows) && rows.length > 0
      )
  );
}

async function fetchLastValidArchiveSnapshot({
  timeframe,
  sessionDate,
  fetchJsonFn = fetchJson,
} = {}) {
  const config = ARCHIVE_CONFIG[timeframe];
  if (!config || !sessionDate) return null;

  const dirUrl =
    `https://api.github.com/repos/bfrye1973/frye-market-backend/contents/${config.root}/${sessionDate}?ref=${config.branch}`;

  let listing;
  try {
    listing = await fetchJsonFn(dirUrl);
  } catch {
    return null;
  }

  const dirs = (Array.isArray(listing) ? listing : [])
    .filter((item) => item?.type === "dir" && item?.name)
    .map((item) => String(item.name))
    .sort()
    .reverse();

  for (const dir of dirs.slice(0, 48)) {
    const rawUrl =
      `https://raw.githubusercontent.com/bfrye1973/frye-market-backend/${config.branch}/${config.root}/${sessionDate}/${dir}/${config.file}`;

    let snapshot;
    try {
      snapshot = await fetchJsonFn(rawUrl);
    } catch {
      continue;
    }

    if (
      snapshot?.completeCanonicalSet === true &&
      Number(snapshot?.coveragePct) >= 70 &&
      Array.isArray(snapshot?.sectorCards) &&
      snapshot.sectorCards.length === 11 &&
      snapshot?.sourceTimestamp
    ) {
      return snapshot;
    }
  }

  return null;
}

export async function fetchDurableLastValidEquityInputs({
  now = Date.now(),
  fetchJsonFn = fetchJson,
} = {}) {
  const sessionDate = expectedCompletedEquitySessionDate(now);
  if (!sessionDate) return null;

  const [intraday, thirtyMinute] = await Promise.all([
    fetchLastValidArchiveSnapshot({
      timeframe: "10m",
      sessionDate,
      fetchJsonFn,
    }),
    fetchLastValidArchiveSnapshot({
      timeframe: "30m",
      sessionDate,
      fetchJsonFn,
    }),
  ]);

  if (!intraday && !thirtyMinute) return null;

  return {
    sessionDate,
    intraday,
    thirtyMinute,
  };
}

export async function fetchCanonicalParticipationInputs({
  backendBase = DEFAULT_BACKEND_BASE,
  fetchJsonFn = fetchJson,
} = {}) {
  const base = String(backendBase || DEFAULT_BACKEND_BASE).replace(/\/+$/, "");

  const routes = {
    intraday: `${base}/live/intraday`,
    thirtyMinute: `${base}/live/30m-internals`,
    hourly: `${base}/live/hourly`,
    fourHour: `${base}/live/4h`,
    eod: `${base}/live/eod`,
  };

  const [intraday, thirtyMinute, hourly, fourHour, eod] = await Promise.all([
    fetchJsonFn(routes.intraday),
    fetchJsonFn(routes.thirtyMinute),
    fetchJsonFn(routes.hourly),
    fetchJsonFn(routes.fourHour),
    fetchJsonFn(routes.eod),
  ]);

  return {
    routes,
    intraday,
    thirtyMinute,
    hourly,
    fourHour,
    eod,
  };
}

export function buildPublishedEngine25Participation({
  sectorHealth,
  canonicalInputs = null,
  previousArtifact = null,
  durableLastValidEquityInputs = null,
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

  const legacyDistributionPressure =
    baseArtifact?.participation?.distributionPressure || null;

  const distributionPressure = buildEngine25DistributionPressureV2({
    intraday: canonicalInputs.intraday,
    thirtyMinute: canonicalInputs.thirtyMinute,
    hourly: canonicalInputs.hourly,
    fourHour: canonicalInputs.fourHour,
    previous:
      previousArtifact?.participation?.distributionPressure?.schema ===
      "engine25.distributionPressure.v2"
        ? previousArtifact.participation.distributionPressure
        : null,
    bootstrapInputs: durableLastValidEquityInputs,
    now,
  });

  return {
    ...baseArtifact,
    participation: {
      ...(baseArtifact.participation || {}),
      legacyDistributionPressure,
      distributionPressure,
    },
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
        thirtyMinute: "/live/30m-internals",
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
  durableLastValidEquityInputs = null,
  now = Date.now(),
  participationFile = PARTICIPATION_FILE,
  legacyFile = LEGACY_COMPATIBILITY_FILE,
} = {}) {
  let previousArtifact = null;
  try {
    if (fs.existsSync(participationFile)) {
      previousArtifact = JSON.parse(fs.readFileSync(participationFile, "utf8"));
    }
  } catch {
    previousArtifact = null;
  }

  if (!hasDistributionHistory(previousArtifact)) {
    const persistentArtifact = readPersistentDistributionArtifact();
    if (hasDistributionHistory(persistentArtifact)) {
      previousArtifact = persistentArtifact;
    }
  }

  const artifact = buildPublishedEngine25Participation({
    sectorHealth,
    canonicalInputs,
    previousArtifact,
    durableLastValidEquityInputs,
    now,
  });

  fs.mkdirSync(path.dirname(participationFile), { recursive: true });
  fs.writeFileSync(participationFile, JSON.stringify(artifact, null, 2));
  fs.writeFileSync(legacyFile, JSON.stringify(sectorHealth, null, 2));
  writePersistentDistributionArtifact(
    artifact?.participation?.distributionPressure || null
  );

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

  let previousForBootstrap = null;
  try {
    if (fs.existsSync(participationFile)) {
      previousForBootstrap = JSON.parse(
        fs.readFileSync(participationFile, "utf8")
      );
    }
  } catch {
    previousForBootstrap = null;
  }

  if (!hasDistributionHistory(previousForBootstrap)) {
    previousForBootstrap = readPersistentDistributionArtifact();
  }

  let durableLastValidEquityInputs = null;
  if (!hasDistributionHistory(previousForBootstrap)) {
    durableLastValidEquityInputs =
      await fetchDurableLastValidEquityInputs({ now });
  }

  return publishEngine25Participation({
    sectorHealth,
    canonicalInputs,
    durableLastValidEquityInputs,
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
          distributionPressure:
            result.artifact.participation?.distributionPressure || null,
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
