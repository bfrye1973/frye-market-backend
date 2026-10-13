// services/core/jobs/autoManageCanonicalPaperLifecycle.js
//
// Engine 28A automatic PAPER lifecycle monitor.
//
// Ownership:
// - Engine 9 owns the frozen management plan.
// - Engine 8 owns REDUCE / EXIT execution.
// - Engine 10 owns the permanent trade lifecycle.
// - This job only detects when the frozen Engine 9 stop/targets were touched
//   and calls the existing canonical Engine 8 lifecycle route.
//
// Safety:
// - ES Strategy 1 PAPER FUTURES only
// - requires explicit lifecycle opt-in
// - rejects live/replay modes
// - never calls Schwab
// - never edits Engine 10 directly
// - ambiguous same-bar stop/target ordering fails closed for manual review

import {
  listTrades,
} from "../logic/journal/tradeJournalStore.js";

import {
  evaluateEsFuturesSession,
} from "./archiveEsReplaySnapshot.js";

const STRATEGY_ID = "intraday_scalp@10m";
const SYMBOL = "ES";
const BAR_LIMIT = 720;
const MAX_BAR_STALENESS_MS = 5 * 60 * 1000;

function nowIso() {
  return new Date().toISOString();
}

function text(value) {
  return String(value ?? "").trim();
}

function upper(value) {
  return text(value).toUpperCase();
}

function num(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? parsed
    : null;
}

function epochMs(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return null;
  }

  return n > 1e12
    ? n
    : n * 1000;
}

function isoMs(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed)
    ? parsed
    : null;
}

function fail(reason, detail = null) {
  console.log(
    JSON.stringify(
      {
        ok: false,
        status:
          "AUTO_PAPER_LIFECYCLE_ERROR",
        reason,
        detail,
        evaluatedAt: nowIso(),
      },
      null,
      2
    )
  );

  process.exit(1);
}

function skip(reason, detail = null) {
  console.log(
    JSON.stringify(
      {
        ok: true,
        skipped: true,
        status:
          "AUTO_PAPER_LIFECYCLE_SKIPPED",
        reason,
        detail,
        evaluatedAt: nowIso(),
      },
      null,
      2
    )
  );

  process.exit(0);
}

function validateEnvironment() {
  if (
    process.env
      .ENGINE8_AUTO_PAPER_LIFECYCLE_ENABLED !==
    "1"
  ) {
    skip(
      "ENGINE8_AUTO_PAPER_LIFECYCLE_DISABLED"
    );
  }

  if (
    process.env.ENGINE8_PAPER_ONLY !==
    "1"
  ) {
    fail("ENGINE8_PAPER_ONLY_NOT_SET");
  }

  if (
    process.env
      .ENGINE8_CANONICAL_EXECUTOR_ENABLED !==
    "1"
  ) {
    fail(
      "ENGINE8_CANONICAL_EXECUTOR_ENABLED_NOT_SET"
    );
  }

  if (
    process.env.ENGINE8_KILL_SWITCH ===
    "1"
  ) {
    fail("ENGINE8_KILL_SWITCH_ACTIVE");
  }

  if (
    process.env
      .ENGINE8_LIVE_TRADING_ENABLED ===
      "1" ||
    process.env
      .ENGINE8_ALLOW_LIVE_FUTURES ===
      "1"
  ) {
    fail("LIVE_EXECUTION_FLAGS_PRESENT");
  }

  if (
    process.env.REPLAY_MODE === "1" ||
    process.env.ENGINE12_REPLAY_MODE ===
      "1"
  ) {
    fail("REPLAY_EXECUTION_FORBIDDEN");
  }

  const adminSecret = text(
    process.env.ENGINE8_ADMIN_SECRET
  );

  if (!adminSecret) {
    fail(
      "ENGINE8_ADMIN_SECRET_NOT_CONFIGURED"
    );
  }

  return {
    adminSecret,
  };
}

