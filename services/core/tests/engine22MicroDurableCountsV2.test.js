import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  createCanonicalMicroState,
} from "../logic/engine22/microV2/canonicalMicroState.js";

import {
  reduceCanonicalMicroState,
} from "../logic/engine22/microV2/reduceCanonicalMicroState.js";

import {
  createAuthorizedMicroRecount,
} from "../logic/engine22/microV2/createAuthorizedMicroRecount.js";

import {
  persistCanonicalMicroState,
  persistCanonicalMicroTransition,
  persistAuthorizedMicroRecount,
  readActiveCanonicalMicroCount,
  readCanonicalMicroCount,
  readCanonicalMicroTransitionHistory,
  readCanonicalMicroRecountHistory,
} from "../logic/engine22/microV2/canonicalMicroStore.js";

function state() {
  return createCanonicalMicroState({
    countId: "COUNT-A",
    sequenceId: "SEQ-A",
    sequenceDirection: "UP",
    origin: {
      price: 7782.75,
      source: "TEST",
    },
    parentDegree: "SUBMINUTE",
    parentWave: "W3",
    parentDirection: "UP",
    sourceTimestamp: "2026-10-09T12:00:00Z",
  });
}

function tempRoot(prefix) {
  return fs.mkdtempSync(
    path.join(os.tmpdir(), prefix)
  );
}

test("durable store survives restart and preserves canonical count", () => {
  const root = tempRoot("micro-v2-store-");

  try {
    const original = state();

    assert.equal(
      persistCanonicalMicroState({
        state: original,
        rootDir: root,
      }).ok,
      true
    );

    const reloaded =
      readActiveCanonicalMicroCount({
        rootDir: root,
      });

    assert.equal(reloaded.countId, "COUNT-A");
    assert.equal(reloaded.origin.price, 7782.75);
    assert.equal(reloaded.activeWave, "W1");
  } finally {
    fs.rmSync(root, {
      recursive: true,
      force: true,
    });
  }
});

test("append-only transition persistence records only new revisions", () => {
  const root = tempRoot("micro-v2-ledger-");

  try {
    const before = state();

    persistCanonicalMicroState({
      state: before,
      rootDir: root,
    });

    const result =
      reduceCanonicalMicroState(
        before,
        {
          type: "UPDATE_DEVELOPING_ANCHOR",
          wave: "W1",
          anchor: 7854,
          sourceTimestamp:
            "2026-10-09T12:05:00Z",
        }
      );

    assert.equal(result.applied, true);

    const persisted =
      persistCanonicalMicroTransition({
        beforeState: before,
        afterState: result.state,
        rootDir: root,
      });

    assert.equal(persisted.ok, true);
    assert.equal(persisted.appendedTransitions, 1);

    const repeated =
      persistCanonicalMicroTransition({
        beforeState: result.state,
        afterState: result.state,
        rootDir: root,
      });

    assert.equal(repeated.appendedTransitions, 0);

    const history =
      readCanonicalMicroTransitionHistory({
        rootDir: root,
      });

    assert.equal(history.length, 1);
    assert.equal(history[0].revision, 1);
    assert.equal(history[0].countId, "COUNT-A");
  } finally {
    fs.rmSync(root, {
      recursive: true,
      force: true,
    });
  }
});

test("recount requires explicit authorization", () => {
  const current = state();
  current.countStatus = "RECOUNT_REQUIRED";

  const result =
    createAuthorizedMicroRecount({
      currentState: current,
      newCountId: "COUNT-B",
      newSequenceId: "SEQ-B",
      newOrigin: {
        price: 7800,
      },
      authorization: {
        authorized: false,
        reasonCode:
          "COMPLETED_CLOSE_INVALIDATION",
      },
    });

  assert.equal(result.ok, false);
  assert.ok(
    result.reasonCodes.includes(
      "MICRO_RECOUNT_NOT_AUTHORIZED"
    )
  );
});

