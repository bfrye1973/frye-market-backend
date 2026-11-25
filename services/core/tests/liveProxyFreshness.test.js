import test from "node:test";
import assert from "node:assert/strict";
import {
  extractLiveSourceTimestampMs,
  newerLiveJson,
} from "../routes/live.js";

test("extracts canonical timestamps from live payloads", () => {
  assert.equal(
    extractLiveSourceTimestampMs({ updated_at_utc: "2026-10-05T15:13:12Z" }),
    Date.parse("2026-10-05T15:13:12Z")
  );
  assert.equal(
    extractLiveSourceTimestampMs({ meta: { last_full_run_utc: "2026-10-05T15:14:16Z" } }),
    Date.parse("2026-10-05T15:14:16Z")
  );
});

test("newer live payload always wins", () => {
  const older = { updated_at_utc: "2026-10-05T15:08:17Z", value: "old" };
  const newer = { updated_at_utc: "2026-10-05T15:14:16Z", value: "new" };

  assert.equal(newerLiveJson(older, newer), newer);
  assert.equal(newerLiveJson(newer, older), newer);
});

test("missing timestamps never replace a timestamped live payload", () => {
  const unknown = { value: "unknown" };
  const known = { updated_at_utc: "2026-10-05T15:14:16Z", value: "known" };

  assert.equal(newerLiveJson(unknown, known), known);
  assert.equal(newerLiveJson(known, unknown), known);
});
