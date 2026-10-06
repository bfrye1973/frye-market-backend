// services/core/logic/engine12/storageHealth.js
// Durable Engine 12 Replay storage-health state.
//
// Health failures are intentionally best-effort and must never change the
// success/failure semantics of Replay writing or retention.

import fs from "fs";
import path from "path";

const AZ_TZ = "America/Phoenix";
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{4}\.json$/;

function isObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  );
}

function phoenixParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat(
    "en-US",
    {
      timeZone: AZ_TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }
  ).formatToParts(date);

  const get = (type) =>
    parts.find((part) => part.type === type)?.value || "";

  return {
    dateYmd: `${get("year")}-${get("month")}-${get("day")}`,
    timeHHMM: `${get("hour")}${get("minute")}`,
  };
}

function readJsonSafe(file) {
  try {
    if (!fs.existsSync(file)) return null;
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return isObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function atomicWriteJson(file, value) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });

  const temp = path.join(
    dir,
    `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`
  );

  const fd = fs.openSync(temp, "wx", 0o600);

  try {
    fs.writeFileSync(
      fd,
      `${JSON.stringify(value, null, 2)}\n`,
      "utf8"
    );
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }

  try {
    fs.renameSync(temp, file);
  } catch (error) {
    try {
      fs.rmSync(temp, { force: true });
    } catch {
      // Best-effort temp cleanup only.
    }
    throw error;
  }
}

function classifyDiskWarning(percent) {
  if (!Number.isFinite(percent)) return "UNKNOWN";
  if (percent >= 95) return "CRITICAL_95";
  if (percent >= 90) return "WARNING_90";
  if (percent >= 80) return "WARNING_80";
  if (percent >= 70) return "WARNING_70";
  return "NORMAL";
}

export function classifyEngine12DiskWarning(percent) {
  return classifyDiskWarning(Number(percent));
}

function statFilesystem(targetPath) {
  const stats = fs.statfsSync(targetPath, {
    bigint: true,
  });

  const blockSize =
    stats.bsize > 0n ? stats.bsize : 1n;

  const total = stats.blocks * blockSize;
  const available = stats.bavail * blockSize;
  const free = stats.bfree * blockSize;
  const used = total - free;

  const totalNumber = Number(total);
  const usedNumber = Number(used);
  const availableNumber = Number(available);

  const usedPercent =
    totalNumber > 0
      ? (usedNumber / totalNumber) * 100
      : null;

  return {
    diskTotalBytes: totalNumber,
    diskUsedBytes: usedNumber,
    diskAvailableBytes: availableNumber,
    diskUsedPercent:
      Number.isFinite(usedPercent)
        ? Number(usedPercent.toFixed(2))
        : null,
  };
}

function treeBytes(root) {
  if (!fs.existsSync(root)) return 0;

  let bytes = 0;
  const stack = [root];

  while (stack.length > 0) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, {
      withFileTypes: true,
    });

    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);

      if (entry.isSymbolicLink()) {
        continue;
      }

      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (entry.isFile()) {
        bytes += fs.statSync(fullPath).size;
      }
    }
  }

  return bytes;
}

function currentDayStats(replayRoot, dateYmd) {
  const dir = path.join(replayRoot, dateYmd);

  if (!fs.existsSync(dir)) {
    return {
      currentDayFileCount: 0,
      currentDayBytes: 0,
    };
  }

  const stat = fs.lstatSync(dir);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    return {
      currentDayFileCount: 0,
      currentDayBytes: 0,
    };
  }

  let currentDayFileCount = 0;
  let currentDayBytes = 0;

  for (const entry of fs.readdirSync(dir, {
    withFileTypes: true,
  })) {
    if (
      !entry.isFile() ||
      !TIME_RE.test(entry.name)
    ) {
      continue;
    }

    const file = path.join(dir, entry.name);
    currentDayFileCount += 1;
    currentDayBytes += fs.statSync(file).size;
  }

  return {
    currentDayFileCount,
    currentDayBytes,
  };
}

function listDateDirectories(replayRoot) {
  if (!fs.existsSync(replayRoot)) return [];

  return fs.readdirSync(replayRoot, {
    withFileTypes: true,
  })
    .filter((entry) => {
      if (!entry.isDirectory()) return false;
      if (!DATE_RE.test(entry.name)) return false;

      const fullPath = path.join(replayRoot, entry.name);
      const stat = fs.lstatSync(fullPath);
      return !stat.isSymbolicLink();
    })
    .map((entry) => entry.name)
    .sort();
}

