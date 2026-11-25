#!/usr/bin/env node

// Offline acceptance report for Engine 22 Micro timing shadow.
//
// Usage:
//   node services/core/jobs/auditMicroTimingShadowReplay.js
//   node services/core/jobs/auditMicroTimingShadowReplay.js /var/data/replay/es
//
// Reads JSON snapshots recursively and prints one aggregate JSON report.
// It never writes Replay or trading state.

import fs from "node:fs";
import path from "node:path";

import {
  summarizeMicroTimingShadowSnapshots,
} from "../logic/engine28a/summarizeMicroTimingShadowSnapshots.js";

const root =
  process.argv[2] ||
  "/var/data/replay/es";

function walk(dir) {
  if (!fs.existsSync(dir)) {
    return [];
  }

  const out = [];

  for (
    const entry of fs.readdirSync(
      dir,
      { withFileTypes: true }
    )
  ) {
    const full =
      path.join(
        dir,
        entry.name
      );

    if (entry.isDirectory()) {
      out.push(...walk(full));
      continue;
    }

    if (
      entry.isFile() &&
      entry.name
        .toLowerCase()
        .endsWith(".json")
    ) {
      out.push(full);
    }
  }

  return out;
}

const files =
  walk(root).sort();

const snapshots = [];
const unreadableFiles = [];

for (const file of files) {
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
    unreadableFiles.push({
      file,
      error:
        String(
          error?.message || error
        ),
    });
  }
}

const summary =
  summarizeMicroTimingShadowSnapshots(
    snapshots
  );

console.log(
  JSON.stringify(
    {
      ...summary,
      replayRoot: root,
      jsonFilesRead:
        snapshots.length,
      unreadableFileCount:
        unreadableFiles.length,
      unreadableFiles,
      generatedAt:
        new Date().toISOString(),
    },
    null,
    2
  )
);
