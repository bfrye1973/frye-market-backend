// services/core/scripts/testEngine22WaveFibState.js
// Engine 22G diagnostic script
//
// Purpose:
// Reads live data/strategy-snapshot.json,
// runs analyzeWaveStack(),
// prints wave/fib state,
// prints W5 projections,
// prints simple fib clusters,
// validates expected SPY proof values.
//
// Run:
// cd /opt/render/project/src/services/core
// node scripts/testEngine22WaveFibState.js

import fs from "fs";
import path from "path";
import { analyzeWaveStack } from "../logic/engine22/wave/analyzeWaveStack.js";

const SNAPSHOT_FILE = path.resolve("./data/strategy-snapshot.json");
const PROOF_PRICE = 748.17;

const DEGREE_ORDER = ["primary", "intermediate", "minor", "minute", "micro"];
const CLUSTER_DEGREES = ["primary", "intermediate", "minor", "minute"];
const FIB_KEYS = ["e100", "e1168", "e1272", "e1618", "e200", "e2618"];

const FIB_LABELS = {
  e100: "1.000",
  e1168: "1.168",
  e1272: "1.272",
  e1618: "1.618",
  e200: "2.000",
  e2618: "2.618",
};

function round2(x) {
  const n = Number(x);
  return Number.isFinite(n) ? Number(n.toFixed(2)) : null;
}

function approxEqual(actual, expected, tolerance = 0.03) {
  const a = Number(actual);
  const e = Number(expected);

  if (!Number.isFinite(a) || !Number.isFinite(e)) return false;

  return Math.abs(a - e) <= tolerance;
}

function readSnapshot() {
  if (!fs.existsSync(SNAPSHOT_FILE)) {
    throw new Error(`Snapshot file not found: ${SNAPSHOT_FILE}`);
  }

  return JSON.parse(fs.readFileSync(SNAPSHOT_FILE, "utf8"));
}

function pickCurrentPrice(snapshot) {
  return (
    snapshot?.strategies?.["intraday_scalp@10m"]?.context?.meta?.current_price ??
    snapshot?.strategies?.["intraday_scalp@10m"]?.context?.meta?.currentPrice ??
    snapshot?.marketMeter?.layers?.tenMinute?.close ??
    snapshot?.marketMeter?.layers?.tenMinuteEma10?.close ??
    snapshot?.emaPosture?.tenMinute?.close ??
    null
  );
}

function degreeRow(name, d) {
  return {
    degree: name,
    ok: d?.ok === true,
    phase: d?.phase ?? "UNKNOWN",
    confirmedPhase: d?.confirmedPhase ?? "UNKNOWN",
    state: d?.state ?? "UNKNOWN",
    action: d?.action ?? null,
    nextExpectedWave: d?.nextExpectedWave ?? null,
    anchors: {
      w2: d?.anchors?.w2 ?? null,
      w3: d?.anchors?.w3 ?? null,
      w4: d?.anchors?.w4 ?? null,
      w4Source: d?.anchors?.w4Source ?? null,
    },
    levels: d?.fibProjection?.levels ?? null,
    fibPressure: {
      nearestFib: d?.fibPressure?.nearestFib ?? null,
      nearestFibKey: d?.fibPressure?.nearestFibKey ?? null,
      nearestFibPrice: d?.fibPressure?.nearestFibPrice ?? null,
      distancePts: d?.fibPressure?.distancePts ?? null,
      extensionState: d?.fibPressure?.extensionState ?? null,
      chaseRisk: d?.fibPressure?.chaseRisk ?? null,
    },
  };
}

function collectFibLevels(degrees) {
  const points = [];

  for (const degree of CLUSTER_DEGREES) {
    const levels = degrees?.[degree]?.fibProjection?.levels || null;
    if (!levels) continue;

    for (const key of FIB_KEYS) {
      const price = Number(levels[key]);
      if (!Number.isFinite(price)) continue;

      points.push({
        degree,
        key,
        fib: FIB_LABELS[key] || key,
        price: round2(price),
        label: `${degree} ${key}`,
      });
    }
  }

  return points.sort((a, b) => a.price - b.price);
}

