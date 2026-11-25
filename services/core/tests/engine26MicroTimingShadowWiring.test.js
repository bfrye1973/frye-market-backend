import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

test("Engine26 Micro timing shadow is assembled only after canonical Engine26/Engine6 work", () => {
  const path =
    fileURLToPath(
      new URL(
        "../jobs/buildStrategySnapshot.js",
        import.meta.url
      )
    );

  const source =
    fs.readFileSync(path, "utf8");

  const engine26ABuild =
    source.indexOf(
      "const engine26A = buildEngine26A({"
    );

  const finalPermission =
    source.indexOf(
      "let finalPermissionRaw ="
    );

  const geometry =
    source.indexOf(
      "engine26ProposedGeometry =\n    buildEngine26BPipeline({"
    );

  const shadow =
    source.indexOf(
      "const engine26MicroTimingShadow ="
    );

  assert.ok(engine26ABuild >= 0);
  assert.ok(finalPermission >= 0);
  assert.ok(geometry >= 0);
  assert.ok(shadow >= 0);

  assert.ok(
    shadow > engine26ABuild,
    "shadow must be assembled after Engine26A"
  );

  assert.ok(
    shadow > finalPermission,
    "shadow must be assembled after Engine6 permission"
  );

  assert.ok(
    shadow > geometry,
    "shadow must be assembled after Engine26B geometry"
  );

  const engine26ACall =
    source.slice(
      engine26ABuild,
      source.indexOf(
        "});",
        engine26ABuild
      ) + 3
    );

  assert.doesNotMatch(
    engine26ACall,
    /engine26MicroTimingShadow/
  );

  assert.match(
    source,
    /engine26MicroTimingShadow,/
  );
});
