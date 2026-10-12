import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { canonicalJson, hash, requireTruth, CandleError, instant } from './identity.js';
import { validateCalendarPlan, assessCoverage } from './calendar.js';
import { normalizeRawRows } from './normalize.js';

const HEX = /^[a-f0-9]{64}$/;

export function datasetFromAcquisition(acquisition) {
  requireTruth(acquisition?.status === 'COMPLETE' && acquisition.quality?.acquisitionComplete === true,
    'INCOMPLETE_ACQUISITION_NOT_PUBLISHABLE');
  requireTruth(acquisition.query?.priceBasis === 'RAW_CONTRACT' && acquisition.receipt?.failure === null &&
    acquisition.receipt?.provider === 'MASSIVE_FUTURES', 'INVALID_ACQUISITION_MANIFEST');
  instant(acquisition.receipt.observedAt);
  const calendar = validateCalendarPlan(acquisition.calendar, acquisition.query);
  const reconstructed = normalizeRawRows(acquisition.records.map(x => x.raw), {
    contract: acquisition.query.contract, providerTicker: acquisition.query.providerTicker,
    timeframe: acquisition.query.timeframe, provider: acquisition.receipt.provider, calendar,
    asOf: acquisition.receipt.asOf, sourceAsOf: acquisition.receipt.sourceAsOf });
  requireTruth(canonicalJson(reconstructed.records) === canonicalJson(acquisition.records), 'ACQUISITION_RECORD_TAMPERED');
  requireTruth(canonicalJson(acquisition.receipt.rawRevisionIds) === canonicalJson(acquisition.records.map(x => x.rawRevisionId)), 'ACQUISITION_LINEAGE_MISMATCH');
  const quality = assessCoverage(acquisition.records, calendar, true, acquisition.receipt.asOf, acquisition.quality.verifiedNoTrades);
  const original = { ...acquisition.quality }; delete original.duplicates;
  requireTruth(canonicalJson(quality) === canonicalJson(original), 'ACQUISITION_QUALITY_TAMPERED');
  const seriesId = 'CME:' + acquisition.query.contract + ':RAW_CONTRACT:' + acquisition.query.timeframe + ':' + acquisition.calendar.alignmentVersion;
  const dataset = { schemaVersion: 'engine11.rawDataset.v1', seriesId, priceBasis: 'RAW_CONTRACT',
    usageClass: 'ISOLATED_RESEARCH_ONLY', structuralEligible: false, query: acquisition.query,
    calendar: acquisition.calendar, quality: acquisition.quality, records: acquisition.records,
    firstObservedAt: acquisition.receipt.observedAt };
  return { ...dataset, datasetVersion: hash(dataset) };
}

