// services/core/jobs/cleanupEsReplayRetention.js
// Engine 12 canonical ES Replay retention maintenance.
//
// Contract:
// - Keep current America/Phoenix calendar date + previous 13 Arizona dates.
// - Consider only direct children of /replay/es.
// - Delete only real, non-symlink directories whose names are valid YYYY-MM-DD
//   calendar dates older than the protected cutoff.
// - Fail closed on malformed dates, invalid dates, symlinks, non-date entries,
//   unexpected filesystem objects, and inspection failures.
// - Never touch legacy /replay/YYYY-MM-DD directories.
// - Never rewrite surviving Replay files.
// - Deletion is disabled unless ENGINE12_RETENTION_ENABLED=true.
// - CLI defaults to dry-run; live CLI deletion also requires --live.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { updateEngine12StorageHealthSafe } from "../logic/engine12/storageHealth.js";

const AZ_TZ = "America/Phoenix";
const RETENTION_DAYS = 14;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CORE_DIR = path.resolve(__dirname, "..");
const DATA_DIR = path.resolve(CORE_DIR, "data");

const REPLAY_DATA_DIR = String(
  process.env.REPLAY_DATA_DIR || DATA_DIR
)
  .trim()
  .replace(/\/+$/, "");

const DEFAULT_ES_REPLAY_ROOT = path.join(
  REPLAY_DATA_DIR,
  "replay",
  "es"
);

const ALWAYS_PROTECTED_NAMES = new Set([
  "markers",
  "health",
  "lifecycle",
]);

function parseBoolean(value) {
  return /^(1|true|yes|on)$/i.test(
    String(value ?? "").trim()
  );
}

export function isEngine12RetentionEnabled() {
  return parseBoolean(
    process.env.ENGINE12_RETENTION_ENABLED
  );
}

function phoenixDateYmd(date = new Date()) {
  const parts = new Intl.DateTimeFormat(
    "en-CA",
    {
      timeZone: AZ_TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }
  ).formatToParts(date);

  const get = (type) =>
    parts.find((part) => part.type === type)?.value || "";

  return `${get("year")}-${get("month")}-${get("day")}`;
}

function parseValidDateYmd(value) {
  if (!DATE_RE.test(String(value || ""))) {
    return null;
  }

  const [yearText, monthText, dayText] = value.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);

  const utc = new Date(
    Date.UTC(year, month - 1, day)
  );

  if (
    utc.getUTCFullYear() !== year ||
    utc.getUTCMonth() !== month - 1 ||
    utc.getUTCDate() !== day
  ) {
    return null;
  }

  return {
    year,
    month,
    day,
    utc,
  };
}

function formatUtcDateYmd(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function buildRetentionWindow(
  now = new Date()
) {
  const currentArizonaDate = phoenixDateYmd(now);
  const parsed = parseValidDateYmd(currentArizonaDate);

  if (!parsed) {
    throw new Error(
      "ENGINE12_RETENTION_INVALID_ARIZONA_DATE"
    );
  }

  const protectedStartUtc = new Date(
    parsed.utc.getTime() -
      (RETENTION_DAYS - 1) * 24 * 60 * 60 * 1000
  );

  const protectedStartDate = formatUtcDateYmd(
    protectedStartUtc
  );

  return {
    timezone: AZ_TZ,
    retentionDays: RETENTION_DAYS,
    currentArizonaDate,
    protectedStartDate,
    deleteBeforeDate: protectedStartDate,
  };
}

function countDirectoryTree(root) {
  let files = 0;
  let bytes = 0;
  let directories = 1;
  let symlinks = 0;
  const stack = [root];

  while (stack.length > 0) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, {
      withFileTypes: true,
    });

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);

      if (entry.isSymbolicLink()) {
        symlinks += 1;
        continue;
      }

      if (entry.isDirectory()) {
        directories += 1;
        stack.push(fullPath);
        continue;
      }

      if (entry.isFile()) {
        const stat = fs.statSync(fullPath);
        files += 1;
        bytes += stat.size;
      }
    }
  }

  return {
    files,
    bytes,
    directories,
    symlinks,
  };
}

