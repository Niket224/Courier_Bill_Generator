const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, randomBytes } = require('node:crypto');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const request = require('supertest');
const Archive = require('../../services/backupArchive');
const Recovery = require('../../services/businessRecovery');
const { assertTestMode } = require('../../config/test-db');
assertTestMode(process.env);
let mongo, client, dbName, original, manifest;
before(async () => {
  dbName = `courier_test_${randomUUID().replaceAll('-', '')}`;
  mongo = await MongoMemoryReplSet.create({ binary: { version: '7.0.24' }, replSet: { count: 1, ip: '127.0.0.1' } });
  const uri = mongo.getUri(dbName);
  assert.match(uri, new RegExp(`^mongodb://127\\.0\\.0\\.1:[0-9]+/${dbName}\\?replicaSet=`));
  await mongoose.connect(uri); client = mongoose.connection.getClient();
  original = await require('../../../tests/fixtures/recovery.cjs').seed();
  manifest = await Recovery.capture(client, dbName);
}, { timeout: 900000 });
after(async () => { await mongoose.disconnect(); if (mongo) await mongo.stop(); });
test('consistent backup includes several invoices/clients, shipments and multiple approved rate versions but excludes sessions', () => {
  assert.equal(manifest.collections.invoices.length, 4); assert.equal(manifest.collections.clients.length, 2);
  assert.equal(manifest.collections.shipments.length, 1); assert.equal(manifest.collections.ratebooks[0].versions.length, 2);
  assert.equal(manifest.collections.sessions, undefined);
});
test('encrypted full restore into a new empty database verifies exact records, indexes, status, tax and correction history', async () => {
  const key = randomBytes(32); const restored = await Recovery.restore(client, Archive.open(Archive.seal(manifest, key), key));
  assert.equal(restored.status, 'VERIFIED'); const db = client.db(restored.database);
  await Recovery.assertRecoveredDatabase(db);
  for (const expected of original) {
    const actual = await db.collection('invoices').findOne({ _id: expected._id });
    assert.deepEqual(actual, expected); assert.equal(actual.totalAmount, 63.72);
    assert.equal(actual.calculationSnapshot.appliedRates[0].rate.baseRate, 45);
  }
  assert.equal(await db.collection('sessions').countDocuments(), 0);
  const indexes = await db.collection('invoices').listIndexes().toArray(); assert.ok(indexes.some(i => i.unique && i.key.invoiceNumber === 1));
  assert.ok(indexes.some(i => i.unique && i.key['operations.requestId'] === 1));
  assert.equal((await db.collection('ratebooks').findOne({ _id: 'TEST' })).activeVersion, 2);
});
test('interrupted backup fails without a completed manifest', async () => {
  await assert.rejects(Recovery.capture(client, dbName, { signal: AbortSignal.abort() }), /interrupted/);
});
test('failed partial restore is quarantined and startup refuses it', async () => {
  let failedName;
  await assert.rejects(Recovery.restore(client, manifest, { onCollection() { throw new Error('synthetic disk/network outage'); } }), error => {
    failedName = /courier_restore_[a-f0-9]{32}/.exec(error.message)[0]; return true;
  });
  await assert.rejects(Recovery.assertRecoveredDatabase(client.db(failedName)), /incomplete/);
  assert.equal((await client.db(failedName).collection('_recovery').findOne({ _id: 'state' })).status, 'FAILED');
  await assert.rejects(Recovery.capture(client, failedName), /incomplete/);
  await assert.rejects(Recovery.assertRecoveredDatabase(client.db(`courier_restore_${randomUUID().replaceAll('-', '')}`)), /incomplete/);
});
test('restore rejects changed counts, incompatible schemas and broken invoice/rate references before writing', async () => {
  for (const mutate of [m => m.version = 99, m => m.inventory[0].count++, m => m.collections.invoices[0].totalAmount++]) {
    const bad = Archive.open(Archive.seal(manifest, Buffer.alloc(32, 3)), Buffer.alloc(32, 3)); mutate(bad);
    await assert.rejects(Recovery.restore(client, bad));
  }
  const bad = { ...manifest.collections, ratebooks: [] }; assert.throws(() => Archive.createManifest(bad, {}));
});
test('loss of source records can be recovered without recalculating issued invoices', async () => {
  const copy = await Recovery.restore(client, manifest);
  // Delete only our synthetic source after a verified isolated copy exists.
  await client.db(dbName).collection('invoices').deleteOne({ invoiceNumber: 'RECOVERY-CANCELLED' });
  const recovered = await Recovery.restore(client, manifest);
  assert.notEqual(copy.database, recovered.database);
  const invoice = await client.db(recovered.database).collection('invoices').findOne({ invoiceNumber: 'RECOVERY-CANCELLED' });
  assert.equal(invoice.status, 'CANCELLED'); assert.equal(invoice.snapshot.totals.final, 63.72);
});
test('browser decryption key requires an authenticated session and valid CSRF; backup has no HTTP surface', async () => {
  const config = await require('../../../tests/fixtures/auth.cjs').authConfig();
  const store = require('../../security/store').createSessionStore(Promise.resolve(client), config);
  const app = require('../../app').createApp(config, { sessionStore: store }); const agent = request.agent(app);
  await request(app).post('/api/privacy/draft-key').expect(401);
  const challenge = await agent.get('/api/auth/csrf');
  const login = await agent.post('/api/auth/login').set('X-CSRF-Token', challenge.body.csrfToken).send({ username: config.adminUsername, password: require('../../../tests/fixtures/auth.cjs').password });
  await agent.post('/api/privacy/draft-key').expect(403);
  const key = await agent.post('/api/privacy/draft-key').set('X-CSRF-Token', login.body.csrfToken).expect(200);
  assert.equal(key.body.key, config.browserDraftKey); assert.equal(key.headers['cache-control'], 'no-store');
  await request(app).post('/api/backup').expect(404);
});
test('40-version guard preserves all publications, rejects a 41st and cannot delete rollback history', async () => {
  const fixture = require('../../../tests/fixtures/rate-card.cjs');
  const Book = require('../../models/RateBook'); const { publish } = require('../../services/rateCards');
  for (let i = 0; i < 40; i++) await fixture.publishFixture(fixture.card('RETENTION'));
  const before = await Book.findById('RETENTION').lean();
  await assert.rejects(fixture.publishFixture(fixture.card('RETENTION')), /limit/);
  await assert.rejects(publish({ requestId: randomUUID(), shipperCode: 'RETENTION', expectedRevision: 40, approved: true, sourceVersion: 1 }, 'test-admin', true), /limit/);
  const after = await Book.findById('RETENTION').lean(); assert.deepEqual(after, before); assert.equal(after.versions[0].version, 1);
});