// Content-addressed files, explicit root and exclusive link publication. This
// local proof store is not a production disk/database selection or latest pointer.
export class IsolatedRawStore {
  constructor({ root, isolated } = {}) {
    requireTruth(isolated === true && typeof root === 'string' && path.isAbsolute(root), 'EXPLICIT_ISOLATED_STORE_REQUIRED');
    this.root = path.resolve(root);
    requireTruth(this.root !== '/' && !this.root.startsWith('/var/data') && !this.root.startsWith('/opt/render'), 'PRODUCTION_STORAGE_FORBIDDEN');
  }
  async writeObject(kind, value, name = hash(value)) {
    requireTruth(['datasets', 'receipts', 'publications'].includes(kind) && HEX.test(name), 'INVALID_STORE_OBJECT');
    const digest = hash(value), dir = path.join(this.root, kind);
    // Reject symlink roots/directories so an explicit test path cannot redirect
    // publication into another store.
    requireTruth((await fs.realpath(this.root)) === this.root && (await fs.stat(this.root)).isDirectory(), 'STORE_SYMLINK_FORBIDDEN');
    try { requireTruth(!(await fs.lstat(dir)).isSymbolicLink(), 'STORE_SYMLINK_FORBIDDEN'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    await fs.mkdir(dir, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
    requireTruth((await fs.realpath(dir)) === dir, 'STORE_SYMLINK_FORBIDDEN');
    const target = path.join(dir, name + '.json'), temp = path.join(dir, '.' + randomUUID() + '.tmp');
    const content = canonicalJson(value);
    const handle = await fs.open(temp, 'wx', 0o600);
    try { await handle.writeFile(content); await handle.sync(); } finally { await handle.close(); }
    try {
      await fs.link(temp, target);
      const directory = await fs.open(dir, 'r');
      try { await directory.sync(); } finally { await directory.close(); }
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      requireTruth((await fs.readFile(target, 'utf8')) === content, 'CONTENT_ADDRESS_CONFLICT');
    } finally { await fs.unlink(temp).catch(() => {}); }
    return digest;
  }
  async publish(acquisition) {
    const dataset = datasetFromAcquisition(acquisition);
    const body = { ...dataset }; delete body.datasetVersion;
    // Dataset object is complete before the immutable publication receipt exists.
    const datasetVersion = await this.writeObject('datasets', body);
    const receiptId = await this.writeObject('receipts', { datasetVersion, receipt: acquisition.receipt });
    const publication = { datasetVersion, receiptId };
    await this.writeObject('publications', { ...publication, manifestHash: hash(publication) }, datasetVersion);
    return { datasetVersion, seriesId: dataset.seriesId, receiptId, structuralEligible: false };
  }
  async read(datasetVersion) {
    requireTruth(typeof datasetVersion === 'string' && HEX.test(datasetVersion), 'INVALID_DATASET_VERSION');
    let publication, receipt;
    try {
      publication = JSON.parse(await fs.readFile(path.join(this.root, 'publications', datasetVersion + '.json'), 'utf8'));
      requireTruth(publication.datasetVersion === datasetVersion && HEX.test(publication.receiptId) &&
        publication.manifestHash === hash({ datasetVersion, receiptId: publication.receiptId }), 'CORRUPT_PUBLICATION');
      receipt = JSON.parse(await fs.readFile(path.join(this.root, 'receipts', publication.receiptId + '.json'), 'utf8'));
      requireTruth(hash(receipt) === publication.receiptId && receipt.datasetVersion === datasetVersion, 'CORRUPT_PUBLICATION');
    } catch (error) {
      if (error.code === 'ENOENT') throw new CandleError('DATASET_UNAVAILABLE');
      if (error instanceof CandleError) throw error;
      throw new CandleError('CORRUPT_PUBLICATION');
    }
    let content;
    try { content = await fs.readFile(path.join(this.root, 'datasets', datasetVersion + '.json'), 'utf8'); }
    catch (error) { if (error.code === 'ENOENT') throw new CandleError('DATASET_UNAVAILABLE'); throw error; }
    let body;
    try { body = JSON.parse(content); } catch { throw new CandleError('CORRUPT_DATASET'); }
    requireTruth(hash(body) === datasetVersion, 'CORRUPT_DATASET');
    requireTruth(body.priceBasis === 'RAW_CONTRACT' && body.usageClass === 'ISOLATED_RESEARCH_ONLY' && body.structuralEligible === false, 'INVALID_DATASET_CLASS');
    return { ...body, datasetVersion };
  }
}

export function validateReadWindow(dataset, from, to, asOf) {
  const lo = instant(from), hi = instant(to);
  requireTruth(lo < hi && lo >= instant(dataset.query.range.fromInclusive) && hi <= instant(dataset.query.range.toExclusive), 'READ_OUTSIDE_PUBLISHED_RANGE');
  if (asOf != null) {
    instant(asOf);
    // Phase 1 requires a dataset finalized by asOf; no hindsight correction query.
    requireTruth(dataset.records.every(x => !x.sourceAsOf || instant(x.sourceAsOf) <= instant(asOf)), 'DATASET_AFTER_ASOF');
    requireTruth(instant(dataset.firstObservedAt) <= instant(asOf), 'EVIDENCE_NOT_OBSERVED_ASOF');
  }
}