function findLatestReplay(replayRoot) {
  const dates = listDateDirectories(replayRoot);

  for (let i = dates.length - 1; i >= 0; i -= 1) {
    const dateYmd = dates[i];
    const dir = path.join(replayRoot, dateYmd);
    const files = fs.readdirSync(dir, {
      withFileTypes: true,
    })
      .filter((entry) => entry.isFile() && TIME_RE.test(entry.name))
      .map((entry) => entry.name)
      .sort();

    if (files.length === 0) continue;

    const filename = files[files.length - 1];
    const timeHHMM = filename.slice(0, 4);
    const file = path.join(dir, filename);

    return {
      file,
      filename,
      dateYmd,
      timeHHMM,
    };
  }

  return null;
}

function replayInstantMs(dateYmd, timeHHMM) {
  if (
    !DATE_RE.test(String(dateYmd || "")) ||
    !/^\d{4}$/.test(String(timeHHMM || ""))
  ) {
    return null;
  }

  const hour = Number(timeHHMM.slice(0, 2));
  const minute = Number(timeHHMM.slice(2, 4));

  if (
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return null;
  }

  const instant = new Date(
    `${dateYmd}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00-07:00`
  );

  const ms = instant.getTime();
  return Number.isFinite(ms) ? ms : null;
}

function ageSeconds(nowMs, instantMs) {
  if (!Number.isFinite(instantMs)) return null;
  return Math.max(0, Math.floor((nowMs - instantMs) / 1000));
}

function sourceSnapshotInfo(
  sourceFile,
  nowMs,
  preferredTimestamp = null,
  fallbackTimestamp = null
) {
  const source = sourceFile
    ? readJsonSafe(sourceFile)
    : null;

  const timestamp =
    preferredTimestamp ??
    source?.snapshotTime ??
    source?.generatedAtUtc ??
    source?.updatedAt ??
    fallbackTimestamp ??
    null;

  if (!timestamp) {
    return {
      sourceSnapshotTimestamp: null,
      sourceSnapshotAgeSeconds: null,
    };
  }

  const ms = new Date(timestamp).getTime();

  return {
    sourceSnapshotTimestamp: timestamp,
    sourceSnapshotAgeSeconds:
      Number.isFinite(ms)
        ? ageSeconds(nowMs, ms)
        : null,
  };
}

function normalizedFailure(replayResult, error) {
  if (error) {
    return {
      atUtc: new Date().toISOString(),
      errorCode:
        error?.code ??
        "REPLAY_WRITE_FAILED",
      detail: String(error?.message || error),
    };
  }

  if (
    replayResult &&
    replayResult.ok === false
  ) {
    return {
      atUtc: new Date().toISOString(),
      errorCode:
        replayResult.errorCode ??
        replayResult.error ??
        "REPLAY_WRITE_FAILED",
      detail:
        replayResult.detail ??
        replayResult.reason ??
        null,
    };
  }

  return null;
}

