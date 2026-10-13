import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

test("Engine28A Micro acceptance telemetry is assembled after canonical Strategy1 owners", () => {
  const file =
    fileURLToPath(
      new URL(
        "../jobs/buildStrategySnapshot.js",
        import.meta.url
      )
    );

  const source =
    fs.readFileSync(file, "utf8");

  const e26a =
    source.indexOf(
      "const engine26A = buildEngine26A({"
    );

  const e3 =
    source.indexOf(
      "const engine3Strategy1Handoff ="
    );

  const e4 =
    source.indexOf(
      "attachEngine4AuthorizedReactionParticipation({",
      e3
    );

  const e6 =
    source.indexOf(
      "let finalPermissionRaw ="
    );

  const e26b =
    source.indexOf(
      "engine26ProposedGeometry =\n    buildEngine26BPipeline({"
    );

  const e26Micro =
    source.indexOf(
      "const engine26MicroTimingShadow ="
    );

  const e28 =
    source.indexOf(
      "const engine28AMicroTimingAutomationShadow ="
    );

  for (const value of [
    e26a,
    e3,
    e4,
    e6,
    e26b,
    e26Micro,
    e28,
  ]) {
    assert.ok(value >= 0);
  }

  assert.ok(e28 > e26a);
  assert.ok(e28 > e3);
  assert.ok(e28 > e4);
  assert.ok(e28 > e6);
  assert.ok(e28 > e26b);
  assert.ok(e28 > e26Micro);

  assert.match(
    source,
    /engine28AMicroTimingAutomationShadow,/
  );
});
