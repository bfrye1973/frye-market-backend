import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

test("Micro position awareness is assembled after canonical Strategy1 decisions and reads Engine10 OPEN trades only", () => {
  const file =
    fileURLToPath(
      new URL(
        "../jobs/buildStrategySnapshot.js",
        import.meta.url
      )
    );

  const source =
    fs.readFileSync(file, "utf8");

  const engine26A =
    source.indexOf(
      "const engine26A = buildEngine26A({"
    );

  const engine6 =
    source.indexOf(
      "let finalPermissionRaw ="
    );

  const engine26B =
    source.indexOf(
      "engine26ProposedGeometry =\n    buildEngine26BPipeline({"
    );

  const engine9 =
    source.indexOf(
      "buildEngine9OfficialManagementPlan"
    );

  const context =
    source.indexOf(
      "const microPositionContext ="
    );

  assert.ok(engine26A >= 0);
  assert.ok(engine6 >= 0);
  assert.ok(engine26B >= 0);
  assert.ok(engine9 >= 0);
  assert.ok(context >= 0);

  assert.ok(context > engine26A);
  assert.ok(context > engine6);
  assert.ok(context > engine26B);

  assert.match(
    source,
    /listTrades\(\{\s*status:\s*"OPEN"/s
  );

  assert.match(
    source,
    /microPositionContext,/
  );

  const beforeContext =
    source.slice(
      0,
      context
    );

  assert.doesNotMatch(
    beforeContext,
    /microPositionContext\?/
  );
});