function labelCluster(cluster) {
  const prices = cluster.map((x) => Number(x.price)).filter(Number.isFinite);
  const lo = Math.min(...prices);
  const hi = Math.max(...prices);

  const hasPrimary1272 = cluster.some((x) => x.degree === "primary" && x.key === "e1272");
  const hasIntermediate1618 = cluster.some((x) => x.degree === "intermediate" && x.key === "e1618");

  const hasPrimary1618 = cluster.some((x) => x.degree === "primary" && x.key === "e1618");
  const hasMinor1618 = cluster.some((x) => x.degree === "minor" && x.key === "e1618");
  const hasIntermediate2618 = cluster.some((x) => x.degree === "intermediate" && x.key === "e2618");

  const hasMinor2618 = cluster.some((x) => x.degree === "minor" && x.key === "e2618");
  const hasPrimary200 = cluster.some((x) => x.degree === "primary" && x.key === "e200");

  if (hasPrimary1272 && hasIntermediate1618) {
    return "FIRST_REACTION_CLUSTER";
  }

  if (hasPrimary1618 && hasMinor1618 && hasIntermediate2618) {
    return "MAJOR_W5_REACTION_EXHAUSTION_CLUSTER";
  }

  if (hasMinor2618 && hasPrimary200) {
    return "EXTENDED_BLOWOFF_CLUSTER";
  }

  if (cluster.length >= 3) {
    return "MULTI_DEGREE_FIB_CLUSTER";
  }

  if (hi - lo <= 8) {
    return "MINOR_CLUSTER";
  }

  return "LOOSE_CLUSTER";
}

function buildFibClusters(points, maxGapPts = 10) {
  const clusters = [];
  let current = [];

  for (const point of points) {
    if (!current.length) {
      current.push(point);
      continue;
    }

    const last = current[current.length - 1];
    const gap = point.price - last.price;

    if (gap <= maxGapPts) {
      current.push(point);
    } else {
      if (current.length >= 2) clusters.push(current);
      current = [point];
    }
  }

  if (current.length >= 2) clusters.push(current);

  return clusters.map((cluster) => {
    const prices = cluster.map((x) => Number(x.price)).filter(Number.isFinite);

    return {
      label: labelCluster(cluster),
      lo: round2(Math.min(...prices)),
      hi: round2(Math.max(...prices)),
      width: round2(Math.max(...prices) - Math.min(...prices)),
      members: cluster.map((x) => ({
        degree: x.degree,
        fibKey: x.key,
        fib: x.fib,
        price: x.price,
      })),
    };
  });
}

function printHeader(title) {
  console.log("");
  console.log("=".repeat(80));
  console.log(title);
  console.log("=".repeat(80));
}

function printValidation(name, pass, detail) {
  const icon = pass ? "✅" : "❌";
  console.log(`${icon} ${name}: ${detail}`);
}

