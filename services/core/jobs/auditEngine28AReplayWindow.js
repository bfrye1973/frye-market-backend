// services/core/jobs/auditEngine28AReplayWindow.js
//
// Read-only historical Strategy 1 Replay audit.
// Uses the recorded canonical Engine 12 snapshots exactly as stored.
// It does not rerun trading engines and does not write Replay or Journal.
//
// Required env:
//   ENGINE28A_REPLAY_AUDIT_DATE=YYYY-MM-DD
// Optional env:
//   ENGINE28A_REPLAY_AUDIT_START=HHMM (default 0000)
//   ENGINE28A_REPLAY_AUDIT_END=HHMM   (default 2359)

import fs from "fs";
import path from "path";

import {
  buildEngine28APipelineDoctor,
} from "../logic/engine28a/buildPipelineDoctor.js";

const ROOT = "/var/data/replay/es";
const STRATEGY_ID = "intraday_scalp@10m";

function text(value) {
  return String(value ?? "").trim();
}

function arr(value) {
  return Array.isArray(value) ? value : [];
}

function readJson(file) {
  return JSON.parse(
    fs.readFileSync(file, "utf8")
  );
}

function inWindow(time, start, end) {
  return time >= start && time <= end;
}

function recordedSummary(strategy) {
  const e3 =
    strategy?.confluence?.context?.reaction
      ?.paperScalpReaction || null;

  const e4 =
    strategy?.confluence?.context?.volume
      ?.engine4AuthorizedReactionParticipation || null;

  const e6 =
    strategy?.permission?.paper || null;

  const e26b =
    strategy?.engine26ProposedGeometry || null;

  const e7 =
    strategy?.engine7PositionSizing || null;

  const e9 =
    strategy?.engine9OfficialManagementPlan || null;

  const e8 =
    strategy?.engine8PaperOrder || null;

  const e10 =
    strategy?.engine10Journal ||
    strategy?.engine10JournalAttachment ||
    strategy?.engine10Lifecycle ||
    null;

  return {
    snapshotTime:
      strategy?.engine26LocationCandidate?.snapshotTime ??
      strategy?.snapshotTime ??
      null,

    candidateId:
      strategy?.engine26LocationCandidate?.candidateId ??
      e6?.candidateId ??
      e26b?.candidateId ??
      null,

    zoneId:
      strategy?.engine26LocationCandidate?.zoneId ??
      e6?.zoneId ??
      e26b?.zoneId ??
      null,

    price:
      strategy?.engine26LocationCandidate?.currentPrice ??
      null,

    engine3: {
      state: e3?.state ?? null,
      direction: e3?.direction ?? null,
      quality: e3?.quality ?? null,
      allowed: e3?.allowed === true,
      qualified:
        e3?.engine3Strategy1QualifiedForEngine6 === true,
      blockers: arr(e3?.blockers),
    },

    engine4: {
      state:
        e4?.participationState ?? null,
      direction:
        e4?.direction ?? null,
      quality:
        e4?.participationQuality ?? null,
      confirmed:
        e4?.participationConfirmed === true,
      allowed:
        e4?.allowed === true,
      hardBlocked:
        e4?.hardBlocked === true,
      blockers:
        arr(e4?.blockers),
    },

    engine6: {
      decision:
        e6?.decision ?? null,
      direction:
        e6?.direction ?? null,
      allowed:
        e6?.allowed === true,
      paperAllowed:
        e6?.paperAllowed === true,
      locked:
        e6?.locked === true,
      blockers:
        arr(e6?.blockers),
    },

    engine26B: {
      status:
        e26b?.status ?? null,
      direction:
        e26b?.direction ?? null,
      geometryReady:
        e26b?.geometryReady === true,
      entry:
        e26b?.proposedEntryPrice ?? null,
      stop:
        e26b?.proposedStopPrice ?? null,
    },

    engine7: {
      status:
        e7?.status ?? null,
      direction:
        e7?.direction ?? null,
      allowed:
        e7?.allowed === true,
      executableSizing:
        e7?.executableSizing === true,
      finalContracts:
        e7?.finalContracts ??
        e7?.paperTestingContracts ??
        null,
      blockers:
        arr(e7?.blockers),
    },

    engine9: {
      status:
        e9?.planStatus ?? null,
      direction:
        e9?.direction ?? null,
      ready:
        e9?.managementReady === true,
      official:
        e9?.official === true,
      planId:
        e9?.planId ?? null,
      waitingFor:
        arr(e9?.waitingFor),
      blockers:
        arr(e9?.blockers),
    },

    engine8: {
      status:
        e8?.status ?? null,
      direction:
        e8?.direction ?? null,
      executable:
        e8?.executable === true,
      orderCreated:
        e8?.orderCreated === true,
      orderId:
        e8?.orderId ?? null,
      tradeId:
        e8?.tradeId ?? null,
      blockers:
        arr(e8?.blockers),
    },

    engine10: e10
      ? {
          status:
            e10?.status ??
            e10?.journal?.status ??
            e10?.lifecycle?.status ??
            null,
          tradeId:
            e10?.tradeId ??
            e10?.journal?.tradeId ??
            e10?.lifecycle?.tradeId ??
            null,
          remainingQty:
            e10?.remainingQty ??
            e10?.journal?.remainingQty ??
            e10?.lifecycle?.remainingQty ??
            null,
        }
      : null,
  };
}

