import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildEngine29DownstreamContext, recordEngine29DownstreamContext } from "../logic/engine29/downstreamContext.js";

test("downstream context preserves canonical 30m parent independent of opposite squeeze", () => {
  const output = {
    timestamp: "2026-11-23T16:00:00.000Z",
    dataDegraded: false,
    marketCharacter: {
      move: { parent: { active: true, direction: "UP", reason: "PARENT_PERSISTED", startedAt: "2026-11-23T15:30:00Z" },
        moveCharacter: "UPSIDE_MOVE_ACTIVE",
        liveCondition: { direction: "DOWN", state: "COUNTERTREND_SELLOFF_FADING" },
        character: { broadConfirmation: { state: "BROAD_CONFIRMED" } } },
      squeezeCampaign: { direction: "DOWN", state: "SQUEEZE_WATCH" },
      liquidity: { state: "SWEEP_LOW" }, trap: { state: "TRAP_WATCH" },
    },
    dataQuality: { degradedGroups: ["ratesDuration"] },
    tacticalState: "NORMAL", fastTacticalState: "NORMAL",
    reasonCodes: ["SOME_REASON"],
  };
  const ctx = buildEngine29DownstreamContext(output);
  assert.equal(ctx.schema, "engine29.downstreamContext.v1");
  assert.equal(ctx.lanes.parentMove.direction, "UP");
  assert.equal(ctx.lanes.parentMove.state, "UPSIDE_MOVE_ACTIVE");
  assert.equal(Object.hasOwn(ctx.lanes.parentMove.parent, "state"), false);
  assert.equal(ctx.lanes.liveTenMinute.direction, "DOWN");
  assert.equal(ctx.lanes.squeeze.campaign.direction, "DOWN");
  assert.equal(ctx.lanes.liquidity.eligibleForEngine4, false);
  assert.equal(ctx.lanes.trap.eligibleForEngine4, false);
  assert.deepEqual(ctx.degradedGroups, ["ratesDuration"]);
});

test("point-in-time receipts never overwrite and are exact live contract bytes", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "engine29-receipt-"));
  try {
    const context = buildEngine29DownstreamContext({
      timestamp: "2026-11-23T16:00:00.000Z",
      marketCharacter: { move: { parent: { direction: "UP" } } },
    });
    const at = new Date("2026-11-23T16:00:00.000Z");
    const a = recordEngine29DownstreamContext(context, { replayBaseDir: dir, now: at });
    const b = recordEngine29DownstreamContext(context, { replayBaseDir: dir, now: at });
    assert.notEqual(a, b);
    assert.deepEqual(JSON.parse(fs.readFileSync(a, "utf8")), context);
    assert.deepEqual(JSON.parse(fs.readFileSync(b, "utf8")), context);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("production-shaped parent state is copied only from moveCharacter, never a fabricated parent.state", () => {
 for (const [direction, state] of [
  ["UP", "UPSIDE_MOVE_ACTIVE"], ["DOWN", "DOWNSIDE_MOVE_ACTIVE"], ["FLAT", "NO_ACTIVE_MOVE"]
 ]) {
  const parent = { active: direction !== "FLAT", direction, reason: "NO_CHANGE",
    lastQualifiedAt: "2026-11-23T17:00:00.000Z" };
  const ctx = buildEngine29DownstreamContext({
    timestamp:"2026-11-23T18:00:00.000Z",
    marketCharacter:{move:{parent,moveCharacter:state}}
  });
  assert.equal(ctx.lanes.parentMove.state,state);
  assert.strictEqual(ctx.lanes.parentMove.parent,parent);
  assert.equal(Object.hasOwn(parent,"state"),false);
 }
});