export function updateEngine12StorageHealth({
  now = new Date(),
  replayRoot,
  sourceFile = null,
  replayResult = null,
  replayError = null,
  retentionResult = null,
} = {}) {
  if (!replayRoot) {
    throw new Error("ENGINE12_HEALTH_REPLAY_ROOT_REQUIRED");
  }

  const normalizedReplayRoot = path.resolve(replayRoot);
  const replayMountPath = path.dirname(normalizedReplayRoot);
  const healthDir = path.join(
    normalizedReplayRoot,
    "health"
  );
  const healthFile = path.join(
    healthDir,
    "engine12-storage-health.json"
  );

  const previous = readJsonSafe(healthFile) || {};
  const nowDate = now instanceof Date ? now : new Date(now);
  const nowMs = nowDate.getTime();

  if (!Number.isFinite(nowMs)) {
    throw new TypeError("ENGINE12_HEALTH_INVALID_NOW");
  }

  const phoenix = phoenixParts(nowDate);
  const latest = findLatestReplay(normalizedReplayRoot);
  const filesystem = statFilesystem(replayMountPath);
  const currentDay = currentDayStats(
    normalizedReplayRoot,
    phoenix.dateYmd
  );
  const source = sourceSnapshotInfo(
    sourceFile,
    nowMs,
    replayResult?.snapshotTime ?? null,
    previous.sourceSnapshotTimestamp ?? null
  );

  const latestInstant = latest
    ? replayInstantMs(latest.dateYmd, latest.timeHHMM)
    : null;

  let lastSuccessfulReplayWrite =
    previous.lastSuccessfulReplayWrite ?? null;

  if (
    replayResult?.ok === true &&
    replayResult?.replayWritten === true
  ) {
    lastSuccessfulReplayWrite =
      replayResult.endedAt ??
      replayResult.generatedAtUtc ??
      new Date().toISOString();
  }

  const failure = normalizedFailure(
    replayResult,
    replayError
  );

  const health = {
    lastSuccessfulReplayWrite,
    latestReplayFilename:
      latest?.filename ?? null,
    latestReplayDateYmd:
      latest?.dateYmd ?? null,
    latestReplayTimeHHMM:
      latest?.timeHHMM ?? null,
    latestReplayAgeSeconds:
      latest
        ? ageSeconds(nowMs, latestInstant)
        : null,
    lastReplayWriteFailure:
      failure ??
      previous.lastReplayWriteFailure ??
      null,

    sourceSnapshotTimestamp:
      source.sourceSnapshotTimestamp,
    sourceSnapshotAgeSeconds:
      source.sourceSnapshotAgeSeconds,

    diskTotalBytes:
      filesystem.diskTotalBytes,
    diskUsedBytes:
      filesystem.diskUsedBytes,
    diskAvailableBytes:
      filesystem.diskAvailableBytes,
    diskUsedPercent:
      filesystem.diskUsedPercent,
    diskWarningLevel:
      classifyDiskWarning(
        filesystem.diskUsedPercent
      ),
    diskPath: replayMountPath,

    canonicalReplayRootBytes:
      treeBytes(normalizedReplayRoot),
    currentDayFileCount:
      currentDay.currentDayFileCount,
    currentDayBytes:
      currentDay.currentDayBytes,

    lastRetentionRun:
      retentionResult?.completedAtUtc ??
      previous.lastRetentionRun ??
      null,
    retentionDryRun:
      retentionResult
        ? retentionResult.dryRun === true
        : previous.retentionDryRun ?? null,
    retentionDeletedDirectories:
      retentionResult
        ? retentionResult.deletedDirectories ?? 0
        : previous.retentionDeletedDirectories ?? 0,
    retentionDeletedFiles:
      retentionResult
        ? retentionResult.deletedFiles ?? 0
        : previous.retentionDeletedFiles ?? 0,
    retentionRecoveredBytes:
      retentionResult
        ? retentionResult.recoveredBytes ?? 0
        : previous.retentionRecoveredBytes ?? 0,
    retentionPartialFailure:
      retentionResult
        ? retentionResult.partialFailure === true
        : previous.retentionPartialFailure ?? false,

    updatedAtUtc: new Date().toISOString(),
    timezone: AZ_TZ,
  };

  atomicWriteJson(healthFile, health);

  console.log(
    JSON.stringify({
      component: "engine12_storage_health",
      ok: true,
      healthFile,
      diskPath: replayMountPath,
      diskUsedPercent: health.diskUsedPercent,
      diskWarningLevel: health.diskWarningLevel,
      currentDayFileCount: health.currentDayFileCount,
      canonicalReplayRootBytes: health.canonicalReplayRootBytes,
      updatedAtUtc: health.updatedAtUtc,
    })
  );

  return {
    ok: true,
    healthFile,
    health,
  };
}

export function updateEngine12StorageHealthSafe(options = {}) {
  try {
    return updateEngine12StorageHealth(options);
  } catch (error) {
    console.error(
      JSON.stringify({
        component: "engine12_storage_health",
        ok: false,
        errorCode: "ENGINE12_STORAGE_HEALTH_UPDATE_FAILED",
        detail: String(error?.message || error),
        updatedAtUtc: new Date().toISOString(),
      })
    );

    return {
      ok: false,
      errorCode: "ENGINE12_STORAGE_HEALTH_UPDATE_FAILED",
      detail: String(error?.message || error),
    };
  }
}
