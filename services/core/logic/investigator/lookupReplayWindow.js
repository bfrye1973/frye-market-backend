// services/core/logic/investigator/lookupReplayWindow.js
//
// Read-only lookup of one canonical ES Replay snapshot.
//   - path built only from validated date + HHMM, never from raw input
//   - day directory and file must be real (no symlinks) and resolve under root
//   - selection: the archived snapshot AT OR BEFORE the requested time, within
//     windowMinutes. A later snapshot is a later state and is never selected;
//     its time is only reported as nextArchivedTime.
//   - the sha256 is computed over the exact bytes that are parsed.

import fs from "node:fs";
import path from "node:path";

import { readEvidenceBytes } from "./readEvidenceFile.js";

const toMinutes = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(2));

function fail(httpStatus, error, extra = {}) {
  return { ok: false, httpStatus, error, ...extra };
}

export function listArchivedTimes(root, date) {
  const dayDir = path.join(root, date);
  let st;
  try {
    st = fs.lstatSync(dayDir);
  } catch {
    return null;
  }
  if (st.isSymbolicLink() || !st.isDirectory()) return { policyRefused: true };
  return fs.readdirSync(dayDir)
    .filter((n) => /^\d{4}\.json$/.test(n))
    .map((n) => n.slice(0, 4))
    .sort();
}

export function lookupReplayWindow({ root, date, time, windowMinutes }) {
  let realRoot;
  try {
    realRoot = fs.realpathSync(root);
  } catch {
    return fail(503, "REPLAY_ROOT_UNAVAILABLE");
  }

  const times = listArchivedTimes(root, date);
  if (times === null) return fail(404, "REPLAY_DATE_NOT_FOUND");
  if (times.policyRefused) return fail(403, "PATH_POLICY_REFUSED");

  const requested = toMinutes(time);
  const atOrBefore = times.filter((t) => toMinutes(t) <= requested);
  const after = times.filter((t) => toMinutes(t) > requested);
  const nextArchivedTime = after[0] ?? null;

  if (atOrBefore.length === 0) {
    return fail(404, "NO_SNAPSHOT_AT_OR_BEFORE_REQUESTED_TIME", { nextArchivedTime });
  }
  const selectedTime = atOrBefore[atOrBefore.length - 1];
  const offsetMinutes = requested - toMinutes(selectedTime);
  if (offsetMinutes > windowMinutes) {
    return fail(404, "NO_SNAPSHOT_WITHIN_WINDOW", {
      latestBefore: selectedTime, offsetMinutes, windowMinutes, nextArchivedTime,
    });
  }

  const file = path.join(root, date, selectedTime + ".json");
  let lst;
  try {
    lst = fs.lstatSync(file);
  } catch {
    return fail(404, "REPLAY_FILE_NOT_FOUND");
  }
  if (lst.isSymbolicLink() || !lst.isFile()) return fail(403, "PATH_POLICY_REFUSED");
  let realFile;
  try {
    realFile = fs.realpathSync(file);
  } catch {
    return fail(404, "REPLAY_FILE_NOT_FOUND");
  }
  if (!realFile.startsWith(realRoot + path.sep)) return fail(403, "PATH_POLICY_REFUSED");

  const raw = readEvidenceBytes(file);
  if (raw.status === "UNAVAILABLE") return fail(404, "REPLAY_FILE_NOT_FOUND");
  if (raw.status !== "OK") return fail(500, "REPLAY_FILE_UNREADABLE", { reason: raw.reason });

  let replay;
  try {
    replay = JSON.parse(raw.bytes.toString("utf8"));
  } catch {
    return fail(500, "REPLAY_FILE_CORRUPT", { sha256: raw.sha256 });
  }

  return {
    ok: true,
    replay,
    selection: {
      requestedTime: time,
      selectedTime,
      selection: offsetMinutes === 0 ? "EXACT" : "AT_OR_BEFORE",
      offsetMinutes,
      windowMinutes,
      nextArchivedTime,
      nextArchivedTimeNote: nextArchivedTime
        ? "A later snapshot is a later system state; it was not used."
        : null,
    },
    provenance: {
      replayRoot: "ENGINE12_ES_REPLAY_ROOT",
      replayRelativePath: date + "/" + selectedTime + ".json",
      sha256: raw.sha256,
      sha256Scope: "EXACT_BYTES_READ_AND_PARSED_FOR_THIS_RESPONSE",
      byteLength: raw.byteLength,
      readAt: raw.readAt,
      schema: replay?.schema ?? null,
      replayContract: replay?.replayContract ?? null,
      immutable: replay?.immutable ?? null,
      generatedAtUtc: replay?.generatedAtUtc ?? null,
      snapshotTime: replay?.snapshotTime ?? null,
      timezone: replay?.timezone ?? null,
    },
  };
}