test("authorized recount creates clean count and moves old count to history", () => {
  const current = state();

  current.countStatus = "RECOUNT_REQUIRED";
  current.waves.W1.lifecycle = "LOCKED";
  current.waves.W1.lockedAnchor = 7854;
  current.waves.W1.confirmedAnchor = 7854;

  const result =
    createAuthorizedMicroRecount({
      currentState: current,
      newCountId: "COUNT-B",
      newSequenceId: "SEQ-B",
      newOrigin: {
        price: 7800,
        source: "RECOUNT_TEST",
      },
      sourceTimestamp:
        "2026-10-09T13:00:00Z",
      authorization: {
        authorized: true,
        type: "DETERMINISTIC_RULE",
        reasonCode:
          "COMPLETED_CLOSE_INVALIDATION",
        authorizedBy:
          "ENGINE22_TEST",
      },
    });

  assert.equal(result.ok, true);

  assert.equal(
    result.previousCount.countStatus,
    "HISTORICAL"
  );

  assert.equal(
    result.previousCount.supersededByCountId,
    "COUNT-B"
  );

  assert.equal(
    result.newCount.countId,
    "COUNT-B"
  );

  assert.equal(
    result.newCount.waves.W1.lifecycle,
    "DEVELOPING"
  );

  assert.equal(
    result.newCount.waves.W1.lockedAnchor,
    null
  );

  assert.equal(
    result.newCount.waves.W2.lockedAnchor,
    null
  );
});

test("authorized recount persists old and new counts without contamination", () => {
  const root = tempRoot("micro-v2-recount-");

  try {
    const current = state();

    current.countStatus = "RECOUNT_REQUIRED";
    current.waves.W1.lifecycle = "LOCKED";
    current.waves.W1.lockedAnchor = 7854;
    current.waves.W1.confirmedAnchor = 7854;

    const result =
      createAuthorizedMicroRecount({
        currentState: current,
        newCountId: "COUNT-B",
        newSequenceId: "SEQ-B",
        newOrigin: {
          price: 7800,
        },
        sourceTimestamp:
          "2026-10-09T13:00:00Z",
        authorization: {
          authorized: true,
          type: "MANAGER",
          reasonCode:
            "MANAGER_AUTHORIZED_RECOUNT",
          authorizedBy:
            "ENGINE22_MANAGER",
        },
      });

    assert.equal(result.ok, true);

    const persisted =
      persistAuthorizedMicroRecount({
        previousCount:
          result.previousCount,
        newCount:
          result.newCount,
        recountRecord:
          result.recountRecord,
        rootDir: root,
      });

    assert.equal(persisted.ok, true);

    const oldCount =
      readCanonicalMicroCount({
        countId: "COUNT-A",
        rootDir: root,
      });

    const active =
      readActiveCanonicalMicroCount({
        rootDir: root,
      });

    assert.equal(
      oldCount.countStatus,
      "HISTORICAL"
    );

    assert.equal(
      oldCount.waves.W1.lockedAnchor,
      7854
    );

    assert.equal(active.countId, "COUNT-B");
    assert.equal(
      active.waves.W1.lockedAnchor,
      null
    );

    const recounts =
      readCanonicalMicroRecountHistory({
        rootDir: root,
      });

    assert.equal(recounts.length, 1);
    assert.equal(
      recounts[0].oldCountId,
      "COUNT-A"
    );
    assert.equal(
      recounts[0].newCountId,
      "COUNT-B"
    );
  } finally {
    fs.rmSync(root, {
      recursive: true,
      force: true,
    });
  }
});

test("normal lifecycle transition cannot cross a count boundary", () => {
  const root = tempRoot("micro-v2-boundary-");

  try {
    const before = state();
    const after = state();
    after.countId = "COUNT-B";

    const persisted =
      persistCanonicalMicroTransition({
        beforeState: before,
        afterState: after,
        rootDir: root,
      });

    assert.equal(persisted.ok, false);
    assert.ok(
      persisted.reasonCodes.includes(
        "COUNT_BOUNDARY_REQUIRES_AUTHORIZED_RECOUNT_PERSISTENCE"
      )
    );
  } finally {
    fs.rmSync(root, {
      recursive: true,
      force: true,
    });
  }
});