function classifyDirectChild({
  replayRoot,
  entry,
  window,
}) {
  const fullPath = path.join(
    replayRoot,
    entry.name
  );

  if (ALWAYS_PROTECTED_NAMES.has(entry.name)) {
    return {
      name: entry.name,
      path: fullPath,
      classification: "PROTECTED_RESERVED_DIRECTORY",
      eligible: false,
    };
  }

  let lstat;
  try {
    lstat = fs.lstatSync(fullPath);
  } catch (error) {
    return {
      name: entry.name,
      path: fullPath,
      classification: "PROTECTED_INSPECTION_FAILED",
      eligible: false,
      error: String(error?.message || error),
    };
  }

  if (lstat.isSymbolicLink()) {
    return {
      name: entry.name,
      path: fullPath,
      classification: "PROTECTED_SYMLINK",
      eligible: false,
    };
  }

  if (!lstat.isDirectory()) {
    return {
      name: entry.name,
      path: fullPath,
      classification: "PROTECTED_UNEXPECTED_FILESYSTEM_OBJECT",
      eligible: false,
    };
  }

  if (!DATE_RE.test(entry.name)) {
    return {
      name: entry.name,
      path: fullPath,
      classification: "PROTECTED_NON_DATE_DIRECTORY",
      eligible: false,
    };
  }

  if (!parseValidDateYmd(entry.name)) {
    return {
      name: entry.name,
      path: fullPath,
      classification: "PROTECTED_INVALID_CALENDAR_DATE",
      eligible: false,
    };
  }

  if (entry.name >= window.protectedStartDate) {
    return {
      name: entry.name,
      path: fullPath,
      classification: "PROTECTED_RETENTION_WINDOW",
      eligible: false,
    };
  }

  return {
    name: entry.name,
    path: fullPath,
    classification: "ELIGIBLE_OLD_CANONICAL_DATE_DIRECTORY",
    eligible: true,
  };
}

