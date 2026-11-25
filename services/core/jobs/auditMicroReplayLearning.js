#!/usr/bin/env node

// Offline Engine 28A Micro Replay learning audit.
//
// Usage:
//   node services/core/jobs/auditMicroReplayLearning.js
//   node services/core/jobs/auditMicroReplayLearning.js /var/data/replay/es
//
// Reads immutable canonical Replay JSON only.
// Writes no trading state.

import fs from "node:fs";
import path from "node:path";

import {
  buildMicroReplayLearningDataset,
  summarizeMicroReplayLearning,
} from "../logic/engine28a/buildMicroReplayLearning.js";

const root =
  process.argv[2] ||
  "/var/data/replay/es";

function walk(dir) {
  if (!fs.existsSync(dir)) {
    return [];
  }

  const out = [];

  for (
    const entry of
    fs.readdirSync(
      dir,
      {
        withFileTypes:
          true,
      }
    )
  ) {
    const full =
      path.join(
        dir,
        entry.name
      );

    if (
      entry.isDirectory()
    ) {
      out.push(
        ...walk(full)
      );
      continue;
    }

    if (
      entry.isFile() &&
      /^\d{4}\.json$/.test(
        entry.name
      )
    ) {
      out.push(full);
    }
  }

  return out;
}

const files =
  walk(root)
    .sort();

const snapshots = [];
const unreadable = [];

for (
  const file of files
) {
  try {
    snapshots.push(
      JSON.parse(
        fs.readFileSync(
          file,
          "utf8"
        )
      )
    );
  } catch (error) {
    unreadable.push({
      file,
      error:
        String(
          error?.message ||
          error
        ),
    });
  }
}

const dataset =
  buildMicroReplayLearningDataset(
    snapshots
  );

const summary =
  summarizeMicroReplayLearning(
    dataset
  );

console.log(
  JSON.stringify(
    {
      ok: true,

      replayRoot:
        root,

      filesRead:
        snapshots.length,

      unreadableFileCount:
        unreadable.length,

      summary,

      dataset,

      generatedAt:
        new Date()
          .toISOString(),
    },
    null,
    2
  )
);
