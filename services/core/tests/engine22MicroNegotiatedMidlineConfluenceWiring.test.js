import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

test("Micro negotiated-midline A++ confluence is assembled after Engine22/26 and cannot feed permission", () => {
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

  const permission =
    source.indexOf(
      "let finalPermissionRaw ="
    );

  const confluence =
    source.indexOf(
      "const engine22MicroNegotiatedMidlineConfluence ="
    );

  assert.ok(e26a >= 0);
  assert.ok(permission >= 0);
  assert.ok(confluence >= 0);

  assert.ok(
    confluence > e26a,
    "A++ confluence must be assembled after Engine26A"
  );

  assert.ok(
    confluence > permission,
    "A++ confluence must be assembled after Engine6 permission so it cannot influence permission"
  );

  const permissionSlice =
    source.slice(
      permission,
      confluence
    );

  assert.doesNotMatch(
    permissionSlice,
    /engine22MicroNegotiatedMidlineConfluence/
  );

  assert.match(
    source,
    /engine22MicroNegotiatedMidlineConfluence,/
  );
});
