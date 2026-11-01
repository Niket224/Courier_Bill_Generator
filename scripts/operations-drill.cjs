const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const { randomUUID, randomBytes } = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const mongoose = require('../server/node_modules/mongoose');
const request = require('supertest');
const { assertTestMode } = require('../server/config/test-db');
assertTestMode(process.env);
async function main() {
  let mongo, runtime, temporary;
  const samples = {};
  const measure = async (name, action) => { const begin = performance.now(); const value = await action(); (samples[name] ||= []).push(Number((performance.now() - begin).toFixed(3))); return value; };
  try {
    mongo = await MongoMemoryReplSet.create({ binary: { version: '7.0.24' }, replSet: { count: 1, ip: '127.0.0.1' } });
    const database = `courier_test_${randomUUID().replaceAll('-', '')}`, uri = mongo.getUri(database);
    assert.match(uri, new RegExp(`^mongodb://127\\.0\\.0\\.1:[0-9]+/${database}\\?replicaSet=`));
    await mongoose.connect(uri); await require('../tests/fixtures/recovery.cjs').seed();
    const { authConfig, password } = require('../tests/fixtures/auth.cjs'); const config = { ...await authConfig(), port: 0 };
    const begin = () => require('../server/runtime').start(config, { connect: async () => { if (mongoose.connection.readyState !== 1) await mongoose.connect(uri); return mongoose; }, log: () => {} });
    runtime = await measure('startupMs', begin);
    const agent = request.agent(runtime.app);
    const challenge = await agent.get('/api/auth/csrf').expect(200);
    const login = await agent.post('/api/auth/login').set('X-CSRF-Token', challenge.body.csrfToken).send({ username: config.adminUsername, password }).expect(200);
    const csrf = login.body.csrfToken;
    const adapter = require('../mobile-bill-app/persistence'), Billing = require('../mobile-bill-app/billing');
    const fixture = structuredClone(require('../tests/fixtures/bill.json')); fixture.bill.invoiceNo = 'DRILL-100'; fixture.rates[0].baseRate = 90;
    fixture.shipments = Array.from({ length: 100 }, (_, i) => ({ ...fixture.shipments[0], id: `drill-${i}`, cno: `DRILL-${i}` }));
    const totals = Billing.invoice({ shipments: fixture.shipments.map(row => ({ awb: row.cno, weight: row.weight, pcs: 1, rate: fixture.rates[0] })), tax: { mode: 'SPLIT', fuelPct: 20, cgstPct: 9, sgstPct: 9, igstPct: 0 } }).totals;
    const payload = adapter.payload(fixture, 'DRAFT', () => ({ status: 'ok', amount: 90 }), () => totals);
    const draft = await measure('draftCreate100Ms', () => agent.post('/api/invoices/save').set('X-CSRF-Token', csrf).send({ ...payload, requestId: randomUUID(), expectedVersion: 0 }));
    assert.equal(draft.status, 201, draft.body.error);
    const final = await measure('finalize100Ms', () => agent.post('/api/invoices/save').set('X-CSRF-Token', csrf).send({ ...payload, status: 'GENERATED', requestId: randomUUID(), expectedVersion: draft.body.data.revision }).expect(200));
    const draftOnly = { ...payload, invoiceNumber: 'DRILL-UNFINISHED', snapshot: { ...payload.snapshot, bill: { ...payload.snapshot.bill, invoiceNo: 'DRILL-UNFINISHED' } }, requestId: randomUUID(), expectedVersion: 0 };
    await agent.post('/api/invoices/save').set('X-CSRF-Token', csrf).send(draftOnly).expect(201);
    for (let i = 0; i < 20; i++) {
      await measure('readinessMs', () => agent.get('/api/health/ready').expect(200));
      await measure('invoiceSearchMs', () => agent.get('/api/invoices/search?q=DRILL').expect(200));
      await measure('invoiceRead100Ms', () => agent.get(`/api/invoices/${final.body.data._id}`).expect(200));
    }
    const previous = runtime; await measure('gracefulShutdownMs', () => previous.shutdown()); runtime = await measure('restartMs', begin);
    const oldCookie = login.headers['set-cookie'].map(x => x.split(';')[0]).join('; ');
    await request(runtime.app).get('/api/auth/session').set('Cookie', oldCookie).expect(200);
    await request(runtime.app).get(`/api/invoices/${final.body.data._id}`).set('Cookie', oldCookie).expect(200);
    const client = mongoose.connection.getClient(), Recovery = require('../server/services/businessRecovery'), Archive = require('../server/services/backupArchive');
    const beforeRss = process.memoryUsage().rss;
    const manifest = await measure('consistentCaptureMs', () => Recovery.capture(client, database));
    const key = randomBytes(32); const encrypted = await measure('encryptMs', async () => Archive.seal(manifest, key));
    temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'courier-drill-')); const file = path.join(temporary, 'synthetic.cbackup');
    await measure('verifiedBackupFileMs', () => require('../server/services/backupFile').writeVerifiedArchive(file, encrypted, key));
    const checked = Archive.open(await fs.readFile(file), key);
    const restored = await measure('restoreAndVerifyMs', () => Recovery.restore(client, checked));
    const recovered = await client.db(restored.database).collection('invoices').findOne({ invoiceNumber: 'RECOVERY-GENERATED' });
    assert.equal(recovered.totalAmount, 63.72); assert.equal(recovered.calculationSnapshot.appliedRates[0].rate.baseRate, 45);
    assert.equal((await client.db(restored.database).collection('ratebooks').findOne({ _id: 'TEST' })).versions.length, 2);
    assert.throws(() => Archive.open(encrypted, randomBytes(32))); const bad = Buffer.from(encrypted); bad[40] ^= 1; assert.throws(() => Archive.open(bad, key));
    await assert.rejects(Recovery.restore(client, checked, { signal: AbortSignal.abort() }), /quarantined/);
    const explain = await mongoose.connection.db.collection('invoices').find({ invoiceNumber: 'DRILL-100' }).explain('executionStats');
    const query = { examined: explain.executionStats.totalDocsExamined, returned: explain.executionStats.nReturned, keysExamined: explain.executionStats.totalKeysExamined };
    const searchExplain = await mongoose.connection.db.collection('invoices').find({ $or: ['shipments.awb', 'shipperCode', 'clientName', 'invoiceNumber'].map(field => ({ [field]: { $regex: 'DRILL', $options: 'i' } })) }).explain('executionStats');
    query.searchDocsExamined = searchExplain.executionStats.totalDocsExamined; query.searchReturned = searchExplain.executionStats.nReturned;
    assert.equal(query.examined, 1);
    const summaries = Object.fromEntries(Object.entries(samples).map(([name, values]) => { const sorted = [...values].sort((a, b) => a - b); return [name, { samples: values.length, mean: Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(3)), p95: sorted[Math.ceil(sorted.length * .95) - 1], max: sorted.at(-1) }]; }));
    const report = { scope: 'Local synthetic disposable MongoDB replica set; not representative hosted staging or an RPO/RTO guarantee', node: process.version, platform: process.platform, measuredAt: new Date().toISOString(), result: 'PASS', records: manifest.inventory.map(({ name, count }) => ({ name, count })), archiveBytes: encrypted.length, metrics: summaries, processRssBytes: { beforeBackup: beforeRss, afterRestore: process.memoryUsage().rss }, indexedInvoiceLookup: query, verified: ['real isolated restore', 'wrong key rejected', 'corruption rejected', 'interrupted restore quarantined', 'session and invoice survive restart', 'historical amounts unchanged'], hostedStaging: 'BLOCKED: no designated hosted staging resources or credentials' };
    await fs.mkdir('outputs', { recursive: true }); await fs.writeFile('outputs/operations-drill.json', JSON.stringify(report, null, 2)); console.log(JSON.stringify(report, null, 2));
  } finally {
    if (runtime) await runtime.shutdown(); await mongoose.disconnect(); if (mongo) await mongo.stop();
    if (temporary) { const resolved = await fs.realpath(temporary); assert.equal(path.dirname(resolved), await fs.realpath(os.tmpdir())); assert.ok(path.basename(resolved).startsWith('courier-drill-')); await fs.rm(resolved, { recursive: true }); }
  }
}
main().catch(error => { console.error(`Disposable synthetic operations drill failed: ${error.message}`); process.exitCode = 1; });
