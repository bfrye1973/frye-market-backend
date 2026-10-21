// Engine 10 / Engine 8 read-only recovery evidence exporter.
// Run only on secured Render host; does not modify source Journal or observer ledger.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const root = "/var/data/replay";
const privateDir = path.resolve(process.env.SCHWAB_PRIVATE_DATA_DIR || path.join(root, "engine8-private"));
const journalDir = path.resolve(process.env.TRADE_JOURNAL_DIR || path.join(root, "journal"));
const ledgerPath = path.join(privateDir, "engine8-real-fill-observer-state.json");
const journalPath = path.join(journalDir, "trade-journal.json");
const start = Date.parse("2026-10-18T00:00:00Z");
const end = Date.parse("2026-10-22T00:00:00Z");
const hash = b => crypto.createHash("sha256").update(b).digest("hex");
const str = v => String(v ?? "").trim();
const upper = v => str(v).toUpperCase();

function read(file) {
  const bytes = fs.readFileSync(file);
  return { data: JSON.parse(bytes.toString("utf8")), sha256: hash(bytes), bytes: bytes.length };
}
function fillOf(record) {
  return record?.normalizedFill && typeof record.normalizedFill === "object"
    ? record.normalizedFill : null;
}
function matches(event, fill) {
  if (str(event?.brokerTransactionId) !== str(fill?.brokerTransactionId)) return false;
  if (!str(fill?.brokerTransactionId)) return false;
  if (upper(event?.journalAccount) !== upper(fill?.journalAccount)) return false;
  const incomingLeg = str(fill?.brokerFillLegId);
  const recordedLeg = str(event?.brokerFillLegId);
  return !incomingLeg || !recordedLeg || incomingLeg === recordedLeg;
}
function inWindow(value) {
  const time = Date.parse(str(value));
  return Number.isFinite(time) && time >= start && time < end;
}
function chronological(a, b) {
  const at = Date.parse(str(fillOf(a.record)?.fillTime)) || 0;
  const bt = Date.parse(str(fillOf(b.record)?.fillTime)) || 0;
  return at - bt || a.observationIdentity.localeCompare(b.observationIdentity);
}
const ledgerSource = read(ledgerPath);
const journalSource = read(journalPath);
const ledger = ledgerSource.data;
const journal = journalSource.data;
if (!Array.isArray(journal)) throw new Error("UNEXPECTED_JOURNAL_SHAPE");
const raw = ledger?.observations && Object.keys(ledger.observations).length
  ? ledger.observations : ledger?.records;
if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
  throw new Error("UNEXPECTED_OBSERVER_LEDGER_SHAPE");
}
const observations = Object.entries(raw).map(([observationIdentity, record]) => ({ observationIdentity, record }));
const realTrades = journal.filter(t => upper(t?.accountMode) === "REAL");
const realEvents = realTrades.flatMap(t => (Array.isArray(t?.events) ? t.events : [])
  .map(event => ({ tradeId: t.tradeId, journalAccount: t.journalAccount, event })));
const journalHas = fill => realEvents.some(({ event }) => matches(event, fill));
const failed = observations.filter(o =>
  o.record?.delivered !== true && o.record?.deliveryStatus === "ENGINE10_NOT_ACKNOWLEDGED");
const missing = failed.filter(o => fillOf(o.record) && !journalHas(fillOf(o.record))).sort(chronological);
const recorded = failed.filter(o => fillOf(o.record) && journalHas(fillOf(o.record))).sort(chronological);
const dryRun = observations.filter(o =>
  o.record?.delivered !== true && o.record?.deliveryStatus === "DRY_RUN_ONLY").sort(chronological);
const surrounding = observations.filter(o => fillOf(o.record) && inWindow(fillOf(o.record).fillTime)).sort(chronological);
const periodEvents = realEvents.filter(({ event }) => inWindow(event?.ts || event?.fillTime))
  .sort((a,b) => Date.parse(a.event.ts || a.event.fillTime) - Date.parse(b.event.ts || b.event.fillTime));
const observed = { missing: missing.length, failedAlreadyRecorded: recorded.length, excludedDryRun: dryRun.length };
const expected = { missing: 15, failedAlreadyRecorded: 27, excludedDryRun: 54 };
if (Object.keys(expected).some(k => observed[k] !== expected[k])) {
  console.error(JSON.stringify({ ok: false, error: "AUDITED_COUNTS_CHANGED_REFUSE_EXPORT", expected, observed }, null, 2));
  process.exitCode = 2;
} else {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outputDir = path.join(privateDir, `engine8-recovery-evidence-${stamp}`);
  fs.mkdirSync(outputDir, { recursive: false, mode: 0o700 });
  fs.chmodSync(outputDir, 0o700);
  const files = [];
  function write(name, data) {
    const file = path.join(outputDir, name);
    const bytes = Buffer.from(JSON.stringify(data, null, 2) + "\n");
    fs.writeFileSync(file, bytes, { flag: "wx", mode: 0o600 });
    fs.chmodSync(file, 0o600);
    files.push({ name, records: Array.isArray(data) ? data.length : null, bytes: bytes.length, sha256: hash(bytes) });
  }
  write("missing-15.json", missing);
  write("failed-already-in-journal-27.json", recorded);
  write("historical-dry-run-54-EXCLUDED.json", dryRun);
  write("surrounding-oct18-21.json", surrounding);
  write("journal-real-events-oct18-21.json", periodEvents);
  write("account-watermarks.json", ledger.accounts || {});
  const manifest = {
    schema: "engine8.schwabRealRecoveryEvidence.v1",
    generatedAt: new Date().toISOString(),
    readOnly: true,
    source: {
      ledger: { path: ledgerPath, bytes: ledgerSource.bytes, sha256: ledgerSource.sha256 },
      journal: { path: journalPath, bytes: journalSource.bytes, sha256: journalSource.sha256 }
    },
    historicalWindowUtc: { start: "2026-10-18T00:00:00Z", endExclusive: "2026-10-22T00:00:00Z" },
    counts: {
      observerRecords: observations.length, realJournalCampaigns: realTrades.length,
      pendingFailed: failed.length, ...observed,
      surroundingNormalizedRecords: surrounding.length, surroundingJournalEvents: periodEvents.length
    },
    limitations: [
      "No timestamped Schwab position snapshot",
      "Not a backup of the source files",
      "Do not ingest exported records directly into production",
      "Parent-only historical events can mask distinct leg-aware records"
    ],
    files
  };
  write("manifest.json", manifest);
  console.log(JSON.stringify({
    ok: true, outputDir, counts: manifest.counts,
    sourceSha256: { observer: ledgerSource.sha256, journal: journalSource.sha256 },
    manifestSha256: files.find(f => f.name === "manifest.json").sha256,
    notice: "READ-ONLY EVIDENCE CREATED; NO JOURNAL OR WATERMARK CHANGES"
  }, null, 2));
}
