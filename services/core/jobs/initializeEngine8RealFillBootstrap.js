// services/core/jobs/initializeEngine8RealFillBootstrap.js
// One-time Engine 8 REAL fill production bootstrap initializer.
//
// This job does NOT read Schwab, does NOT call Engine 10, does NOT create
// tradeId/contractId, and does NOT deliver historical fills.
//
// Required:
// ENGINE8_REAL_FILL_BOOTSTRAP_STARTED_AT=<ISO timestamp>

import {
  initializeEngine8RealFillBootstrap,
  readEngine8RealFillObserverState,
} from "../logic/trading/schwab/engine8RealFillStore.js";

const bootstrapStartedAt = String(
  process.env.ENGINE8_REAL_FILL_BOOTSTRAP_STARTED_AT || ""
).trim();

if (!bootstrapStartedAt) {
  console.error(
    "ENGINE8_REAL_FILL_BOOTSTRAP_STARTED_AT_REQUIRED"
  );
  process.exitCode = 1;
} else {
  try {
    const initialized = initializeEngine8RealFillBootstrap({
      bootstrapStartedAt,
    });

    const state = readEngine8RealFillObserverState();

    console.log(
      JSON.stringify(
        {
          ...initialized,
          engine:
            "engine8.schwabRealFillBootstrapInitializer.v1",
          brokerWrites: false,
          engine10Writes: false,
          contractIdsCreated: false,
          recordsPreserved:
            Object.keys(state.records || {}).length,
          accountWatermarksPreserved:
            Object.keys(state.accounts || {}).length,
        },
        null,
        2
      )
    );
  } catch (error) {
    console.error(
      String(error?.message || error)
    );
    process.exitCode = 1;
  }
}
