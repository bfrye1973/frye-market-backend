// services/core/tests/engine26GeneralParentStrategy1Child.test.js

import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  buildEngine26A,
} from "../logic/engine26/buildEngine26LocationCandidate.js";

/*
 * Keep this suite completely isolated from:
 *
 * - live Engine 26 negotiated-zone memory
 * - live daily manual imbalance inventory
 *
 * The production manual-zone file changes throughout the trading day,
 * so these regression tests must control their own zone inventory.
 */
const TEST_DIR = fs.mkdtempSync(
  path.join(
    os.tmpdir(),
    "engine26-general-parent-child-"
  )
);

const TEST_MEMORY_PATH = path.join(
  TEST_DIR,
  "negotiated-zone-memory.json"
);

const TEST_MANUAL_ZONES_PATH = path.join(
  TEST_DIR,
  "es-smz-manual-zones.txt"
);

/*
 * One controlled major imbalance:
 *
 * Broad manual imbalance:
 *   7419.75–7473.50
 *
 * Negotiated middle zone:
 *   7433.75–7457.50
 *
 * This gives the first test:
 * - a valid broad parent near 7475
 * - a valid Strategy 1 negotiated child near 7475
 *
 * At 7800 both are outside the 25-point Strategy 1 monitoring range,
 * so the second test can prove the child safely waits while the general
 * parent remains informationally available.
 */
fs.writeFileSync(
  TEST_MANUAL_ZONES_PATH,
  [
    "7419.75-7473.50 | NEG 7433.75-7457.50",
    "",
  ].join("\n"),
  "utf8"
);

after(() => {
  fs.rmSync(
    TEST_DIR,
    {
      recursive: true,
      force: true,
    }
  );
});

function makeEngine22MinuteDown() {
  return {
    degreeStates: {
      primary: {
        direction: "UP",
        stage: "ACTIVE",
      },

      intermediate: {
        direction: "UP",
        stage: "ACTIVE",
      },

      minor: {
        direction: "UP",
        stage: "E_LEG_COMPLETION_WATCH",
      },

      minute: {
        direction: "DOWN",
        stage: "C_COMPLETION_WATCH",
      },

      subminute: {
        direction: "NEUTRAL",
        stage: "TACTICAL_RECLAIM_WATCH",
      },
    },

    waveOpportunity: {
      direction: "NONE",
      setupType: "NONE",
    },

    currentLifecycleState: {
      direction: "NONE",
      key: "MINUTE_C_COMPLETION_WATCH",
    },
  };
}

