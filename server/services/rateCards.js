const { createHash } = require('node:crypto');
const Draft = require('../models/RateCardDraft');
const Book = require('../models/RateBook');
const Contract = require('../../mobile-bill-app/rate-card');
class RateCardError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
const error = (status, code, message) => { throw new RateCardError(status, code, message); };
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function fields(body, keys) { if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some((key) => !keys.includes(key))) error(400, 'INVALID_REQUEST', 'Invalid rate-card request.'); }
function id(value) { if (typeof value !== 'string' || !/^[a-f0-9]{24}$/i.test(value)) error(400, 'INVALID_ID', 'Invalid draft ID.'); return value; }
function requestId(value) { if (typeof value !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value)) error(400, 'INVALID_REQUEST_ID', 'A UUID request ID is required.'); }
function revision(value) { if (!Number.isSafeInteger(value) || value < 0) error(400, 'INVALID_REVISION', 'An explicit non-negative revision is required.'); }
function shipper(value) { if (typeof value !== 'string' || !value.trim() || value.length > 128) error(400, 'INVALID_SHIPPER', 'Shipper code is required.'); return value.trim().toUpperCase(); }
function normalize(card) { try { return Contract.normalize(card); } catch (e) { error(400, e.code || 'INVALID_RATE_CARD', e.message); } }
async function ready() {
  if (Book.db.readyState !== 1) error(503, 'RATE_STORAGE_UNAVAILABLE', 'Rate storage is unavailable. No publication was confirmed.');
  await Promise.all([Draft.init(), Book.init()]);
}
function replay(document, requestId, digest, key) {
  const op = document?.operations?.find((op) => op.requestId === requestId);
  if (!op) return null;
  if (op.hash !== digest) error(409, 'IDEMPOTENCY_CONFLICT', 'Request ID already used for different rate-card data.');
  return { data: document, replayed: true, operationRevision: op[key] };
}
async function saveDraft(body) {
  fields(body, ['requestId', 'draftId', 'expectedRevision', 'card']); requestId(body.requestId); revision(body.expectedRevision);
  if (body.draftId !== undefined) id(body.draftId);
  const { card } = normalize(body.card);
  const digest = hash({ action: 'DRAFT', draftId: body.draftId || null, expectedRevision: body.expectedRevision, card });
  await ready();
  const known = replay(await Draft.findOne({ 'operations.requestId': body.requestId }).lean(), body.requestId, digest, 'revision');
  if (known) return known;
  const op = { requestId: body.requestId, hash: digest, revision: body.expectedRevision + 1 };
  try {
    if (!body.draftId) {
      if (body.expectedRevision !== 0) error(409, 'REVISION_CONFLICT', 'New drafts start at revision zero.');
      const [draft] = await Draft.create([{ shipperCode: card.shipperCode, revision: 1, card, operations: [op] }], { writeConcern: { w: 'majority', wtimeout: 5000 } });
      return { data: draft, replayed: false, operationRevision: 1 };
    }
    const draft = await Draft.findOneAndUpdate({ _id: id(body.draftId), shipperCode: card.shipperCode, revision: body.expectedRevision, 'operations.999': { $exists: false } },
      { $set: { card }, $inc: { revision: 1 }, $push: { operations: op } }, { new: true, runValidators: true, writeConcern: { w: 'majority', wtimeout: 5000 } }).lean();
    if (draft) return { data: draft, replayed: false, operationRevision: draft.revision };
  } catch (e) { if (e.code !== 11000) throw e; }
  const retry = replay(await Draft.findOne({ 'operations.requestId': body.requestId }).lean(), body.requestId, digest, 'revision');
  if (retry) return retry;
  error(409, 'REVISION_CONFLICT', 'Draft changed, reached its revision limit, or belongs to another shipper. Reload before saving.');
}
async function publish(body, operator, rollback = false) {
  fields(body, rollback ? ['requestId', 'shipperCode', 'expectedRevision', 'sourceVersion', 'approved'] : ['requestId', 'shipperCode', 'expectedRevision', 'draftId', 'draftRevision', 'approved', 'acknowledgedWarnings']);
  requestId(body.requestId); revision(body.expectedRevision);
  const code = shipper(body.shipperCode);
  if (typeof operator !== 'string' || !operator.trim()) error(503, 'OPERATOR_REQUIRED', 'Publication operator is not configured.');
  if (body.approved !== true) error(400, 'APPROVAL_REQUIRED', 'Explicit operator approval is required.');
  if (rollback) { revision(body.sourceVersion); if (!body.sourceVersion) error(400, 'INVALID_VERSION', 'Select an approved version.'); }
  else { id(body.draftId); revision(body.draftRevision); if (!Array.isArray(body.acknowledgedWarnings) || body.acknowledgedWarnings.some((v) => typeof v !== 'string')) error(400, 'REVIEW_REQUIRED', 'Review acknowledgements are required.'); }
  const digest = hash({ action: rollback ? 'ROLLBACK' : 'PUBLISH', requestId: body.requestId, shipperCode: code,
    expectedRevision: body.expectedRevision, approved: true, ...(rollback ? { sourceVersion: body.sourceVersion } : {
      draftId: body.draftId.toLowerCase(), draftRevision: body.draftRevision, acknowledgedWarnings: [...new Set(body.acknowledgedWarnings)].sort() }) });
  await ready();
  const known = replay(await Book.findOne({ 'operations.requestId': body.requestId }).lean(), body.requestId, digest, 'version');
  if (known) return known;
  const book = await Book.findById(code).lean();
  if ((book?.revision || 0) !== body.expectedRevision) error(409, 'PUBLICATION_CONFLICT', 'Published rates changed. Reload and approve against the current version.');
  if ((book?.versions.length || 0) >= 40) error(409, 'VERSION_LIMIT', 'The retained-version limit is reached. Export and plan an approved archive migration; no history was deleted.');
  let card, draftId, draftRevision, warnings;
  if (rollback) {
    const source = book?.versions.find((entry) => entry.version === body.sourceVersion);
    if (!source) error(404, 'VERSION_NOT_FOUND', 'Approved version not found for this shipper.');
    card = source.card; draftId = source.draftId; draftRevision = source.draftRevision; warnings = source.warnings;
  } else {
    const draft = await Draft.findOne({ _id: body.draftId, shipperCode: code, revision: body.draftRevision }).lean();
    if (!draft) error(409, 'DRAFT_CONFLICT', 'Draft not found at the reviewed revision for this shipper.');
    const normalized = normalize(draft.card); card = normalized.card;
    warnings = normalized.warnings.map((warning) => warning.code);
    if (warnings.some((warning) => !body.acknowledgedWarnings.includes(warning))) error(400, 'REVIEW_REQUIRED', 'Acknowledge all rate-card warnings before publication.');
    draftId = String(draft._id); draftRevision = draft.revision;
  }
  const version = body.expectedRevision + 1;
  const entry = { version, card, draftId, draftRevision, approvedBy: operator, approvedAt: new Date(), warnings,
    kind: rollback ? 'ROLLBACK' : 'PUBLISH', ...(rollback ? { sourceVersion: body.sourceVersion } : {}) };
  const op = { requestId: body.requestId, hash: digest, version };
  try {
    if (!book) {
      const [created] = await Book.create([{ _id: code, revision: 1, activeVersion: 1, versions: [entry], operations: [op] }], { writeConcern: { w: 'majority', wtimeout: 5000 } });
      return { data: created, replayed: false, operationRevision: 1 };
    }
    const changed = await Book.findOneAndUpdate({ _id: code, revision: body.expectedRevision },
      { $set: { activeVersion: version }, $inc: { revision: 1 }, $push: { versions: entry, operations: op } }, { new: true, runValidators: true, writeConcern: { w: 'majority', wtimeout: 5000 } }).lean();
    if (changed) return { data: changed, replayed: false, operationRevision: version };
  } catch (e) { if (e.code !== 11000) throw e; }
  const retry = replay(await Book.findOne({ 'operations.requestId': body.requestId }).lean(), body.requestId, digest, 'version');
  if (retry) return retry;
  error(409, 'PUBLICATION_CONFLICT', 'Another publication won. Active rates were not overwritten by this request.');
}
async function activeRates(code, { allowLegacy = false } = {}) {
  const normalized = shipper(code);
  const [book] = await Book.aggregate([{ $match: { _id: normalized } }, { $project: { activeVersion: 1, active: { $arrayElemAt: ['$versions', { $subtract: ['$activeVersion', 1] }] } } }]);
  if (book) {
    const version = book.active;
    if (!version || version.version !== book.activeVersion || !version.approvedBy) error(503, 'INVALID_PUBLICATION', 'Published rate version is unavailable.');
    return version.card.rates.map((rate, i) => ({ ...rate, _id: `${normalized}:${version.version}:${i}`, shipperCode: normalized, revision: version.version, publicationVersion: version.version, approved: true }));
  }
  return allowLegacy ? require('../models/Rate').find({ shipperCode: normalized }).lean() : [];
}
module.exports = { RateCardError, saveDraft, publish, activeRates, shipper, id };
