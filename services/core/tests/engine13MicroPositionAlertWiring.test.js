import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

test("Engine13 Micro position alert runs after ES snapshot and cannot block canonical engine success", () => {
  const file =
    fileURLToPath(
      new URL(
        "../routes/runAllEngines.js",
        import.meta.url
      )
    );

  const source =
    fs.readFileSync(file, "utf8");

  const snapshotStep =
    source.indexOf(
      'name: "build_es_strategy_snapshot"'
    );

  const alertStep =
    source.indexOf(
      'name: "engine13_micro_position_alert"'
    );

  const doctorStep =
    source.indexOf(
      'name: "engine28a_pipeline_doctor"'
    );

  assert.ok(snapshotStep >= 0);
  assert.ok(alertStep > snapshotStep);
  assert.ok(doctorStep > alertStep);

  const okBlockStart =
    source.indexOf(
      "const ok ="
    );

  const codeBlockStart =
    source.indexOf(
      "const code =",
      okBlockStart
    );

  const okBlock =
    source.slice(
      okBlockStart,
      codeBlockStart
    );

  assert.doesNotMatch(
    okBlock,
    /step3alert\.code/
  );

  assert.match(
    source,
    /nonAuthoritative:\s*true/
  );
});

test("alerts route exposes dedicated Micro position check endpoint", () => {
  const file =
    fileURLToPath(
      new URL(
        "../routes/alerts.js",
        import.meta.url
      )
    );

  const source =
    fs.readFileSync(file, "utf8");

  assert.match(
    source,
    /check-micro-position/
  );

  assert.match(
    source,
    /runMicroPositionAlertsFromSnapshot/
  );
});