function coreBaseUrl() {
  const port =
    Number(process.env.PORT) ||
    10000;

  return String(
    process.env.CORE_BASE_URL ||
      process.env.CORE_BASE ||
      `http://127.0.0.1:${port}`
  ).replace(/\/+$/, "");
}

async function readMinuteBars() {
  const url =
    `${coreBaseUrl()}/api/v1/futures/ohlc` +
    `?symbol=${SYMBOL}` +
    `&timeframe=1m` +
    `&limit=${BAR_LIMIT}`;

  const controller =
    new AbortController();

  const timeout =
    setTimeout(
      () => controller.abort(),
      15000
    );

  let response;
  let raw = "";

  try {
    response = await fetch(url, {
      method: "GET",
      headers: {
        accept: "application/json",
        "Cache-Control": "no-store",
      },
      signal: controller.signal,
    });

    raw = await response.text();
  } catch (error) {
    clearTimeout(timeout);

    fail(
      "ES_1M_OHLC_REQUEST_FAILED",
      String(
        error?.message ||
        error
      )
    );
  } finally {
    clearTimeout(timeout);
  }

  if (!response?.ok) {
    fail(
      "ES_1M_OHLC_REQUEST_REJECTED",
      {
        httpStatus:
          response?.status ?? null,
        raw: raw.slice(0, 1000),
      }
    );
  }

  let parsed;

  try {
    parsed = JSON.parse(raw);
  } catch {
    fail(
      "ES_1M_OHLC_RESPONSE_UNREADABLE",
      raw.slice(0, 1000)
    );
  }

  const bars =
    Array.isArray(parsed)
      ? parsed
      : Array.isArray(parsed?.bars)
      ? parsed.bars
      : [];

  const normalized =
    bars
      .map((bar) => {
        const timeMs =
          epochMs(
            bar?.time ??
            bar?.t
          );

        const open =
          num(bar?.open ?? bar?.o);

        const high =
          num(bar?.high ?? bar?.h);

        const low =
          num(bar?.low ?? bar?.l);

        const close =
          num(bar?.close ?? bar?.c);

        if (
          timeMs === null ||
          open === null ||
          high === null ||
          low === null ||
          close === null
        ) {
          return null;
        }

        return {
          timeMs,
          open,
          high,
          low,
          close,
        };
      })
      .filter(Boolean)
      .sort(
        (a, b) =>
          a.timeMs - b.timeMs
      );

  if (normalized.length === 0) {
    fail("ES_1M_OHLC_EMPTY");
  }

  const latest =
    normalized[
      normalized.length - 1
    ];

  const latestAge =
    Date.now() -
    latest.timeMs;

  if (
    latestAge >
    MAX_BAR_STALENESS_MS
  ) {
    fail(
      "ES_1M_OHLC_STALE",
      {
        latestBarTime:
          new Date(
            latest.timeMs
          ).toISOString(),
        latestAgeMs:
          latestAge,
      }
    );
  }

  return normalized;
}

function canonicalTradeIdentity(
  trade
) {
  const identity =
    trade?.identity || {};

  return {
    tradeId:
      trade?.tradeId ??
      identity?.tradeId ??
      null,

    planId:
      identity?.planId ??
      trade?.openingPlan
        ?.planId ??
      null,

    candidateId:
      identity?.candidateId ??
      null,

    zoneId:
      identity?.zoneId ??
      null,

    strategyId:
      trade?.strategyId ??
      identity?.strategyId ??
      null,

    symbol:
      trade?.symbol ??
      identity?.symbol ??
      null,

    direction:
      trade?.direction ??
      identity?.direction ??
      null,

    setupType:
      trade?.setupType ??
      identity?.setupType ??
      null,
  };
}

