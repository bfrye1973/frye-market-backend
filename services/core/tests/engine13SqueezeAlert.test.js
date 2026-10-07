import test from "node:test";
import assert from "node:assert/strict";

import { decideSqueezeAlert } from "../jobs/alertEngine29Squeeze.js";

function campaign(overrides = {}) {
  return {
    version: "engine29.squeezeCampaign.v2",
    available: true,
    dataDegraded: false,
    campaignId: "E29SQ-UP-20261005T140400",
    direction: "UP",
    state: "SQUEEZE_WATCH",
    watchAt: "2026-10-05T14:04:00.000Z",
    activeAt: null,
    ...overrides,
  };
}

test("new WATCH sends", () => {
  const r = decideSqueezeAlert({
    campaign: campaign(),
    ledger: {},
    now: Date.parse("2026-10-05T14:04:30Z"),
    minIntervalSec: 0,
  });
  assert.equal(r.send, true);
  assert.equal(r.stage, "WATCH");
});

test("same WATCH campaign dedupes", () => {
  const c = campaign();
  const key = `ES|SQUEEZE|UP|${c.campaignId}|WATCH`;
  const r = decideSqueezeAlert({
    campaign: c,
    ledger: { lastWatchKey: key },
    now: Date.parse("2026-10-05T14:07:00Z"),
    minIntervalSec: 0,
  });
  assert.equal(r.send, false);
  assert.equal(r.why, "duplicate_watch");
});

test("same campaign ACTIVE sends once independently from WATCH", () => {
  const c = campaign({
    state: "SQUEEZE_ACTIVE",
    activeAt: "2026-10-05T14:10:00.000Z",
  });
  const watchKey = `ES|SQUEEZE|UP|${c.campaignId}|WATCH`;
  const r = decideSqueezeAlert({
    campaign: c,
    ledger: { lastWatchKey: watchKey },
    now: Date.parse("2026-10-05T14:10:30Z"),
    minIntervalSec: 0,
  });
  assert.equal(r.send, true);
  assert.equal(r.stage, "ACTIVE");
});

test("same ACTIVE campaign dedupes", () => {
  const c = campaign({
    state: "SQUEEZE_ACTIVE",
    activeAt: "2026-10-05T14:10:00.000Z",
  });
  const key = `ES|SQUEEZE|UP|${c.campaignId}|ACTIVE`;
  const r = decideSqueezeAlert({
    campaign: c,
    ledger: { lastActiveKey: key },
    now: Date.parse("2026-10-05T14:13:00Z"),
    minIntervalSec: 0,
  });
  assert.equal(r.send, false);
  assert.equal(r.why, "duplicate_active");
});

test("new DOWN WATCH sends", () => {
  const r = decideSqueezeAlert({
    campaign: campaign({
      campaignId: "E29SQ-DOWN-20261005T194000",
      direction: "DOWN",
    }),
    ledger: {},
    now: Date.parse("2026-10-05T19:40:30Z"),
    minIntervalSec: 0,
  });
  assert.equal(r.send, true);
  assert.equal(r.stage, "WATCH");
});

test("HOLDING does not send", () => {
  const r = decideSqueezeAlert({
    campaign: campaign({ state: "SQUEEZE_HOLDING" }),
    ledger: {},
    now: Date.parse("2026-10-05T14:20:00Z"),
    minIntervalSec: 0,
  });
  assert.equal(r.send, false);
  assert.equal(r.why, "state_not_alertable");
});

test("degraded campaign fails closed", () => {
  const r = decideSqueezeAlert({
    campaign: campaign({ dataDegraded: true, available: false }),
    ledger: {},
    now: Date.parse("2026-10-05T14:20:00Z"),
    minIntervalSec: 0,
  });
  assert.equal(r.send, false);
  assert.equal(r.why, "unavailable_or_degraded");
});

test("malformed contract fails closed", () => {
  const r = decideSqueezeAlert({
    campaign: { state: "SQUEEZE_WATCH" },
    ledger: {},
    now: Date.parse("2026-10-05T14:20:00Z"),
    minIntervalSec: 0,
  });
  assert.equal(r.send, false);
  assert.equal(r.why, "invalid_contract");
});

test("rate limit suppresses rapid different stage", () => {
  const c = campaign({
    state: "SQUEEZE_ACTIVE",
    activeAt: "2026-10-05T14:10:00.000Z",
  });
  const r = decideSqueezeAlert({
    campaign: c,
    ledger: { lastSentAtUtc: "2026-10-05T14:09:45.000Z" },
    now: Date.parse("2026-10-05T14:10:00Z"),
    minIntervalSec: 60,
  });
  assert.equal(r.send, false);
  assert.equal(r.why, "rate_limited");
});
