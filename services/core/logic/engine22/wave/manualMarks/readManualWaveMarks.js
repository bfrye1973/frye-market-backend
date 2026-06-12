import fs from "fs";

const DEFAULT_FIB_INPUT_FILE =
"/opt/render/project/src/services/core/data/fib-input.csv";

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

function readFibInputRows(filePath = DEFAULT_FIB_INPUT_FILE) {
try {
if (!fs.existsSync(filePath)) return [];

```
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
    };
  });
```

} catch (err) {
console.warn(
"[Engine22 ManualMarks] Failed reading fib-input.csv:",
err?.message
);

```
return [];
```

}
}

export function getManualLevelRowsFor(args = {}) {
const {
symbol,
degree,
tf,
filePath = DEFAULT_FIB_INPUT_FILE,
} = args;

return readFibInputRows(filePath).filter((row) => {
const wave = String(row.wave || "").toUpperCase();
const kind = String(row.kind || "").toUpperCase();

```
const isLevelRow = kind === "LEVEL";

const isAbcDownRow =
  wave === "ABC" &&
  ["A", "B", "C"].includes(kind);

const isAbcUpRow =
  wave === "ABC_UP" &&
  ["ORIGIN_LOW", "A_HIGH", "B_LOW", "C_HIGH"].includes(kind);

const isDownImpulseRow =
  wave === "W3_DOWN" &&
  ["W1_LOW", "W2_HIGH", "W3_LOW", "W4_HIGH", "W5_LOW"].includes(kind);

const isPostW5BounceRow =
  wave === "POST_W5_BOUNCE" &&
  ["ORIGIN_LOW", "A_HIGH", "B_LOW", "C_HIGH"].includes(kind);

const symbolMatches =
  String(row.symbol || "").toUpperCase() ===
  String(symbol || "").toUpperCase();

const degreeMatches =
  String(row.degree || "").toLowerCase() ===
  String(degree || "").toLowerCase();

const tfMatches =
  !tf ||
  String(row.tf || "").toLowerCase() === String(tf || "").toLowerCase();

return (
  symbolMatches &&
  degreeMatches &&
  tfMatches &&
  (
    isLevelRow ||
    isAbcDownRow ||
    isAbcUpRow ||
    isDownImpulseRow ||
    isPostW5BounceRow
  )
);
```

});
}

export function attachManualLevelsToEngine2Block(block, levelRows = []) {
if (!block || typeof block !== "object") return block;

const findLevel = (...names) => {
const wanted = names.map((x) => String(x || "").toUpperCase());

```
const row = levelRows.find((r) => {
  const wave = String(r.wave || "").toUpperCase();
  const kind = String(r.kind || "").toUpperCase();

  if (wanted.includes(wave)) return true;
  if (wave === "ABC" && wanted.includes(kind)) return true;

  return false;
});

return toPriceOrNull(row?.price);
```

};

const findFamilyMark = (familyName, kindName) => {
const wantedFamily = String(familyName || "").toUpperCase();
const wantedKind = String(kindName || "").toUpperCase();

```
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
```

};

const findAbcUpMark = (kindName) => {
return findFamilyMark("ABC_UP", kindName);
};

const findDownImpulseMark = (kindName) => {
return findFamilyMark("W3_DOWN", kindName);
};

const findPostW5BounceMark = (kindName) => {
return findFamilyMark("POST_W5_BOUNCE", kindName);
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

const abcUpMarks = {
originLow: originLow.price,
originTime: originLow.time,

```
aHigh: aHigh.price,
aTime: aHigh.time,

bLow: bLow.price,
bTime: bLow.time,

cHigh: cHigh.price,
cTime: cHigh.time,
```

};

const downImpulseMarks = {
w1Low: downW1Low.price,
w1Time: downW1Low.time,

```
w2High: downW2High.price,
w2Time: downW2High.time,

w3Low: downW3Low.price,
w3Time: downW3Low.time,

w4High: downW4High.price,
w4Time: downW4High.time,

w5Low: downW5Low.price,
w5Time: downW5Low.time,
```

};

const postW5BounceMarks = {
originLow: postW5OriginLow.price,
originTime: postW5OriginLow.time,

```
aHigh: postW5AHigh.price,
aTime: postW5AHigh.time,

bLow: postW5BLow.price,
bTime: postW5BLow.time,

cHigh: postW5CHigh.price,
cTime: postW5CHigh.time,
```

};

return {
...block,
aLow,
bHigh,
cLow,
w4Low: cLow,
lowerHighLevel: bHigh,
continuationLevel: bHigh,
abcUpMarks,
downImpulseMarks,
postW5BounceMarks,
};
}