function eligibleTrade(trade) {
  const identity =
    canonicalTradeIdentity(
      trade
    );

  const plan =
    trade?.openingPlan || {};

  const blocks =
    plan?.threeBlockManagement
      ?.blocks;

  const reasons = [];

  if (
    upper(trade?.status) !==
    "OPEN"
  ) {
    reasons.push("TRADE_NOT_OPEN");
  }

  if (
    upper(trade?.accountMode) !==
    "PAPER"
  ) {
    reasons.push(
      "ACCOUNT_MODE_NOT_PAPER"
    );
  }

  if (
    upper(trade?.assetType) !==
    "FUTURES"
  ) {
    reasons.push(
      "ASSET_TYPE_NOT_FUTURES"
    );
  }

  if (
    upper(identity.symbol) !==
    SYMBOL
  ) {
    reasons.push("SYMBOL_NOT_ES");
  }

  if (
    identity.strategyId !==
    STRATEGY_ID
  ) {
    reasons.push(
      "STRATEGY_ID_MISMATCH"
    );
  }

  if (
    !["LONG", "SHORT"].includes(
      upper(identity.direction)
    )
  ) {
    reasons.push(
      "DIRECTION_INVALID"
    );
  }

  if (!text(identity.tradeId)) {
    reasons.push("TRADE_ID_MISSING");
  }

  if (!text(identity.planId)) {
    reasons.push("PLAN_ID_MISSING");
  }

  if (
    upper(
      plan?.engine9PlanStatus
    ) !==
    "OFFICIAL_PLAN_READY"
  ) {
    reasons.push(
      "ENGINE9_PLAN_NOT_OFFICIAL"
    );
  }

  if (
    plan?.threeBlockManagement
      ?.enabled !== true
  ) {
    reasons.push(
      "THREE_BLOCK_MANAGEMENT_DISABLED"
    );
  }

  if (
    !Array.isArray(blocks) ||
    blocks.length !== 3
  ) {
    reasons.push(
      "THREE_BLOCK_PLAN_INVALID"
    );
  }

  if (
    num(
      trade?.qty?.remainingQty
    ) === null ||
    num(
      trade?.qty?.remainingQty
    ) <= 0
  ) {
    reasons.push(
      "REMAINING_QTY_INVALID"
    );
  }

  const stop =
    num(
      plan?.officialStopPrice
    );

  if (
    stop === null ||
    stop <= 0
  ) {
    reasons.push(
      "OFFICIAL_STOP_INVALID"
    );
  }

  return {
    ok:
      reasons.length === 0,
    reasons,
    identity,
    plan,
  };
}

function exitedBlockIds(trade) {
  const ids = new Set();

  for (
    const event of
    Array.isArray(trade?.events)
      ? trade.events
      : []
  ) {
    const blockId =
      text(event?.blockId);

    const fillQuantity =
      num(
        event?.fillQuantity ??
        event?.qtyClosed
      );

    if (
      blockId &&
      fillQuantity !== null &&
      fillQuantity > 0
    ) {
      ids.add(blockId);
    }
  }

  return ids;
}

function breakevenArmed(trade) {
  return (
    Array.isArray(trade?.events) &&
    trade.events.some(
      (event) =>
        upper(
          event?.managementAction
        ) ===
          "MOVE_STOP_TO_BREAKEVEN" ||
        (
          text(event?.blockId) ===
            "BLOCK_1" &&
          num(
            event?.fillQuantity ??
            event?.qtyClosed
          ) > 0
        )
    )
  );
}

function latestTradeEventMs(trade) {
  const values = [
    isoMs(
      trade?.entry?.time
    ),
    ...(
      Array.isArray(trade?.events)
        ? trade.events.map(
            (event) =>
              isoMs(event?.ts)
          )
        : []
    ),
  ].filter(
    (value) =>
      value !== null
  );

  if (values.length === 0) {
    return null;
  }

  return Math.max(...values);
}

function nextFullMinuteMs(ms) {
  return (
    Math.floor(
      ms / 60000
    ) *
      60000 +
    60000
  );
}

function stopTouched({
  direction,
  stop,
  bar,
}) {
  return direction === "LONG"
    ? bar.low <= stop
    : bar.high >= stop;
}

function targetTouched({
  direction,
  target,
  bar,
}) {
  return direction === "LONG"
    ? bar.high >= target
    : bar.low <= target;
}