function main() {
  const snapshot = readSnapshot();
  const symbol = snapshot?.symbol || "SPY";
  const engine2State = snapshot?.engine2State || null;
  const currentPrice = pickCurrentPrice(snapshot);

  const waveFibState = analyzeWaveStack({
    symbol,
    engine2State,
    currentPrice,
  });

  const proofWaveFibState = analyzeWaveStack({
    symbol,
    engine2State,
    currentPrice: PROOF_PRICE,
  });
  
  printHeader("ENGINE 22G WAVE/FIB STATE DIAGNOSTIC");

  console.log(
    JSON.stringify(
      {
        ok: waveFibState.ok,
        engine: waveFibState.engine,
        symbol: waveFibState.symbol,
        currentPrice: waveFibState.currentPrice,
        stackBias: waveFibState.stackBias,
        activeTradingDegree: waveFibState.activeTradingDegree,
        activeSetup: waveFibState.activeSetup,
        chaseRisk: waveFibState.chaseRisk,
        chaseRiskDegree: waveFibState.chaseRiskDegree,
        summary: waveFibState.summary,
      },
      null,
      2
    )
  );

  printHeader("ENGINE 22G PROOF MODE @ 748.17");

  console.log(
    JSON.stringify(
      {
        ok: proofWaveFibState.ok,
        engine: proofWaveFibState.engine,
        symbol: proofWaveFibState.symbol,
        proofPrice: PROOF_PRICE,
        stackBias: proofWaveFibState.stackBias,
        activeTradingDegree: proofWaveFibState.activeTradingDegree,
        activeSetup: proofWaveFibState.activeSetup,
        chaseRisk: proofWaveFibState.chaseRisk,
        chaseRiskDegree: proofWaveFibState.chaseRiskDegree,
        summary: proofWaveFibState.summary,
      },
      null,
      2
    )
  );
  printHeader("DEGREE STATE SUMMARY");

  for (const degree of DEGREE_ORDER) {
    console.log(JSON.stringify(degreeRow(degree, waveFibState.degrees?.[degree]), null, 2));
  }

  printHeader("W5 PROJECTION LEVELS");

  const projectionRows = {};

  for (const degree of DEGREE_ORDER) {
    projectionRows[degree] = waveFibState.degrees?.[degree]?.fibProjection?.levels ?? null;
  }

  console.log(JSON.stringify(projectionRows, null, 2));

  printHeader("FIB CLUSTERS");

  const points = collectFibLevels(waveFibState.degrees || {});
  const clusters = buildFibClusters(points, 10);

  console.log(JSON.stringify(clusters, null, 2));

  printHeader("EXPECTED SPY VALIDATIONS");

  const intermediateE1618 =
    proofWaveFibState.degrees?.intermediate?.fibProjection?.levels?.e1618;

  const minuteE100 =
    proofWaveFibState.degrees?.minute?.fibProjection?.levels?.e100;

  const microState =
    proofWaveFibState.degrees?.micro?.state;

  const microNext =
    proofWaveFibState.degrees?.micro?.nextExpectedWave;

  const stackBias =
    proofWaveFibState.stackBias;

  const chaseRisk =
    proofWaveFibState.chaseRisk;

  const checks = [
    {
      name: "Intermediate e1618 ≈ 749.73",
      pass: approxEqual(intermediateE1618, 749.73),
      detail: `actual=${intermediateE1618}`,
    },
    {
      name: "Minute e100 ≈ 752.15",
      pass: approxEqual(minuteE100, 752.15),
      detail: `actual=${minuteE100}`,
    },
    {
      name: "Micro state = PULLBACK_ACTIVE",
      pass: microState === "PULLBACK_ACTIVE",
      detail: `actual=${microState}`,
    },
    {
      name: "Micro nextExpectedWave = W5",
      pass: microNext === "W5",
      detail: `actual=${microNext}`,
    },
    {
      name: "Stack bias = BULLISH_LATE_EXTENSION_REACTION_ZONE",
      pass: stackBias === "BULLISH_LATE_EXTENSION_REACTION_ZONE",
      detail: `actual=${stackBias}`,
    },
    {
      name: "Chase risk = HIGH",
      pass: chaseRisk === "HIGH",
      detail: `actual=${chaseRisk}`,
    },
  ];

  for (const check of checks) {
    printValidation(check.name, check.pass, check.detail);
  }

  const allPassed = checks.every((x) => x.pass);

  printHeader("FINAL RESULT");

  if (allPassed) {
    console.log("✅ Engine 22G wave/fib diagnostic PASSED.");
    process.exitCode = 0;
  } else {
    console.log("❌ Engine 22G wave/fib diagnostic FAILED.");
    console.log("Stop and fix wave/fib module before wiring into old Engine 22.");
    process.exitCode = 1;
  }
}

try {
  main();
} catch (err) {
  console.error("❌ Engine 22G diagnostic crashed:");
  console.error(err);
  process.exitCode = 1;
}
