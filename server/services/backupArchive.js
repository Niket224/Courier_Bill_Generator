const { randomBytes, createCipheriv, createDecipheriv, createHash } = require('node:crypto');
const { BSON } = require('mongoose').mongo;
const EJSON = BSON.EJSON;
const COLLECTIONS = ['clients', 'invoices', 'shipments', 'rates', 'ratecarddrafts', 'ratebooks'];
const MAX_BYTES = 64 * 1024 * 1024;
const fail = () => { throw new Error('Backup is corrupt, incompatible, incomplete, or inconsistent. Nothing was restored.'); };
const encode = value => EJSON.stringify(value, { relaxed: false });
const digest = value => createHash('sha256').update(encode(value)).digest('hex');
function keyBytes(key) { if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error('A separate 32-byte backup key is required.'); return key; }
function safeJSON(text) {
  return JSON.parse(text, (key, value) => { if (['__proto__', 'constructor', 'prototype'].includes(key)) fail(); return value; });
}
function validateRecords(collections) {
  if (!collections || Object.keys(collections).sort().join() !== [...COLLECTIONS].sort().join()) fail();
  const ids = {};
  for (const name of COLLECTIONS) {
    const records = collections[name]; if (!Array.isArray(records) || records.length > 100000) fail();
    ids[name] = new Set();
    for (const row of records) {
      if (!row || typeof row !== 'object' || !row._id || ids[name].has(String(row._id))) fail();
      ids[name].add(String(row._id));
    }
  }
  for (const row of collections.clients) if (typeof row.shipperCode !== 'string' || typeof row.name !== 'string' || !row.shipperCode || !row.name) fail();
  for (const draft of collections.ratecarddrafts) {
    if (!Number.isSafeInteger(draft.revision) || draft.revision < 1 || draft.card?.shipperCode !== draft.shipperCode) fail();
    require('../../mobile-bill-app/rate-card').normalize(draft.card);
  }
  for (const book of collections.ratebooks) {
    if (!Number.isInteger(book.revision) || book.revision < 1 || book.revision > 40 || book.activeVersion !== book.revision || book.versions?.length !== book.revision) fail();
    for (const [i, version] of book.versions.entries()) {
      const draft = collections.ratecarddrafts.find(d => String(d._id) === String(version.draftId));
      if (version.version !== i + 1 || !version.approvedBy || !draft || draft.shipperCode !== book._id || version.draftRevision > draft.revision || version.draftRevision < 1) fail();
      require('../../mobile-bill-app/rate-card').normalize(version.card);
      if (version.card.shipperCode !== book._id) fail();
    }
  }
  for (const row of collections.shipments) if (row.invoiceId && !ids.invoices.has(String(row.invoiceId))) fail();
  const numbers = new Set(collections.invoices.map(i => i.invoiceNumber));
  if (numbers.size !== collections.invoices.length) fail();
  for (const invoice of collections.invoices) {
    if (!invoice.invoiceNumber || !invoice.shipperCode || !['DRAFT', 'GENERATED', 'PAID', 'CANCELLED'].includes(invoice.status) || !Array.isArray(invoice.shipments)) fail();
    if (invoice.client && !ids.clients.has(String(invoice.client))) fail();
    if (invoice.correctionOf && !numbers.has(invoice.correctionOf) && !ids.invoices.has(invoice.correctionOf)) fail();
    for (const field of ['subtotal', 'taxAmount', 'totalAmount']) if (!Number.isFinite(invoice[field]) || invoice[field] < 0) fail();
    if (!(invoice.invoiceDate instanceof Date) || !Number.isFinite(invoice.invoiceDate.getTime()) || invoice.schemaVersion !== undefined && ![2, 3].includes(invoice.schemaVersion)) fail();
    for (const shipment of invoice.shipments) {
      if (typeof shipment.awb !== 'string' || !shipment.awb || !['amount', 'actualWeight', 'chargedWeight'].every(k => Number.isFinite(shipment[k]) && shipment[k] >= 0)) fail();
    }
    const snapshot = invoice.calculationSnapshot;
    if (snapshot) {
      const paise = snapshot.paise;
      if (!paise || !Number.isSafeInteger(paise.final) || require('../../mobile-bill-app/billing').money(invoice.totalAmount) !== paise.final || paise.subtotal + paise.cgst + paise.sgst + paise.igst !== paise.final) fail();
      if (snapshot.appliedRates?.length !== invoice.shipments.length) fail();
      const money = require('../../mobile-bill-app/billing').money;
      if (money(invoice.subtotal) !== paise.subtotal || money(invoice.taxAmount) !== paise.cgst + paise.sgst + paise.igst || snapshot.lines?.length !== invoice.shipments.length || snapshot.lines.some((line, i) => line.amountPaise !== money(invoice.shipments[i].amount))) fail();
      if (invoice.snapshot && money(invoice.snapshot.totals?.final) !== paise.final) fail();
      for (const applied of snapshot.appliedRates) {
        if (applied.manualOverride) continue;
        const match = /^(.*):(\d+):(\d+)$/.exec(applied.rateId || '');
        // Pre-Phase-4 ObjectIds refer to preserved legacy rate records.
        if (!match) { if (!ids.rates.has(String(applied.rateId))) fail(); continue; }
        const book = collections.ratebooks.find(b => b._id === match[1]);
        const rate = book?.versions[Number(match[2]) - 1]?.card.rates[Number(match[3])];
        if (!rate || applied.rateRevision !== Number(match[2]) || ['baseKg', 'baseRate', 'perKgRate'].some(k => rate[k] !== applied.rate?.[k])) fail();
      }
    }
  }
  return true;
}
function createManifest(collections, indexes, date = new Date()) {
  validateRecords(collections);
  return { format: 'courier-business-backup', version: 1, applicationVersion: '1.0.0', schemaVersion: 5, createdAt: date.toISOString(),
    inventory: COLLECTIONS.map(name => ({ name, count: collections[name].length, sha256: digest(collections[name]), indexes: indexes[name] || [] })), collections };
}
function validateManifest(manifest) {
  if (manifest?.format !== 'courier-business-backup' || manifest.version !== 1 || manifest.schemaVersion !== 5 || manifest.applicationVersion !== '1.0.0' || !/^\d{4}-\d\d-\d\dT/.test(manifest.createdAt) || !Number.isFinite(Date.parse(manifest.createdAt)) || manifest.inventory?.length !== COLLECTIONS.length) fail();
  if (new Set(manifest.inventory.map(x => x.name)).size !== COLLECTIONS.length) fail();
  for (const name of COLLECTIONS) {
    const item = manifest.inventory.find(x => x.name === name);
    if (!item || !Array.isArray(item.indexes) || item.count !== manifest.collections?.[name]?.length || item.sha256 !== digest(manifest.collections[name])) fail();
  }
  validateRecords(manifest.collections); return manifest;
}
function seal(manifest, key) {
  validateManifest(manifest); const plain = Buffer.from(encode(manifest));
  if (plain.length > MAX_BYTES) throw new Error('Backup exceeds the 64 MiB logical archive limit. Use an approved native snapshot process.');
  const iv = randomBytes(12); const header = Buffer.from('COURIER-BACKUP-1\n');
  const cipher = createCipheriv('aes-256-gcm', keyBytes(key), iv); cipher.setAAD(header);
  const bytes = Buffer.concat([header, iv, cipher.update(plain), cipher.final(), cipher.getAuthTag()]); plain.fill(0); return bytes;
}
function open(bytes, key) {
  keyBytes(key);
  try {
    const header = Buffer.from('COURIER-BACKUP-1\n');
    if (!Buffer.isBuffer(bytes) || bytes.length < header.length + 28 || bytes.length > MAX_BYTES + 100 || !bytes.subarray(0, header.length).equals(header)) fail();
    const decipher = createDecipheriv('aes-256-gcm', key, bytes.subarray(header.length, header.length + 12)); decipher.setAAD(header); decipher.setAuthTag(bytes.subarray(-16));
    const plain = Buffer.concat([decipher.update(bytes.subarray(header.length + 12, -16)), decipher.final()]);
    try { const text = plain.toString('utf8'); safeJSON(text); return validateManifest(EJSON.parse(text, { relaxed: true })); }
    finally { plain.fill(0); }
  } catch { fail(); }
}
module.exports = { COLLECTIONS, MAX_BYTES, encode, digest, createManifest, validateManifest, validateRecords, seal, open, safeJSON };