function stopGapAtOpen({
  direction,
  stop,
  bar,
}) {
  return direction === "LONG"
    ? bar.open <= stop
    : bar.open >= stop;
}

function targetGapAtOpen({
  direction,
  target,
  bar,
}) {
  return direction === "LONG"
    ? bar.open >= target
    : bar.open <= target;
}

function normalizeBlocks(plan) {
  return (
    plan?.threeBlockManagement
      ?.blocks || []
  )
    .map((block, index) => ({
      blockId:
        text(block?.blockId) ||
        `BLOCK_${index + 1}`,

      targetId:
        text(block?.targetId) ||
        text(
          block?.exitAtTargetId
        ) ||
        `T${index + 1}`,

      contracts:
        Math.max(
          0,
          Math.floor(
            num(
              block?.contracts
            ) || 0
          )
        ),

      targetPrice:
        num(
          block?.targetPrice
        ),

      afterExitAction:
        upper(
          block?.afterExitAction
        ) || null,
    }))
    .filter(
      (block) =>
        block.contracts > 0 &&
        block.targetPrice !== null &&
        block.targetPrice > 0
    );
}

async function postLifecycle({
  adminSecret,
  body,
}) {
  const url =
    `${coreBaseUrl()}/api/trading/paper/execute-lifecycle`;

  const controller =
    new AbortController();

  const timeout =
    setTimeout(
      () => controller.abort(),
      15000
    );

  let response;
  let raw = "";

  try {
    response = await fetch(url, {
      method: "POST",
      headers: {
        accept:
          "application/json",
        "content-type":
          "application/json",
        "x-engine8-admin-secret":
          adminSecret,
      },
      body:
        JSON.stringify(body),
      signal:
        controller.signal,
    });

    raw =
      await response.text();
  } catch (error) {
    clearTimeout(timeout);

    return {
      ok: false,
      error:
        "LIFECYCLE_ROUTE_REQUEST_FAILED",
      detail:
        String(
          error?.message ||
          error
        ),
    };
  } finally {
    clearTimeout(timeout);
  }

  let payload = null;

  try {
    payload =
      raw
        ? JSON.parse(raw)
        : null;
  } catch {
    payload = null;
  }

  if (
    !response?.ok ||
    payload?.ok !== true
  ) {
    return {
      ok: false,
      error:
        "LIFECYCLE_ROUTE_REJECTED",
      httpStatus:
        response?.status ??
        null,
      payload,
      raw:
        payload
          ? null
          : raw.slice(0, 1500),
    };
  }

  return {
    ok: true,
    payload,
  };
}

