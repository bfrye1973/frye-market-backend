import fs from "fs";

const DEFAULT_FIB_INPUT_FILE =
  "/opt/render/project/src/services/core/data/fib-input.csv";

const DEFAULT_ACTIVE_WAVE_STATE_FILE =
  "/opt/render/project/src/services/core/data/waves/active/active-wave-state-es.json";

function parseCsvLine(line) {
  return String(line || "")
    .split(",")
    .map((x) => x.trim());
}

function toPriceOrNull(value) {
  if (value === null || value === undefined || value === "") return null;

  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function makeEmptyMark() {
  return {
    price: null,
    time: null,
  };
}

function datetimeAzToSec(datetimeAz) {
  const raw = String(datetimeAz || "").trim();
  if (!raw) return null;

  const normalized = raw.includes("T") ? raw : raw.replace(" ", "T");

  const withSeconds =
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(normalized)
      ? normalized + ":00"
      : normalized;

  const ms = Date.parse(withSeconds + "-07:00");
  if (!Number.isFinite(ms)) return null;

  return Math.floor(ms / 1000);
}

function readFibInputRows(filePath = DEFAULT_FIB_INPUT_FILE) {
  try {
    if (!fs.existsSync(filePath)) return [];

    const text = fs.readFileSync(filePath, "utf8");

    return text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .slice(1)
      .map((line) => {
        const [symbol, degree, tf, wave, kind, datetime_az, price] =
          parseCsvLine(line);

        return {
          symbol,
          degree,
          tf,
          wave,
          kind,
          datetime_az,
          price: Number(price),
          source: "fib-input.csv",
        };
      });
  } catch (err) {
    console.warn(
      "[Engine22 ManualMarks] Failed reading fib-input.csv:",
      err?.message
    );

    return [];
  }
}

function readActiveWaveStateJson(filePath = DEFAULT_ACTIVE_WAVE_STATE_FILE) {
  try {
    if (!fs.existsSync(filePath)) return null;

    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (err) {
    console.warn(
      "[Engine22 ManualMarks] Failed reading active-wave-state-es.json:",
      err?.message
    );

    return null;
  }
}

export function getActiveWaveStateMeta({
  symbol,
  filePath = DEFAULT_ACTIVE_WAVE_STATE_FILE,
} = {}) {
  const json = readActiveWaveStateJson(filePath);

  if (!json || typeof json !== "object") return null;

  const symbolMatches =
    String(json?.symbol || "").toUpperCase() ===
    String(symbol || "").toUpperCase();

  if (!symbolMatches) return null;

  const activeStructures =
    json?.activeStructures && typeof json.activeStructures === "object"
      ? json.activeStructures
      : {};

  const activeDegreeKeys = Object.keys(activeStructures)
    .map((key) => String(key || "").toLowerCase())
    .filter(Boolean);

  return {
    symbol: json.symbol || symbol || null,
    updatedAt: json.updatedAt || null,
    source: "active-wave-state-es.json",
    activeDegreeKeys,
    historicalAllowedAsCurrent: false,
    hasActiveStateForSymbol: true,
  };
}

function readActiveWaveStateRows({
  symbol,
  degree,
  tf,
  filePath = DEFAULT_ACTIVE_WAVE_STATE_FILE,
} = {}) {
  try {
    const json = readActiveWaveStateJson(filePath);
    if (!json || typeof json !== "object") return [];

    const symbolMatches =
      String(json?.symbol || "").toUpperCase() ===
      String(symbol || "").toUpperCase();

    if (!symbolMatches) return [];

    const degreeKey = String(degree || "").toLowerCase();
    const structure = json?.activeStructures?.[degreeKey] || null;

    if (!structure || typeof structure !== "object") return [];

    const tfMatches =
      !tf ||
      String(structure?.tf || "").toLowerCase() ===
        String(tf || "").toLowerCase();

    if (!tfMatches) return [];

    const marks = structure?.marks || {};
    const rows = [];

    for (const key of ["W1", "W2", "W3", "W4", "W5"]) {
      const mark = marks?.[key];
      const price = toPriceOrNull(mark?.price);
      const time = mark?.time || null;

      if (price == null || !time) continue;

      rows.push({
        symbol: json.symbol,
        degree: degreeKey,
        tf: structure.tf || tf || null,
        wave: "MARK",
        kind: key,
        datetime_az: time,
        price,
        source: "active-wave-state",
        direction: structure.direction || null,
        updatedAt: json.updatedAt || null,
      });
    }

    return rows;
  } catch (err) {
    console.warn(
      "[Engine22 ManualMarks] Failed reading active-wave-state-es.json rows:",
      err?.message
    );

    return [];
  }
}

function rowMatchesRequest(row, { symbol, degree, tf }) {
  const symbolMatches =
    String(row.symbol || "").toUpperCase() ===
    String(symbol || "").toUpperCase();

  const degreeMatches =
    String(row.degree || "").toLowerCase() ===
    String(degree || "").toLowerCase();

  const tfMatches =
    !tf ||
    String(row.tf || "").toLowerCase() === String(tf || "").toLowerCase();

  return symbolMatches && degreeMatches && tfMatches;
}

function isSupportedManualRow(row) {
  const wave = String(row.wave || "").toUpperCase();
  const kind = String(row.kind || "").toUpperCase();

  const isLevelRow = kind === "LEVEL";

  const isManualWaveMarkRow =
    wave === "MARK" && ["W1", "W2", "W3", "W4", "W5"].includes(kind);

  const isAbcDownRow = wave === "ABC" && ["A", "B", "C"].includes(kind);

  const isAbcUpRow =
    wave === "ABC_UP" &&
    ["ORIGIN_LOW", "A_HIGH", "B_LOW", "C_HIGH"].includes(kind);

  const isDownImpulseRow =
    wave === "W3_DOWN" &&
    ["W1_LOW", "W2_HIGH", "W3_LOW", "W4_HIGH", "W5_LOW"].includes(kind);

  const isPostW5BounceRow =
    wave === "POST_W5_BOUNCE" &&
    ["ORIGIN_LOW", "A_HIGH", "B_LOW", "C_HIGH"].includes(kind);

  const isPossibleW5UpRow =
    wave === "POSSIBLE_W5_UP" &&
    [
      "ORIGIN_LOW",
      "W1_HIGH",
      "W2_LOW",
      "W3_HIGH",
      "W4_LOW",
      "W5_HIGH",
    ].includes(kind);

  return (
    isLevelRow ||
    isManualWaveMarkRow ||
    isAbcDownRow ||
    isAbcUpRow ||
    isDownImpulseRow ||
    isPostW5BounceRow ||
    isPossibleW5UpRow
  );
}

function isNormalWaveMarkRow(row) {
  const wave = String(row.wave || "").toUpperCase();
  const kind = String(row.kind || "").toUpperCase();

  return wave === "MARK" && ["W1", "W2", "W3", "W4", "W5"].includes(kind);
}

export function getManualLevelRowsFor(args = {}) {
  const {
    symbol,
    degree,
    tf,
    filePath = DEFAULT_FIB_INPUT_FILE,
    activeFilePath = DEFAULT_ACTIVE_WAVE_STATE_FILE,
  } = args;

  const activeStateMeta = getActiveWaveStateMeta({
    symbol,
    filePath: activeFilePath,
  });

  const degreeKey = String(degree || "").toLowerCase();

  const hasActiveStateForSymbol =
    activeStateMeta?.hasActiveStateForSymbol === true;

  const activeDegreeKeys = Array.isArray(activeStateMeta?.activeDegreeKeys)
    ? activeStateMeta.activeDegreeKeys
    : null;

  const degreeIsActive =
    !hasActiveStateForSymbol ||
    !activeDegreeKeys ||
    activeDegreeKeys.includes(degreeKey);

  // Long-term active source-of-truth rule:
  // If active-wave-state-es.json exists for this symbol and this degree is omitted,
  // historical CSV rows for that degree are archive/context only, not current marks.
  if (!degreeIsActive) {
    return [];
  }

  const activeRows = readActiveWaveStateRows({
    symbol,
    degree,
    tf,
    filePath: activeFilePath,
  });

  const hasActiveWaveStructure = activeRows.length > 0;

  const csvRows = readFibInputRows(filePath)
    .filter((row) => rowMatchesRequest(row, { symbol, degree, tf }))
    .filter(isSupportedManualRow)
    .filter((row) => {
      if (!hasActiveWaveStructure) return true;

      // If active-wave-state provides W1/W2/etc for this degree,
      // old CSV MARK rows for that degree become historical only.
      // Keep ABC / ABC_UP / W3_DOWN / POST_W5_BOUNCE / POSSIBLE_W5_UP rows
      // only for the same active degree.
      return !isNormalWaveMarkRow(row);
    });

  return [...activeRows, ...csvRows];
}

export function attachManualLevelsToEngine2Block(block, levelRows = []) {
  if (!block || typeof block !== "object") return block;

  const findLevel = (...names) => {
    const wanted = names.map((x) => String(x || "").toUpperCase());

    const row = levelRows.find((r) => {
      const wave = String(r.wave || "").toUpperCase();
      const kind = String(r.kind || "").toUpperCase();

      if (wanted.includes(wave)) return true;
      if (wave === "ABC" && wanted.includes(kind)) return true;

      return false;
    });

    return toPriceOrNull(row?.price);
  };

  const findFamilyMark = (familyName, kindName) => {
    const wantedFamily = String(familyName || "").toUpperCase();
    const wantedKind = String(kindName || "").toUpperCase();

    const row = levelRows.find((r) => {
      const wave = String(r.wave || "").toUpperCase();
      const kind = String(r.kind || "").toUpperCase();

      return wave === wantedFamily && kind === wantedKind;
    });

    if (!row) return makeEmptyMark();

    return {
      price: toPriceOrNull(row?.price),
      time: row?.datetime_az || null,
    };
  };

  const findManualWaveMark = (kindName) => {
    return findFamilyMark("MARK", kindName);
  };

  const toWaveMark = (mark) => {
    if (!mark || mark.price == null) return null;

    return {
      p: mark.price,
      t: mark.time || null,
      tSec: datetimeAzToSec(mark.time),
    };
  };

  const manualWaveMarks = {
    W1: toWaveMark(findManualWaveMark("W1")),
    W2: toWaveMark(findManualWaveMark("W2")),
    W3: toWaveMark(findManualWaveMark("W3")),
    W4: toWaveMark(findManualWaveMark("W4")),
    W5: toWaveMark(findManualWaveMark("W5")),
  };

  const cleanedManualWaveMarks = Object.fromEntries(
    Object.entries(manualWaveMarks).filter(([, value]) => value)
  );

  const hasManualWaveMarks = Object.keys(cleanedManualWaveMarks).length > 0;

  const buildManualWavePhase = () => {
    const order = ["W1", "W2", "W3", "W4", "W5"];
    const marksPresent = order.filter((key) => cleanedManualWaveMarks[key]);

    if (!marksPresent.length) {
      return {
        phase: block.phase ?? "UNKNOWN",
        confirmedPhase: block.confirmedPhase ?? "UNKNOWN",
        lastMark: block.lastMark ?? null,
        nextMark: block.nextMark ?? null,
        marksPresent: block.marksPresent ?? [],
      };
    }

    const lastKey = marksPresent[marksPresent.length - 1];
    const last = cleanedManualWaveMarks[lastKey];

    const phaseByLastKey = {
      W1: "IN_W2",
      W2: "IN_W3",
      W3: "IN_W4",
      W4: "IN_W5",
      W5: "COMPLETE_W5",
    };

    const confirmedPhaseByLastKey = {
      W1: "IN_W1",
      W2: "IN_W2",
      W3: "IN_W3",
      W4: "IN_W4",
      W5: "COMPLETE_W5",
    };

    return {
      phase: phaseByLastKey[lastKey] || "UNKNOWN",
      confirmedPhase: confirmedPhaseByLastKey[lastKey] || "UNKNOWN",
      phaseReason: `ACTIVE_WAVE_STATE_${lastKey}_MARKED`,
      lastMark: {
        key: lastKey,
        ...last,
      },
      nextMark: null,
      marksPresent,
    };
  };

  const manualWavePhase = buildManualWavePhase();

  const findAbcUpMark = (kindName) => {
    return findFamilyMark("ABC_UP", kindName);
  };

  const findDownImpulseMark = (kindName) => {
    return findFamilyMark("W3_DOWN", kindName);
  };

  const findPostW5BounceMark = (kindName) => {
    return findFamilyMark("POST_W5_BOUNCE", kindName);
  };

  const findPossibleW5UpMark = (kindName) => {
    return findFamilyMark("POSSIBLE_W5_UP", kindName);
  };

  const aLow = findLevel("A_LOW", "A");
  const bHigh = findLevel("B_HIGH", "B");
  const cLow = findLevel("C_LOW", "C");

  const originLow = findAbcUpMark("ORIGIN_LOW");
  const aHigh = findAbcUpMark("A_HIGH");
  const bLow = findAbcUpMark("B_LOW");
  const cHigh = findAbcUpMark("C_HIGH");

  const downW1Low = findDownImpulseMark("W1_LOW");
  const downW2High = findDownImpulseMark("W2_HIGH");
  const downW3Low = findDownImpulseMark("W3_LOW");
  const downW4High = findDownImpulseMark("W4_HIGH");
  const downW5Low = findDownImpulseMark("W5_LOW");

  const postW5OriginLow = findPostW5BounceMark("ORIGIN_LOW");
  const postW5AHigh = findPostW5BounceMark("A_HIGH");
  const postW5BLow = findPostW5BounceMark("B_LOW");
  const postW5CHigh = findPostW5BounceMark("C_HIGH");

  const possibleW5OriginLow = findPossibleW5UpMark("ORIGIN_LOW");
  const possibleW5W1High = findPossibleW5UpMark("W1_HIGH");
  const possibleW5W2Low = findPossibleW5UpMark("W2_LOW");
  const possibleW5W3High = findPossibleW5UpMark("W3_HIGH");
  const possibleW5W4Low = findPossibleW5UpMark("W4_LOW");
  const possibleW5W5High = findPossibleW5UpMark("W5_HIGH");

  const abcUpMarks = {
    originLow: originLow.price,
    originTime: originLow.time,

    aHigh: aHigh.price,
    aTime: aHigh.time,

    bLow: bLow.price,
    bTime: bLow.time,

    cHigh: cHigh.price,
    cTime: cHigh.time,
  };

  const downImpulseMarks = {
    w1Low: downW1Low.price,
    w1Time: downW1Low.time,

    w2High: downW2High.price,
    w2Time: downW2High.time,

    w3Low: downW3Low.price,
    w3Time: downW3Low.time,

    w4High: downW4High.price,
    w4Time: downW4High.time,

    w5Low: downW5Low.price,
    w5Time: downW5Low.time,
  };

  const postW5BounceMarks = {
    originLow: postW5OriginLow.price,
    originTime: postW5OriginLow.time,

    aHigh: postW5AHigh.price,
    aTime: postW5AHigh.time,

    bLow: postW5BLow.price,
    bTime: postW5BLow.time,

    cHigh: postW5CHigh.price,
    cTime: postW5CHigh.time,
  };

  const possibleW5UpMarks = {
    originLow: possibleW5OriginLow.price,
    originTime: possibleW5OriginLow.time,

    w1High: possibleW5W1High.price,
    w1Time: possibleW5W1High.time,

    w2Low: possibleW5W2Low.price,
    w2Time: possibleW5W2Low.time,

    w3High: possibleW5W3High.price,
    w3Time: possibleW5W3High.time,

    w4Low: possibleW5W4Low.price,
    w4Time: possibleW5W4Low.time,

    w5High: possibleW5W5High.price,
    w5Time: possibleW5W5High.time,
  };

  return {
    ...block,

    waveMarks: hasManualWaveMarks ? cleanedManualWaveMarks : block.waveMarks,

    ...(hasManualWaveMarks
      ? {
          phase: manualWavePhase.phase,
          confirmedPhase: manualWavePhase.confirmedPhase,
          phaseReason: manualWavePhase.phaseReason,
          lastMark: manualWavePhase.lastMark,
          nextMark: manualWavePhase.nextMark,
          marksPresent: manualWavePhase.marksPresent,
        }
      : {}),

    aLow,
    bHigh,
    cLow,
    w4Low: cLow,
    lowerHighLevel: bHigh,
    continuationLevel: bHigh,

    abcUpMarks,
    downImpulseMarks,
    postW5BounceMarks,
    possibleW5UpMarks,
  };
}