test(
  "broad parent and neutral V2 negotiated observation child publish independently",
  () => {
    const result = buildEngine26A({
      symbol: "ES",

      strategyId:
        "intraday_scalp@10m",

      timeframe: "10m",

      currentPrice: 7475,

      snapshotTime:
        "2026-07-28T17:00:00.000Z",

      engine22WaveStrategy:
        makeEngine22MinuteDown(),

      engine25Context: null,

      engine1Context: null,

      previousLocationCandidate: null,

      bars10m: [],

      manualZonesFilePath:
        TEST_MANUAL_ZONES_PATH,

      memoryFilePath:
        TEST_MEMORY_PATH,

      persistMemory: false,

      tickSize: 0.25,

      activationRangePoints: 4,

      monitoringRangePoints: 25,
    });

    const parent =
      result.engine26GeneralLocation;

    const child =
      result.engine26LocationCandidate;

    const reactionHandoff =
      result.engine26ReactionHandoff;

    assert.ok(parent);
    assert.ok(child);

    /*
     * General parent may use the broad major imbalance.
     */
    assert.equal(
      parent.location.source,
      "ENGINE26_MANUAL_IMBALANCE"
    );

    assert.equal(
      parent.directionBias,
      "SHORT"
    );

    /*
     * Strategy 1 independently selects only the approved
     * negotiated middle zone.
     */
    assert.equal(
      child.location.source,
      "ENGINE26_MANUAL_NEGOTIATED"
    );

    assert.equal(
      child.location.lo,
      7433.75
    );

    assert.equal(
      child.location.hi,
      7457.5
    );

    assert.equal(
      child.setupClass,
      "NEGOTIATED_ZONE_ROTATION"
    );

    assert.equal(
      child.candidateIdentityVersion,
      "engine26.strategy1.v2"
    );

    /*
     * Engine 26 does not inherit Minute DOWN as the tactical
     * Strategy 1 direction.
     */
    assert.equal(
      child.directionBias,
      "NEUTRAL"
    );

    assert.equal(
      child.direction,
      "NEUTRAL"
    );

    assert.equal(
      child.directionState,
      "OBSERVING_ZONE_REACTION"
    );

    assert.notEqual(
      parent.directionBias,
      child.directionBias
    );

    /*
     * NEW CONTRACT:
     *
     * A valid Engine 26 Strategy 1 candidate is available,
     * so Engine 3 remains authorized to observe/evaluate it
     * even though Engine 26 has not resolved LONG or SHORT.
     */
    assert.equal(
      reactionHandoff
        .authorizeEngine3Evaluation,
      true
    );

    assert.equal(
      reactionHandoff.active,
      true
    );

    /*
     * Engine 26B geometry still must not advance while
     * directional resolution is absent.
     */
    assert.equal(
      result.engine26GeometryHandoff.active,
      false
    );

    assert.equal(
      parent.noPermissionCreated,
      true
    );

    assert.equal(
      child.noPermissionCreated,
      true
    );

    assert.equal(
      child.noExecution,
      true
    );
  }
);

test(
  "missing in-range negotiated child waits safely while general parent remains available",
  () => {
    const result = buildEngine26A({
      symbol: "ES",

      strategyId:
        "intraday_scalp@10m",

      timeframe: "10m",

      currentPrice: 7800,

      snapshotTime:
        "2026-07-28T17:10:00.000Z",

      engine22WaveStrategy:
        makeEngine22MinuteDown(),

      manualZonesFilePath:
        TEST_MANUAL_ZONES_PATH,

      memoryFilePath:
        TEST_MEMORY_PATH,

      persistMemory: false,

      activationRangePoints: 4,

      monitoringRangePoints: 25,
    });

    /*
     * The general parent may remain informationally available
     * even though its nearest controlled zone is distant.
     */
    assert.ok(
      result.engine26GeneralLocation
    );

    /*
     * The only controlled negotiated zone is far outside the
     * 25-point Strategy 1 monitoring range.
     */
    assert.equal(
      result.engine26LocationCandidate.active,
      false
    );

    assert.equal(
      result.engine26LocationCandidate.status,
      "WAITING_FOR_LOCATION"
    );

    /*
     * No valid Engine 26 candidate context exists, so the
     * reaction handoff itself is not active/authorized.
     *
     * Engine 3/4's continuous market observers are a separate
     * concept from an authorized Engine 26 candidate context.
     */
    assert.equal(
      result.engine26ReactionHandoff.active,
      false
    );

    assert.equal(
      result.engine26ReactionHandoff
        .authorizeEngine3Evaluation,
      false
    );

    /*
     * No location candidate means no geometry progression.
     */
    assert.equal(
      result.engine26GeometryHandoff.active,
      false
    );
  }
);

test(
  "Engine 26A does not mutate caller inputs",
  () => {
    const engine22WaveStrategy =
      makeEngine22MinuteDown();

    const before =
      JSON.stringify(
        engine22WaveStrategy
      );

    buildEngine26A({
      symbol: "ES",

      strategyId:
        "intraday_scalp@10m",

      timeframe: "10m",

      currentPrice: 7475,

      snapshotTime:
        "2026-07-28T17:20:00.000Z",

      engine22WaveStrategy,

      manualZonesFilePath:
        TEST_MANUAL_ZONES_PATH,

      memoryFilePath:
        TEST_MEMORY_PATH,

      persistMemory: false,
    });

    assert.equal(
      JSON.stringify(
        engine22WaveStrategy
      ),
      before
    );
  }
);