async function manageTrade({
  trade,
  bars,
  adminSecret,
}) {
  const eligibility =
    eligibleTrade(trade);

  if (!eligibility.ok) {
    return {
      tradeId:
        trade?.tradeId ??
        null,
      status:
        "SKIPPED_INELIGIBLE_TRADE",
      reasons:
        eligibility.reasons,
      actions: [],
    };
  }

  const {
    identity,
    plan,
  } = eligibility;

  const direction =
    upper(identity.direction);

  const entryPrice =
    num(trade?.entry?.price);

  let effectiveStop =
    breakevenArmed(trade)
      ? entryPrice
      : num(
          plan
            ?.officialStopPrice
        );

  if (
    entryPrice === null ||
    effectiveStop === null
  ) {
    return {
      tradeId:
        identity.tradeId,
      status:
        "SKIPPED_INVALID_ENTRY_OR_STOP",
      reasons: [
        "ENTRY_OR_STOP_MISSING",
      ],
      actions: [],
    };
  }

  const blocks =
    normalizeBlocks(plan);

  if (blocks.length !== 3) {
    return {
      tradeId:
        identity.tradeId,
      status:
        "SKIPPED_INVALID_THREE_BLOCK_PLAN",
      reasons: [
        "NORMALIZED_BLOCK_COUNT_NOT_THREE",
      ],
      actions: [],
    };
  }

  const exited =
    exitedBlockIds(trade);

  let remaining =
    Math.floor(
      num(
        trade?.qty
          ?.remainingQty
      ) || 0
    );

  let lastEventMs =
    latestTradeEventMs(
      trade
    );

  if (lastEventMs === null) {
    return {
      tradeId:
        identity.tradeId,
      status:
        "SKIPPED_MISSING_EVENT_TIME",
      reasons: [
        "ENTRY_OR_EVENT_TIME_MISSING",
      ],
      actions: [],
    };
  }

  const startMs =
    nextFullMinuteMs(
      lastEventMs
    );

  const eligibleBars =
    bars.filter(
      (bar) =>
        bar.timeMs >=
        startMs
    );

  if (
    eligibleBars.length === 0
  ) {
    return {
      tradeId:
        identity.tradeId,
      status:
        "NO_NEW_COMPLETE_BAR_EVIDENCE",
      reasons: [],
      actions: [],
    };
  }

  const earliestBarMs =
    bars[0]?.timeMs ??
    null;

  if (
    earliestBarMs !== null &&
    startMs <
      earliestBarMs
  ) {
    return {
      tradeId:
        identity.tradeId,
      status:
        "INSUFFICIENT_1M_BAR_COVERAGE",
      reasons: [
        "MANAGEMENT_WINDOW_PRECEDES_AVAILABLE_BARS",
      ],
      actions: [],
    };
  }

  const actions = [];

  for (
    const bar of
    eligibleBars
  ) {
    if (remaining <= 0) {
      break;
    }

    const pendingBlocks =
      blocks.filter(
        (block) =>
          !exited.has(
            block.blockId
          )
      );

    const touchedBlocks =
      pendingBlocks.filter(
        (block) =>
          targetTouched({
            direction,
            target:
              block.targetPrice,
            bar,
          })
      );

    const stopHit =
      stopTouched({
        direction,
        stop:
          effectiveStop,
        bar,
      });

    const stopAtOpen =
      stopGapAtOpen({
        direction,
        stop:
          effectiveStop,
        bar,
      });

    const targetsAtOpen =
      touchedBlocks.filter(
        (block) =>
          targetGapAtOpen({
            direction,
            target:
              block.targetPrice,
            bar,
          })
      );

    if (
      stopHit &&
      touchedBlocks.length > 0 &&
      !stopAtOpen &&
      targetsAtOpen.length === 0
    ) {
      return {
        tradeId:
          identity.tradeId,
        status:
          "AMBIGUOUS_STOP_TARGET_SAME_1M_BAR",
        reasons: [
          "INTRABAR_ORDER_UNKNOWN",
        ],
        ambiguousBar: {
          time:
            new Date(
              bar.timeMs
            ).toISOString(),
          open: bar.open,
          high: bar.high,
          low: bar.low,
          close: bar.close,
          effectiveStop,
          touchedTargets:
            touchedBlocks.map(
              (block) => ({
                blockId:
                  block.blockId,
                targetId:
                  block.targetId,
                targetPrice:
                  block.targetPrice,
              })
            ),
        },
        actions,
      };
    }

    if (stopAtOpen) {
      const result =
        await postLifecycle({
          adminSecret,
          body: {
            action: "EXIT",
            lifecycleEventId:
              breakevenArmed(
                trade
              ) ||
              effectiveStop ===
                entryPrice
                ? "AUTO_BREAKEVEN_STOP_EXIT"
                : "AUTO_INITIAL_STOP_EXIT",
            ...identity,
            fillQuantity:
              remaining,
            fillPrice:
              bar.open,
            remainingQuantity:
              0,
            managementAction:
              "CLOSE_REMAINDER",
            exitReason:
              "STOP_EXIT",
            stopReason:
              effectiveStop ===
              entryPrice
                ? "BREAKEVEN_STOP"
                : "PROTECTIVE_STOP",
          },
        });

      actions.push({
        type:
          "STOP_EXIT",
        barTime:
          new Date(
            bar.timeMs
          ).toISOString(),
        fillPrice:
          bar.open,
        quantity:
          remaining,
        result,
      });

      if (!result.ok) {
        return {
          tradeId:
            identity.tradeId,
          status:
            "LIFECYCLE_EXECUTION_ERROR",
          reasons: [
            result.error,
          ],
          actions,
        };
      }

      remaining = 0;
      break;
    }

    if (
      touchedBlocks.length > 0
    ) {
      const ordered =
        pendingBlocks.filter(
          (block) =>
            touchedBlocks.some(
              (hit) =>
                hit.blockId ===
                block.blockId
            )
        );

      for (
        const block of
        ordered
      ) {
        if (
          remaining <= 0 ||
          exited.has(
            block.blockId
          )
        ) {
          continue;
        }

        const quantity =
          Math.min(
            block.contracts,
            remaining
          );

        const remainingAfter =
          Math.max(
            0,
            remaining -
            quantity
          );

        const action =
          remainingAfter === 0 ||
          block.afterExitAction ===
            "CLOSE_REMAINDER"
            ? "EXIT"
            : "REDUCE";

        const result =
          await postLifecycle({
            adminSecret,
            body: {
              action,
              lifecycleEventId:
                `AUTO_${block.blockId}_TARGET_EXIT`,
              ...identity,
              fillQuantity:
                quantity,
              fillPrice:
                block.targetPrice,
              remainingQuantity:
                remainingAfter,
              targetId:
                block.targetId,
              blockId:
                block.blockId,
              managementAction:
                block
                  .afterExitAction,
              exitReason:
                "TARGET_EXIT",
              stopReason:
                null,
            },
          });

        actions.push({
          type:
            "TARGET_EXIT",
          barTime:
            new Date(
              bar.timeMs
            ).toISOString(),
          blockId:
            block.blockId,
          targetId:
            block.targetId,
          fillPrice:
            block.targetPrice,
          quantity,
          action,
          result,
        });

        if (!result.ok) {
          return {
            tradeId:
              identity.tradeId,
            status:
              "LIFECYCLE_EXECUTION_ERROR",
            reasons: [
              result.error,
            ],
            actions,
          };
        }

        exited.add(
          block.blockId
        );

        remaining =
          num(
            result?.payload
              ?.journalRemainingQty ??
            result?.payload
              ?.remainingQty
          ) ??
          remainingAfter;

        if (
          block.afterExitAction ===
          "MOVE_STOP_TO_BREAKEVEN"
        ) {
          effectiveStop =
            entryPrice;
        }

        if (remaining <= 0) {
          break;
        }
      }

      // If targets were already satisfied at the bar open,
      // they are known to precede a later intrabar stop.
      if (
        remaining > 0 &&
        targetsAtOpen.length > 0 &&
        stopTouched({
          direction,
          stop:
            effectiveStop,
          bar,
        })
      ) {
        const result =
          await postLifecycle({
            adminSecret,
            body: {
              action: "EXIT",
              lifecycleEventId:
                effectiveStop ===
                entryPrice
                  ? "AUTO_BREAKEVEN_STOP_EXIT"
                  : "AUTO_INITIAL_STOP_EXIT",
              ...identity,
              fillQuantity:
                remaining,
              fillPrice:
                effectiveStop,
              remainingQuantity:
                0,
              managementAction:
                "CLOSE_REMAINDER",
              exitReason:
                "STOP_EXIT",
              stopReason:
                effectiveStop ===
                entryPrice
                  ? "BREAKEVEN_STOP"
                  : "PROTECTIVE_STOP",
            },
          });

        actions.push({
          type:
            "STOP_EXIT_AFTER_OPEN_TARGET",
          barTime:
            new Date(
              bar.timeMs
            ).toISOString(),
          fillPrice:
            effectiveStop,
          quantity:
            remaining,
          result,
        });

        if (!result.ok) {
          return {
            tradeId:
              identity.tradeId,
            status:
              "LIFECYCLE_EXECUTION_ERROR",
            reasons: [
              result.error,
            ],
            actions,
          };
        }

        remaining = 0;
        break;
      }

      continue;
    }

    if (stopHit) {
      const fillPrice =
        effectiveStop;

      const result =
        await postLifecycle({
          adminSecret,
          body: {
            action: "EXIT",
            lifecycleEventId:
              effectiveStop ===
              entryPrice
                ? "AUTO_BREAKEVEN_STOP_EXIT"
                : "AUTO_INITIAL_STOP_EXIT",
            ...identity,
            fillQuantity:
              remaining,
            fillPrice,
            remainingQuantity:
              0,
            managementAction:
              "CLOSE_REMAINDER",
            exitReason:
              "STOP_EXIT",
            stopReason:
              effectiveStop ===
              entryPrice
                ? "BREAKEVEN_STOP"
                : "PROTECTIVE_STOP",
          },
        });

      actions.push({
        type:
          "STOP_EXIT",
        barTime:
          new Date(
            bar.timeMs
          ).toISOString(),
        fillPrice,
        quantity:
          remaining,
        result,
      });

      if (!result.ok) {
        return {
          tradeId:
            identity.tradeId,
        status:
            "LIFECYCLE_EXECUTION_ERROR",
          reasons: [
            result.error,
          ],
          actions,
        };
      }

      remaining = 0;
      break;
    }
  }

  return {
    tradeId:
      identity.tradeId,
    status:
      actions.length > 0
        ? "LIFECYCLE_ACTIONS_EXECUTED"
        : "NO_MANAGEMENT_LEVEL_TOUCHED",
    reasons: [],
    remainingQty:
      remaining,
    effectiveStop,
    actions,
  };
}