const date = text(
  process.env.ENGINE28A_REPLAY_AUDIT_DATE
);

const start = text(
  process.env.ENGINE28A_REPLAY_AUDIT_START ||
  "0000"
);

const end = text(
  process.env.ENGINE28A_REPLAY_AUDIT_END ||
  "2359"
);

if (
  !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
  !/^\d{4}$/.test(start) ||
  !/^\d{4}$/.test(end)
) {
  console.log(
    JSON.stringify({
      ok: false,
      error:
        "ENGINE28A_REPLAY_AUDIT_BAD_WINDOW",
      date,
      start,
      end,
    })
  );
  process.exit(1);
}

const dayDir =
  path.join(ROOT, date);

if (!fs.existsSync(dayDir)) {
  console.log(
    JSON.stringify({
      ok: false,
      error:
        "ENGINE28A_REPLAY_AUDIT_DATE_NOT_FOUND",
      date,
      dayDir,
    })
  );
  process.exit(1);
}

const times =
  fs.readdirSync(dayDir)
    .filter(
      (name) =>
        /^\d{4}\.json$/.test(name)
    )
    .map(
      (name) =>
        name.replace(".json", "")
    )
    .filter(
      (time) =>
        inWindow(
          time,
          start,
          end
        )
    )
    .sort();

const rows = [];

for (const time of times) {
  const file =
    path.join(
      dayDir,
      time + ".json"
    );

  let snapshot;

  try {
    snapshot = readJson(file);
  } catch (error) {
    rows.push({
      time,
      file,
      error:
        "REPLAY_FILE_UNREADABLE",
      detail:
        String(
          error?.message ||
          error
        ),
    });
    continue;
  }

  const strategy =
    snapshot?.strategies?.[
      STRATEGY_ID
    ];

  if (
    !strategy ||
    typeof strategy !== "object"
  ) {
    rows.push({
      time,
      file,
      error:
        "STRATEGY1_NOT_PRESENT",
    });
    continue;
  }

  const diagnosis =
    buildEngine28APipelineDoctor(
      strategy
    );

  rows.push({
    time,
    file,
    recorded:
      recordedSummary(
        strategy
      ),
    diagnosis: {
      pipelineStatus:
        diagnosis?.pipelineStatus ??
        null,
      firstFailingEngine:
        diagnosis?.firstFailingEngine ??
        null,
      failureType:
        diagnosis?.failureType ??
        null,
      rootCause:
        diagnosis?.rootCause ??
        null,
    },
  });
}

const goRows =
  rows.filter(
    (row) =>
      row?.recorded
        ?.engine6
        ?.allowed === true ||
      row?.recorded
        ?.engine8
        ?.executable === true ||
      row?.recorded
        ?.engine8
        ?.orderCreated === true
  );

const firstFailures = {};

for (const row of rows) {
  const key =
    row?.diagnosis
      ?.firstFailingEngine ||
    (
      row?.diagnosis
        ?.pipelineStatus ===
        "ORDER_READY"
        ? "ORDER_READY"
        : "UNKNOWN"
    );

  firstFailures[key] =
    (firstFailures[key] || 0) + 1;
}

console.log(
  JSON.stringify(
    {
      ok: true,
      source:
        "CANONICAL_ENGINE12_REPLAY",
      historicalEnginesRerun:
        false,
      date,
      start,
      end,
      strategyId:
        STRATEGY_ID,
      replayCount:
        rows.length,
      availableTimes:
        times,
      goSnapshotCount:
        goRows.length,
      firstFailureCounts:
        firstFailures,
      goSnapshots:
        goRows,
      snapshots:
        rows,
    },
    null,
    2
  )
);
