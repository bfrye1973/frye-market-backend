import assert from "node:assert/strict";
import test from "node:test";

import { isEsGlobexSessionOpen } from "../logic/engine29/isEsGlobexSessionOpen.js";

function utc(value) {
  return Date.parse(value);
}

test("Sunday before 6pm ET is closed", () => {
  const result = isEsGlobexSessionOpen(utc("2026-09-27T21:59:00Z")); // 5:59pm ET
  assert.equal(result.open, false);
});

test("Sunday 6pm ET opens ES Globex", () => {
  const result = isEsGlobexSessionOpen(utc("2026-09-27T22:00:00Z")); // 6:00pm ET
  assert.equal(result.open, true);
});

test("weekday daytime is open", () => {
  const result = isEsGlobexSessionOpen(utc("2026-09-30T18:30:00Z")); // 2:30pm ET
  assert.equal(result.open, true);
});

test("weekday maintenance 5pm to 6pm ET is closed", () => {
  const result = isEsGlobexSessionOpen(utc("2026-09-30T21:30:00Z")); // 5:30pm ET
  assert.equal(result.open, false);
  assert.equal(result.reason, "DAILY_MAINTENANCE");
});

test("weekday 6pm ET reopens", () => {
  const result = isEsGlobexSessionOpen(utc("2026-09-30T22:00:00Z")); // 6:00pm ET
  assert.equal(result.open, true);
});

test("Friday after 5pm ET is closed", () => {
  const result = isEsGlobexSessionOpen(utc("2026-10-02T21:00:00Z")); // 5:00pm ET
  assert.equal(result.open, false);
});

test("Saturday is closed", () => {
  const result = isEsGlobexSessionOpen(utc("2026-10-03T16:00:00Z"));
  assert.equal(result.open, false);
});
