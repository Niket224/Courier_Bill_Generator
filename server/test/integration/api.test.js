const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { assertTestMode, assertOwnedUri } = require('../../config/test-db');
assertTestMode(process.env);
const { MongoMemoryServer } = require('mongodb-memory-server');
const mongoose = require('mongoose');
const request = require('supertest');
const { createApp } = require('../../app');
const Rate = require('../../models/Rate');
const Invoice = require('../../models/Invoice');
const app = createApp();
let mongo;
before(async (context) => {
  const dbName = `courier_test_${randomUUID().replaceAll('-', '')}`;
  mongo = await MongoMemoryServer.create({ binary: { version: '7.0.24' }, instance: { ip: '127.0.0.1', dbName } });
  if (context.signal.aborted) {
    await mongo.stop();
    throw new Error('Test database setup timed out.');
  }
  const uri = mongo.getUri(dbName);
  assertOwnedUri(uri, dbName);
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
  await Promise.all([Rate.init(), Invoice.init()]);
}, { timeout: 900000 });
after(async () => {
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
});
test('health, missing route, and input validation', async () => {
  assert.equal((await request(app).get('/api/health').expect(200)).body.status, 'ok');
  await request(app).get('/api/not-found').expect(404);
  await request(app).post('/api/rates/calculate').send({}).expect(400);
  await request(app).post('/api/invoices/save').send({}).expect(400);
  await request(app).post('/api/rates/parse-pdf').expect(400);
});
test('rate upsert, fallback priority, minimum weight and rounding', async () => {
  for (const [targetType, targetName, perKgRate] of [['DEFAULT', 'default', 50], ['REGION', 'east_india', 40], ['STATE', 'bihar', 30], ['CITY', 'patna', 15.25]]) {
    await request(app).post('/api/rates').send({ shipperCode: 'TEST', baseKg: 3, targetType, targetName, perKgRate }).expect(201);
  }
  for (const [destination, rule, amount] of [[' patna ', 'CITY', 45.75], ['gaya', 'STATE', 90], ['ranchi', 'REGION', 120], ['unknown', 'DEFAULT', 150]]) {
    const result = await request(app).post('/api/rates/calculate').send({ shipperCode: ' test ', destination, weight: 1 }).expect(200);
    assert.equal(result.body.matchedRule, rule);
    assert.equal(result.body.calculatedAmount, amount);
    assert.equal(result.body.chargedWeight, 3);
  }
  const excess = await request(app).post('/api/rates/calculate').send({ shipperCode: 'TEST', destination: 'patna', weight: 3.333 }).expect(200);
  assert.equal(excess.body.calculatedAmount, 50.83);
  await request(app).post('/api/rates').send({ shipperCode: 'TEST', targetType: 'CITY', targetName: 'patna', perKgRate: 16, baseKg: 3 }).expect(201);
  assert.equal((await request(app).get('/api/rates?shipperCode=test').expect(200)).body.count, 4);
  await request(app).post('/api/rates/calculate').send({ shipperCode: 'MISSING', destination: 'patna', weight: 1 }).expect(404);
});
test('invoice computation, upsert, pagination, search and retrieval', async () => {
  const payload = { invoiceNumber: ' test-100 ', shipperCode: ' test ', clientName: 'Synthetic Customer',
    invoiceDate: '2026-01-02', shipments: [{ cno: 'TEST-AWB', date: '2026-01-02', weight: 2, amount: 100 }] };
  const saved = await request(app).post('/api/invoices/save').send(payload).expect(201);
  assert.equal(saved.body.data.invoiceNumber, 'TEST-100');
  assert.equal(saved.body.data.subtotal, 100);
  assert.equal(saved.body.data.taxAmount, 18);
  assert.equal(saved.body.data.totalAmount, 118);
  assert.equal(saved.body.data.shipments[0].awb, 'TEST-AWB');
  await request(app).post('/api/invoices/save').send({ ...payload, status: 'PAID' }).expect(201);
  assert.equal(await Invoice.countDocuments(), 1);
  const list = await request(app).get('/api/invoices?shipperCode=test&status=paid&limit=1').expect(200);
  assert.equal(list.body.pagination.total, 1);
  const search = await request(app).get('/api/invoices/search?q=TEST-AWB&startDate=2026-01-01&endDate=2026-01-31').expect(200);
  assert.equal(search.body.count, 1);
  await request(app).get('/api/invoices/TEST-100').expect(200);
  await request(app).get(`/api/invoices/${saved.body.data._id}`).expect(200);
  await request(app).get('/api/invoices/MISSING').expect(404);
});
