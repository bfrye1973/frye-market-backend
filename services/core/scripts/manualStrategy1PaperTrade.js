/**
 * Engine 28A Manual Strategy 1 PAPER Trade
 *
 * Deliberately bypasses live Engine 3 / 4 / 6 / 27 / 7 / 9 authorization
 * for a manager-requested MANUAL PAPER TEST only.
 *
 * ES FUTURES only, PAPER only, 3 contracts total, 1 + 1 + 1 blocks.
 * Uses Engine 26A current location / negotiated-zone inventory as geometry facts,
 * then sends one 3-contract ticket through Engine 8 paper execution and Engine 10 journal sync.
 *
 * Preview:
 *   node services/core/scripts/manualStrategy1PaperTrade.js SHORT
 *   node services/core/scripts/manualStrategy1PaperTrade.js LONG
 *
 * Execute PAPER trade:
 *   node services/core/scripts/manualStrategy1PaperTrade.js SHORT --confirm
 *   node services/core/scripts/manualStrategy1PaperTrade.js LONG --confirm
 *
 * Optional:
 *   --entry=current      default; uses engine26LocationCandidate.currentPrice
 *   --entry=midpoint     uses active negotiated-zone midpoint
 *   --entry-price=7691.25
 *   --stop=7705.75
 *   --t1=7658.75
 *   --t2=7647.25
 *   --t3=7647.25
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const TICK = 0.25;
const STRATEGY_ID = "intraday_scalp@10m";
const SYMBOL = "ES";
const CONTRACTS = 3;

function fail(message, details = null) {
  console.error(`\nMANUAL PAPER TEST REFUSED: ${message}`);
  if (details) {
    console.error(typeof details === "string" ? details : JSON.stringify(details, null, 2));
  }
  process.exit(1);
}

function safeUpper(value) {
  return String(value ?? "").trim().toUpperCase();
}

function toNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function roundToTick(value) {
  if (!Number.isFinite(value)) return null;
  return Math.round(value / TICK) * TICK;
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const direction = safeUpper(args[0]);
  const out = {
    direction,
    confirm: args.includes("--confirm"),
    entryMode: "current",
    entryPrice: null,
    stop: null,
    t1: null,
    t2: null,
    t3: null,
  };

  for (const arg of args.slice(1)) {
    if (arg.startsWith("--entry=")) out.entryMode = String(arg.split("=")[1] || "").trim().toLowerCase();
    else if (arg.startsWith("--entry-price=")) out.entryPrice = toNumber(arg.split("=")[1]);
    else if (arg.startsWith("--stop=")) out.stop = toNumber(arg.split("=")[1]);
    else if (arg.startsWith("--t1=")) out.t1 = toNumber(arg.split("=")[1]);
    else if (arg.startsWith("--t2=")) out.t2 = toNumber(arg.split("=")[1]);
    else if (arg.startsWith("--t3=")) out.t3 = toNumber(arg.split("=")[1]);
  }

  return out;
}

function normalizeZone(zone) {
  if (!zone || typeof zone !== "object") return null;
  const low = toNumber(zone.low ?? zone.lo);
  const high = toNumber(zone.high ?? zone.hi);
  const midline = toNumber(zone.midline ?? zone.mid) ?? (low != null && high != null ? roundToTick((low + high) / 2) : null);
  if (low == null || high == null || midline == null || high <= low) return null;
  return { ...zone, low, high, midline, zoneId: zone.zoneId ?? zone.id ?? null };
}

function pickTargetZone({ direction, entryZone, inventory }) {
  const zones = inventory.map(normalizeZone).filter(Boolean);
  if (direction === "SHORT") {
    return zones.filter((z) => z.high < entryZone.low).sort((a, b) => b.high - a.high)[0] ?? null;
  }
  return zones.filter((z) => z.low > entryZone.high).sort((a, b) => a.low - b.low)[0] ?? null;
}

function buildGeometry({ direction, location, explicitEntry, entryMode, explicitStop, explicitT1, explicitT2, explicitT3 }) {
  const entryZone = normalizeZone(location?.entryZone);
  if (!entryZone) fail("Engine 26A active entryZone is missing or invalid.");

  const currentPrice = toNumber(location?.currentPrice);
  const inventory = Array.isArray(location?.approvedNegotiatedZoneInventory) ? location.approvedNegotiatedZoneInventory : [];
  if (inventory.length === 0) fail("approvedNegotiatedZoneInventory is empty.");

  const targetZone = pickTargetZone({ direction, entryZone, inventory });
  if (!targetZone && (explicitT1 == null || explicitT2 == null)) {
    fail(`No approved negotiated target zone exists ${direction === "SHORT" ? "below" : "above"} the active entry zone.`);
  }

  let entryPrice = explicitEntry;
  if (entryPrice == null) {
    if (entryMode === "midpoint") entryPrice = entryZone.midline;
    else if (entryMode === "current") entryPrice = currentPrice;
    else fail(`Unknown --entry mode "${entryMode}". Use current or midpoint.`);
  }
  if (entryPrice == null || entryPrice <= 0) fail("No valid manual PAPER entry price is available.");
  entryPrice = roundToTick(entryPrice);

  let stop = explicitStop ?? (direction === "SHORT" ? roundToTick(entryZone.high + TICK) : roundToTick(entryZone.low - TICK));
  let t1 = explicitT1 ?? (targetZone ? (direction === "SHORT" ? targetZone.high : targetZone.low) : null);
  let t2 = explicitT2 ?? targetZone?.midline ?? null;
  let t3 = explicitT3 ?? t2;

  stop = roundToTick(stop);
  t1 = roundToTick(t1);
  t2 = roundToTick(t2);
  t3 = roundToTick(t3);

  const stopValid = direction === "SHORT" ? stop > entryPrice : stop < entryPrice;
  const targets = [t1, t2, t3];
  const targetsValid = targets.every((price) => direction === "SHORT" ? price < entryPrice : price > entryPrice);

  if (!stopValid) fail("Stop is not directionally valid for the manual entry.", { direction, entryPrice, stop });
  if (!targetsValid) {
    fail("One or more targets are not directionally valid from the manual entry. Use explicit --t1/--t2/--t3 overrides or wait for valid geometry.", { direction, entryPrice, targets });
  }

  return {
    direction,
    currentPrice,
    entryPrice,
    stop,
    t1,
    t2,
    t3,
    entryZone,
    targetZone,
    riskPoints: Math.abs(entryPrice - stop),
    rewardT1: Math.abs(t1 - entryPrice),
    rewardT2: Math.abs(t2 - entryPrice),
  };
}

const args = parseArgs(process.argv);
if (!["LONG", "SHORT"].includes(args.direction)) fail("Direction must be LONG or SHORT.");

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CORE_DIR = path.resolve(__dirname, "..");
const SNAPSHOT_FILE = path.resolve(CORE_DIR, "data", "strategy-snapshot-es.json");

if (!fs.existsSync(SNAPSHOT_FILE)) fail(`Canonical ES snapshot not found: ${SNAPSHOT_FILE}`);

let snapshot;
try {
  snapshot = JSON.parse(fs.readFileSync(SNAPSHOT_FILE, "utf8"));
} catch (error) {
  fail("Could not parse strategy-snapshot-es.json.", error?.message);
}

const strategy = snapshot?.strategies?.[STRATEGY_ID];
if (!strategy) fail(`Missing strategy ${STRATEGY_ID} in canonical snapshot.`);

const location = strategy?.engine26LocationCandidate;
if (!location || typeof location !== "object") fail("Missing engine26LocationCandidate.");

const geometry = buildGeometry({
  direction: args.direction,
  location,
  explicitEntry: args.entryPrice,
  entryMode: args.entryMode,
  explicitStop: args.stop,
  explicitT1: args.t1,
  explicitT2: args.t2,
  explicitT3: args.t3,
});

const stamp = Date.now();
const candidateId = location?.candidateId ?? null;
const zoneId = location?.zoneId ?? geometry.entryZone?.zoneId ?? null;

const blocks = [
  { blockId: "BLOCK_1", contractId: "CONTRACT_1", contracts: 1, targetId: "T1", targetPrice: geometry.t1, purpose: "TARGET_1_ZONE_TOUCH", afterExitAction: "MOVE_STOP_TO_BREAKEVEN" },
  { blockId: "BLOCK_2", contractId: "CONTRACT_2", contracts: 1, targetId: "T2", targetPrice: geometry.t2, purpose: "TARGET_2_ZONE_MIDLINE", afterExitAction: "HOLD_FINAL_CONTRACT_TO_MIDLINE" },
  { blockId: "BLOCK_3", contractId: "CONTRACT_3", contracts: 1, targetId: "T3", targetPrice: geometry.t3, purpose: "TARGET_3_ZONE_MIDLINE_TESTING", afterExitAction: "CLOSE_REMAINDER" },
];

const targets = [
  { targetId: "T1", price: geometry.t1, contracts: 1 },
  { targetId: "T2", price: geometry.t2, contracts: 1 },
  { targetId: "T3", price: geometry.t3, contracts: 1 },
];

const ticket = {
  idempotencyKey: `MANUAL_PAPER_TEST_ES_${args.direction}_${stamp}`,
  symbol: SYMBOL,
  strategyId: STRATEGY_ID,
  timeframe: "10m",
  assetType: "FUTURES",
  intent: "ENTRY",
  direction: args.direction,
  contracts: CONTRACTS,
  qty: CONTRACTS,
  paper: true,
  orderType: "MARKET",
  timeInForce: "DAY",
  entry: {
    price: geometry.entryPrice,
    intendedMidpoint: geometry.entryPrice,
    source: args.entryPrice != null ? "MANUAL_EXPLICIT_ENTRY" : args.entryMode === "midpoint" ? "ENGINE26A_ENTRY_ZONE_MIDPOINT" : "ENGINE26A_CURRENT_PRICE",
  },
  stop: {
    price: geometry.stop,
    source: args.stop != null ? "MANUAL_EXPLICIT_STOP" : "ENGINE26A_ENTRY_ZONE_ONE_TICK_INVALIDATION",
  },
  takeProfit: { price: geometry.t1 },
  targets,
  blocks,
  engine6: {
    permission: "MANUAL_PAPER_BYPASS",
    direction: args.direction,
    allowed: false,
    locked: false,
    bypassedForManualPaperTest: true,
  },
  engine7: {
    manualPaperTest: true,
    finalContracts: CONTRACTS,
    allocation: { block1Contracts: 1, block2Contracts: 1, block3Contracts: 1, totalContracts: CONTRACTS },
  },
  signalEvent: {
    source: "ENGINE28A_MANUAL_PAPER_TEST",
    direction: args.direction,
    signalPrice: geometry.entryPrice,
    candidateId,
    zoneId,
  },
  sourceSignal: "ENGINE28A_MANUAL_PAPER_TEST",
  metadata: {
    manualPaperTest: true,
    forcedPipelineTest: true,
    bypassedLiveDecisionEngines: ["ENGINE3", "ENGINE4", "ENGINE6", "ENGINE27", "ENGINE7A", "ENGINE9", "ENGINE7B"],
    geometrySource: "ENGINE26A_LOCATION_FACTS",
    candidateId,
    zoneId,
    entryZoneId: geometry.entryZone?.zoneId ?? null,
    targetZoneId: geometry.targetZone?.zoneId ?? null,
    paperOnly: true,
    realExecutionAllowed: false,
    brokerExecutionAllowed: false,
    schwabExecutionAllowed: false,
    liveTradingAllowed: false,
    noSchwabCall: true,
  },
};

console.log("\n==============================================");
console.log("ENGINE 28A — MANUAL ES PAPER TRADE");
console.log("==============================================");
console.log(`Mode:        ${args.confirm ? "EXECUTE PAPER" : "PREVIEW ONLY"}`);
console.log(`Direction:   ${args.direction}`);
console.log("Asset:       ES FUTURES");
console.log("Contracts:   3 (1 + 1 + 1)");
console.log(`Current ES:  ${geometry.currentPrice ?? "N/A"}`);
console.log(`Entry:       ${geometry.entryPrice}`);
console.log(`Stop:        ${geometry.stop}`);
console.log(`T1:          ${geometry.t1}`);
console.log(`T2:          ${geometry.t2}`);
console.log(`T3:          ${geometry.t3}`);
console.log(`Risk:        ${geometry.riskPoints.toFixed(2)} pts`);
console.log(`Reward T1:   ${geometry.rewardT1.toFixed(2)} pts`);
console.log(`Reward T2:   ${geometry.rewardT2.toFixed(2)} pts`);
console.log(`Candidate:   ${candidateId ?? "N/A"}`);
console.log(`Zone:        ${zoneId ?? "N/A"}`);
console.log("----------------------------------------------");
console.log("SAFETY: PAPER ONLY / NO SCHWAB / NO BROKER");
console.log("==============================================\n");

if (!args.confirm) {
  console.log("PREVIEW COMPLETE — no order was created.");
  console.log(`To execute this PAPER test:\nnode services/core/scripts/manualStrategy1PaperTrade.js ${args.direction} --confirm`);
  process.exit(0);
}

process.env.ENGINE8_PAPER_ONLY = "1";

const { executeTradeTicket, getTradingStatus } = await import("../logic/trading/engine8Paper.js");

const tradingStatus = await getTradingStatus();
if (tradingStatus?.paperOnly !== true) fail("Engine 8 did not report paperOnly=true. Refusing manual test.", tradingStatus);
if (tradingStatus?.killSwitch === true) fail("Engine 8 kill switch is active. Refusing manual test.", tradingStatus);
if (!Array.isArray(tradingStatus?.allowlist) || !tradingStatus.allowlist.includes(SYMBOL)) fail("ES is not in the Engine 8 paper allowlist.", tradingStatus);

const result = await executeTradeTicket(ticket);

console.log("\nENGINE 8 PAPER RESULT");
console.log(JSON.stringify(result, null, 2));

if (result?.ok !== true || result?.rejected === true) fail("Engine 8 rejected the manual ES PAPER trade.", result);
if (result?.assetType !== "FUTURES") fail("Engine 8 did not classify the order as FUTURES.", result);
if (result?.filledQty !== CONTRACTS) fail("Engine 8 did not fill exactly 3 PAPER contracts.", result);
if (toNumber(result?.avgPrice) !== geometry.entryPrice) fail("Engine 8 PAPER fill price does not match the requested manual entry.", { expected: geometry.entryPrice, actual: result?.avgPrice });
if (!Array.isArray(result?.blocks) || result.blocks.length !== 3) fail("Engine 8 did not preserve all three management blocks.", result);

console.log("\n==============================================");
console.log("MANUAL ES PAPER TRADE PASSED");
console.log(`Direction:   ${args.direction}`);
console.log(`Paper fill:  ${result.avgPrice}`);
console.log(`Contracts:   ${result.filledQty}`);
console.log(`Order ID:    ${result.orderId}`);
console.log(`Trade ID:    ${result.tradeId ?? "JOURNAL NOT ATTACHED"}`);
console.log(`Journal:     ${result?.journal?.journalCompleted === true ? "COMPLETED" : result?.journal ? "RETURNED BUT NOT COMPLETE" : "NO JOURNAL RESULT"}`);
console.log("PAPER ONLY — NO SCHWAB / NO REAL BROKER");
console.log("==============================================\n");
