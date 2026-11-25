import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

test("Engine22 wave strategy publishes dual W2/W3 transition Fib context additively", () => {
  const file =
    fileURLToPath(
      new URL(
        "../logic/engine22/wave/buildEngine22WaveStrategy.js",
        import.meta.url
      )
    );

  const source =
    fs.readFileSync(
      file,
      "utf8"
    );

  assert.match(
    source,
    /buildMicroW2W3TransitionFibs/
  );

  const migration =
    source.indexOf(
      "microV2Migration ="
    );

  const dual =
    source.indexOf(
      "const microW2W3TransitionFibs ="
    );

  assert.ok(migration >= 0);
  assert.ok(dual > migration);

  assert.match(
    source,
    /microW2W3TransitionFibs,/
  );
});
