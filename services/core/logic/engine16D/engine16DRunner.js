// services/core/logic/engine16D/engine16DRunner.js

import fetch from "node-fetch";
import { maybeSendInstantTriggerAlert } from "../alerts/instantTriggerPushover.js";

const SNAPSHOT_URL = "http://127.0.0.1:10000/api/v1/dashboard-snapshot";

export async function runEngine16DBridge() {
  try {
    const res = await fetch(SNAPSHOT_URL);
    const snapshot = await res.json();

    if (!snapshot?.strategies) return;

    const strat = snapshot.strategies["intraday_scalp@10m"];
    if (!strat) return;

    const decision = strat.engine15Decision;
    const permission = strat.permission;
    const e16 = strat.engine16;

    if (!decision || !permission || !e16) return;

    // -----------------------------
    // ✅ TRADE RULE
    // -----------------------------
    if (decision.action !== "GO") return;
    if (permission.permission === "STAND_DOWN") return;

    const isExhaustion = e16.exhaustionTrigger === true;
    const isContinuation = e16.continuationTrigger === true;

    if (!isExhaustion && !isContinuation) return;

    // -----------------------------
    // ✅ CORE FIELDS
    // -----------------------------
    const direction = decision.direction;
    const signalType = decision.strategyType;

    const triggerTime =
      e16?.signalTimes?.exhaustionTriggerTime ||
      e16?.signalTimes?.continuationTriggerTime ||
      e16?.exhaustionBarTime;

    const triggerPrice =
      e16?.exhaustionBarPrice ||
      decision?.lifecycle?.currentPrice;

    if (!direction || !triggerTime) return;

    const idempotencyKey = `AUTO|SPY|intraday_scalp@10m|${direction}|${triggerTime}`;

    // -----------------------------
    // ✅ BUILD ENGINE 8 PAYLOAD
    // -----------------------------
    const payload = {
      idempotencyKey,
      symbol: "SPY",
      strategyId: "intraday_scalp@10m",
      intent: "ENTRY",
      direction,
      assetType: "OPTION",
      contracts: 3,
      paper: true,
      signalEvent: {
        signalType,
        direction,
        signalTime: triggerTime,
        signalPrice: triggerPrice,
        signalSource: "ENGINE16D"
      },
      option: {
        midPrice: 1.85 // temporary fixed for now
      },
      engine6: {
        permission: permission.permission
      }
    };

    // -----------------------------
    // 🚀 SEND TRADE TO ENGINE 8
    // -----------------------------
    const tradeRes = await fetch("http://127.0.0.1:10000/api/trading/execute", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const tradeResult = await tradeRes.json();

    if (!tradeResult?.ok) {
      console.log("[Engine16D] trade rejected:", tradeResult);
      return;
    }

    if (tradeResult?.duplicate) {
      console.log("[Engine16D] duplicate signal, skipped");
      return;
    }

    console.log("[Engine16D] TRADE EXECUTED:", tradeResult.orderId);

    // -----------------------------
    // 🔔 SEND PHONE ALERT
    // -----------------------------
    const alertKey = `SPY|${signalType}|${direction}|${triggerTime}`;

    await maybeSendInstantTriggerAlert({
      symbol: "SPY",
      signalFamily: signalType,
      direction,
      triggerTime,
      triggerPrice,
      mode: permission.permission,
      dedupeKey: alertKey,
      actionText: `ENTER ${direction}`
    });

  } catch (err) {
    console.error("[Engine16D ERROR]", err?.message || err);
  }
}
