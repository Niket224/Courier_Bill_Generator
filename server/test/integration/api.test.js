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
const rateFixtures = require('../../../tests/fixtures/rate-card.cjs');
const { createSessionStore } = require('../../security/store');
const { authConfig, password } = require('../../../tests/fixtures/auth.cjs');
let app, store, config, agent, csrfToken;
const api = {
  get: (url) => agent.get(url),
  post: (url) => agent.post(url).set('X-CSRF-Token', csrfToken)
};
let mongo;
let testUri;
before(async (context) => {
  const dbName = `courier_test_${randomUUID().replaceAll('-', '')}`;
  mongo = await MongoMemoryServer.create({ binary: { version: '7.0.24' }, instance: { ip: '127.0.0.1', dbName } });
  if (context.signal.aborted) {
    await mongo.stop();
    throw new Error('Test database setup timed out.');
  }
  const uri = mongo.getUri(dbName);
  testUri = uri;
  assertOwnedUri(uri, dbName);
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000 });
  await Promise.all([Rate.init(), Invoice.init()]);
  config = await authConfig();
  store = createSessionStore(Promise.resolve(mongoose.connection.getClient()), config);
  // Tests intentionally construct many apps against the same disposable store.
  store.setMaxListeners(100);
  await store.collectionP;
  app = createApp(config, { sessionStore: store });
  agent = request.agent(app);
  const challenge = await agent.get('/api/auth/csrf').expect(200);
  const login = await agent.post('/api/auth/login').set('X-CSRF-Token', challenge.body.csrfToken)
    .send({ username: config.adminUsername, password }).expect(200);
  csrfToken = login.body.csrfToken;
}, { timeout: 900000 });
after(async () => {
  await mongoose.disconnect();
  if (mongo) await mongo.stop();
});
test('health, missing route, and input validation', async () => {
  assert.equal((await api.get('/api/health').expect(200)).body.status, 'ok');
  await api.get('/api/not-found').expect(404);
  await api.post('/api/rates/calculate').send({}).expect(400);
  await api.post('/api/invoices/save').send({}).expect(400);
  await api.post('/api/rates/parse-pdf').expect(400);
});
test('legacy rate reads, fallback priority, minimum weight and rounding', async () => {
  for (const [targetType, targetName, perKgRate] of [['DEFAULT', 'default', 50], ['REGION', 'east_india', 40], ['STATE', 'bihar', 30], ['CITY', 'patna', 15.25]]) {
    await Rate.create({ shipperCode: 'TEST', baseKg: 3, targetType, targetName, perKgRate });
  }
  for (const [destination, rule, amount] of [[' patna ', 'CITY', 45.75], ['gaya', 'STATE', 90], ['ranchi', 'REGION', 120], ['unknown', 'DEFAULT', 150]]) {
    const result = await api.post('/api/rates/calculate').send({ shipperCode: ' test ', destination, weight: 1 }).expect(200);
    assert.equal(result.body.matchedRule, rule);
    assert.equal(result.body.calculatedAmount, amount);
    assert.equal(result.body.chargedWeight, 3);
  }
  const excess = await api.post('/api/rates/calculate').send({ shipperCode: 'TEST', destination: 'patna', weight: 3.333 }).expect(200);
  assert.equal(excess.body.calculatedAmount, 50.83);
  await Rate.updateOne({ shipperCode: 'TEST', targetType: 'CITY', targetName: 'patna' }, { perKgRate: 16 }); // isolated legacy fixture only
  assert.equal((await api.get('/api/rates?shipperCode=test').expect(200)).body.count, 4);
  await api.post('/api/rates/calculate').send({ shipperCode: 'MISSING', destination: 'patna', weight: 1 }).expect(404);
});
test('invoice computation, controlled lifecycle, pagination, search and retrieval', async () => {
  const payload = { requestId: randomUUID(), expectedVersion: 0, status: 'GENERATED', invoiceNumber: ' test-100 ', shipperCode: ' test ', clientName: 'Synthetic Customer',
    subtotal: 100, taxRate: 18, taxAmount: 18, totalAmount: 118, tax: { mode: 'SPLIT', cgstPct: 9, sgstPct: 9 }, invoiceDate: '2026-01-02', shipments: [{ cno: 'TEST-AWB', date: '2026-01-02', weight: 2, manualAmount: 100, amount: 100 }] };
  const saved = await api.post('/api/invoices/save').send(payload).expect(201);
  assert.equal(saved.body.data.invoiceNumber, 'TEST-100');
  assert.equal(saved.body.data.subtotal, 100);
  assert.equal(saved.body.data.taxAmount, 18);
  assert.equal(saved.body.data.totalAmount, 118);
  assert.equal(saved.body.data.shipments[0].awb, 'TEST-AWB');
  await api.post(`/api/invoices/${saved.body.data._id}/status`).send({ requestId: randomUUID(), expectedVersion: 1, status: 'PAID', reason: 'Synthetic payment reference' }).expect(200);
  assert.equal(await Invoice.countDocuments(), 1);
  const list = await api.get('/api/invoices?shipperCode=test&status=paid&limit=1').expect(200);
  assert.equal(list.body.pagination.total, 1);
  const search = await api.get('/api/invoices/search?q=TEST-AWB&startDate=2026-01-01&endDate=2026-01-31').expect(200);
  assert.equal(search.body.count, 1);
  await api.get('/api/invoices/TEST-100').expect(200);
  await api.get(`/api/invoices/${saved.body.data._id}`).expect(200);
  await api.get('/api/invoices/MISSING').expect(404);
});

