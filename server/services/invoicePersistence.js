const Invoice = require('../models/Invoice');
const Client = require('../models/Client');
const { validateInvoice, validateTransition, fingerprint, InvoiceError } = require('./invoiceValidation');
const conflict = (code, message) => { throw new InvoiceError(409, code, message); };
function replay(invoice, requestId, hash) {
  const operation = invoice?.operations?.find((entry) => entry.requestId === requestId);
  if (!operation) return null;
  if (operation.hash !== hash) conflict('IDEMPOTENCY_CONFLICT', 'This request ID was already used for different invoice data.');
  return { invoice, replayed: true, operationVersion: operation.version };
}
function writable(invoice, expectedVersion) {
  if (invoice.schemaVersion !== 2) conflict('LEGACY_READ_ONLY', 'Historical invoice is read-only. Create a correction with a new number.');
  if (invoice.revision !== expectedVersion) conflict('VERSION_CONFLICT', 'Invoice changed elsewhere. Reload its saved version before continuing.');
  if (invoice.operations.length >= 1000) conflict('REVISION_LIMIT', 'Revision limit reached. Archive this draft and create a new invoice.');
}
async function ready() {
  if (Invoice.db.readyState !== 1) throw new InvoiceError(503, 'DATABASE_UNAVAILABLE', 'Invoice storage is unavailable. Your draft is preserved; retry later.');
  await Invoice.init(); // Never accept concurrent creates before the unique index is ready.
}
async function saveInvoice(body) {
  const { requestId, expectedVersion, data } = validateInvoice(body);
  const hash = fingerprint({ action: 'SAVE', expectedVersion, data });
  await ready();
  const known = replay(await Invoice.findOne({ 'operations.requestId': requestId }).lean(), requestId, hash);
  if (known) return known;
  const existing = await Invoice.findOne({ invoiceNumber: data.invoiceNumber }).lean();
  const repeated = replay(existing, requestId, hash);
  if (repeated) return repeated;
  if (existing) {
    writable(existing, expectedVersion);
    if (existing.status !== 'DRAFT') conflict('INVOICE_IMMUTABLE', 'Generated, paid and cancelled invoices cannot be edited. Create a correction with a new number.');
    if (existing.correctionOf !== data.correctionOf) conflict('CORRECTION_CONFLICT', 'A correction reference cannot change after creation.');
  } else if (expectedVersion !== 0) conflict('VERSION_CONFLICT', 'Invoice does not exist at the expected version.');
  if (data.correctionOf && !await Invoice.exists({ invoiceNumber: data.correctionOf, status: { $in: ['GENERATED', 'PAID', 'CANCELLED'] } })) {
    throw new InvoiceError(400, 'INVALID_CORRECTION', 'Correction must reference an existing finalized invoice.');
  }
  if (data.client && !await Client.exists({ _id: data.client, shipperCode: data.shipperCode })) {
    throw new InvoiceError(400, 'INVALID_CLIENT', 'Client reference must match an existing client for this shipper.');
  }
  const revision = expectedVersion + 1;
  const operation = { requestId, hash, version: revision, action: 'SAVE', status: data.status, at: new Date() };
  const fields = { ...data, dueDate: data.dueDate ?? null, snapshot: data.snapshot ?? null, schemaVersion: 2, revision, totalsVerified: false, reconstructionComplete: !!data.snapshot,
    calculationContract: data.snapshot ? 'browser-v1-unverified' : 'legacy-api-v1-unverified' };
  if (data.status === 'GENERATED') fields.finalizedAt = new Date();
  try {
    if (!existing) {
      const [invoice] = await Invoice.create([{ ...fields, operations: [operation] }], { writeConcern: { w: 'majority', wtimeout: 5000 } });
      return { invoice, replayed: false, operationVersion: revision };
    }
    const invoice = await Invoice.findOneAndUpdate({ _id: existing._id, revision: expectedVersion, status: 'DRAFT' },
      { $set: fields, $push: { operations: operation } }, { new: true, runValidators: true, writeConcern: { w: 'majority', wtimeout: 5000 } }).lean();
    if (invoice) return { invoice, replayed: false, operationVersion: revision };
  } catch (error) { if (error.code !== 11000) throw error; }
  const winner = await Invoice.findOne({ invoiceNumber: data.invoiceNumber }).lean();
  const retry = replay(winner, requestId, hash);
  if (retry) return retry;
  conflict('INVOICE_CONFLICT', 'Invoice number or version is already in use. Reload history; do not overwrite it.');
}
async function transitionInvoice(id, body) {
  const input = validateTransition(body);
  if (!/^[a-f0-9]{24}$/i.test(id)) throw new InvoiceError(400, 'INVALID_INVOICE', 'Invalid invoice ID.');
  await ready();
  const existing = await Invoice.findById(id).lean();
  if (!existing) throw new InvoiceError(404, 'INVOICE_NOT_FOUND', 'Invoice not found.');
  const hash = fingerprint({ action: 'STATUS', invoiceId: id.toLowerCase(), ...input });
  const known = replay(await Invoice.findOne({ 'operations.requestId': input.requestId }).lean(), input.requestId, hash);
  if (known) return known;
  const repeated = replay(existing, input.requestId, hash);
  if (repeated) return repeated;
  writable(existing, input.expectedVersion);
  const allowed = input.status === 'PAID' ? existing.status === 'GENERATED' : ['DRAFT', 'GENERATED', 'PAID'].includes(existing.status);
  if (!allowed) conflict('INVALID_TRANSITION', 'This invoice status transition is not allowed.');
  const operation = { requestId: input.requestId, hash, version: input.expectedVersion + 1, action: 'STATUS', status: input.status, reason: input.reason, at: new Date() };
  let invoice;
  try {
    invoice = await Invoice.findOneAndUpdate({ _id: id, revision: input.expectedVersion, status: existing.status },
      { $set: { status: input.status }, $inc: { revision: 1 }, $push: { operations: operation } },
      { new: true, runValidators: true, writeConcern: { w: 'majority', wtimeout: 5000 } }).lean();
  } catch (error) {
    if (error.code === 11000) conflict('IDEMPOTENCY_CONFLICT', 'This request ID is already used by another invoice.');
    throw error;
  }
  if (invoice) return { invoice, replayed: false, operationVersion: operation.version };
  const retry = replay(await Invoice.findById(id).lean(), input.requestId, hash);
  if (retry) return retry;
  conflict('VERSION_CONFLICT', 'Invoice changed elsewhere. Reload before continuing.');
}
module.exports = { saveInvoice, transitionInvoice };
