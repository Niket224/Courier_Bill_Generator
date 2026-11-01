const { randomUUID } = require('node:crypto');
const Archive = require('./backupArchive');
const models = () => [require('../models/Client'), require('../models/Invoice'), require('../models/Shipment').Shipment, require('../models/Rate'), require('../models/RateCardDraft'), require('../models/RateBook')];
async function capture(client, databaseName, { signal } = {}) {
  const db = client.db(databaseName); const session = client.startSession();
  const collections = {}, indexes = {};
  try {
    await assertRecoveredDatabase(db);
    const names = (await db.listCollections({}, { nameOnly: true }).toArray()).map(x => x.name);
    if (names.some(n => ![...Archive.COLLECTIONS, 'sessions', '_recovery'].includes(n))) throw new Error('Unknown collection: audit the backup inventory before continuing.');
    for (const name of Archive.COLLECTIONS) indexes[name] = names.includes(name) ? await db.collection(name).listIndexes().toArray() : [];
    session.startTransaction({ readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' }, maxCommitTimeMS: 10000 });
    let bytes = 0;
    for (const name of Archive.COLLECTIONS) {
      if (signal?.aborted) throw new Error('Backup interrupted. No completed archive created.');
      collections[name] = [];
      for await (const record of db.collection(name).find({}, { session, maxTimeMS: 30000 })) {
        if (signal?.aborted) throw new Error('Backup interrupted.');
        bytes += Buffer.byteLength(Archive.encode(record));
        if (bytes > Archive.MAX_BYTES) throw new Error('Backup exceeds the logical archive limit.');
        collections[name].push(record);
      }
    }
    const manifest = Archive.createManifest(collections, indexes);
    await session.commitTransaction(); return manifest;
  } finally { if (session.inTransaction()) await session.abortTransaction(); await session.endSession(); }
}
function assertRestoreUri(uri) {
  if (typeof uri !== 'string' || !/^mongodb:\/\/127\.0\.0\.1:[1-9]\d{0,4}\/?$/.test(uri)) throw new Error('Restore requires an explicit isolated loopback MongoDB URI with no database, credentials or options. Production targets are forbidden.');
}
async function restore(client, manifest, { signal, onCollection } = {}) {
  if (client.options.credentials || client.options.hosts?.length !== 1 || client.options.hosts[0].host !== '127.0.0.1') throw new Error('Restore client must target isolated loopback MongoDB without credentials.');
  Archive.validateManifest(manifest);
  const name = `courier_restore_${randomUUID().replaceAll('-', '')}`;
  const db = client.db(name);
  // Never reuse, merge or drop an existing database.
  if ((await db.listCollections().toArray()).length) throw new Error('Restore target is not empty.');
  await db.collection('_recovery').insertOne({ _id: 'state', status: 'RESTORING', startedAt: new Date() });
  try {
    for (const item of manifest.inventory) {
      if (signal?.aborted) throw new Error('Restore interrupted.');
      const target = await db.createCollection(item.name);
      const rows = manifest.collections[item.name]; if (rows.length) await target.insertMany(rows, { ordered: true });
      for (const index of item.indexes) {
        if (index.name === '_id_') continue;
        const { key, name: indexName, unique, sparse, partialFilterExpression, expireAfterSeconds, collation } = index;
        await target.createIndex(key, { name: indexName, ...(unique !== undefined ? { unique } : {}), ...(sparse !== undefined ? { sparse } : {}), ...(partialFilterExpression ? { partialFilterExpression } : {}), ...(expireAfterSeconds !== undefined ? { expireAfterSeconds } : {}), ...(collation ? { collation } : {}) });
      }
      await onCollection?.(item.name);
    }
    // Ensure current application indexes even when an older source omitted them.
    for (const model of models()) for (const [key, opts] of model.schema.indexes()) await db.collection(model.collection.name).createIndex(key, opts);
    const actual = {};
    for (const item of manifest.inventory) {
      const rows = await db.collection(item.name).find().toArray();
      // Compare by ID; natural database ordering is not a guarantee.
      const order = new Map(manifest.collections[item.name].map((row, i) => [String(row._id), i])); rows.sort((a, b) => order.get(String(a._id)) - order.get(String(b._id)));
      if (rows.length !== item.count || Archive.digest(rows) !== item.sha256) throw new Error('Restored counts or record checksums differ.');
      actual[item.name] = rows;
    }
    Archive.validateRecords(actual);
    if (signal?.aborted) throw new Error('Restore interrupted.');
    await db.collection('_recovery').updateOne({ _id: 'state', status: 'RESTORING' }, { $set: { status: 'VERIFIED', verifiedAt: new Date(), sourceCreatedAt: manifest.createdAt } });
    return { database: name, status: 'VERIFIED', counts: manifest.inventory.map(({ name, count }) => ({ name, count })) };
  } catch {
    await db.collection('_recovery').updateOne({ _id: 'state' }, { $set: { status: 'FAILED' } }).catch(() => {});
    throw new Error(`Restore failed. Database ${name} is quarantined; do not use it. Retry into a new database after resolving the failure.`);
  }
}
async function assertRecoveredDatabase(db) {
  const marker = await db.collection('_recovery').findOne({ _id: 'state' });
  if (marker && marker.status !== 'VERIFIED' || !marker && db.databaseName.startsWith('courier_restore_')) throw new Error('Database restore is incomplete. Application startup refused.');
}
module.exports = { capture, restore, assertRestoreUri, assertRecoveredDatabase };