function fresh(overrides = {}, limits = {}, ai = {}) {
  return createApp({ ...config, ...overrides }, { sessionStore: store, limits, ...ai });
}
async function signIn(target = fresh(), credentials = { username: 'test-admin', password }) {
  const client = request.agent(target);
  const challenge = await client.get('/api/auth/csrf').expect(200);
  const response = await client.post('/api/auth/login').set('X-CSRF-Token', challenge.body.csrfToken).send(credentials);
  return { client, response, token: response.body.csrfToken, challenge };
}
test('successful admin login, session check, fixation prevention and cookie flags', async () => {
  const { client, response, challenge } = await signIn();
  assert.equal(response.status, 200);
  assert.notEqual(response.headers['set-cookie'][0].split(';')[0], challenge.headers['set-cookie'][0].split(';')[0]);
  assert.notEqual(response.body.csrfToken, challenge.body.csrfToken);
  assert.match(response.headers['set-cookie'][0], /HttpOnly/);
  assert.match(response.headers['set-cookie'][0], /SameSite=Lax/);
  assert.ok(!JSON.stringify(response.body).includes(password));
  assert.equal((await client.get('/api/auth/session').expect(200)).body.authenticated, true);
});
test('incorrect password and unknown user have the same generic error', async () => {
  const wrong = await signIn(fresh(), { username: 'test-admin', password: 'wrong-password' });
  const unknown = await signIn(fresh(), { username: 'unknown', password });
  assert.equal(wrong.response.status, 401);
  assert.equal(unknown.response.status, 401);
  assert.deepEqual(wrong.response.body, unknown.response.body);
});
test('missing or malformed login credentials return 400', async () => {
  for (const credentials of [{}, { username: 'test-admin' }, { username: {}, password }, { username: 'test-admin', password: ['bad'] }]) {
    assert.equal((await signIn(fresh(), credentials)).response.status, 400);
  }
});
test('invalid session and unsigned cookies return 401', async () => {
  await request(app).get('/api/auth/session').set('Cookie', 'courier.sid=forged').expect(401);
  await request(app).get('/api/invoices').set('Cookie', 'courier.sid=s%3Afake.invalid').expect(401);
});
test('expired session is rejected before MongoDB TTL cleanup', async () => {
  const { response } = await signIn();
  const cookie = response.headers['set-cookie'][0].split(';')[0];
  const sid = decodeURIComponent(cookie.split('=')[1]).slice(2).split('.')[0];
  const id = require('node:crypto').createHash('sha256').update(sid).digest('hex');
  const collection = await store.collectionP;
  const row = await collection.findOne({ _id: id });
  const data = JSON.parse(row.session);
  data.expiresAt = Date.now() - 1;
  await collection.updateOne({ _id: id }, { $set: { session: JSON.stringify(data) } });
  await request(fresh()).get('/api/invoices').set('Cookie', cookie).expect(401);
});
test('sessions survive app recreation but credential changes revoke them', async () => {
  const { response } = await signIn();
  const cookie = response.headers['set-cookie'][0].split(';')[0];
  await request(fresh()).get('/api/auth/session').set('Cookie', cookie).expect(200);
  await request(fresh({ adminUsername: 'changed-admin' })).get('/api/auth/session').set('Cookie', cookie).expect(401);
});
test('logout destroys session and old cookies cannot be replayed', async () => {
  const target = fresh();
  const { client, response, token } = await signIn(target);
  const cookie = response.headers['set-cookie'][0].split(';')[0];
  const logout = await client.post('/api/auth/logout').set('X-CSRF-Token', token).expect(200);
  assert.match(logout.headers['set-cookie'][0], /Expires=Thu, 01 Jan 1970/);
  await request(target).get('/api/auth/session').set('Cookie', cookie).expect(401);
});
for (const [method, url] of [['get', '/api/invoices'], ['get', '/api/invoices/search'], ['get', '/api/invoices/TEST-100'],
  ['post', '/api/invoices/save'], ['get', '/api/rates'], ['post', '/api/rates'],
  ['post', '/api/rates/calculate'], ['post', '/api/rates/parse-pdf']]) {
  test(`unauthenticated ${method.toUpperCase()} ${url} returns 401`, async () => {
    await request(app)[method](url).expect(401);
  });
}
test('login and private writes require session-bound CSRF tokens', async () => {
  const target = fresh();
  await request(target).post('/api/auth/login').send({ username: 'test-admin', password }).expect(403);
  const { client, token, challenge } = await signIn(target);
  await client.post('/api/invoices/save').send({}).expect(403);
  await client.post('/api/rates').set('X-CSRF-Token', 'f'.repeat(64)).send({}).expect(403);
  await client.post('/api/auth/logout').set('X-CSRF-Token', challenge.body.csrfToken).expect(403);
  const other = await signIn(target);
  await other.client.post('/api/rates').set('X-CSRF-Token', token).send({}).expect(403);
  await client.post('/api/invoices/save').set('X-CSRF-Token', token).send({}).expect(400);
});
test('explicit allowed CORS origin supports credentialed preflight', async () => {
  const response = await request(app).options('/api/invoices/save').set('Origin', 'https://billing.example.test')
    .set('Access-Control-Request-Method', 'POST').set('Access-Control-Request-Headers', 'Content-Type,X-CSRF-Token').expect(204);
  assert.equal(response.headers['access-control-allow-origin'], 'https://billing.example.test');
  assert.equal(response.headers['access-control-allow-credentials'], 'true');
});
test('disallowed origins including arbitrary Vercel domains and null are rejected', async () => {
  for (const origin of ['https://evil.example', 'https://arbitrary.vercel.app', 'null']) {
    const response = await request(app).get('/api/health').set('Origin', origin).expect(403);
    assert.equal(response.headers['access-control-allow-origin'], undefined);
    assert.ok(!JSON.stringify(response.body).includes(origin));
  }
});
test('authentication rate limit blocks repeated attempts', async () => {
  const target = fresh({}, { login: 2 });
  const client = request.agent(target);
  const challenge = await client.get('/api/auth/csrf');
  for (let i = 0; i < 2; i++) await client.post('/api/auth/login').set('X-CSRF-Token', challenge.body.csrfToken).send({}).expect(400);
  const blocked = await client.post('/api/auth/login').set('X-CSRF-Token', challenge.body.csrfToken).send({}).expect(429);
  assert.ok(blocked.headers['retry-after']);
});
test('PDF upload is authenticated, CSRF protected and rate limited without Gemini calls', async () => {
  const { client, token } = await signIn(fresh({}, { pdf: 2 }));
  await client.post('/api/rates/parse-pdf').expect(403);
  await client.post('/api/rates/parse-pdf').set('X-CSRF-Token', token).expect(400);
  await client.post('/api/rates/parse-pdf').set('X-CSRF-Token', token)
    .attach('pdf', Buffer.from('synthetic text'), { filename: 'test.txt', contentType: 'text/plain' }).expect(400);
  await client.post('/api/rates/parse-pdf').set('X-CSRF-Token', token).expect(429);
});
test('malformed and oversized JSON return safe errors', async () => {
  const bad = await request(app).post('/api/auth/login').set('Content-Type', 'application/json').send('{"secret":"do-not-echo",').expect(400);
  assert.equal(bad.body.error, 'Invalid request.');
  await request(app).post('/api/auth/login').send({ password: 'x'.repeat(5000) }).expect(413);
  await request(app).post('/api/invoices/save').send({ notes: 'x'.repeat(1024 * 1024) }).expect(413);
});
test('security headers, no-store, and production Secure cookies', async () => {
  const response = await request(app).get('/api/health').expect(200);
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
  assert.ok(response.headers['content-security-policy']);
  assert.equal(response.headers['x-frame-options'], 'SAMEORIGIN');
  assert.equal(response.headers['cache-control'], 'no-store');
  assert.equal(response.headers['x-powered-by'], undefined);
  const secure = await request(fresh({ nodeEnv: 'production', trustProxy: 'loopback' }))
    .get('/api/auth/csrf').set('X-Forwarded-Proto', 'https').expect(200);
  assert.match(secure.headers['set-cookie'][0], /^__Host-courier.sid=/);
  assert.match(secure.headers['set-cookie'][0], /; Secure/);
  assert.match(secure.headers['set-cookie'][0], /; HttpOnly/);
  assert.ok(!secure.headers['set-cookie'][0].includes('Domain='));
});
test('production API errors do not leak secrets or stack traces', async () => {
  const { client } = await signIn();
  const find = Rate.find;
  Rate.find = () => { throw new Error('secret-password mongodb://private-host/customer-document'); };
  try {
    const response = await client.get('/api/rates').expect(500);
    assert.deepEqual(response.body, { success: false, error: 'Unable to complete request. Please try again.' });
  } finally { Rate.find = find; }
});
test('single-account limiter also applies across independent login sessions', async () => {
  const target = fresh({}, { loginGlobal: 1 });
  assert.equal((await signIn(target, {})).response.status, 400);
  assert.equal((await signIn(target, {})).response.status, 429);
});
test('password hashing concurrency is bounded for the single operator', async () => {
  const target = fresh();
  const clients = [request.agent(target), request.agent(target)];
  const challenges = await Promise.all(clients.map((client) => client.get('/api/auth/csrf')));
  const responses = await Promise.all(clients.map((client, i) => client.post('/api/auth/login')
    .set('X-CSRF-Token', challenges[i].body.csrfToken).send({ username: 'test-admin', password })));
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 429]);
});
test('upgraded upload middleware rejects excess files and oversized PDF safely', async () => {
  const { client, token } = await signIn();
  await client.post('/api/rates/parse-pdf').set('X-CSRF-Token', token)
    .attach('pdf', Buffer.from('%PDF synthetic'), 'one.pdf').attach('pdf', Buffer.from('%PDF synthetic'), 'two.pdf').expect(400);
  await client.post('/api/rates/parse-pdf').set('X-CSRF-Token', token)
    .attach('pdf', Buffer.alloc(10 * 1024 * 1024 + 1), 'large.pdf').expect(400);
});
test('Gemini failures never leak provider credentials or documents', async (context) => {
  const sentinel = 'synthetic-provider-secret-and-customer-document';
  const messages = [];
  for (const method of ['error', 'log', 'warn']) context.mock.method(console, method, (...args) => messages.push(args.join(' ')));
  const { client, token } = await signIn(fresh({}, {}, { aiProvider: async () => { throw new Error(sentinel); }, aiOptions: { retries: 0 } }));
  const response = await client.post('/api/rates/parse-pdf').set('X-CSRF-Token', token)
    .attach('pdf', await rateFixtures.pdf(), 'test.pdf').expect(502);
  assert.ok(!JSON.stringify(response.body).includes(sentinel));
  assert.ok(!messages.join(' ').includes(sentinel));
});
test('invalid Gemini output is redacted, and synthetic valid PDF extraction still works', async (context) => {
  const logs = [];
  for (const method of ['error', 'log', 'warn']) context.mock.method(console, method, (...args) => logs.push(args.join(' ')));
  let output = 'synthetic-private-document-invalid-json';
  const { client, token } = await signIn(fresh({}, {}, { aiProvider: async () => output }));
  const bytes = await rateFixtures.pdf();
  const send = () => client.post('/api/rates/parse-pdf').set('X-CSRF-Token', token).attach('pdf', bytes, 'test.pdf');
  const invalid = await send().expect(422);
  assert.equal(invalid.body.rawOutput, undefined);
  assert.ok(!JSON.stringify(invalid.body).includes(output));
  assert.ok(!logs.join(' ').includes(output));
  output = JSON.stringify(rateFixtures.card());
  const valid = await send().expect(200);
  assert.equal(valid.body.data.rates[0].perKgRate, 15);
});
test('session store failures fail closed with a generic API error', async (context) => {
  const { response } = await signIn();
  const cookie = response.headers['set-cookie'][0].split(';')[0];
  context.mock.method(store, 'get', (id, callback) => callback(new Error('synthetic-private-db-credential')));
  const result = await request(app).get('/api/invoices').set('Cookie', cookie).expect(500);
  assert.equal(result.body.error, 'Unable to complete request. Please try again.');
});