const {
  adminSecret,
} = validateEnvironment();

const session =
  evaluateEsFuturesSession(
    new Date()
  );

if (
  session?.sessionState !==
  "OPEN"
) {
  skip(
    "ES_FUTURES_SESSION_NOT_OPEN",
    {
      sessionState:
        session?.sessionState ??
        null,
      exchangeTimezone:
        session?.exchangeTimezone ??
        null,
      exchangeDate:
        session?.exchangeDate ??
        null,
      exchangeTime:
        session?.exchangeTime ??
        null,
      arizonaDate:
        session?.arizonaDate ??
        null,
      arizonaTime:
        session?.arizonaTime ??
        null,
    }
  );
}

const tradesResult =
  await listTrades({
    symbol: SYMBOL,
    strategyId: STRATEGY_ID,
    status: "OPEN",
    accountMode: "PAPER",
  });

if (
  tradesResult?.ok !== true
) {
  fail(
    "ENGINE10_OPEN_TRADES_READ_FAILED",
    tradesResult
  );
}

const openTrades =
  Array.isArray(
    tradesResult?.trades
  )
    ? tradesResult.trades
    : [];

if (openTrades.length === 0) {
  skip(
    "NO_OPEN_STRATEGY1_PAPER_TRADES"
  );
}

const bars =
  await readMinuteBars();

const results = [];

for (const trade of openTrades) {
  results.push(
    await manageTrade({
      trade,
      bars,
      adminSecret,
    })
  );
}

const hasError =
  results.some(
    (result) =>
      [
        "LIFECYCLE_EXECUTION_ERROR",
        "AMBIGUOUS_STOP_TARGET_SAME_1M_BAR",
        "INSUFFICIENT_1M_BAR_COVERAGE",
      ].includes(
        result?.status
      )
  );

console.log(
  JSON.stringify(
    {
      ok: !hasError,
      status:
        hasError
          ? "AUTO_PAPER_LIFECYCLE_ATTENTION_REQUIRED"
          : "AUTO_PAPER_LIFECYCLE_OK",
      openTradeCount:
        openTrades.length,
      results,
      safety: {
        paperOnly: true,
        liveExecutionAllowed:
          false,
        noSchwabCall: true,
      },
      evaluatedAt: nowIso(),
    },
    null,
    2
  )
);

process.exit(
  hasError
    ? 1
    : 0
);