export function runReplayRetention({
  now = new Date(),
  replayRoot = DEFAULT_ES_REPLAY_ROOT,
  dryRun = true,
  retentionEnabled = isEngine12RetentionEnabled(),
  updateHealth = true,
  removeDirectory = fs.rmSync,
} = {}) {
  const startedAtUtc = new Date().toISOString();
  const window = buildRetentionWindow(now);
  const normalizedReplayRoot = path.resolve(replayRoot);
  const effectiveDryRun = dryRun !== false;
  const deletionAllowed =
    retentionEnabled === true &&
    effectiveDryRun === false;

  const result = {
    ok: true,
    job: "ENGINE12_ES_REPLAY_RETENTION",
    timezone: AZ_TZ,
    retentionDays: RETENTION_DAYS,
    replayRoot: normalizedReplayRoot,
    retentionEnabled: retentionEnabled === true,
    dryRun: effectiveDryRun,
    deletionAllowed,
    currentArizonaDate: window.currentArizonaDate,
    protectedStartDate: window.protectedStartDate,
    deleteBeforeDate: window.deleteBeforeDate,
    protectedNames: Array.from(ALWAYS_PROTECTED_NAMES),
    inspectedEntries: 0,
    eligibleDirectories: [],
    protectedEntries: [],
    candidateDirectories: 0,
    candidateFiles: 0,
    candidateBytes: 0,
    deletedDirectories: 0,
    deletedFiles: 0,
    recoveredBytes: 0,
    partialFailure: false,
    failures: [],
    startedAtUtc,
    completedAtUtc: null,
  };

  try {
    if (!fs.existsSync(normalizedReplayRoot)) {
      result.ok = false;
      result.partialFailure = true;
      result.failures.push({
        path: normalizedReplayRoot,
        stage: "READ_REPLAY_ROOT",
        error: "REPLAY_ROOT_NOT_FOUND",
      });
      return result;
    }

    const rootStat = fs.lstatSync(normalizedReplayRoot);
    if (
      rootStat.isSymbolicLink() ||
      !rootStat.isDirectory()
    ) {
      result.ok = false;
      result.partialFailure = true;
      result.failures.push({
        path: normalizedReplayRoot,
        stage: "VALIDATE_REPLAY_ROOT",
        error: "REPLAY_ROOT_NOT_REAL_DIRECTORY",
      });
      return result;
    }

    const entries = fs.readdirSync(
      normalizedReplayRoot,
      { withFileTypes: true }
    );

    result.inspectedEntries = entries.length;

    const candidates = [];

    for (const entry of entries) {
      const classified = classifyDirectChild({
        replayRoot: normalizedReplayRoot,
        entry,
        window,
      });

      if (!classified.eligible) {
        result.protectedEntries.push(classified);
        continue;
      }

      try {
        const usage = countDirectoryTree(
          classified.path
        );

        const candidate = {
          ...classified,
          files: usage.files,
          bytes: usage.bytes,
          directories: usage.directories,
          nestedSymlinks: usage.symlinks,
        };

        candidates.push(candidate);
        result.eligibleDirectories.push(candidate);
        result.candidateDirectories += 1;
        result.candidateFiles += usage.files;
        result.candidateBytes += usage.bytes;
      } catch (error) {
        result.partialFailure = true;
        result.failures.push({
          path: classified.path,
          stage: "MEASURE_CANDIDATE",
          error: String(error?.message || error),
        });
      }
    }

    if (deletionAllowed) {
      for (const candidate of candidates) {
        try {
          const beforeDelete = fs.lstatSync(
            candidate.path
          );

          if (
            beforeDelete.isSymbolicLink() ||
            !beforeDelete.isDirectory()
          ) {
            throw new Error(
              "CANDIDATE_CHANGED_BEFORE_DELETE"
            );
          }

          const name = path.basename(candidate.path);
          const parent = path.dirname(candidate.path);

          if (
            parent !== normalizedReplayRoot ||
            name !== candidate.name ||
            !parseValidDateYmd(name) ||
            name >= window.protectedStartDate
          ) {
            throw new Error(
              "CANDIDATE_FAILED_PREDELETE_REVALIDATION"
            );
          }

          removeDirectory(candidate.path, {
            recursive: true,
            force: false,
          });

          result.deletedDirectories += 1;
          result.deletedFiles += candidate.files;
          result.recoveredBytes += candidate.bytes;
        } catch (error) {
          result.partialFailure = true;
          result.failures.push({
            path: candidate.path,
            stage: "DELETE_CANDIDATE",
            error: String(error?.message || error),
          });
        }
      }
    }
  } catch (error) {
    result.ok = false;
    result.partialFailure = true;
    result.failures.push({
      path: normalizedReplayRoot,
      stage: "RETENTION_RUN",
      error: String(error?.message || error),
    });
  } finally {
    result.completedAtUtc = new Date().toISOString();

    if (updateHealth) {
      updateEngine12StorageHealthSafe({
        now,
        replayRoot: normalizedReplayRoot,
        retentionResult: result,
      });
    }
  }

  if (result.partialFailure) {
    result.ok = false;
  }

  return result;
}

function main() {
  const liveRequested = process.argv.includes("--live");
  const result = runReplayRetention({
    dryRun: !liveRequested,
  });

  console.log(
    JSON.stringify(result, null, 2)
  );

  if (!result.ok) {
    process.exitCode = 1;
  }
}

const isDirectExecution =
  process.argv[1] &&
  path.resolve(process.argv[1]) === __filename;

if (isDirectExecution) {
  main();
}