function invoiceInput(patch = {}) {
  return { requestId: randomUUID(), expectedVersion: 0, invoiceNumber: `TEST-${randomUUID()}`, shipperCode: 'TEST',
    invoiceDate: '2026-01-02', clientName: 'Synthetic Customer', status: 'DRAFT',
    subtotal: 100, taxRate: 18, taxAmount: 18, totalAmount: 118, tax: { mode: 'SPLIT', cgstPct: 9, sgstPct: 9 }, shipments: [{ awb: 'TEST-AWB', bookingDate: '2026-01-02', destination: 'PATNA', weight: 2, manualAmount: 100, amount: 100 }], ...patch };
}
test('identical concurrent saves are idempotent and create exactly one invoice', async () => {
  const input = invoiceInput();
  const responses = await Promise.all([api.post('/api/invoices/save').send(input), api.post('/api/invoices/save').send(input)]);
  assert.deepEqual(responses.map((r) => r.status).sort(), [200, 201]);
  assert.equal(responses[0].body.data._id, responses[1].body.data._id);
  assert.equal(await Invoice.countDocuments({ invoiceNumber: input.invoiceNumber }), 1);
  assert.equal(responses[1].body.data.operations.length, 1);
});
test('duplicate invoice numbers and changed idempotency payloads are rejected', async () => {
  const input = invoiceInput();
  const created = await api.post('/api/invoices/save').send(input).expect(201);
  await api.post('/api/invoices/save').send({ ...input, requestId: randomUUID() }).expect(409);
  const changed = await api.post('/api/invoices/save').send({ ...input, notes: 'different' }).expect(409);
  assert.equal(changed.body.code, 'IDEMPOTENCY_CONFLICT');
  await api.post('/api/invoices/save').send({ ...input, invoiceNumber: 'CHANGED-NUMBER-SAME-REQUEST' }).expect(409);
  assert.equal(await Invoice.countDocuments({ invoiceNumber: 'CHANGED-NUMBER-SAME-REQUEST' }), 0);
  const original = await Invoice.findById(created.body.data._id).lean();
  assert.equal(original.revision, 1); assert.equal(original.notes, '');
});
test('draft updates use revisions and conflicting concurrent edits never partially combine', async () => {
  const input = invoiceInput();
  await api.post('/api/invoices/save').send(input).expect(201);
  const updated = await api.post('/api/invoices/save').send({ ...input, expectedVersion: 1, requestId: randomUUID(), notes: 'revision two' }).expect(200);
  assert.equal(updated.body.data.revision, 2);
  const responses = await Promise.all(['first', 'second'].map((notes) => api.post('/api/invoices/save').send({ ...input, expectedVersion: 2, requestId: randomUUID(), notes })));
  assert.deepEqual(responses.map((r) => r.status).sort(), [200, 409]);
  const stored = await Invoice.findOne({ invoiceNumber: input.invoiceNumber }).lean();
  assert.equal(stored.revision, 3); assert.equal(stored.operations.length, 3);
  assert.ok(['first', 'second'].includes(stored.notes));
});
test('finalized and paid contents are immutable; paid and cancellation actions retain original amounts', async () => {
  const input = invoiceInput();
  const created = await api.post('/api/invoices/save').send(input).expect(201);
  const final = { ...input, requestId: randomUUID(), expectedVersion: 1, status: 'GENERATED' };
  await api.post('/api/invoices/save').send(final).expect(200);
  await api.post('/api/invoices/save').send({ ...final, requestId: randomUUID(), expectedVersion: 2, notes: 'overwrite attempt' }).expect(409);
  const paid = { requestId: randomUUID(), expectedVersion: 2, status: 'PAID', reason: 'Synthetic payment' };
  await api.post(`/api/invoices/${created.body.data._id}/status`).send(paid).expect(200);
  await api.post(`/api/invoices/${created.body.data._id}/status`).send(paid).expect(200);
  await api.post('/api/invoices/save').send({ ...final, requestId: randomUUID(), expectedVersion: 3, totalAmount: 1 }).expect(409);
  const cancel = { requestId: randomUUID(), expectedVersion: 3, status: 'CANCELLED', reason: 'Documented correction required' };
  const cancelled = await api.post(`/api/invoices/${created.body.data._id}/status`).send(cancel).expect(200);
  assert.equal(cancelled.body.data.totalAmount, 118); assert.equal(cancelled.body.data.shipments[0].amount, 100);
  assert.equal(cancelled.body.data.operations.at(-1).reason, cancel.reason);
  await api.post(`/api/invoices/${created.body.data._id}/status`).send({ requestId: randomUUID(), expectedVersion: 4, status: 'PAID', reason: 'reopen' }).expect(409);
});
test('corrections link new numbers without mutating original finalized data', async () => {
  const original = invoiceInput({ status: 'GENERATED' });
  const created = await api.post('/api/invoices/save').send(original).expect(201);
  const before = await Invoice.findById(created.body.data._id).lean();
  const correction = invoiceInput({ correctionOf: original.invoiceNumber, correctionReason: 'Synthetic address correction' });
  const saved = await api.post('/api/invoices/save').send(correction).expect(201);
  assert.equal(saved.body.data.correctionOf, original.invoiceNumber.toUpperCase());
  assert.deepEqual(await Invoice.findById(before._id).lean(), before);
});
test('legacy historical documents remain readable and cannot be silently adopted or overwritten', async () => {
  const legacy = { invoiceNumber: 'LEGACY-PRESERVED', shipperCode: 'TEST', invoiceDate: new Date('2020-01-02'), status: 'GENERATED', totalAmount: 987.65,
    shipments: [{ awb: 'LEGACY-TEST', amount: 987.65 }], legacyExtra: { retained: true } };
  const inserted = await Invoice.collection.insertOne(legacy);
  const before = await Invoice.collection.findOne({ _id: inserted.insertedId });
  await api.get('/api/invoices/LEGACY-PRESERVED').expect(200);
  const rejected = await api.post('/api/invoices/save').send(invoiceInput({ invoiceNumber: legacy.invoiceNumber })).expect(409);
  assert.equal(rejected.body.code, 'LEGACY_READ_ONLY');
  assert.deepEqual(await Invoice.collection.findOne({ _id: inserted.insertedId }), before);
});
test('invalid fields and failed updates leave invoice data unchanged', async (context) => {
  const input = invoiceInput();
  const created = await api.post('/api/invoices/save').send(input).expect(201);
  const before = await Invoice.findById(created.body.data._id).lean();
  for (const patch of [{ invoiceDate: '2026-02-30' }, { totalAmount: null }, { totalAmount: '-1' }, { shipments: [{}] }, { status: 'PAID' }]) {
    await api.post('/api/invoices/save').send({ ...input, expectedVersion: 1, requestId: randomUUID(), ...patch }).expect(400);
  }
  await api.post('/api/invoices/save').send({ ...input, expectedVersion: 1, requestId: randomUUID(), client: '000000000000000000000001' }).expect(400);
  context.mock.method(Invoice, 'findOneAndUpdate', () => { throw new Error('synthetic failure'); });
  await api.post('/api/invoices/save').send({ ...input, expectedVersion: 1, requestId: randomUUID(), notes: 'must not appear' }).expect(500);
  assert.deepEqual(await Invoice.findById(before._id).lean(), before);
});
test('complete metadata and shipment snapshot survives persistence without repricing', async () => {
  await rateFixtures.publishFixture(rateFixtures.card());
  const adapter = require('../../../mobile-bill-app/persistence');
  const fixture = structuredClone(require('../../../tests/fixtures/bill.json'));
  fixture.bill.invoiceNo = 'SNAPSHOT-TEST';
  const payload = adapter.payload(fixture, 'GENERATED', () => ({ status: 'ok', amount: 45 }), () => ({ gross: 45, fuel: 9, subtotal: 54, cgst: 4.86, sgst: 4.86, final: 63.72 }));
  const saved = await api.post('/api/invoices/save').send({ ...payload, requestId: randomUUID(), expectedVersion: 0 }).expect(201);
  assert.equal(saved.body.data.totalsVerified, true); assert.equal(saved.body.data.calculationContract, 'courier-v1');
  assert.equal(saved.body.data.reconstructionComplete, true);
  assert.deepEqual(saved.body.data.snapshot, payload.snapshot);
  assert.equal(saved.body.data.shipments[0].pcs, 1); assert.equal(saved.body.data.shipments[0].rateSnapshot.baseRate, 45);
});
test('new lifecycle endpoints retain authentication and CSRF protections', async () => {
  const path = '/api/invoices/000000000000000000000001/status';
  await request(app).post(path).send({}).expect(401);
  await agent.post(path).send({}).expect(403);
  await api.post(path).send({}).expect(400);
});
test('history lists stay lightweight while detail preserves reconstruction data', async () => {
  const list = await api.get('/api/invoices?limit=100').expect(200);
  const snapshot = list.body.data.find((item) => item.invoiceNumber === 'SNAPSHOT-TEST');
  assert.equal(snapshot.snapshot, undefined); assert.equal(snapshot.operations, undefined);
  assert.equal(snapshot.calculationSnapshot, undefined);
  const detail = await api.get(`/api/invoices/${snapshot._id}`).expect(200);
  assert.equal(detail.body.data.snapshot.totals.final, 63.72);
  assert.equal(detail.body.data.operations.length, 1);
});
test('invoice search rejects malformed filters and treats search input literally', async () => {
  for (const query of ['startDate=bad', 'endDate=2026-02-30', 'startDate=2026-02-01&endDate=2026-01-01', 'page=-1', 'limit=NaN', 'status=WRONG', 'unknown=value']) {
    await api.get(`/api/invoices/search?${query}`).expect(400);
  }
  const input = invoiceInput({ clientName: 'Synthetic [literal' });
  await api.post('/api/invoices/save').send(input).expect(201);
  const result = await api.get('/api/invoices/search?q=%5Bliteral').expect(200);
  assert.equal(result.body.count, 1);
});
test('concurrent lifecycle retries append only one audit operation', async () => {
  const created = await api.post('/api/invoices/save').send(invoiceInput({ status: 'GENERATED' })).expect(201);
  const body = { requestId: randomUUID(), expectedVersion: 1, status: 'PAID', reason: 'Synthetic payment' };
  const results = await Promise.all([api.post(`/api/invoices/${created.body.data._id}/status`).send(body), api.post(`/api/invoices/${created.body.data._id}/status`).send(body)]);
  assert.deepEqual(results.map((r) => r.status), [200, 200]);
  assert.equal((await Invoice.findById(created.body.data._id)).operations.length, 2);
  const other = await api.post('/api/invoices/save').send(invoiceInput({ status: 'GENERATED' })).expect(201);
  await api.post(`/api/invoices/${other.body.data._id}/status`).send(body).expect(409);
  assert.equal((await Invoice.findById(other.body.data._id)).status, 'GENERATED');
});
async function financialCard(baseRate = 45) {
  return rateFixtures.publishFixture(rateFixtures.card('BILLING-TEST', [{ targetName: 'patna', targetType: 'CITY', baseKg: 3, baseRate, perKgRate: 15 }]));
}
function financialInput(patch = {}) {
  return { requestId: randomUUID(), expectedVersion: 0, invoiceNumber: `FIN-${randomUUID()}`, shipperCode: 'BILLING-TEST', clientName: 'Synthetic Customer', invoiceDate: '2026-01-02',
    status: 'GENERATED', tax: { mode: 'SPLIT', fuelPct: 20, cgstPct: 9, sgstPct: 9, igstPct: 0 },
    shipments: [{ awb: 'FIN-AWB', bookingDate: '2026-01-02', destination: 'PATNA', actualWeight: 1, pcs: 1, amount: 45 }],
    subtotal: 54, taxRate: 18, taxAmount: 9.72, totalAmount: 63.72, ...patch };
}
test('server independently verifies new final invoices using published base-charge cards', async () => {
  await financialCard();
  const saved = await api.post('/api/invoices/save').send(financialInput()).expect(201);
  assert.equal(saved.body.data.totalsVerified, true); assert.equal(saved.body.data.schemaVersion, 3);
  assert.equal(saved.body.data.calculationSnapshot.paise.final, 6372);
  assert.equal(saved.body.data.calculationSnapshot.appliedRates[0].rate.baseRate, 45);
  assert.equal(saved.body.data.calculationSnapshot.amountWords, 'SIXTY THREE AND SEVENTY TWO PAISE');
});
for (const field of ['subtotal', 'taxAmount', 'totalAmount']) {
  test(`tampered ${field} cannot be finalized`, async () => {
    await financialCard();
    const body = financialInput({ [field]: 1 });
    const response = await api.post('/api/invoices/save').send(body).expect(422);
    assert.equal(response.body.code, 'CALCULATION_MISMATCH');
    assert.ok(response.body.reconciliation.mismatches.some((item) => item.field === field));
    assert.equal(await Invoice.countDocuments({ invoiceNumber: body.invoiceNumber }), 0);
  });
}
test('tampered shipment amount, missing rate and malformed monetary values are rejected', async () => {
  await financialCard();
  const bad = financialInput(); bad.shipments[0].amount = 1;
  await api.post('/api/invoices/save').send(bad).expect(422);
  const rateTamper = financialInput(); rateTamper.shipments[0].rateSnapshot = { baseKg: 3, baseRate: 999, perKgRate: 15 };
  await api.post('/api/invoices/save').send(rateTamper).expect(422);
  const missing = financialInput(); missing.shipments[0].destination = 'UNKNOWN';
  assert.equal((await api.post('/api/invoices/save').send(missing).expect(422)).body.code, 'RATE_REVIEW_REQUIRED');
  await api.post('/api/invoices/save').send(financialInput({ totalAmount: '63.72' })).expect(400);
});
test('calculation endpoint requires authentication/CSRF and returns structured reconciliation', async () => {
  await financialCard();
  await request(app).post('/api/invoices/calculate').send(financialInput()).expect(401);
  await agent.post('/api/invoices/calculate').send(financialInput()).expect(403);
  const result = await api.post('/api/invoices/calculate').send(financialInput({ totalAmount: 1 })).expect(200);
  assert.equal(result.body.calculation.totals.final, 63.72);
  assert.equal(result.body.mismatches[0].field, 'totalAmount');
});
test('committed replay ignores new rates, edited idempotency payload fails, historical calculation is unchanged', async () => {
  await financialCard();
  const input = financialInput();
  const created = await api.post('/api/invoices/save').send(input).expect(201);
  const before = await Invoice.findById(created.body.data._id).lean();
  await financialCard(99);
  const replay = await api.post('/api/invoices/save').send(input).expect(200);
  assert.equal(replay.body.replayed, true); assert.equal(replay.body.data.totalAmount, 63.72);
  await api.post('/api/invoices/save').send({ ...input, totalAmount: 99 }).expect(409);
  assert.deepEqual(await Invoice.findById(before._id).lean(), before);
  const correction = financialInput({ correctionOf: input.invoiceNumber, correctionReason: 'Synthetic new-rate correction' });
  await api.post('/api/invoices/save').send(correction).expect(422);
  correction.shipments[0].amount = 99; correction.subtotal = 118.8; correction.taxAmount = 21.38; correction.totalAmount = 140.18;
  const corrected = await api.post('/api/invoices/save').send(correction).expect(201);
  assert.equal(corrected.body.data.calculationSnapshot.appliedRates[0].rate.baseRate, 99);
  assert.deepEqual(await Invoice.findById(before._id).lean(), before);
});
test('IGST, no-tax and explicit manual totals are independently checked', async () => {
  const input = financialInput({ tax: { mode: 'IGST', fuelPct: 20, igstPct: 18 }, taxRate: 18 });
  input.shipments[0].manualAmount = 45;
  const result = await api.post('/api/invoices/save').send(input).expect(201);
  assert.equal(result.body.data.calculationSnapshot.paise.igst, 972);
  assert.equal(result.body.data.calculationSnapshot.appliedRates[0].manualOverride, true);
  await api.post('/api/invoices/save').send({ ...input, invoiceNumber: 'NONE-TEST', requestId: randomUUID(), tax: { mode: 'NONE', fuelPct: 20 }, taxRate: 0, taxAmount: 0, totalAmount: 54 }).expect(201);
  await api.post('/api/invoices/save').send({ ...input, requestId: randomUUID(), invoiceNumber: 'BAD-TAX', tax: { mode: 'IGST', cgstPct: 9, igstPct: 18 } }).expect(400);
});
test('legacy base-charge omission is estimate-only and cannot certify a final invoice', async () => {
  await Rate.create({ shipperCode: 'LEGACY-RATE', targetName: 'patna', targetType: 'CITY', baseKg: 3, perKgRate: 15 });
  const estimate = await api.post('/api/rates/calculate').send({ shipperCode: 'LEGACY-RATE', destination: 'patna', weight: 1 }).expect(200);
  assert.equal(estimate.body.calculatedAmount, 45); assert.equal(estimate.body.requiresRateReview, true);
  await api.post('/api/rates/calculate').send({ shipperCode: 'LEGACY-RATE', destination: 'patna', weight: null }).expect(400);
  await api.post('/api/rates/calculate').send({ shipperCode: 'LEGACY-RATE', destination: 'patna', weight: 1, pcs: null }).expect(400);
  await api.post('/api/rates').send({ shipperCode: 'LEGACY-RATE', targetName: 'invalid', targetType: 'CITY', baseKg: null, baseRate: 0, perKgRate: 0 }).expect(400);
  await api.post('/api/invoices/save').send(financialInput({ shipperCode: 'LEGACY-RATE' })).expect(422);
});
test('new finalizations cannot rely on legacy implicit claims or default tax assumptions', async () => {
  const missing = financialInput(); delete missing.totalAmount;
  await api.post('/api/invoices/save').send(missing).expect(400);
  const noTax = financialInput(); delete noTax.tax;
  assert.equal((await api.post('/api/invoices/save').send(noTax).expect(400)).body.code, 'TAX_CONFIGURATION_REQUIRED');
  const noWeight = financialInput(); delete noWeight.shipments[0].actualWeight;
  assert.equal((await api.post('/api/invoices/save').send(noWeight).expect(400)).body.code, 'SHIPMENT_WEIGHT_REQUIRED');
});
test('Phase 2 committed request IDs still replay without financial recertification', async () => {
  const { validateInvoice, fingerprint } = require('../../services/invoiceValidation');
  const input = invoiceInput({ status: 'GENERATED' }); delete input.tax;
  const { data } = validateInvoice(input);
  const old = await Invoice.create({ ...data, schemaVersion: 2, revision: 1, totalsVerified: false,
    operations: [{ requestId: input.requestId, hash: fingerprint({ action: 'SAVE', expectedVersion: 0, data }), version: 1, action: 'SAVE', status: 'GENERATED' }] });
  const replay = await api.post('/api/invoices/save').send(input).expect(200);
  assert.equal(replay.body.data._id, String(old._id)); assert.equal(replay.body.data.totalsVerified, false);
  await api.post('/api/invoices/save').send({ ...input, totalAmount: 1 }).expect(409);
});
const RateBook = require('../../models/RateBook');
const RateDraft = require('../../models/RateCardDraft');
const RateContract = require('../../../mobile-bill-app/rate-card');
async function draftFor(card) {
  return (await api.post('/api/rate-cards/drafts').send({ requestId: randomUUID(), expectedRevision: 0, card }).expect(200)).body.data;
}
function publication(draft, expectedRevision = 0) {
  return { requestId: randomUUID(), shipperCode: draft.shipperCode, expectedRevision, draftId: draft._id, draftRevision: draft.revision, approved: true,
    acknowledgedWarnings: RateContract.normalize(draft.card).warnings.map((warning) => warning.code) };
}
test('new rate-card endpoints require authentication, CSRF and explicit approval', async () => {
  for (const path of ['/api/rate-cards/drafts', '/api/rate-cards/publish', '/api/rate-cards/rollback']) {
    await request(app).post(path).send({}).expect(401);
    await agent.post(path).send({}).expect(403);
  }
  const draft = await draftFor(rateFixtures.card('APPROVAL-TEST'));
  await api.post('/api/rate-cards/publish').send({ ...publication(draft), approved: false }).expect(400);
  await api.post('/api/rate-cards/publish').send({ ...publication(draft), acknowledgedWarnings: [] }).expect(400);
  assert.equal(await RateBook.findById('APPROVAL-TEST'), null);
});
test('reviewed drafts save and update without changing active or legacy rates', async () => {
  const card = rateFixtures.card('DRAFT-ONLY');
  await Rate.create({ shipperCode: card.shipperCode, targetName: 'patna', targetType: 'CITY', baseKg: 3, baseRate: 999, perKgRate: 15 });
  const draft = await draftFor(card);
  card.rates[0].baseRate = 50;
  const changed = await api.post('/api/rate-cards/drafts').send({ requestId: randomUUID(), draftId: draft._id, expectedRevision: 1, card }).expect(200);
  assert.equal(changed.body.data.revision, 2);
  assert.equal(await RateBook.findById(card.shipperCode), null);
  assert.equal((await Rate.findOne({ shipperCode: card.shipperCode })).baseRate, 999);
  await api.post('/api/rates').send({ shipperCode: card.shipperCode, targetName: 'patna', targetType: 'CITY', baseKg: 3, baseRate: 1, perKgRate: 0 }).expect(409);
  assert.equal((await Rate.findOne({ shipperCode: card.shipperCode })).baseRate, 999);
});
test('publication is atomic, idempotent and switches all rates together', async () => {
  const draft = await draftFor(rateFixtures.card('ATOMIC-CARD', [
    { targetName: 'patna', targetType: 'CITY', baseKg: 3, baseRate: 45, perKgRate: 15 },
    { targetName: 'ranchi', targetType: 'CITY', baseKg: 2, baseRate: 60, perKgRate: 20 }
  ]));
  const body = publication(draft);
  const results = await Promise.all([api.post('/api/rate-cards/publish').send(body), api.post('/api/rate-cards/publish').send(body)]);
  assert.deepEqual(results.map((r) => r.status), [200, 200]);
  const book = await RateBook.findById(draft.shipperCode).lean(); assert.equal(book.versions.length, 1); assert.equal(book.operations.length, 1);
  const rates = await api.get('/api/rates?shipperCode=ATOMIC-CARD').expect(200);
  assert.equal(rates.body.data.length, 2); assert.ok(rates.body.data.every((r) => r.approved && r.publicationVersion === 1));
  await api.post('/api/rate-cards/publish').send({ ...body, expectedRevision: 1 }).expect(409);
});
test('concurrent publications conflict instead of overwriting a winner', async () => {
  const first = await draftFor(rateFixtures.card('RACE-CARD'));
  const altered = structuredClone(first.card); altered.rates[0].baseRate = 70;
  const second = await draftFor(altered);
  const results = await Promise.all([api.post('/api/rate-cards/publish').send(publication(first)), api.post('/api/rate-cards/publish').send(publication(second))]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  assert.equal((await RateBook.findById(first.shipperCode)).versions.length, 1);
});
test('publication database failure leaves the previously approved version unchanged', async (context) => {
  const first = await draftFor(rateFixtures.card('FAILURE-CARD'));
  await api.post('/api/rate-cards/publish').send(publication(first)).expect(200);
  const next = structuredClone(first.card); next.rates[0].baseRate = 80;
  const draft = await draftFor(next);
  const before = await RateBook.findById(first.shipperCode).lean();
  context.mock.method(RateBook, 'findOneAndUpdate', () => { throw new Error('synthetic database failure'); });
  await api.post('/api/rate-cards/publish').send(publication(draft, 1)).expect(500);
  assert.deepEqual(await RateBook.findById(first.shipperCode).lean(), before);
});
test('rollback creates a new approved version without changing historical invoices', async () => {
  const shipper = 'ROLLBACK-CARD';
  const first = await draftFor(rateFixtures.card(shipper));
  await api.post('/api/rate-cards/publish').send(publication(first)).expect(200);
  const input = financialInput({ shipperCode: shipper });
  const saved = await api.post('/api/invoices/save').send(input).expect(201);
  const oldInvoice = await Invoice.findById(saved.body.data._id).lean();
  const revised = structuredClone(first.card); revised.rates[0].baseRate = 99;
  const second = await draftFor(revised);
  await api.post('/api/rate-cards/publish').send(publication(second, 1)).expect(200);
  assert.equal((await api.post('/api/rates/calculate').send({ shipperCode: shipper, destination: 'patna', weight: 1 }).expect(200)).body.calculatedAmount, 99);
  const body = { requestId: randomUUID(), shipperCode: shipper, expectedRevision: 2, sourceVersion: 1, approved: true };
  await api.post('/api/rate-cards/rollback').send(body).expect(200);
  await api.post('/api/rate-cards/rollback').send(body).expect(200);
  const book = await RateBook.findById(shipper).lean(); assert.equal(book.versions.length, 3); assert.equal(book.activeVersion, 3);
  assert.equal((await api.post('/api/rates/calculate').send({ shipperCode: shipper, destination: 'patna', weight: 1 }).expect(200)).body.calculatedAmount, 45);
  assert.deepEqual(await Invoice.findById(oldInvoice._id).lean(), oldInvoice);
});
test('draft tampering, stale revisions and cross-shipper identifiers are rejected', async () => {
  const draft = await draftFor(rateFixtures.card('IDENTITY-CARD'));
  await api.get(`/api/rate-cards/drafts/${draft._id}?shipperCode=OTHER`).expect(404);
  await api.post('/api/rate-cards/publish').send({ ...publication(draft), shipperCode: 'OTHER' }).expect(409);
  const altered = structuredClone(draft.card); altered.rates[0].baseRate = null;
  await api.post('/api/rate-cards/drafts').send({ requestId: randomUUID(), draftId: draft._id, expectedRevision: 1, card: altered }).expect(400);
  await api.post('/api/rate-cards/drafts').send({ requestId: randomUUID(), draftId: draft._id, expectedRevision: 0, card: draft.card }).expect(409);
  assert.equal((await RateDraft.findById(draft._id)).revision, 1);
});
test('fake signatures and corrupt PDFs never reach the provider', async () => {
  let calls = 0;
  const { client, token } = await signIn(fresh({}, {}, { aiProvider: async () => { calls++; return JSON.stringify(rateFixtures.card()); } }));
  for (const bytes of [Buffer.from('not a PDF'), Buffer.from('%PDF-1.7 corrupt %%EOF'), Buffer.alloc(0)]) {
    await client.post('/api/rates/parse-pdf').set('X-CSRF-Token', token).attach('pdf', bytes, { filename: 'fake.pdf', contentType: 'application/pdf' }).expect(400);
  }
  assert.equal(calls, 0);
});
test('parser timeout, service outage, credentials and quota return safe failures', async () => {
  const bytes = await rateFixtures.pdf();
  for (const [provider, expected, code] of [
    [async () => new Promise(() => {}), 504, 'AI_TIMEOUT'],
    [async () => { throw { status: 503, message: 'secret' }; }, 502, 'AI_UNAVAILABLE'],
    [async () => { throw { status: 401, message: 'secret' }; }, 503, 'AI_CREDENTIALS'],
    [async () => { throw { status: 429, message: 'secret' }; }, 429, 'AI_QUOTA']
  ]) {
    const { client, token } = await signIn(fresh({}, {}, { aiProvider: provider, aiOptions: { timeoutMs: 10, retries: 0, totalMs: 20 } }));
    const result = await client.post('/api/rates/parse-pdf').set('X-CSRF-Token', token).attach('pdf', bytes, 'test.pdf').expect(expected);
    assert.equal(result.body.code, code); assert.ok(!JSON.stringify(result.body).includes('secret'));
  }
});
test('missing AI charges are unresolved, malformed fields are rejected, and neither changes rates', async () => {
  const bytes = await rateFixtures.pdf(); const input = rateFixtures.card('AI-UNRESOLVED'); input.rates[0].baseRate = null;
  let output = JSON.stringify(input);
  const { client, token } = await signIn(fresh({}, {}, { aiProvider: async () => output }));
  const send = () => client.post('/api/rates/parse-pdf').set('X-CSRF-Token', token).attach('pdf', bytes, 'test.pdf');
  const unresolved = await send().expect(200); assert.equal(unresolved.body.complete, false); assert.equal(unresolved.body.data.rates[0].baseRate, null);
  input.rates[0].baseCharge = 45; output = JSON.stringify(input);
  await send().expect(422); assert.equal(await RateBook.findById(input.shipperCode), null);
});
test('only one PDF is admitted while a provider operation is in flight', async () => {
  let started; const entered = new Promise((resolve) => { started = resolve; }); let release;
  const provider = () => { started(); return new Promise((resolve) => { release = () => resolve(JSON.stringify(rateFixtures.card())); }); };
  const { client, token } = await signIn(fresh({}, {}, { aiProvider: provider }));
  const bytes = await rateFixtures.pdf();
  const first = client.post('/api/rates/parse-pdf').set('X-CSRF-Token', token).attach('pdf', bytes, 'test.pdf').then((r) => r);
  await entered;
  await client.post('/api/rates/parse-pdf').set('X-CSRF-Token', token).attach('pdf', bytes, 'test.pdf').expect(429);
  release(); assert.equal((await first).status, 200);
});
test('operational health, private counters and request identifiers expose no customer data', async () => {
  await request(app).get('/api/health/live').expect(200, { status: 'alive' });
  const ready = await request(app).get('/api/health/ready').expect(200);
  assert.deepEqual(ready.body, { status: 'ready' }); assert.match(ready.headers['x-request-id'], /^[a-f0-9-]{36}$/);
  await request(app).get('/api/ops/status').expect(401);
  const metrics = await api.get('/api/ops/status').expect(200); assert.equal(metrics.body.ready, true); assert.ok(metrics.body.counters.requests > 0);
  assert.equal(metrics.body.database, undefined); assert.equal(metrics.body.adminUsername, undefined);
});
test('incompatible client protocol rejects writes before persistence and correlation headers are server generated', async () => {
  const input = invoiceInput();
  const result = await api.post('/api/invoices/save').set('X-Courier-Protocol', 'future-v999').set('X-Request-ID', 'untrusted-client-id').send(input).expect(409);
  assert.equal(result.body.code, 'CLIENT_VERSION'); assert.notEqual(result.headers['x-request-id'], 'untrusted-client-id');
  assert.equal(await Invoice.countDocuments({ invoiceNumber: input.invoiceNumber }), 0);
});
test('disconnected isolated database fails safely without buffering a write', async () => {
  const memory = new (require('../../node_modules/express-session').MemoryStore)();
  const isolated = createApp(config, { sessionStore: memory });
  const { client, token } = await signIn(isolated);
  const input = invoiceInput();
  await mongoose.disconnect();
  try {
    await client.get('/api/health/live').expect(200);
    await client.get('/api/health/ready').expect(503, { status: 'unavailable' });
    const result = await client.post('/api/invoices/save').set('X-CSRF-Token', token).send(input).expect(503);
    assert.equal(result.body.code, 'DATABASE_UNAVAILABLE');
  } finally { await mongoose.connect(testUri, { serverSelectionTimeoutMS: 5000 }); }
  assert.equal(await Invoice.countDocuments({ invoiceNumber: input.invoiceNumber }), 0);
});
